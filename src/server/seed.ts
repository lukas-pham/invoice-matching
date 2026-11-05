import { db } from "./db";
import { DEFAULT_THRESHOLDS } from "../core/types";

/** Demo master data: users with separated roles, vendors, POs and goods receipts. All fictional. */
export const VENDORS = [
  { taxId: "0312345678", name: "Công ty TNHH Văn Phòng Phẩm Sao Mai", email: "ketoan@saomai.example" },
  { taxId: "0109876543", name: "Công ty CP Thiết Bị Điện Hòa Bình", email: "billing@hoabinh.example" },
  { taxId: "0401122334", name: "Công ty TNHH Dịch Vụ Vệ Sinh Xanh", email: "ar@vesinhxanh.example" },
];

export const POS = [
  {
    number: "PO-1001", vendorTaxId: "0312345678", type: "goods", requester: "u-req",
    lines: [
      { no: 1, sku: "PAPER-A4", description: "Giấy A4 Double A 70gsm", unit: "ram", quantity: 100, unitPrice: 80000, taxRate: 0.08 },
      { no: 2, sku: "PEN-BL", description: "Bút bi Thiên Long xanh", unit: "hộp", quantity: 20, unitPrice: 50000, taxRate: 0.08 },
    ],
  },
  {
    number: "PO-1002", vendorTaxId: "0109876543", type: "goods", requester: "u-req",
    lines: [
      { no: 1, sku: "LED-18W", description: "Bóng đèn LED tuýp 18W", unit: "cái", quantity: 200, unitPrice: 65000, taxRate: 0.1 },
      { no: 2, sku: "CABLE-2.5", description: "Dây điện Cadivi 2.5mm", unit: "cuộn", quantity: 10, unitPrice: 1250000, taxRate: 0.1 },
    ],
  },
  {
    number: "PO-2001", vendorTaxId: "0401122334", type: "service", requester: "u-req",
    lines: [{ no: 1, sku: "CLEAN-M", description: "Dịch vụ vệ sinh văn phòng tháng 10/2026", unit: "tháng", quantity: 1, unitPrice: 15000000, taxRate: 0.08 }],
  },
];

export const GRNS = [
  { number: "GRN-5001", poNumber: "PO-1001", receivedAt: new Date("2026-10-02"), lines: [{ sku: "PAPER-A4", quantity: 100 }, { sku: "PEN-BL", quantity: 20 }] },
  { number: "GRN-5002", poNumber: "PO-1002", receivedAt: new Date("2026-10-03"), lines: [{ sku: "LED-18W", quantity: 150 }, { sku: "CABLE-2.5", quantity: 10 }] },
];

async function main() {
  const users = [
    { id: "u-clerk", name: "Lan (Nhập liệu)", roles: ["clerk"], team: "accounting" },
    { id: "u-proc", name: "Minh (Kế toán công nợ)", roles: ["processor"], team: "accounting" },
    { id: "u-buy", name: "Hà (Mua hàng)", roles: ["processor"], team: "purchasing" },
    { id: "u-wh", name: "Tuấn (Kho)", roles: ["processor"], team: "warehouse" },
    { id: "u-req", name: "Quang (Người đề nghị)", roles: ["processor"], team: "requester" },
    { id: "u-appr", name: "Chị Thu (Kế toán trưởng)", roles: ["approver"], team: null },
    { id: "u-admin", name: "Admin", roles: ["admin", "approver"], team: null },
  ];
  for (const u of users) await db.user.upsert({ where: { id: u.id }, create: u, update: u });
  for (const v of VENDORS) await db.vendor.upsert({ where: { taxId: v.taxId }, create: v, update: v });
  for (const p of POS) await db.purchaseOrder.upsert({ where: { number: p.number }, create: p, update: p });
  for (const g of GRNS) await db.goodsReceipt.upsert({ where: { number: g.number }, create: g, update: g });
  await db.settings.upsert({ where: { id: 1 }, create: { id: 1, thresholds: { ...DEFAULT_THRESHOLDS } }, update: {} });
  console.log("Seeded users, vendors, POs, goods receipts and thresholds.");
}

if (process.argv[1]?.endsWith("seed.ts")) main().finally(() => db.$disconnect());
