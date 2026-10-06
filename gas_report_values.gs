/**
 * รายงานยอดขายเต็มชุด 30 คอลัมน์ — เขียนเป็น "ค่าดิบ" ไม่ใช่สูตร
 * หน้าตาเดียวกับแท็บ Total 2569 / มกราคม 69 / Daily ในไฟล์แบบฟอร์มส่งยอดขาย
 *
 * ทำไมต้องมี:
 *   แท็บเดิมคำนวณด้วยสูตรนับพันช่อง + ดึงข้าวไฟล์ด้วย IMPORTRANGE
 *   เปิดบนไอโฟนไม่ไหว ไฟล์นี้ย้ายการคำนวณทั้งหมดมาไว้ที่ Apps Script
 *   ชีทปลายทางเหลือแต่ตัวเลขนิ่ง ๆ เปิดเร็วเท่าตารางเปล่า
 *
 * ⚠️ ไฟล์อิสระ ไม่เกี่ยวกับ gas_sync_v20.gs และ gas_summary_values.gs
 *
 * วิธีติดตั้ง:
 *   1. เปิดชีทปลายทาง → ส่วนขยาย → Apps Script
 *   2. วางโค้ดนี้ทั้งไฟล์
 *   3. แก้ REPORT_TARGETS ให้ตรงกับไฟล์/แท็บ/ช่วงเวลาที่ต้องการ
 *   4. เลือก syncReports แล้วกด Run (ครั้งแรกจะขออนุญาต)
 *   5. อยากให้อัปเดตเอง เลือก setupReportTrigger แล้วกด Run
 */

// ── Supabase (ชุดของไฟล์นี้เอง) ──
const RPT_SUPABASE_URL = "https://zroqklbobvixyohfaimc.supabase.co";
const RPT_SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb3FrbGJvYnZpeHlvaGZhaW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTUzNjMsImV4cCI6MjA5NDIzMTM2M30.BSwbqeQ1jsyvATpOkJ-wV04TGZacagaNpj6S4fPC-J4";

/* ── แท็บที่จะสร้าง — เพิ่มได้ไม่จำกัด ─────────────────────────────
   id     = รหัสไฟล์ชีทปลายทาง
   tab    = ชื่อแท็บ (ไม่มีจะสร้างให้)
   scope  = "year" | "month" | "day" | "range"
   year / month / date / from / to  ตามชนิดของ scope
   bzm    = กรองเฉพาะโซนนั้น · "" = ทุกสาขา
   codes  = กรองเฉพาะรหัสสาขาที่ระบุ · [] = ไม่กรอง

   ตัวอย่าง:
     { id:"xxx", tab:"Total 2026",   scope:"year",  year:2026 },
     { id:"xxx", tab:"มกราคม 2026",  scope:"month", year:2026, month:1 },
     { id:"xxx", tab:"Daily",        scope:"day",   date:"วันนี้" },
     { id:"xxx", tab:"โซนพี่นพ",      scope:"month", year:2026, month:1,
       bzm:"นพชัย จันทร์รุ่ง (พี่นพ)" },
──────────────────────────────────────────────────────────────── */
const REPORT_TARGETS = [
  { id: "ใส่รหัสไฟล์ปลายทางตรงนี้", tab: "Total 2026", scope: "year", year: 2026, bzm: "", codes: [] }
];

// สาขา Santa fe Easy — แยกบล็อกท้ายตารางเหมือนในไฟล์เดิม
const EASY_CODES = ["5504", "5505", "5508", "5509"];

const RPT_HEADER = [
  "BZM", "รหัส", "สาขา",
  "Plan Sale", "Actual Sale 16.00", "Actual Sale สิ้นวัน", "%",
  "Dine In", "Take away", "Grab", "Line Man", "Shopee Food", "Total Delivery",
  "Trans Total", "Trans Dine In", "Trans Take away", "Trans Grab",
  "Trans Line Man", "Trans Shopee Food", "Trans Delivery",
  "Ticket Avg.", "Ticket Dine In", "Ticket Take away", "Ticket Delivery",
  "Customer", "Customer Avg.", "Labour(hour)", "Labour(Baht)",
  "%Col", "Productivity Trans", "Productivity Sale"
];

// ════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════
function syncReports() {
  const t0 = new Date().getTime();
  REPORT_TARGETS.forEach(target => {
    try {
      const range = _rptRange(target);
      const rows  = _rptFetch(range.from, range.to);
      const n     = _rptWriteTarget(target, rows, range);
      Logger.log("  ✓ " + target.tab + "  " + range.from + " ถึง " + range.to + "  " + n + " สาขา");
    } catch (e) {
      Logger.log("  ✗ " + target.tab + " : " + e.message);
    }
  });
  Logger.log("✅ เสร็จ " + REPORT_TARGETS.length + " แท็บ ใช้เวลา " +
             ((new Date().getTime() - t0) / 1000).toFixed(1) + " วินาที");
}

// ช่วงวันที่ของแต่ละ scope
function _rptRange(t) {
  const pad = n => (n < 10 ? "0" + n : "" + n);
  if (t.scope === "year")  return { from: t.year + "-01-01", to: t.year + "-12-31", label: "ปี " + t.year };
  if (t.scope === "month") {
    const last = new Date(t.year, t.month, 0).getDate();   // วันสุดท้ายของเดือน
    return { from: t.year + "-" + pad(t.month) + "-01",
             to:   t.year + "-" + pad(t.month) + "-" + pad(last),
             label: TH_MONTH_NAMES[t.month - 1] + " " + t.year };
  }
  if (t.scope === "day") {
    const d = (!t.date || t.date === "วันนี้") ? _rptToday() : t.date;
    return { from: d, to: d, label: d };
  }
  if (t.scope === "range") return { from: t.from, to: t.to, label: t.from + " – " + t.to };
  throw new Error("scope ไม่ถูกต้อง: " + t.scope);
}

const TH_MONTH_NAMES = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
                        "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

function _rptToday() {
  return Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd");
}

// ════════════════════════════════════════════
// FETCH — ทั้งรอบ 16.00 และสิ้นวัน (แบ่งหน้าละ 1000)
// ════════════════════════════════════════════
function _rptFetch(from, to) {
  const PAGE = 1000;
  const url = RPT_SUPABASE_URL + "/rest/v1/sales_data" +
    "?select=branch_code,branch_name,district_manager,submit_date,submit_time_slot," +
    "plan_sale,actual_sale,sale_dine_in,sale_take_away,sale_grab,sale_lineman,sale_shopeefood," +
    "total_trans,trans_dine_in,trans_take_away,trans_grab,trans_lineman,trans_shopeefood," +
    "customer,labour_hour,labour_baht" +
    "&submit_date=gte." + from + "&submit_date=lte." + to +
    "&order=submit_date.asc";

  let all = [], offset = 0;
  while (true) {
    const res = UrlFetchApp.fetch(url, {
      headers: {
        apikey: RPT_SUPABASE_KEY, Authorization: "Bearer " + RPT_SUPABASE_KEY,
        Range: offset + "-" + (offset + PAGE - 1), "Range-Unit": "items"
      },
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code !== 200 && code !== 206) throw new Error("HTTP " + code + ": " + res.getContentText());
    const data = JSON.parse(res.getContentText());
    all = all.concat(data);
    if (data.length < PAGE) break;
    offset += PAGE;
    if (offset > 500000) break;
  }
  return all;
}

// ════════════════════════════════════════════
// รวมยอดต่อสาขา
// ════════════════════════════════════════════
function _rptAggregate(rows, target) {
  const codeSet = (target.codes && target.codes.length)
    ? _rptSet(target.codes.map(String)) : null;

  const by = {};
  rows.forEach(r => {
    const code = String(r.branch_code || "").trim();
    if (!code) return;
    if (target.bzm && String(r.district_manager || "") !== target.bzm) return;
    if (codeSet && !codeSet[code]) return;

    let b = by[code];
    if (!b) {
      b = by[code] = {
        code: code, name: "", bzm: "",
        plan: 0, a16: 0, aEod: 0,
        dine: 0, take: 0, grab: 0, line: 0, shopee: 0,
        tTotal: 0, tDine: 0, tTake: 0, tGrab: 0, tLine: 0, tShopee: 0,
        customer: 0, lhour: 0, lbaht: 0
      };
    }
    if (r.branch_name)      b.name = _rptCleanName(r.branch_name);
    if (r.district_manager) b.bzm  = r.district_manager;

    const n = v => Number(v) || 0;
    if (r.submit_time_slot === "16.00") {
      b.a16 += n(r.actual_sale);
      return;                       // รอบ 16.00 เป็นยอดระหว่างวัน ไม่เอามารวมช่องทาง/trans
    }
    // รอบสิ้นวัน = ยอดจริงทั้งวัน
    b.plan     += n(r.plan_sale);
    b.aEod     += n(r.actual_sale);
    b.dine     += n(r.sale_dine_in);
    b.take     += n(r.sale_take_away);
    b.grab     += n(r.sale_grab);
    b.line     += n(r.sale_lineman);
    b.shopee   += n(r.sale_shopeefood);
    b.tTotal   += n(r.total_trans);
    b.tDine    += n(r.trans_dine_in);
    b.tTake    += n(r.trans_take_away);
    b.tGrab    += n(r.trans_grab);
    b.tLine    += n(r.trans_lineman);
    b.tShopee  += n(r.trans_shopeefood);
    b.customer += n(r.customer);
    b.lhour    += n(r.labour_hour);
    b.lbaht    += n(r.labour_baht);
  });
  return by;
}

// หารแบบไม่ให้ขึ้น #DIV/0! — ตัวหารเป็น 0 คืนค่าว่าง
function _rptDiv(a, b) { return b ? a / b : ""; }

// แปลงข้อมูลสาขาหนึ่งเป็นแถวตาราง
function _rptRow(b) {
  const delivery  = b.grab + b.line + b.shopee;
  const tDelivery = b.tGrab + b.tLine + b.tShopee;
  return [
    b.bzm, b.code, b.name,
    b.plan, b.a16, b.aEod, _rptDiv(b.aEod, b.plan),
    b.dine, b.take, b.grab, b.line, b.shopee, delivery,
    b.tTotal, b.tDine, b.tTake, b.tGrab, b.tLine, b.tShopee, tDelivery,
    _rptDiv(b.aEod, b.tTotal), _rptDiv(b.dine, b.tDine),
    _rptDiv(b.take, b.tTake), _rptDiv(delivery, tDelivery),
    b.customer, _rptDiv(b.aEod, b.customer),
    b.lhour, b.lbaht,
    _rptDiv(b.lbaht, b.aEod),
    _rptDiv(b.tTotal, b.lhour), _rptDiv(b.aEod, b.lhour)
  ];
}

// แถวรวมของกลุ่ม — บวกยอดดิบก่อนแล้วค่อยหา ไม่ใช่เอาค่าเฉลี่ยมาเฉลี่ยซ้ำ
function _rptTotalRow(label, list) {
  const sum = {
    code: "", name: label, bzm: "",
    plan: 0, a16: 0, aEod: 0, dine: 0, take: 0, grab: 0, line: 0, shopee: 0,
    tTotal: 0, tDine: 0, tTake: 0, tGrab: 0, tLine: 0, tShopee: 0,
    customer: 0, lhour: 0, lbaht: 0
  };
  list.forEach(b => {
    Object.keys(sum).forEach(k => {
      if (typeof sum[k] === "number") sum[k] += b[k];
    });
  });
  const row = _rptRow(sum);
  row[0] = "Total";
  return row;
}

// ════════════════════════════════════════════
// เขียนลงชีท
// ════════════════════════════════════════════
function _rptWriteTarget(target, rows, range) {
  const by = _rptAggregate(rows, target);
  const codes = Object.keys(by).sort();

  const easy = _rptSet(EASY_CODES);
  const main = codes.filter(c => !easy[c]).map(c => by[c]);
  const sfe  = codes.filter(c =>  easy[c]).map(c => by[c]);

  const body = [];
  main.forEach(b => body.push(_rptRow(b)));
  if (main.length) body.push(_rptTotalRow("Santa fe", main));
  if (sfe.length) {
    body.push(new Array(RPT_HEADER.length).fill(""));
    sfe.forEach(b => body.push(_rptRow(b)));
    body.push(_rptTotalRow("Santa fe Easy", sfe));
  }

  // รวมแยกตาม BZM ท้ายตาราง
  const zones = {};
  codes.forEach(c => {
    const z = by[c].bzm || "(ไม่ระบุ BZM)";
    (zones[z] = zones[z] || []).push(by[c]);
  });
  const zoneNames = Object.keys(zones).sort();
  if (zoneNames.length > 1) {
    body.push(new Array(RPT_HEADER.length).fill(""));
    zoneNames.forEach(z => body.push(_rptTotalRow(z, zones[z])));
  }

  _rptWrite(target, RPT_HEADER, body, range.label);
  return codes.length;
}

function _rptWrite(target, header, body, label) {
  const ss = SpreadsheetApp.openById(target.id);
  let sh = ss.getSheetByName(target.tab);
  if (!sh) {
    sh = ss.insertSheet(target.tab);
    sh.setFrozenRows(2);
    sh.setFrozenColumns(3);
  }
  const cols = header.length;
  const need = body.length + 4;
  if (sh.getMaxRows() < need)    sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  if (sh.getMaxColumns() < cols) sh.insertColumnsAfter(sh.getMaxColumns(), cols - sh.getMaxColumns());

  sh.getRange(1, 1, sh.getMaxRows(), cols).clearContent();
  sh.getRange(1, 1).setValue(label).setFontWeight("bold");
  sh.getRange(2, 1, 1, cols).setValues([header]).setFontWeight("bold");

  if (body.length) {
    sh.getRange(3, 1, body.length, cols).setValues(body);
    // รูปแบบตัวเลข: ยอดเงิน/จำนวน = คั่นหลักพัน · อัตราส่วน = เปอร์เซ็นต์
    const pctCols = [7, 29];                 // % และ %Col
    const numStart = 4;
    sh.getRange(3, numStart, body.length, cols - numStart + 1).setNumberFormat("#,##0.00");
    pctCols.forEach(c => sh.getRange(3, c, body.length, 1).setNumberFormat("0.00%"));
  }
  sh.getRange(body.length + 4, 1).setValue(
    "อัปเดตล่าสุด " + Utilities.formatDate(new Date(), "Asia/Bangkok", "d/M/yyyy HH:mm")
  );
  SpreadsheetApp.flush();
}

// Set แบบ object — Apps Script รุ่นเก่าบางตัวไม่มี Set
function _rptSet(list) {
  const o = {};
  list.forEach(v => { o[String(v)] = true; });
  return o;
}

function _rptCleanName(name) {
  return String(name || "").replace(/^\s*\d{4,5}\s+/, "").trim();
}

// ════════════════════════════════════════════
// TRIGGER
// ════════════════════════════════════════════
function setupReportTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "syncReports")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("syncReports").timeBased().everyHours(1).create();
  Logger.log("✅ ตั้งให้รายงานอัปเดตทุก 1 ชั่วโมง");
}
