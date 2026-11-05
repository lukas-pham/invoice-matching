import { XMLParser } from "fast-xml-parser";
import type { ExtractedField, InvoiceData, InvoiceKind, InvoiceLine } from "./types";

/**
 * Parser for Vietnamese e-invoice XML (HDon / DLHDon structure used since Decree 123/2020 and
 * carried into Decree 254/2026 + Circular 91/2026). XML is read by code only — no AI (req 3.1).
 * Element names must be re-checked against the schema published with Circular 91/2026.
 */

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

const f = <T>(value: T | null, path: string): ExtractedField<T> => ({ value, confidence: 1, source: { path } });

const num = (v: unknown): number => {
  if (v === undefined || v === null || v === "") return 0;
  const n = Number(String(v).replace(/\s/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

/** "8%" -> 0.08, "KCT" (not subject) -> -1, "0%" -> 0 */
export function parseTaxRate(v: unknown): number {
  const s = String(v ?? "").trim().toUpperCase();
  if (!s || s === "KCT" || s === "KKKNT") return -1;
  const n = Number(s.replace("%", ""));
  return Number.isFinite(n) ? n / 100 : -1;
}

const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);

export function parseInvoiceXml(xml: string): InvoiceData {
  const doc = parser.parse(xml);
  const root = doc.HDon ?? doc.HDON ?? doc;
  const dl = root.DLHDon;
  if (!dl) throw new Error("Not an e-invoice XML: DLHDon element not found.");
  const tt = dl.TTChung ?? {};
  const nd = dl.NDHDon ?? {};
  const nban = nd.NBan ?? {};
  const toan = nd.TToan ?? {};

  const lines: InvoiceLine[] = asArray(nd.DSHHDVu?.HHDVu).map((h: Record<string, unknown>, i: number) => ({
    no: num(h.STT) || i + 1,
    description: String(h.THHDVu ?? ""),
    unit: String(h.DVTinh ?? ""),
    quantity: num(h.SLuong),
    unitPrice: num(h.DGia),
    amount: num(h.ThTien),
    taxRate: parseTaxRate(h.TSuat),
    sku: h.MHHDVu ? String(h.MHHDVu) : undefined,
    confidence: 1,
    source: { path: `NDHDon/DSHHDVu/HHDVu[${i + 1}]` },
  }));

  // Related invoice (adjustment / replacement), TTHDLQuan block.
  const rel = tt.TTHDLQuan;
  let kind: InvoiceKind = "original";
  let related: InvoiceData["related"];
  if (rel) {
    // TCHDon: 1 = replacement, 2 = adjustment
    kind = String(rel.TCHDon) === "1" ? "replacement" : "adjustment";
    related = { series: String(rel.KHHDCLQuan ?? ""), number: String(rel.SHDCLQuan ?? ""), date: rel.NLHDCLQuan ? String(rel.NLHDCLQuan) : undefined };
  }

  // PO reference is not a standard field; vendors put it in TTKhac or in a note. Accept common places.
  const extra = asArray<Record<string, unknown>>(dl.TTKhac?.TTin).find((t) => /PO|DonMuaHang|DonHang/i.test(String(t.TTruong)));
  const po = String(extra?.DLieu ?? nd.SoDonHang ?? "");

  return {
    vendorName: f(String(nban.Ten ?? ""), "NDHDon/NBan/Ten"),
    vendorTaxId: f(String(nban.MST ?? ""), "NDHDon/NBan/MST"),
    series: f(`${tt.KHMSHDon ?? ""}${tt.KHHDon ?? ""}`, "TTChung/KHMSHDon+KHHDon"),
    number: f(String(tt.SHDon ?? ""), "TTChung/SHDon"),
    date: f(String(tt.NLap ?? ""), "TTChung/NLap"),
    currency: f(String(tt.DVTTe ?? "VND"), "TTChung/DVTTe"),
    poNumbers: f(po || null, "TTKhac/TTin[PO]"),
    subtotal: f(num(toan.TgTCThue), "NDHDon/TToan/TgTCThue"),
    taxAmount: f(num(toan.TgTThue), "NDHDon/TToan/TgTThue"),
    total: f(num(toan.TgTTTBSo), "NDHDon/TToan/TgTTTBSo"),
    kind,
    related,
    lines,
  };
}
