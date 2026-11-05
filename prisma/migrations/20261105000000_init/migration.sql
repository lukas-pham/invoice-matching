-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" TEXT[],
    "team" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "tax_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("tax_id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "number" TEXT NOT NULL,
    "vendor_tax_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "requester" TEXT NOT NULL,
    "lines" JSONB NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "number" TEXT NOT NULL,
    "po_number" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "lines" JSONB NOT NULL,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "ai_data" JSONB,
    "vendor_tax_id" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "invoice_date" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'original',
    "related_id" TEXT,
    "match" JSONB,
    "confirmed_pairs" JSONB NOT NULL DEFAULT '[]',
    "pair_suggestions" JSONB NOT NULL DEFAULT '[]',
    "near_duplicates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploaded_by" TEXT NOT NULL,
    "edited_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matched_at" TIMESTAMP(3),

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_exceptions" (
    "id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "line_no" INTEGER,
    "route" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "resolved_by" TEXT,
    "resolved_at" TIMESTAMP(3),
    "explanation" TEXT,
    "email_draft" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "seq" SERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "invoice_id" TEXT,
    "field" TEXT,
    "ai_value" TEXT,
    "old_value" TEXT,
    "new_value" TEXT,
    "prev_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "thresholds" JSONB NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_calls" (
    "id" TEXT NOT NULL,
    "prompt_id" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "cost_usd" DOUBLE PRECISION NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "goods_receipts_po_number_idx" ON "goods_receipts"("po_number");

-- CreateIndex
CREATE INDEX "invoices_vendor_tax_id_number_idx" ON "invoices"("vendor_tax_id", "number");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_exceptions_route_status_idx" ON "invoice_exceptions"("route", "status");

-- AddForeignKey
ALTER TABLE "invoice_exceptions" ADD CONSTRAINT "invoice_exceptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 3.14: the audit log cannot be changed or deleted, even with direct SQL from the app user.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON "audit_log" FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
