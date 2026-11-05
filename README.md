# Invoice Matching & Payment Proposals (outside Shopify)

Reads supplier invoices, matches them against purchase orders (PO) and goods receipts (GRN), and routes every discrepancy to the right person. **AI only extracts and explains. Code decides whether something matches. People approve.**

Target users: accounts-payable clerks and payment approvers in mid-sized Vietnamese companies. The UI is in Vietnamese.

> Status: **v0 — first working build.** Core matching logic is unit tested (23 tests), the app builds, and the main flow was run end to end against PostgreSQL with the sample XML invoices. The 100-invoice benchmark (with PDFs and low-quality images) and the accountant user test have not been done yet.

## What it does

| Req | How |
|---|---|
| 3.1 XML / PDF / image | XML → `src/core/xmlInvoice.ts` (parser, no AI). PDF/image → Claude with a JSON schema |
| 3.2 / 3.3 schema + confidence + source link | Every field carries `confidence` and `source` (XML element path, or PDF page + quoted text); "Xem" jumps to it in the viewer |
| 3.4 arithmetic | `checkArithmetic`: qty × price per line, VAT, subtotal + VAT = total |
| 3.5 / 3.6 2-way & 3-way | `matchInvoice`: services → invoice vs PO; goods → invoice vs PO vs received-and-not-yet-billed quantity |
| 3.7 thresholds | Price: % **and** VND per unit; quantity %; rounding tolerance; low-confidence cut-off |
| 3.8 duplicates | Exact (vendor + series/number + date + amount) blocks the invoice; near-duplicates reported separately |
| 3.9 adjustment / replacement | Read from `TTHDLQuan`; linked to the original or raised as an exception |
| 3.10 line pairing | Deterministic by SKU / exact name; AI suggests the rest; a person confirms |
| 3.11 routing | Price → Purchasing, quantity → Warehouse, missing PO → Requester, arithmetic/duplicates → Accounting |
| 3.12 explanation + email draft | Generated on request, shown as a draft, never sent |
| 3.13 roles + SoD | Clerk / processor / approver / admin; nobody approves an invoice they entered, edited or processed (`approvalBlocked`) |
| 3.14 audit trail | Hash-chained `audit_log` with AI value, final value, who, when; DB trigger blocks UPDATE/DELETE; chain verified on the audit page |
| 3.15 CSV | Only approved + matched + no open exceptions; formula-injection safe; no payment is executed |
| 3.16 dashboard | Auto-match rate, exceptions by type, average resolution time |

Documents are stored outside the web root and served only through HMAC-signed links that expire after 10 minutes.

## Domain notes (what I had to learn)

- **Three-way matching**: invoice ↔ PO ↔ goods receipt. Variance above tolerance → exception. Services only need two-way (nothing is received into stock).
- Typical exceptions: wrong quantity, wrong price, missing PO number, one invoice for several POs, partial delivery.
- **Partial delivery** is not an error by itself: the invoice may bill only what was received and not yet billed. The code tracks quantities already billed on other invoices so the same receipt cannot be billed twice.
- Vietnamese e-invoices now follow **Decree 254/2026 and Circular 91/2026 (effective 1 Jul 2026)**; many articles still cite Decree 123/2020. The XML element names used here (`HDon/DLHDon/TTChung/NDHDon/...`) must be re-checked against the schema published with Circular 91/2026.
- Questions still to ask an accountant: which tolerance is normal per category; who may accept a price increase; how adjustment invoices are booked against an already-paid original.

## Run it

```bash
nvm use 22
npm install
docker compose up -d
cp .env.example .env
npx prisma migrate deploy
npm run db:seed          # users with separated roles, vendors, POs, goods receipts
npm run samples          # writes 11 XML invoices with known problems to samples/
npm run dev              # API :8788, UI :5173
npm test
```

Try it: pick **Lan (Nhập liệu)** and upload `samples/01…11` in order; switch to **Hà (Mua hàng)** / **Tuấn (Kho)** to resolve exceptions; switch to **Chị Thu (Kế toán trưởng)** to approve; download the payment proposal CSV.

## Acceptance criteria — status

| Criterion | Status |
|---|---|
| 100 invoices (XML, PDF, images) with seeded errors | 11 XML samples with expected results (`samples/expected.json`): **11/11 raised every expected exception** in an end-to-end run on PostgreSQL. Extra exceptions seen: 08 also flagged as possible duplicate of 05 (same vendor, same amount, 1 day apart); 10 and 11 also flagged over-billing because 01 had already billed the same receipt — both are correct behaviour. PDFs/images not built |
| ≥95% key fields correct on clear PDFs | Not measured |
| 100% over-threshold variances become exceptions | Unit tests + XML samples pass |
| 100% exact duplicates detected; near-duplicates reported separately | Unit tests + sample 02/11 |
| Low-confidence fields cannot auto-advance | Enforced: matching does not run until confirmed |
| Unmatched / unapproved invoices never in the payment list | Enforced in the export query |
| Instructions inside invoice text do not change results | Matching is code-only; sample 10 + unit test |
| An accountant tries it and gives feedback | Not done |
| Passes Agent Review (project 1, finance rule set) | Not run yet |

## Known gaps (v0)

- Demo login (user picked in the UI). Needs real authentication.
- PDF viewer jumps to the page and shows the quoted text; it does not draw a box on the PDF yet.
- No ERP connection, no tax-portal verification, no payments (out of scope).
