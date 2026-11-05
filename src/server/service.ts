import type { Invoice } from "@prisma/client";
import { audit, db } from "./db";
import { findDuplicates, lowConfidenceFields, matchInvoice, splitPoNumbers } from "../core/matching";
import { DEFAULT_THRESHOLDS, type GoodsReceipt, type InvoiceData, type LinePair, type PurchaseOrder, type Thresholds } from "../core/types";
import { explainException, suggestPairs } from "../ai/ai";

export async function getThresholds(): Promise<Thresholds> {
  const s = await db.settings.findUnique({ where: { id: 1 } });
  return { ...DEFAULT_THRESHOLDS, ...((s?.thresholds as Partial<Thresholds>) ?? {}) };
}

/**
 * Runs every deterministic check for one invoice and sets its status.
 * Called after upload, after a field edit, after confirming a line pair, and after resolving an exception.
 */
export async function processInvoice(id: string, actor = "system") {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id } });
  if (inv.status === "approved" || inv.status === "rejected") return inv;
  const data = inv.data as unknown as InvoiceData;
  const t = await getThresholds();

  // Keep header columns in sync with the (possibly edited) data.
  const key = {
    vendorTaxId: data.vendorTaxId.value ?? "",
    series: data.series.value ?? "",
    number: data.number.value ?? "",
    invoiceDate: data.date.value ?? "",
    total: data.total.value ?? 0,
  };

  // 3.8 duplicates
  const others = await db.invoice.findMany({
    where: { vendorTaxId: key.vendorTaxId, id: { not: id }, status: { notIn: ["rejected", "duplicate"] } },
    select: { id: true, vendorTaxId: true, series: true, number: true, invoiceDate: true, total: true },
  });
  const dup = findDuplicates({ id, ...key, date: key.invoiceDate }, others.map((o) => ({ ...o, date: o.invoiceDate })));

  // 3.9 adjustment / replacement must point to an existing original
  let relatedId: string | null = null;
  if (data.kind !== "original" && data.related) {
    const orig = await db.invoice.findFirst({ where: { vendorTaxId: key.vendorTaxId, number: { endsWith: data.related.number.replace(/^0+/, "") } } });
    relatedId = orig?.id ?? null;
  }

  const lowConf = lowConfidenceFields(data, t.lowConfidence);

  // Matching runs only on confirmed data (FIN-7).
  let match = null;
  let suggestions: unknown[] = [];
  if (!lowConf.length && !dup.exact.length) {
    const poNums = splitPoNumbers(data.poNumbers.value);
    const pos = (await db.purchaseOrder.findMany({ where: { number: { in: poNums } } })).map((p) => ({ ...p, lines: p.lines })) as unknown as PurchaseOrder[];
    const receipts = (await db.goodsReceipt.findMany({ where: { poNumber: { in: poNums } } })).map((r) => ({ ...r, receivedAt: r.receivedAt.toISOString() })) as unknown as GoodsReceipt[];
    const alreadyInvoiced = await invoicedQuantities(id, poNums);
    match = matchInvoice({ invoice: data, pos, receipts, alreadyInvoiced, confirmedPairs: inv.confirmedPairs as unknown as LinePair[], thresholds: t });
    const unmatched = match.exceptions.filter((e) => e.type === "UNMATCHED_LINE").map((e) => e.lineNo!);
    if (unmatched.length) {
      suggestions = await suggestPairs(data.lines.filter((l) => unmatched.includes(l.no)), pos).catch(() => []);
    }
  }

  // Rebuild open exceptions; keep resolved ones as history.
  const exceptions = [
    ...(dup.exact.length ? [{ type: "DUPLICATE", message: "An identical invoice (same vendor, number, date and amount) already exists.", route: "accounting" }] : []),
    ...(dup.near.length ? [{ type: "POSSIBLE_DUPLICATE", message: `Looks similar to ${dup.near.length} other invoice(s). Check before paying.`, route: "accounting" }] : []),
    ...(data.kind !== "original" && !relatedId ? [{ type: "RELATED_INVOICE_MISSING", message: `This is a ${data.kind} invoice but the original (${data.related?.number}) is not in the system.`, route: "accounting" }] : []),
    ...(lowConf.length ? [{ type: "LOW_CONFIDENCE", message: `Confirm these fields: ${lowConf.join(", ")}.`, route: "accounting" }] : []),
    ...(match?.exceptions ?? []),
  ] as { type: string; message: string; route: string; lineNo?: number }[];

  const resolved = await db.invoiceException.findMany({ where: { invoiceId: id, status: "resolved" } });
  const isResolved = (e: { type: string; lineNo?: number }) => resolved.some((r) => r.type === e.type && (r.lineNo ?? null) === (e.lineNo ?? null));
  await db.invoiceException.deleteMany({ where: { invoiceId: id, status: "open" } });
  for (const e of exceptions) {
    if (isResolved(e)) continue;
    const info = e.type === "PARTIAL_RECEIPT";
    await db.invoiceException.create({
      data: { invoiceId: id, type: e.type, message: e.message, lineNo: e.lineNo, route: e.route, status: info ? "resolved" : "open", resolution: info ? "Information only" : null },
    });
  }

  const open = await db.invoiceException.count({ where: { invoiceId: id, status: "open" } });
  const status = dup.exact.length ? "duplicate" : lowConf.length ? "needs_review" : open ? "exceptions" : "ready_for_approval";
  const updated = await db.invoice.update({
    where: { id },
    data: { ...key, status, relatedId, nearDuplicates: dup.near, match: (match ?? undefined) as object | undefined, pairSuggestions: suggestions as object[], matchedAt: match ? new Date() : null },
  });
  if (updated.status !== inv.status) await audit({ actor, action: "status", invoiceId: id, oldValue: inv.status, newValue: status });
  return updated;
}

/** Quantities already billed on other live invoices for the same POs (prevents billing the same receipt twice). */
async function invoicedQuantities(excludeId: string, poNums: string[]) {
  const map = new Map<string, number>();
  if (!poNums.length) return map;
  const invs = await db.invoice.findMany({ where: { id: { not: excludeId }, status: { in: ["ready_for_approval", "approved"] } } });
  const pos = await db.purchaseOrder.findMany({ where: { number: { in: poNums } } });
  for (const i of invs) {
    const m = i.match as { pairs?: LinePair[] } | null;
    const d = i.data as unknown as InvoiceData;
    for (const p of m?.pairs ?? []) {
      if (!poNums.includes(p.poNumber)) continue;
      const po = pos.find((x) => x.number === p.poNumber);
      const sku = (po?.lines as { no: number; sku: string }[] | undefined)?.find((l) => l.no === p.poLine)?.sku;
      const qty = d.lines.find((l) => l.no === p.invoiceLine)?.quantity ?? 0;
      if (sku) map.set(`${p.poNumber}#${sku}`, (map.get(`${p.poNumber}#${sku}`) ?? 0) + qty);
    }
  }
  return map;
}

/** Lazily adds an AI explanation + email draft to an exception (3.12). */
export async function explain(exceptionId: string) {
  const e = await db.invoiceException.findUniqueOrThrow({ where: { id: exceptionId }, include: { invoice: true } });
  if (e.explanation) return e;
  const d = e.invoice.data as unknown as InvoiceData;
  const out = await explainException(
    { type: e.type as never, message: e.message, route: e.route as never, lineNo: e.lineNo ?? undefined },
    { vendorName: d.vendorName.value ?? "", number: d.number.value ?? "", date: d.date.value ?? "" },
  );
  return db.invoiceException.update({ where: { id: e.id }, data: { explanation: out.explanation, emailDraft: out.emailDraft } });
}

export function publicInvoice(i: Invoice) {
  return i;
}
