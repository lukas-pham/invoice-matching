import type {
  ExceptionType,
  GoodsReceipt,
  InvoiceData,
  LinePair,
  MatchException,
  MatchResult,
  PurchaseOrder,
  Thresholds,
} from "./types";

/**
 * All match / no-match decisions live here, in plain code (FIN-1).
 * The model may suggest line pairs; a person confirms them; this file decides.
 */

const ROUND = 1; // VND rounding tolerance per line

// ---------- 3.4 arithmetic ----------
export function checkArithmetic(inv: InvoiceData, totalAbs: number): MatchException[] {
  const out: MatchException[] = [];
  let subtotal = 0;
  let tax = 0;
  for (const l of inv.lines) {
    const expected = Math.round(l.quantity * l.unitPrice);
    if (Math.abs(expected - l.amount) > ROUND)
      out.push({ type: "ARITHMETIC", lineNo: l.no, message: `Line ${l.no}: quantity × price = ${expected}, invoice says ${l.amount}.`, expected, actual: l.amount, route: "accounting" });
    subtotal += l.amount;
    if (l.taxRate > 0) tax += l.amount * l.taxRate;
  }
  const sub = inv.subtotal.value ?? 0;
  const taxAmt = inv.taxAmount.value ?? 0;
  const total = inv.total.value ?? 0;
  if (Math.abs(subtotal - sub) > totalAbs)
    out.push({ type: "ARITHMETIC", message: `Sum of lines is ${subtotal}, subtotal says ${sub}.`, expected: subtotal, actual: sub, route: "accounting" });
  if (Math.abs(Math.round(tax) - taxAmt) > totalAbs)
    out.push({ type: "ARITHMETIC", message: `VAT should be ${Math.round(tax)}, invoice says ${taxAmt}.`, expected: Math.round(tax), actual: taxAmt, route: "accounting" });
  if (Math.abs(sub + taxAmt - total) > totalAbs)
    out.push({ type: "ARITHMETIC", message: `Subtotal + VAT = ${sub + taxAmt}, total says ${total}.`, expected: sub + taxAmt, actual: total, route: "accounting" });
  return out;
}

// ---------- line pairing ----------
const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim();

/** Deterministic pairing by SKU, then exact normalised name. Leftovers go to the AI suggester + human. */
export function pairLines(inv: InvoiceData, pos: PurchaseOrder[], confirmed: LinePair[] = []): { pairs: LinePair[]; unmatched: number[] } {
  const pairs: LinePair[] = [...confirmed];
  const used = new Set(confirmed.map((p) => `${p.poNumber}#${p.poLine}`));
  const done = new Set(confirmed.map((p) => p.invoiceLine));
  for (const l of inv.lines) {
    if (done.has(l.no)) continue;
    let hit: LinePair | undefined;
    for (const po of pos) {
      for (const pl of po.lines) {
        const key = `${po.number}#${pl.no}`;
        if (used.has(key)) continue;
        if (l.sku && pl.sku && norm(l.sku) === norm(pl.sku)) hit = { invoiceLine: l.no, poNumber: po.number, poLine: pl.no, method: "sku" };
        else if (norm(l.description) === norm(pl.description)) hit ??= { invoiceLine: l.no, poNumber: po.number, poLine: pl.no, method: "exact_name" };
        if (hit?.method === "sku") break;
      }
      if (hit?.method === "sku") break;
    }
    if (hit) {
      pairs.push(hit);
      used.add(`${hit.poNumber}#${hit.poLine}`);
    }
  }
  const paired = new Set(pairs.map((p) => p.invoiceLine));
  return { pairs, unmatched: inv.lines.filter((l) => !paired.has(l.no)).map((l) => l.no) };
}

export const splitPoNumbers = (s: string | null) => (s ?? "").split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

// ---------- 3.5 / 3.6 two-way and three-way matching ----------
export function matchInvoice(args: {
  invoice: InvoiceData;
  pos: PurchaseOrder[]; // all POs found for the invoice's PO numbers
  receipts: GoodsReceipt[]; // all GRNs for those POs
  /** Quantities already invoiced on earlier invoices, per `${po}#${sku}` */
  alreadyInvoiced?: Map<string, number>;
  confirmedPairs?: LinePair[];
  thresholds: Thresholds;
}): MatchResult {
  const { invoice: inv, pos, receipts, thresholds: t } = args;
  const ex: MatchException[] = [];
  const add = (type: ExceptionType, message: string, route: MatchException["route"], extra: Partial<MatchException> = {}) =>
    ex.push({ type, message, route, ...extra });

  ex.push(...checkArithmetic(inv, t.totalAbs));

  const requested = splitPoNumbers(inv.poNumbers.value);
  if (!requested.length) add("MISSING_PO", "The invoice has no purchase order number.", "requester");
  for (const n of requested) if (!pos.some((p) => p.number === n)) add("PO_NOT_FOUND", `PO ${n} does not exist.`, "requester");

  for (const po of pos)
    if (po.vendorTaxId !== inv.vendorTaxId.value)
      add("VENDOR_MISMATCH", `PO ${po.number} belongs to tax ID ${po.vendorTaxId}, invoice is from ${inv.vendorTaxId.value}.`, "purchasing", { expected: po.vendorTaxId, actual: inv.vendorTaxId.value ?? "" });

  // Services need only 2-way; any goods PO makes it 3-way.
  const mode = pos.some((p) => p.type === "goods") ? "three_way" : "two_way";
  const { pairs, unmatched } = pairLines(inv, pos, args.confirmedPairs);
  for (const n of unmatched) add("UNMATCHED_LINE", `Invoice line ${n} does not match any PO line.`, "purchasing", { lineNo: n });

  for (const pair of pairs) {
    const line = inv.lines.find((l) => l.no === pair.invoiceLine)!;
    const po = pos.find((p) => p.number === pair.poNumber)!;
    const pl = po.lines.find((l) => l.no === pair.poLine)!;

    // Price: variance must exceed BOTH the % and the absolute tolerance to be an exception.
    const diff = line.unitPrice - pl.unitPrice;
    if (Math.abs(diff) > t.priceAbs && Math.abs(diff) / pl.unitPrice > t.pricePct)
      add("PRICE_VARIANCE", `Line ${line.no}: unit price ${line.unitPrice} vs PO ${pl.unitPrice} (${((diff / pl.unitPrice) * 100).toFixed(1)}%).`, "purchasing", {
        lineNo: line.no, expected: pl.unitPrice, actual: line.unitPrice,
      });

    const prior = args.alreadyInvoiced?.get(`${po.number}#${pl.sku}`) ?? 0;
    if (po.type === "goods") {
      const received = receipts.filter((r) => r.poNumber === po.number).flatMap((r) => r.lines).filter((r) => r.sku === pl.sku).reduce((s, r) => s + r.quantity, 0);
      const billable = received - prior;
      if (received === 0) add("NO_RECEIPT", `Line ${line.no}: nothing received yet for ${pl.sku}.`, "warehouse", { lineNo: line.no, expected: 0, actual: line.quantity });
      else if (line.quantity > billable * (1 + t.qtyPct))
        add("QTY_OVER_RECEIVED", `Line ${line.no}: billed ${line.quantity}, received and not yet billed ${billable}.`, "warehouse", { lineNo: line.no, expected: billable, actual: line.quantity });
      else if (received < pl.quantity && line.quantity <= billable)
        add("PARTIAL_RECEIPT", `Line ${line.no}: partial delivery (${received} of ${pl.quantity} received). Billed quantity is covered.`, "warehouse", { lineNo: line.no, expected: pl.quantity, actual: received });
    } else if (line.quantity + prior > pl.quantity * (1 + t.qtyPct)) {
      add("QTY_OVER_RECEIVED", `Line ${line.no}: billed ${line.quantity + prior} in total, PO allows ${pl.quantity}.`, "requester", { lineNo: line.no, expected: pl.quantity, actual: line.quantity + prior });
    }
  }

  // PARTIAL_RECEIPT is informational: it does not block auto-match by itself.
  const blocking = ex.filter((e) => e.type !== "PARTIAL_RECEIPT");
  return { mode, pairs, exceptions: ex, autoMatched: blocking.length === 0 };
}

// ---------- 3.8 duplicates ----------
export interface InvoiceKey {
  id: string;
  vendorTaxId: string;
  series: string;
  number: string;
  date: string;
  total: number;
}

export function findDuplicates(inv: InvoiceKey, existing: InvoiceKey[]) {
  const exact: string[] = [];
  const near: string[] = [];
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^0+/, "");
  for (const e of existing) {
    if (e.id === inv.id || e.vendorTaxId !== inv.vendorTaxId) continue;
    const sameNumber = digits(e.number) === digits(inv.number) && e.series === inv.series;
    if (sameNumber && e.date === inv.date && e.total === inv.total) exact.push(e.id);
    else if (sameNumber || (e.total === inv.total && Math.abs(Date.parse(e.date) - Date.parse(inv.date)) <= 3 * 86_400_000)) near.push(e.id);
  }
  return { exact, near };
}

// ---------- low confidence gate (FIN-7) ----------
export function lowConfidenceFields(inv: InvoiceData, threshold: number): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(inv)) {
    if (v && typeof v === "object" && "confidence" in v && !(v as { confirmedBy?: string }).confirmedBy && (v as { confidence: number }).confidence < threshold) out.push(k);
  }
  inv.lines.forEach((l) => {
    if ((l.confidence ?? 1) < threshold) out.push(`line ${l.no}`);
  });
  return out;
}
