import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, send, STATUS, vnd } from "../api";

interface Row { id: string; fileName: string; source: string; status: string; vendorTaxId: string; number: string; invoiceDate: string; total: number; openExceptions: number; createdAt: string }

export function InvoicesPage({ me }: { me: { roles: string[] } }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const load = () => api<Row[]>(`/api/invoices${filter ? `?status=${filter}` : ""}`).then(setRows);
  useEffect(() => {
    load();
  }, [filter]);

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    const fd = new FormData();
    fd.append("file", file);
    try {
      const inv = await send<{ id: string }>("/api/invoices", "POST", fd);
      nav(`/invoices/${inv.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  const canUpload = me.roles.includes("clerk") || me.roles.includes("admin");
  return (
    <>
      <div className="card">
        <h2>Nhập hóa đơn</h2>
        <p className="muted small">XML hóa đơn điện tử được đọc trực tiếp bằng code. PDF và ảnh được AI trích xuất; trường có độ tin cậy thấp phải được xác nhận trước khi đối chiếu.</p>
        {canUpload ? (
          <label className="row" style={{ fontWeight: 400 }}>
            <input type="file" accept=".xml,.pdf,.png,.jpg,.jpeg,.webp" onChange={onUpload} disabled={busy} style={{ maxWidth: 360 }} />
            {busy && <span><span className="spinner" /> Đang đọc và đối chiếu…</span>}
          </label>
        ) : (
          <p className="small">Chỉ người nhập liệu mới tải hóa đơn lên. Đổi người dùng ở góc phải.</p>
        )}
        {error && <div className="field-error">{error}</div>}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Danh sách hóa đơn</h2>
          <select style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Lọc theo trạng thái">
            <option value="">Tất cả trạng thái</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
        {rows.length === 0 ? (
          <div className="empty">Chưa có hóa đơn. Tải lên một file XML trong thư mục <code>samples/</code> để thử.</div>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Số HĐ</th><th>MST bán</th><th>Ngày</th><th>Tổng tiền</th><th>Trạng thái</th><th>Ngoại lệ mở</th><th>Nguồn</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td><Link to={`/invoices/${r.id}`}>{r.number || "(chưa đọc được)"}</Link></td>
                <td>{r.vendorTaxId}</td><td>{r.invoiceDate}</td><td>{vnd(r.total)}</td>
                <td><span className={`badge ${STATUS[r.status]?.cls}`}>{STATUS[r.status]?.label ?? r.status}</span></td>
                <td>{r.openExceptions || ""}</td><td className="muted small">{r.source.toUpperCase()}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
