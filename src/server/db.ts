import { PrismaClient } from "@prisma/client";
import { hashEntry } from "../core/controls";

export const db = new PrismaClient();

/** 3.14 — append one hash-chained audit entry. Serialised with an advisory lock so the chain never forks. */
export async function audit(e: {
  actor: string;
  action: string;
  invoiceId?: string | null;
  field?: string | null;
  aiValue?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
}) {
  const s = (v: unknown) => (v === undefined || v === null ? null : typeof v === "string" ? v : JSON.stringify(v));
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(4242)`;
    const last = await tx.auditLog.findFirst({ orderBy: { seq: "desc" } });
    const seq = (last?.seq ?? 0) + 1;
    const at = new Date();
    const base = {
      seq,
      at: at.toISOString(),
      actor: e.actor,
      action: e.action,
      invoiceId: e.invoiceId ?? null,
      field: e.field ?? null,
      aiValue: s(e.aiValue),
      oldValue: s(e.oldValue),
      newValue: s(e.newValue),
      prevHash: last?.hash ?? "GENESIS",
    };
    return tx.auditLog.create({ data: { ...base, at, hash: hashEntry(base) } });
  });
}
