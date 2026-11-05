import express, { type NextFunction, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { audit, db } from "./db";
import { explain, getThresholds, processInvoice } from "./service";
import { parseInvoiceXml } from "../core/xmlInvoice";
import { approvalBlocked, canEdit, signFileUrl, toCsv, verifyChain, verifyFileSig, type Actor, type AuditEntry, type InvoiceStatus } from "../core/controls";
import { extractInvoice, isMockMode } from "../ai/ai";
import type { InvoiceData, LinePair, Role } from "../core/types";

const app = express();
app.use(express.json({ limit: "1mb" }));
const STORAGE = path.resolve("storage");
const FILE_SECRET = process.env.FILE_LINK_SECRET || "dev-only-secret-change-me";
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// ---------- auth (demo: user picked in the UI, sent as a header; replace with SSO in production) ----------
type AuthedRequest = Request & { actor: Actor & { name: string; team: string | null } };
async function auth(req: Request, res: Response, next: NextFunction) {
  const id = req.header("x-user-id");
  const user = id ? await db.user.findUnique({ where: { id } }) : null;
  if (!user) return res.status(401).json({ error: "Choose a user first." });
  (req as AuthedRequest).actor = { id: user.id, name: user.name, roles: user.roles as Role[], team: user.team };
  next();
}
const wrap = (fn: (req: AuthedRequest, res: Response) => Promise<unknown>) => (req: Request, res: Response) =>
  fn(req as AuthedRequest, res).catch((err: Error) => res.status(500).json({ error: err.message }));

// Public: list users for the demo user switcher
app.get("/api/users", async (_req, res) => res.json(await db.user.findMany({ orderBy: { id: "asc" } })));

// Private files with expiring signed links (FIN-10)
app.get("/api/files/:key", (req, res) => {
  const key = req.params.key;
  if (!verifyFileSig(key, Number(req.query.exp), String(req.query.sig ?? ""), FILE_SECRET)) return res.status(403).send("Link expired or invalid.");
  const abs = path.join(STORAGE, path.basename(key));
  if (!fs.existsSync(abs)) return res.status(404).send("Not found");
  res.sendFile(abs);
});

app.use("/api", auth);

app.get("/api/meta", wrap(async (req, res) => {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const calls = await db.aiCall.aggregate({ where: { createdAt: { gte: start } }, _sum: { costUsd: true }, _count: true });
  res.json({ me: req.actor, mockMode: isMockMode(), aiCallsToday: calls._count, aiCostToday: calls._sum.costUsd ?? 0 });
}));

// ---------- 3.1 upload ----------
app.post("/api/invoices", upload.single("file"), wrap(async (req, res) => {
  if (!req.actor.roles.includes("clerk") && !req.actor.roles.includes("admin")) return res.status(403).json({ error: "Only clerks can upload invoices." });
  const file = req.file;
  if (!file) return res.status(400).json({ error: "Choose an XML, PDF or image file." });
  const ext = path.extname(file.originalname).toLowerCase();
  const source = ext === ".xml" ? "xml" : ext === ".pdf" ? "pdf" : [".png", ".jpg", ".jpeg", ".webp"].includes(ext) ? "image" : null;
  if (!source) return res.status(400).json({ error: "Only .xml, .pdf, .png, .jpg or .webp files are accepted." });

  let data: InvoiceData;
  try {
    data = source === "xml" ? parseInvoiceXml(file.buffer.toString("utf8")) : await extractInvoice(file.buffer, file.mimetype);
  } catch (err) {
    return res.status(422).json({ error: `Could not read the file: ${(err as Error).message}` });
  }
  const fileKey = `${randomUUID()}${ext}`;
  fs.mkdirSync(STORAGE, { recursive: true });
  fs.writeFileSync(path.join(STORAGE, fileKey), file.buffer);

  const inv = await db.invoice.create({
    data: {
      source, fileKey, fileName: file.originalname, status: "needs_review",
      data: data as object, aiData: source === "xml" ? undefined : (data as object),
      vendorTaxId: data.vendorTaxId.value ?? "", series: data.series.value ?? "", number: data.number.value ?? "",
      invoiceDate: data.date.value ?? "", total: data.total.value ?? 0, kind: data.kind, uploadedBy: req.actor.id,
    },
  });
  await audit({ actor: req.actor.id, action: "upload", invoiceId: inv.id, newValue: { file: file.originalname, source } });
  res.status(201).json(await processInvoice(inv.id, req.actor.id));
}));

app.get("/api/invoices", wrap(async (req, res) => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const rows = await db.invoice.findMany({ where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { exceptions: { where: { status: "open" }, select: { id: true } } } });
  res.json(rows.map((r) => ({ ...r, openExceptions: r.exceptions.length, exceptions: undefined })));
}));

app.get("/api/invoices/:id", wrap(async (req, res) => {
  const inv = await db.invoice.findUnique({ where: { id: req.params.id }, include: { exceptions: { orderBy: { createdAt: "asc" } } } });
  if (!inv) return res.status(404).json({ error: "Invoice not found" });
  const poNums = ((inv.data as unknown as InvoiceData).poNumbers.value ?? "").split(/[,;\s]+/).filter(Boolean);
  const [pos, receipts, history] = await Promise.all([
    db.purchaseOrder.findMany({ where: { number: { in: poNums } } }),
    db.goodsReceipt.findMany({ where: { poNumber: { in: poNums } } }),
    db.auditLog.findMany({ where: { invoiceId: inv.id }, orderBy: { seq: "asc" } }),
  ]);
  const editBlocked = canEdit(req.actor, inv.status as InvoiceStatus);
  const approveBlocked = approvalBlocked(req.actor, inv.status as InvoiceStatus, { uploadedBy: inv.uploadedBy, editedBy: inv.editedBy });
  res.json({ invoice: inv, fileUrl: signFileUrl(inv.fileKey, FILE_SECRET), pos, receipts, history, permissions: { editBlocked, approveBlocked } });
}));

// ---------- edit / confirm a field (keeps AI value in the audit log) ----------
app.patch("/api/invoices/:id/fields", wrap(async (req, res) => {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: req.params.id } });
  const blocked = canEdit(req.actor, inv.status as InvoiceStatus);
  if (blocked) return res.status(403).json({ error: blocked });
  const { field, value } = req.body as { field: keyof InvoiceData; value: string | number };
  const data = inv.data as unknown as InvoiceData;
  const ai = inv.aiData as unknown as InvoiceData | null;
  const target = data[field] as { value: unknown; confidence: number; confirmedBy?: string } | undefined;
  if (!target || typeof target !== "object" || !("confidence" in target)) return res.status(400).json({ errors: { [field]: "This field cannot be edited." } });
  const numeric = ["subtotal", "taxAmount", "total"].includes(field);
  const v = numeric ? Number(String(value).replace(/[.,\s]/g, "")) : String(value).trim();
  if (numeric && !Number.isFinite(v)) return res.status(400).json({ errors: { [field]: "Enter a number without separators, e.g. 9720000." } });
  if (field === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return res.status(400).json({ errors: { [field]: "Use YYYY-MM-DD." } });
  const old = target.value;
  Object.assign(target, { value: v, confirmedBy: req.actor.id });
  await db.invoice.update({ where: { id: inv.id }, data: { data: data as object, editedBy: [...new Set([...inv.editedBy, req.actor.id])] } });
  await audit({ actor: req.actor.id, action: old === v ? "confirm_field" : "edit_field", invoiceId: inv.id, field, aiValue: (ai?.[field] as { value?: unknown } | undefined)?.value, oldValue: old, newValue: v });
  res.json(await processInvoice(inv.id, req.actor.id));
}));

// ---------- 3.10 confirm an AI line-pair suggestion ----------
app.post("/api/invoices/:id/pairs", wrap(async (req, res) => {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: req.params.id } });
  const blocked = canEdit(req.actor, inv.status as InvoiceStatus);
  if (blocked) return res.status(403).json({ error: blocked });
  const p = req.body as LinePair;
  const pairs = [...(inv.confirmedPairs as unknown as LinePair[]).filter((x) => x.invoiceLine !== p.invoiceLine), { ...p, method: "confirmed_suggestion" as const }];
  await db.invoice.update({ where: { id: inv.id }, data: { confirmedPairs: pairs as object[], editedBy: [...new Set([...inv.editedBy, req.actor.id])] } });
  await audit({ actor: req.actor.id, action: "confirm_pair", invoiceId: inv.id, newValue: p });
  res.json(await processInvoice(inv.id, req.actor.id));
}));

// ---------- exceptions ----------
app.get("/api/exceptions", wrap(async (req, res) => {
  const route = req.query.route ? String(req.query.route) : req.actor.team ?? undefined;
  const rows = await db.invoiceException.findMany({
    where: { status: "open", ...(route && route !== "all" ? { route } : {}) },
    include: { invoice: { select: { id: true, number: true, vendorTaxId: true, total: true, data: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json(rows.map((r) => ({ ...r, vendorName: (r.invoice.data as unknown as InvoiceData).vendorName.value, invoice: { ...r.invoice, data: undefined } })));
}));

app.post("/api/exceptions/:id/explain", wrap(async (req, res) => res.json(await explain(req.params.id))));

app.post("/api/exceptions/:id/resolve", wrap(async (req, res) => {
  if (!req.actor.roles.includes("processor") && !req.actor.roles.includes("admin")) return res.status(403).json({ error: "Only processors can resolve exceptions." });
  const resolution = String(req.body.resolution ?? "").trim();
  if (resolution.length < 5) return res.status(400).json({ errors: { resolution: "Explain the decision in a few words (at least 5 characters)." } });
  const e = await db.invoiceException.findUniqueOrThrow({ where: { id: req.params.id }, include: { invoice: true } });
  if (["DUPLICATE"].includes(e.type)) return res.status(400).json({ error: "Exact duplicates cannot be resolved. Reject the invoice instead." });
  if (e.type === "LOW_CONFIDENCE") return res.status(400).json({ error: "Confirm each highlighted field instead." });
  await db.invoiceException.update({ where: { id: e.id }, data: { status: "resolved", resolution, resolvedBy: req.actor.id, resolvedAt: new Date() } });
  await db.invoice.update({ where: { id: e.invoiceId }, data: { editedBy: [...new Set([...e.invoice.editedBy, req.actor.id])] } });
  await audit({ actor: req.actor.id, action: "resolve_exception", invoiceId: e.invoiceId, field: e.type, newValue: resolution });
  res.json(await processInvoice(e.invoiceId, req.actor.id));
}));

// ---------- 3.13 approve / reject ----------
app.post("/api/invoices/:id/approve", wrap(async (req, res) => {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: req.params.id } });
  const fresh = await processInvoice(inv.id, req.actor.id); // never approve on stale checks
  const blocked = approvalBlocked(req.actor, fresh.status as InvoiceStatus, { uploadedBy: fresh.uploadedBy, editedBy: fresh.editedBy });
  if (blocked) return res.status(403).json({ error: blocked });
  const done = await db.invoice.update({ where: { id: inv.id }, data: { status: "approved", approvedBy: req.actor.id, approvedAt: new Date() } });
  await audit({ actor: req.actor.id, action: "approve", invoiceId: inv.id, oldValue: fresh.status, newValue: "approved" });
  res.json(done);
}));

app.post("/api/invoices/:id/reject", wrap(async (req, res) => {
  const reason = String(req.body.reason ?? "").trim();
  if (reason.length < 5) return res.status(400).json({ errors: { reason: "Give a reason (at least 5 characters)." } });
  if (!req.actor.roles.some((r) => r === "processor" || r === "approver")) return res.status(403).json({ error: "Only processors or approvers can reject." });
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: req.params.id } });
  if (inv.status === "approved") return res.status(400).json({ error: "Approved invoices cannot be rejected here." });
  const done = await db.invoice.update({ where: { id: inv.id }, data: { status: "rejected" } });
  await audit({ actor: req.actor.id, action: "reject", invoiceId: inv.id, oldValue: inv.status, newValue: reason });
  res.json(done);
}));

// ---------- 3.15 payment proposal (CSV). The system never pays. ----------
async function payableInvoices() {
  const rows = await db.invoice.findMany({ where: { status: "approved" }, include: { exceptions: { where: { status: "open" } } }, orderBy: { approvedAt: "asc" } });
  // Defence in depth (FIN-8): approved AND no open exception AND matched.
  return rows.filter((r) => r.exceptions.length === 0 && r.matchedAt);
}
app.get("/api/payment-proposal", wrap(async (_req, res) => {
  const rows = await payableInvoices();
  res.json(rows.map((r) => ({ id: r.id, vendor: (r.data as unknown as InvoiceData).vendorName.value, vendorTaxId: r.vendorTaxId, number: r.number, date: r.invoiceDate, total: r.total, approvedBy: r.approvedBy })));
}));
app.get("/api/payment-proposal.csv", wrap(async (req, res) => {
  const rows = await payableInvoices();
  const csv = toCsv(rows.map((r) => ({ vendor_tax_id: r.vendorTaxId, vendor_name: (r.data as unknown as InvoiceData).vendorName.value ?? "", invoice_series: r.series, invoice_number: r.number, invoice_date: r.invoiceDate, amount_vnd: r.total, approved_by: r.approvedBy ?? "", approved_at: r.approvedAt?.toISOString() ?? "" })));
  await audit({ actor: req.actor.id, action: "export_payment_proposal", newValue: { count: rows.length } });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="payment-proposal-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("﻿" + csv);
}));

// ---------- 3.7 thresholds ----------
app.get("/api/settings", wrap(async (_req, res) => res.json(await getThresholds())));
app.put("/api/settings", wrap(async (req, res) => {
  if (!req.actor.roles.includes("admin")) return res.status(403).json({ error: "Only admins can change thresholds." });
  const b = req.body as Record<string, number>;
  const errors: Record<string, string> = {};
  const pct = (k: string) => (b[k] < 0 || b[k] > 0.5 || !Number.isFinite(b[k]) ? (errors[k] = "Between 0 and 50%.") : null);
  pct("pricePct"); pct("qtyPct");
  for (const k of ["priceAbs", "totalAbs"]) if (!(b[k] >= 0)) errors[k] = "Zero or more.";
  if (!(b.lowConfidence >= 0.5 && b.lowConfidence <= 1)) errors.lowConfidence = "Between 0.5 and 1.";
  if (Object.keys(errors).length) return res.status(400).json({ errors });
  const old = await getThresholds();
  const next = { pricePct: b.pricePct, priceAbs: b.priceAbs, qtyPct: b.qtyPct, totalAbs: b.totalAbs, lowConfidence: b.lowConfidence };
  await db.settings.upsert({ where: { id: 1 }, create: { id: 1, thresholds: next }, update: { thresholds: next } });
  await audit({ actor: req.actor.id, action: "update_thresholds", oldValue: old, newValue: next });
  res.json(next);
}));

// ---------- 3.16 dashboard ----------
app.get("/api/dashboard", wrap(async (_req, res) => {
  const invoices = await db.invoice.findMany({ select: { status: true, match: true, createdAt: true, approvedAt: true } });
  const matched = invoices.filter((i) => i.match);
  const auto = matched.filter((i) => (i.match as { autoMatched?: boolean }).autoMatched).length;
  const byType = await db.invoiceException.groupBy({ by: ["type"], _count: true });
  const resolved = await db.invoiceException.findMany({ where: { status: "resolved", resolvedAt: { not: null } }, select: { createdAt: true, resolvedAt: true } });
  const avgHours = resolved.length ? resolved.reduce((s, r) => s + (r.resolvedAt!.getTime() - r.createdAt.getTime()), 0) / resolved.length / 3.6e6 : null;
  const byStatus = invoices.reduce<Record<string, number>>((m, i) => ((m[i.status] = (m[i.status] ?? 0) + 1), m), {});
  res.json({ total: invoices.length, matchedCount: matched.length, autoMatchRate: matched.length ? auto / matched.length : null, byStatus, exceptionsByType: byType.map((b) => ({ type: b.type, count: b._count })), avgResolutionHours: avgHours });
}));

// ---------- audit ----------
app.get("/api/audit", wrap(async (_req, res) => {
  const rows = await db.auditLog.findMany({ orderBy: { seq: "asc" } });
  const entries: AuditEntry[] = rows.map((r) => ({ ...r, at: r.at.toISOString() }));
  res.json({ brokenAt: verifyChain(entries), entries: entries.slice(-300).reverse() });
}));

const dist = path.resolve("dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

const port = Number(process.env.PORT || 8788);
app.listen(port, () => console.log(`Invoice matching API on http://localhost:${port} (${isMockMode() ? "mock AI" : "live AI"})`));
