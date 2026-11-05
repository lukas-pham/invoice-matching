export const currentUser = () => {
  try {
    return localStorage.getItem("userId") ?? "";
  } catch {
    return "";
  }
};

export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-user-id": currentUser(), ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }) };
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || Object.values(body.errors ?? {}).join(" ") || `Lỗi ${res.status}`), { body });
  return body as T;
}
export const send = <T,>(url: string, method: string, data?: unknown) => api<T>(url, { method, body: data instanceof FormData ? data : JSON.stringify(data ?? {}) });

export const vnd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${Math.round(n).toLocaleString("vi-VN")} ₫`);

export const STATUS: Record<string, { label: string; cls: string }> = {
  needs_review: { label: "Cần xác nhận dữ liệu", cls: "b-medium" },
  exceptions: { label: "Có ngoại lệ", cls: "b-high" },
  ready_for_approval: { label: "Chờ duyệt", cls: "b-compliant" },
  approved: { label: "Đã duyệt", cls: "b-pass" },
  rejected: { label: "Từ chối", cls: "b-low" },
  duplicate: { label: "Trùng", cls: "b-fail" },
};

export const ROUTE: Record<string, string> = { purchasing: "Mua hàng", warehouse: "Kho", requester: "Người đề nghị", accounting: "Kế toán" };

export const EXCEPTION: Record<string, string> = {
  ARITHMETIC: "Sai số học",
  MISSING_PO: "Thiếu số PO",
  PO_NOT_FOUND: "PO không tồn tại",
  VENDOR_MISMATCH: "Sai nhà cung cấp",
  PRICE_VARIANCE: "Lệch đơn giá",
  QTY_OVER_RECEIVED: "Vượt số lượng nhập",
  PARTIAL_RECEIPT: "Nhận hàng một phần",
  NO_RECEIPT: "Chưa có phiếu nhập",
  UNMATCHED_LINE: "Dòng chưa ghép",
  DUPLICATE: "Hóa đơn trùng",
  POSSIBLE_DUPLICATE: "Có thể trùng",
  RELATED_INVOICE_MISSING: "Thiếu hóa đơn gốc",
  LOW_CONFIDENCE: "Độ tin cậy thấp",
};
