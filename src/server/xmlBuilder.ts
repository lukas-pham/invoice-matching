/** Builds sample e-invoice XML (HDon structure) for tests and the sample/benchmark generator. */

export interface SampleInvoice {
  vendorName: string;
  vendorTaxId: string;
  series: string; // e.g. C26TAA
  number: string;
  date: string;
  po: string;
  lines: { sku: string; name: string; unit: string; qty: number; price: number; rate: number }[];
  related?: { type: "adjustment" | "replacement"; series: string; number: string };
  /** Corrupt totals on purpose (benchmark). */
  totalOffset?: number;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildInvoiceXml(s: SampleInvoice): string {
  let sub = 0;
  let tax = 0;
  const items = s.lines
    .map((l, i) => {
      const amount = Math.round(l.qty * l.price);
      sub += amount;
      tax += l.rate > 0 ? amount * l.rate : 0;
      return `<HHDVu><STT>${i + 1}</STT><MHHDVu>${esc(l.sku)}</MHHDVu><THHDVu>${esc(l.name)}</THHDVu><DVTinh>${esc(l.unit)}</DVTinh><SLuong>${l.qty}</SLuong><DGia>${l.price}</DGia><ThTien>${amount}</ThTien><TSuat>${l.rate < 0 ? "KCT" : `${Math.round(l.rate * 100)}%`}</TSuat></HHDVu>`;
    })
    .join("");
  tax = Math.round(tax);
  const related = s.related
    ? `<TTHDLQuan><TCHDon>${s.related.type === "replacement" ? 1 : 2}</TCHDon><KHMSHDCLQuan>1</KHMSHDCLQuan><KHHDCLQuan>${esc(s.related.series.slice(1))}</KHHDCLQuan><SHDCLQuan>${esc(s.related.number)}</SHDCLQuan></TTHDLQuan>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<HDon><DLHDon>
<TTChung><PBan>2.1.0</PBan><THDon>HÓA ĐƠN GIÁ TRỊ GIA TĂNG</THDon><KHMSHDon>${esc(s.series.slice(0, 1))}</KHMSHDon><KHHDon>${esc(s.series.slice(1))}</KHHDon><SHDon>${esc(s.number)}</SHDon><NLap>${s.date}</NLap><DVTTe>VND</DVTTe>${related}</TTChung>
<NDHDon>
<NBan><Ten>${esc(s.vendorName)}</Ten><MST>${esc(s.vendorTaxId)}</MST></NBan>
<NMua><Ten>Công ty Demo</Ten><MST>0109999999</MST></NMua>
<DSHHDVu>${items}</DSHHDVu>
<TToan><TgTCThue>${sub}</TgTCThue><TgTThue>${tax}</TgTThue><TgTTTBSo>${sub + tax + (s.totalOffset ?? 0)}</TgTTTBSo></TToan>
</NDHDon>
<TTKhac><TTin><TTruong>SoDonMuaHang</TTruong><KDLieu>string</KDLieu><DLieu>${esc(s.po)}</DLieu></TTin></TTKhac>
</DLHDon></HDon>`;
}
