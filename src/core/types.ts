// Domain types shared by server and UI. Money is in VND (integers); quantities may be decimal.

export type Role = "clerk" | "processor" | "approver" | "admin";

export interface SourceRef {
  /** XML: element path. PDF/image: page + the exact text the value was read from. */
  page?: number;
  path?: string;
  quote?: string;
}

export interface ExtractedField<T = string | number> {
  value: T | null;
  confidence: number; // 0..1, XML parser = 1
  source: SourceRef;
  /** Set when a person changed the value; the AI value stays in the audit log. */
  confirmedBy?: string;
}

export interface InvoiceLine {
  no: number;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxRate: number; // 0.08 = 8%; -1 = not subject to VAT
  sku?: string;
  confidence?: number;
  source?: SourceRef;
}

export type InvoiceKind = "original" | "adjustment" | "replacement";

export interface InvoiceData {
  vendorName: ExtractedField<string>;
  vendorTaxId: ExtractedField<string>;
  series: ExtractedField<string>;
  number: ExtractedField<string>;
  date: ExtractedField<string>; // YYYY-MM-DD
  currency: ExtractedField<string>;
  poNumbers: ExtractedField<string>; // comma separated as written on the invoice
  subtotal: ExtractedField<number>;
  taxAmount: ExtractedField<number>;
  total: ExtractedField<number>;
  kind: InvoiceKind;
  related?: { series: string; number: string; date?: string };
  lines: InvoiceLine[];
}

export interface PoLine {
  no: number;
  sku: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

export interface PurchaseOrder {
  number: string;
  vendorTaxId: string;
  type: "goods" | "service";
  requester: string;
  lines: PoLine[];
}

export interface GoodsReceipt {
  number: string;
  poNumber: string;
  receivedAt: string;
  lines: { sku: string; quantity: number }[];
}

export interface Thresholds {
  pricePct: number; // 0.02 = 2%
  priceAbs: number; // VND per unit
  qtyPct: number;
  totalAbs: number; // VND tolerance on the invoice total
  lowConfidence: number; // fields below this need human confirmation
}

export const DEFAULT_THRESHOLDS: Thresholds = { pricePct: 0.02, priceAbs: 1000, qtyPct: 0, totalAbs: 1000, lowConfidence: 0.85 };

export type ExceptionType =
  | "ARITHMETIC"
  | "MISSING_PO"
  | "PO_NOT_FOUND"
  | "VENDOR_MISMATCH"
  | "PRICE_VARIANCE"
  | "QTY_OVER_RECEIVED"
  | "PARTIAL_RECEIPT"
  | "NO_RECEIPT"
  | "UNMATCHED_LINE"
  | "DUPLICATE"
  | "POSSIBLE_DUPLICATE"
  | "RELATED_INVOICE_MISSING"
  | "LOW_CONFIDENCE";

export interface MatchException {
  type: ExceptionType;
  message: string;
  lineNo?: number;
  expected?: number | string;
  actual?: number | string;
  /** Who should handle it (req 3.11). */
  route: "purchasing" | "warehouse" | "requester" | "accounting";
}

export interface LinePair {
  invoiceLine: number;
  poNumber: string;
  poLine: number;
  method: "sku" | "exact_name" | "confirmed_suggestion";
}

export interface MatchResult {
  mode: "two_way" | "three_way";
  pairs: LinePair[];
  exceptions: MatchException[];
  autoMatched: boolean;
}
