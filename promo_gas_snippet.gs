// ═════════════════════════════════════════════════════════════
// เพิ่ม CODE นี้ในไฟล์ Apps Script เดิม (ที่ handle pushToSheet)
// ═════════════════════════════════════════════════════════════

// Sheet ID ปลายทางสำหรับ "รายการเชียร์ขาย" — แยกจากไฟล์อื่น
const PROMO_SHEET_ID = "1PLTuAZI8E9w_-0SMigjZs_Ok1UE4w-kkL_dCJ7mfTHw";
const PROMO_SHEET_NAME = "Promo";  // ชื่อ tab ในไฟล์นั้น

// ═════════════════════════════════════════════════════════════
// ในฟังก์ชัน doPost(e) หลัก — เพิ่ม case สำหรับ action = "promo_submission"
// ตัวอย่าง (ปรับให้เข้ากับ handler ของคุณ):
//
//   const action = data.action;
//   if (action === "promo_submission") {
//     return handlePromoSubmission(data);
//   }
//   ...
// ═════════════════════════════════════════════════════════════

function handlePromoSubmission(data) {
  try {
    const ss = SpreadsheetApp.openById(PROMO_SHEET_ID);
    let sheet = ss.getSheetByName(PROMO_SHEET_NAME);

    // สร้าง sheet + header ถ้ายังไม่มี
    if (!sheet) {
      sheet = ss.insertSheet(PROMO_SHEET_NAME);
      sheet.appendRow([
        "timestamp", "submit_date", "branch_code", "branch_name",
        "district_manager", "submitter_name",
        "item_id", "item_name", "unit_price", "quantity", "subtotal",
        "total_qty", "total_amount"
      ]);
      sheet.setFrozenRows(1);
    }

    const ts = new Date();
    const items = Array.isArray(data.items) ? data.items : [];

    // 1 submission = หลาย rows (1 row ต่อ item ที่กรอก qty > 0)
    const rowsToAdd = [];
    items.forEach(function(it) {
      if (!it || (parseFloat(it.qty) || 0) <= 0) return;  // ข้าม item ที่ไม่ได้กรอก
      rowsToAdd.push([
        ts,
        data.submit_date || "",
        data.branch_code || "",
        data.branch_name || "",
        data.district_manager || "",
        data.submitter_name || "",
        it.id || "",
        it.name || "",
        parseFloat(it.price) || 0,
        parseInt(it.qty) || 0,
        parseFloat(it.subtotal) || 0,
        parseInt(data.total_qty) || 0,
        parseFloat(data.total_amount) || 0
      ]);
    });

    if (rowsToAdd.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, rowsToAdd[0].length)
           .setValues(rowsToAdd);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, rows: rowsToAdd.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
