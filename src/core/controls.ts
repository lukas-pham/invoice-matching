import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Role } from "./types";

/** Invoice workflow states. Transitions are only made through `canTransition`. */
export type InvoiceStatus =
  | "needs_review" // low-confidence fields must be confirmed
  | "exceptions" // open exceptions
  | "ready_for_approval"
  | "approved"
  | "rejected"
  | "duplicate";

export interface Actor {
  id: string;
  roles: Role[];
}

export interface InvoiceParties {
  uploadedBy: string;
  editedBy: string[]; // anyone who changed a field or resolved an exception
}

/** 3.13 — segregation of duties. Returns the reason it is not allowed, or null. */
export function approvalBlocked(actor: Actor, status: InvoiceStatus, parties: InvoiceParties): string | null {
  if (!actor.roles.includes("approver")) return "Only approvers can approve invoices.";
  if (status !== "ready_for_approval") return "The invoice is not ready for approval.";
  if (parties.uploadedBy === actor.id) return "You entered this invoice, so someone else must approve it.";
  if (parties.editedBy.includes(actor.id)) return "You changed or processed this invoice, so someone else must approve it.";
  return null;
}

export function canEdit(actor: Actor, status: InvoiceStatus): string | null {
  if (!actor.roles.some((r) => r === "clerk" || r === "processor")) return "Only clerks and processors can change invoice data.";
  if (status === "approved" || status === "duplicate") return "Approved or duplicate invoices cannot be changed.";
  return null;
}

/** 3.15 / FIN-8 — only matched and approved invoices may appear in the payment proposal. */
export const payable = (status: InvoiceStatus, autoMatchedOrResolved: boolean) => status === "approved" && autoMatchedOrResolved;

// ---------- 3.14 audit trail: hash chain ----------
export interface AuditEntry {
  seq: number;
  at: string;
  actor: string;
  action: string;
  invoiceId: string | null;
  field: string | null;
  aiValue: string | null;
  oldValue: string | null;
  newValue: string | null;
  prevHash: string;
  hash: string;
}

export function hashEntry(e: Omit<AuditEntry, "hash">): string {
  return createHash("sha256")
    .update(JSON.stringify([e.seq, e.at, e.actor, e.action, e.invoiceId, e.field, e.aiValue, e.oldValue, e.newValue, e.prevHash]))
    .digest("hex");
}

/** Returns the seq of the first broken entry, or null when the chain is intact. */
export function verifyChain(entries: AuditEntry[]): number | null {
  let prev = "GENESIS";
  for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
    if (e.prevHash !== prev || hashEntry(e) !== e.hash) return e.seq;
    prev = e.hash;
  }
  return null;
}

// ---------- private document links with expiry ----------
export function signFileUrl(key: string, secret: string, ttlSec = 600, now = Date.now()) {
  const exp = Math.floor(now / 1000) + ttlSec;
  const sig = createHmac("sha256", secret).update(`${key}.${exp}`).digest("hex");
  return `/api/files/${encodeURIComponent(key)}?exp=${exp}&sig=${sig}`;
}

export function verifyFileSig(key: string, exp: number, sig: string, secret: string, now = Date.now()) {
  if (!Number.isFinite(exp) || exp < now / 1000) return false;
  const expected = createHmac("sha256", secret).update(`${key}.${exp}`).digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// ---------- CSV ----------
export function toCsv(rows: Record<string, string | number>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}
