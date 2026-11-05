import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import "./styles.css";
import { api, currentUser } from "./api";
import { InvoicesPage } from "./pages/InvoicesPage";
import { InvoicePage } from "./pages/InvoicePage";
import { ExceptionsPage } from "./pages/ExceptionsPage";
import { PaymentPage, DashboardPage, SettingsPage, AuditPage } from "./pages/OtherPages";

interface User { id: string; name: string; roles: string[]; team: string | null }

function App() {
  const [users, setUsers] = useState<User[]>([]);
  const [me, setMe] = useState(currentUser());
  const [mock, setMock] = useState(false);
  useEffect(() => {
    fetch("/api/users").then((r) => r.json()).then(setUsers);
  }, []);
  useEffect(() => {
    if (me) api<{ mockMode: boolean }>("/api/meta").then((m) => setMock(m.mockMode)).catch(() => undefined);
  }, [me]);
  const choose = (id: string) => {
    try {
      localStorage.setItem("userId", id);
    } catch {
      /* private mode */
    }
    setMe(id);
    location.reload();
  };
  const user = users.find((u) => u.id === me);

  return (
    <BrowserRouter>
      <div className="shell">
        <div className="topbar">
          <h1>Đối chiếu hóa đơn</h1>
          <div className="row small">
            <NavLink to="/">Hóa đơn</NavLink>
            <NavLink to="/exceptions">Ngoại lệ</NavLink>
            <NavLink to="/payment">Đề nghị thanh toán</NavLink>
            <NavLink to="/dashboard">Tổng quan</NavLink>
            <NavLink to="/settings">Ngưỡng</NavLink>
            <NavLink to="/audit">Nhật ký</NavLink>
            <select className="user-select" value={me} onChange={(e) => choose(e.target.value)} aria-label="Người dùng">
              <option value="">Chọn người dùng…</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        {mock && <div className="banner info small">Chế độ demo: chưa cấu hình khóa AI. XML vẫn đọc đầy đủ; PDF/ảnh sẽ cần nhập tay.</div>}
        {!user ? (
          <div className="card empty">Chọn người dùng ở góc phải để bắt đầu. Mỗi người có vai trò khác nhau (nhập liệu, xử lý, duyệt).</div>
        ) : (
          <Routes>
            <Route path="/" element={<InvoicesPage me={user} />} />
            <Route path="/invoices/:id" element={<InvoicePage />} />
            <Route path="/exceptions" element={<ExceptionsPage me={user} />} />
            <Route path="/payment" element={<PaymentPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/settings" element={<SettingsPage me={user} />} />
            <Route path="/audit" element={<AuditPage />} />
          </Routes>
        )}
      </div>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
