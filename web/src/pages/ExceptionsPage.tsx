import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, EXCEPTION, ROUTE, vnd } from "../api";

interface Row { id: string; type: string; message: string; route: string; createdAt: string; vendorName: string; invoice: { id: string; number: string; total: number } }

export function ExceptionsPage({ me }: { me: { team: string | null } }) {
  const [route, setRoute] = useState(me.team ?? "all");
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    api<Row[]>(`/api/exceptions?route=${route}`).then(setRows);
  }, [route]);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2>Hàng đợi ngoại lệ</h2>
        <select style={{ width: "auto" }} value={route} onChange={(e) => setRoute(e.target.value)} aria-label="Bộ phận">
          <option value="all">Tất cả bộ phận</option>
          {Object.entries(ROUTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <p className="muted small">Giá → Mua hàng · Số lượng → Kho · Thiếu PO → Người đề nghị · Số học, trùng → Kế toán.</p>
      {rows.length === 0 ? <div className="empty">Không có ngoại lệ đang mở cho bộ phận này.</div> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Loại</th><th>Hóa đơn</th><th>Nhà cung cấp</th><th>Chi tiết</th><th>Bộ phận</th><th>Mở từ</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td>{EXCEPTION[r.type] ?? r.type}</td>
              <td><Link to={`/invoices/${r.invoice.id}`}>{r.invoice.number}</Link><div className="muted small">{vnd(r.invoice.total)}</div></td>
              <td className="small">{r.vendorName}</td><td className="small">{r.message}</td><td>{ROUTE[r.route]}</td>
              <td className="muted small">{new Date(r.createdAt).toLocaleDateString("vi-VN")}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
