import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, currentUser, EXCEPTION, send, STATUS, vnd } from "../api";

export function PaymentPage() {
  const [rows, setRows] = useState<{ id: string; vendor: string; vendorTaxId: string; number: string; date: string; total: number; approvedBy: string }[]>([]);
  useEffect(() => {
    api<typeof rows>("/api/payment-proposal").then(setRows);
  }, []);
  async function download() {
    const res = await fetch("/api/payment-proposal.csv", { headers: { "x-user-id": currentUser() } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = `de-nghi-thanh-toan-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Đề nghị thanh toán</h2>
        <button className="primary" disabled={!rows.length} onClick={download}>Tải CSV</button>
      </div>
      <p className="muted small">Chỉ gồm hóa đơn đã đối chiếu, không còn ngoại lệ mở và đã được duyệt. Hệ thống không thực hiện thanh toán.</p>
      {rows.length === 0 ? <div className="empty">Chưa có hóa đơn đủ điều kiện.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Nhà cung cấp</th><th>MST</th><th>Số HĐ</th><th>Ngày</th><th>Số tiền</th><th>Người duyệt</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.id}><td>{r.vendor}</td><td>{r.vendorTaxId}</td><td><Link to={`/invoices/${r.id}`}>{r.number}</Link></td><td>{r.date}</td><td>{vnd(r.total)}</td><td>{r.approvedBy}</td></tr>)}</tbody>
          <tfoot><tr><th colSpan={4}>Tổng</th><th>{vnd(rows.reduce((s, r) => s + r.total, 0))}</th><th /></tr></tfoot>
        </table></div>
      )}
    </div>
  );
}

export function DashboardPage() {
  const [d, setD] = useState<{ total: number; matchedCount: number; autoMatchRate: number | null; byStatus: Record<string, number>; exceptionsByType: { type: string; count: number }[]; avgResolutionHours: number | null } | null>(null);
  useEffect(() => {
    api<NonNullable<typeof d>>("/api/dashboard").then(setD);
  }, []);
  if (!d) return <div className="empty"><span className="spinner" /></div>;
  const max = Math.max(1, ...d.exceptionsByType.map((e) => e.count));
  return (
    <>
      <div className="grid2">
        <div className="card"><div className="muted small">Tổng hóa đơn</div><div className="metric">{d.total}</div></div>
        <div className="card"><div className="muted small">Tỷ lệ tự khớp</div><div className="metric">{d.autoMatchRate === null ? "—" : `${Math.round(d.autoMatchRate * 100)}%`}</div><div className="muted small">trên {d.matchedCount} hóa đơn đã đối chiếu</div></div>
        <div className="card"><div className="muted small">Thời gian xử lý ngoại lệ TB</div><div className="metric">{d.avgResolutionHours === null ? "—" : `${d.avgResolutionHours.toFixed(1)} giờ`}</div></div>
      </div>
      <div className="grid2">
        <div className="card">
          <h2>Ngoại lệ theo loại</h2>
          {d.exceptionsByType.length === 0 ? <p className="muted">Chưa có.</p> : d.exceptionsByType.sort((a, b) => b.count - a.count).map((e) => (
            <div key={e.type} className="small" style={{ marginBottom: 6 }}>
              <div className="row" style={{ justifyContent: "space-between" }}><span>{EXCEPTION[e.type] ?? e.type}</span><strong>{e.count}</strong></div>
              <div style={{ height: 8, background: "var(--na-bg)", borderRadius: 4 }}><div style={{ width: `${(e.count / max) * 100}%`, height: 8, background: "var(--accent)", borderRadius: 4 }} /></div>
            </div>
          ))}
        </div>
        <div className="card">
          <h2>Hóa đơn theo trạng thái</h2>
          <table><tbody>{Object.entries(d.byStatus).map(([k, v]) => <tr key={k}><td><span className={`badge ${STATUS[k]?.cls}`}>{STATUS[k]?.label ?? k}</span></td><td>{v}</td></tr>)}</tbody></table>
        </div>
      </div>
    </>
  );
}

type T = { pricePct: number; priceAbs: number; qtyPct: number; totalAbs: number; lowConfidence: number };
export function SettingsPage({ me }: { me: { roles: string[] } }) {
  const [t, setT] = useState<T | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<T>("/api/settings").then(setT);
  }, []);
  if (!t) return null;
  const admin = me.roles.includes("admin");
  const field = (k: keyof T, label: string, help: string, pct = false) => (
    <div className={errors[k] ? "has-error" : ""}>
      <label htmlFor={k}>{label}</label>
      <input id={k} type="number" step="any" disabled={!admin} value={pct ? +(t[k] * 100).toFixed(2) : t[k]}
        onChange={(e) => { setSaved(false); setT({ ...t, [k]: pct ? Number(e.target.value) / 100 : Number(e.target.value) }); }} />
      <div className="muted small">{help}</div>
      {errors[k] && <div className="field-error">{errors[k]}</div>}
    </div>
  );
  return (
    <div className="card">
      <h2>Ngưỡng chênh lệch</h2>
      {!admin && <div className="banner info small">Chỉ quản trị viên được thay đổi ngưỡng.</div>}
      <div className="grid2">
        {field("pricePct", "Lệch đơn giá cho phép (%)", "Ngoại lệ khi vượt CẢ ngưỡng % và ngưỡng tiền.", true)}
        {field("priceAbs", "Lệch đơn giá cho phép (₫/đơn vị)", "Ví dụ 1000 = lệch dưới 1.000 ₫ được bỏ qua.")}
        {field("qtyPct", "Vượt số lượng cho phép (%)", "0 = không cho vượt số lượng nhập.", true)}
        {field("totalAbs", "Sai số làm tròn tổng (₫)", "Áp dụng cho tổng trước thuế, thuế và tổng thanh toán.")}
        {field("lowConfidence", "Ngưỡng độ tin cậy AI (0.5–1)", "Trường dưới ngưỡng phải được người xác nhận.")}
      </div>
      {admin && (
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => send<T>("/api/settings", "PUT", t).then(() => { setErrors({}); setSaved(true); }).catch((e) => setErrors(e.body?.errors ?? {}))}>Lưu ngưỡng</button>
          {saved && <span className="small">Đã lưu. Áp dụng cho các lần đối chiếu tiếp theo.</span>}
        </div>
      )}
    </div>
  );
}

export function AuditPage() {
  const [d, setD] = useState<{ brokenAt: number | null; entries: { seq: number; at: string; actor: string; action: string; invoiceId: string | null; field: string | null; aiValue: string | null; oldValue: string | null; newValue: string | null; hash: string }[] } | null>(null);
  useEffect(() => {
    api<NonNullable<typeof d>>("/api/audit").then(setD);
  }, []);
  if (!d) return null;
  return (
    <div className="card">
      <h2>Nhật ký kiểm toán</h2>
      {d.brokenAt === null ? <div className="banner info small">Chuỗi băm toàn vẹn: không bản ghi nào bị sửa hoặc xóa.</div> : <div className="banner error">Chuỗi băm bị phá vỡ tại bản ghi #{d.brokenAt}. Có dấu hiệu chỉnh sửa trực tiếp cơ sở dữ liệu.</div>}
      <div className="table-wrap"><table className="small">
        <thead><tr><th>#</th><th>Thời điểm</th><th>Người</th><th>Hành động</th><th>Hóa đơn</th><th>Trường</th><th>Giá trị AI</th><th>Cũ → Mới</th></tr></thead>
        <tbody>{d.entries.map((e) => (
          <tr key={e.seq}><td>{e.seq}</td><td>{new Date(e.at).toLocaleString("vi-VN")}</td><td>{e.actor}</td><td>{e.action}</td>
            <td>{e.invoiceId && <Link to={`/invoices/${e.invoiceId}`}>mở</Link>}</td><td>{e.field}</td><td>{e.aiValue}</td><td>{e.oldValue !== null && `${e.oldValue} → `}{e.newValue}</td></tr>
        ))}</tbody>
      </table></div>
    </div>
  );
}
