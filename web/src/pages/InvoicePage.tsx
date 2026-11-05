import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, EXCEPTION, ROUTE, send, STATUS, vnd } from "../api";
import type { ExtractedField, InvoiceData, LinePair, MatchResult, PurchaseOrder, SourceRef } from "../../../src/core/types";

interface Exc { id: string; type: string; message: string; lineNo: number | null; route: string; status: string; resolution: string | null; resolvedBy: string | null; explanation: string | null; emailDraft: string | null }
interface Detail {
  invoice: {
    id: string; source: string; fileName: string; status: string; data: InvoiceData; match: MatchResult | null; uploadedBy: string; approvedBy: string | null;
    pairSuggestions: { invoiceLine: number; poNumber: string; poLine: number; reason: string; confidence: number }[];
    nearDuplicates: string[]; exceptions: Exc[];
  };
  fileUrl: string;
  pos: PurchaseOrder[];
  history: { seq: number; at: string; actor: string; action: string; field: string | null; aiValue: string | null; oldValue: string | null; newValue: string | null }[];
  permissions: { editBlocked: string | null; approveBlocked: string | null };
}

const FIELDS: [keyof InvoiceData, string][] = [
  ["vendorName", "Người bán"], ["vendorTaxId", "MST người bán"], ["series", "Ký hiệu"], ["number", "Số hóa đơn"], ["date", "Ngày lập"],
  ["poNumbers", "Số PO"], ["subtotal", "Tiền trước thuế"], ["taxAmount", "Tiền thuế"], ["total", "Tổng thanh toán"],
];
const LOW = 0.85;

export function InvoicePage() {
  const { id } = useParams();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [focus, setFocus] = useState<SourceRef | null>(null);
  const load = () => api<Detail>(`/api/invoices/${id}`).then(setD).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, [id]);
  const act = async (fn: () => Promise<unknown>) => {
    setErr("");
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  if (!d) return <div className="empty">{err || <><span className="spinner" /> Đang tải…</>}</div>;
  const inv = d.invoice;
  const data = inv.data;
  const st = STATUS[inv.status];
  const open = inv.exceptions.filter((e) => e.status === "open");

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>Hóa đơn {data.number.value || "(chưa có số)"} · {data.vendorName.value}</h2>
          <span className="muted small">{inv.fileName} · {inv.source.toUpperCase()} · {data.kind === "original" ? "Hóa đơn gốc" : data.kind === "adjustment" ? `Điều chỉnh cho HĐ ${data.related?.number}` : `Thay thế HĐ ${data.related?.number}`}</span>
        </div>
        <span className={`badge ${st?.cls}`} style={{ fontSize: 14 }}>{st?.label}</span>
      </div>
      <NextStep status={inv.status} open={open.length} perms={d.permissions} />
      {err && <div className="banner error">{err}</div>}

      <div className="split">
        <DocViewer source={inv.source} url={d.fileUrl} focus={focus} />
        <div>
          <div className="card">
            <h2>Dữ liệu trích xuất</h2>
            <p className="muted small">Bấm “Xem” để thấy vị trí trong chứng từ gốc. Ô vàng có độ tin cậy thấp: phải xác nhận hoặc sửa.</p>
            {FIELDS.map(([k, label]) => (
              <FieldRow key={k} label={label} f={data[k] as ExtractedField} readOnly={!!d.permissions.editBlocked}
                onShow={() => setFocus(((data[k] as ExtractedField).source))}
                onSave={(v) => act(() => send(`/api/invoices/${inv.id}/fields`, "PATCH", { field: k, value: v }))} />
            ))}
          </div>

          <LinesCard d={d} onShow={setFocus} onConfirm={(p) => act(() => send(`/api/invoices/${inv.id}/pairs`, "POST", p))} />

          <div className="card">
            <h2>Ngoại lệ ({open.length} đang mở)</h2>
            {inv.exceptions.length === 0 ? <p className="muted">Không có ngoại lệ. Hóa đơn khớp tự động.</p> :
              inv.exceptions.map((e) => <ExceptionCard key={e.id} e={e} onChange={load} setErr={setErr} />)}
          </div>

          <Actions d={d} act={act} />

          <div className="card">
            <h2>Lịch sử</h2>
            <table className="small"><tbody>{d.history.map((h) => (
              <tr key={h.seq}><td className="muted">{new Date(h.at).toLocaleString("vi-VN")}</td><td>{h.actor}</td><td>{h.action}{h.field ? ` · ${h.field}` : ""}</td>
                <td>{h.aiValue !== null && <span className="muted">AI: {h.aiValue} · </span>}{h.oldValue !== null && <>{h.oldValue} → </>}{h.newValue}</td></tr>
            ))}</tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}

function NextStep({ status, open, perms }: { status: string; open: number; perms: Detail["permissions"] }) {
  const text: Record<string, string> = {
    needs_review: "Bước tiếp theo: xác nhận các ô màu vàng. Hệ thống chỉ đối chiếu sau khi dữ liệu được xác nhận.",
    exceptions: `Bước tiếp theo: xử lý ${open} ngoại lệ. Mỗi ngoại lệ được chuyển đúng bộ phận (Mua hàng, Kho, Người đề nghị, Kế toán).`,
    ready_for_approval: perms.approveBlocked ? `Chờ người duyệt. ${perms.approveBlocked}` : "Bạn có thể duyệt hóa đơn này.",
    approved: "Đã duyệt. Hóa đơn sẽ có trong danh sách đề nghị thanh toán.",
    duplicate: "Hóa đơn trùng với một hóa đơn đã có. Không thể thanh toán.",
    rejected: "Đã từ chối.",
  };
  return <div className="banner action small">{text[status]}</div>;
}

function DocViewer({ source, url, focus }: { source: string; url: string; focus: SourceRef | null }) {
  const [xml, setXml] = useState("");
  useEffect(() => {
    if (source === "xml") fetch(url).then((r) => r.text()).then(setXml);
  }, [url, source]);
  const highlighted = useMemo(() => {
    if (!xml) return null;
    const tag = focus?.path?.split("/").pop()?.replace(/\[\d+\]$/, "").split("+")[0];
    if (!tag) return <>{xml}</>;
    const parts = xml.split(new RegExp(`(<${tag}>[\\s\\S]*?</${tag}>)`));
    return parts.map((p, i) => (p.startsWith(`<${tag}>`) ? <mark key={i} ref={(el) => el?.scrollIntoView({ block: "center" })}>{p}</mark> : p));
  }, [xml, focus]);
  return (
    <div className="viewer" aria-label="Chứng từ gốc">
      {source === "xml" ? <pre>{highlighted}</pre> : source === "pdf" ? <iframe key={focus?.page} title="Hóa đơn PDF" src={`${url}#page=${focus?.page ?? 1}`} /> : <img src={url} alt="Ảnh hóa đơn" style={{ width: "100%" }} />}
      {focus?.quote && source !== "xml" && <div className="banner info small" style={{ position: "absolute", bottom: 8, left: 8, right: 8 }}>Trang {focus.page}: “{focus.quote}”</div>}
    </div>
  );
}

function FieldRow({ label, f, onSave, onShow, readOnly }: { label: string; f: ExtractedField; onSave: (v: string) => void; onShow: () => void; readOnly: boolean }) {
  const [v, setV] = useState(String(f.value ?? ""));
  useEffect(() => setV(String(f.value ?? "")), [f.value]);
  const low = f.confidence < LOW && !f.confirmedBy;
  const changed = v !== String(f.value ?? "");
  return (
    <div className={`field-row ${low ? "low" : ""}`}>
      <label className="small" style={{ margin: 0 }}>{label}</label>
      <div>
        <input value={v} onChange={(e) => setV(e.target.value)} disabled={readOnly} aria-label={label} />
        <div className="src">
          {f.confirmedBy ? `Đã xác nhận bởi ${f.confirmedBy}` : `Độ tin cậy ${Math.round(f.confidence * 100)}%`}
          {" · "}<button type="button" className="small" style={{ padding: "0 6px" }} onClick={onShow}>Xem</button>
        </div>
      </div>
      {!readOnly && (low || changed) && <button className={low ? "primary" : ""} onClick={() => onSave(v)}>{changed ? "Lưu" : "Xác nhận"}</button>}
    </div>
  );
}

function LinesCard({ d, onShow, onConfirm }: { d: Detail; onShow: (s: SourceRef) => void; onConfirm: (p: LinePair) => void }) {
  const inv = d.invoice;
  const pairs = inv.match?.pairs ?? [];
  const poLine = (p: LinePair) => d.pos.find((x) => x.number === p.poNumber)?.lines.find((l) => l.no === p.poLine);
  return (
    <div className="card">
      <h2>Dòng hàng & ghép với PO {inv.match && <span className="muted small">({inv.match.mode === "three_way" ? "đối chiếu 3 bên: HĐ–PO–phiếu nhập" : "đối chiếu 2 bên: HĐ–PO (dịch vụ)"})</span>}</h2>
      <div className="table-wrap"><table>
        <thead><tr><th>#</th><th>Tên trên hóa đơn</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th><th>Dòng PO</th></tr></thead>
        <tbody>{inv.data.lines.map((l) => {
          const p = pairs.find((x) => x.invoiceLine === l.no);
          const pl = p && poLine(p);
          const sug = inv.pairSuggestions.find((s) => s.invoiceLine === l.no);
          return (
            <tr key={l.no}>
              <td>{l.no}</td>
              <td>{l.description} {l.source && <button className="small" style={{ padding: "0 6px" }} onClick={() => onShow(l.source!)}>Xem</button>}</td>
              <td>{l.quantity}</td><td>{vnd(l.unitPrice)}</td><td>{vnd(l.amount)}</td>
              <td className="small">
                {pl ? <>{p!.poNumber} #{p!.poLine}: {pl.description}<div className="muted">PO: {pl.quantity} × {vnd(pl.unitPrice)} · {p!.method === "confirmed_suggestion" ? "người dùng xác nhận" : p!.method === "sku" ? "khớp mã hàng" : "khớp tên"}</div></>
                  : sug ? (
                    <div>
                      <div>Gợi ý của AI: {sug.poNumber} #{sug.poLine} — {d.pos.find((x) => x.number === sug.poNumber)?.lines.find((x) => x.no === sug.poLine)?.description}</div>
                      <div className="muted">{sug.reason}</div>
                      {!d.permissions.editBlocked && <button onClick={() => onConfirm({ invoiceLine: l.no, poNumber: sug.poNumber, poLine: sug.poLine, method: "confirmed_suggestion" })}>Xác nhận ghép</button>}
                    </div>
                  ) : <span className="badge b-high">Chưa ghép</span>}
              </td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}

function ExceptionCard({ e, onChange, setErr }: { e: Exc; onChange: () => void; setErr: (s: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
      onChange();
    } catch (x) {
      setErr((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="issue">
      <h3><span className={`badge ${e.status === "open" ? "b-high" : "b-pass"}`}>{e.status === "open" ? "Mở" : "Đã xử lý"}</span> {EXCEPTION[e.type] ?? e.type}{e.lineNo ? ` · dòng ${e.lineNo}` : ""} <span className="muted small">→ {ROUTE[e.route]}</span></h3>
      <p className="small">{e.message}</p>
      {e.resolution && <p className="small muted">Kết quả: {e.resolution} {e.resolvedBy && `(${e.resolvedBy})`}</p>}
      {e.explanation ? (
        <>
          <p className="small"><strong>Giải thích (AI):</strong> {e.explanation}</p>
          {e.emailDraft && (
            <details><summary className="small">Nháp email cho nhà cung cấp — hệ thống không tự gửi</summary>
              <pre>{e.emailDraft}</pre>
              <button onClick={() => navigator.clipboard?.writeText(e.emailDraft ?? "")}>Sao chép</button>
            </details>
          )}
        </>
      ) : e.status === "open" && <button disabled={busy} onClick={() => run(() => send(`/api/exceptions/${e.id}/explain`, "POST"))}>Giải thích & soạn email</button>}
      {e.status === "open" && !["DUPLICATE", "LOW_CONFIDENCE"].includes(e.type) && (
        <div className="row" style={{ marginTop: 8 }}>
          <input placeholder="Quyết định, ví dụ: Mua hàng đồng ý giá mới theo phụ lục 02" value={note} onChange={(x) => setNote(x.target.value)} style={{ flex: 1 }} />
          <button disabled={busy} onClick={() => run(() => send(`/api/exceptions/${e.id}/resolve`, "POST", { resolution: note }))}>Đánh dấu đã xử lý</button>
        </div>
      )}
    </div>
  );
}

function Actions({ d, act }: { d: Detail; act: (fn: () => Promise<unknown>) => void }) {
  const [reason, setReason] = useState("");
  const inv = d.invoice;
  if (inv.status === "approved" || inv.status === "rejected") return null;
  return (
    <div className="card">
      <h2>Quyết định</h2>
      <div className="row">
        <button className="primary" disabled={!!d.permissions.approveBlocked} onClick={() => act(() => send(`/api/invoices/${inv.id}/approve`, "POST"))}>Duyệt hóa đơn</button>
        {d.permissions.approveBlocked && <span className="small muted">{d.permissions.approveBlocked}</span>}
      </div>
      <label htmlFor="reason">Hoặc từ chối (ghi lý do)</label>
      <div className="row">
        <input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: Nhà cung cấp sẽ xuất hóa đơn điều chỉnh" style={{ flex: 1 }} />
        <button onClick={() => act(() => send(`/api/invoices/${inv.id}/reject`, "POST", { reason }))}>Từ chối</button>
      </div>
    </div>
  );
}
