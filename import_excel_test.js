/**
 * Santa Fe — Import Excel Sales Data → Supabase `sales_data_test`
 *
 * วิธีรัน:
 *   1. ต้องรัน SQL ใน supabase_test_table.sql ก่อน (สร้าง table)
 *   2. npm i xlsx @supabase/supabase-js   (ทำครั้งเดียว)
 *   3. node import_excel_test.js
 *
 * ทำอะไร:
 *   - อ่านไฟล์ "แบบฟอร์มส่งยอดขาย เทสระบบใหม่.xlsx"
 *   - parse → map ให้ตรง schema sales_data_test
 *   - upsert เป็น batch ขนาด 500 (idempotent: รันซ้ำได้)
 */

const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ── CONFIG ─────────────────────────────────────
const SUPABASE_URL = "https://zroqklbobvixyohfaimc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb3FrbGJvYnZpeHlvaGZhaW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTUzNjMsImV4cCI6MjA5NDIzMTM2M30.BSwbqeQ1jsyvATpOkJ-wV04TGZacagaNpj6S4fPC-J4";
const FILE = "แบบฟอร์มส่งยอดขาย เทสระบบใหม่.xlsx";
const TABLE = "sales_data_test";
const BATCH_SIZE = 500;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Helpers ────────────────────────────────────
function xlDateToISO(serial) {
  if (typeof serial !== "number" || !isFinite(serial)) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

function num(v) {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isFinite(n) ? n : 0;
}

function int(v) {
  return Math.round(num(v));
}

function parseSlot(v) {
  if (v === 16 || v === "16" || v === "16.00") return "16.00";
  if (v === "สิ้นวัน") return "สิ้นวัน";
  return null;
}

function parseBranch(s) {
  if (!s) return { code: null, name: null };
  const m = String(s).trim().match(/^(\d+)\s+(.+)$/);
  if (m) return { code: m[1], name: m[2].trim() };
  return { code: null, name: String(s).trim() };
}

// ── Map Excel row → DB row ─────────────────────
function mapRow(r) {
  const slot = parseSlot(r[3]);
  const date = xlDateToISO(r[2]);
  const branch = parseBranch(r[1]);
  if (!slot || !date || !branch.code) return null;

  return {
    branch_code: branch.code,
    branch_name: branch.name,
    district_manager: r[0] || null,
    submitter_name: r[31] || null,
    submit_date: date,
    submit_time_slot: slot,
    plan_sale: num(r[4]),
    actual_sale: num(r[5]),
    sale_dine_in: num(r[7]),
    sale_take_away: num(r[8]),
    sale_grab: num(r[9]),
    sale_lineman: num(r[10]),
    sale_shopeefood: num(r[11]),
    total_trans: int(r[13]),
    trans_dine_in: int(r[14]),
    trans_take_away: int(r[15]),
    trans_grab: int(r[16]),
    trans_lineman: int(r[17]),
    trans_shopeefood: int(r[18]),
    customer: int(r[24]),
    labour_hour: num(r[26]),
    labour_baht: num(r[27])
  };
}

// ── Main ───────────────────────────────────────
async function main() {
  console.log(`📂 อ่านไฟล์: ${FILE}`);
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`   พบ ${rows.length} แถวรวม header`);

  // skip 2 header rows (row 0 = section labels, row 1 = column names)
  const dataRows = rows.slice(2);
  const mapped = [];
  const seen = new Set(); // กัน duplicate ในไฟล์เอง (key = branch+date+slot)
  let skipped = 0, dupInFile = 0;

  for (const r of dataRows) {
    const m = mapRow(r);
    if (!m) { skipped++; continue; }
    const key = `${m.branch_code}|${m.submit_date}|${m.submit_time_slot}`;
    if (seen.has(key)) { dupInFile++; continue; }
    seen.add(key);
    mapped.push(m);
  }

  console.log(`✅ Parse สำเร็จ: ${mapped.length} แถว`);
  console.log(`   ข้าม (slot/date/branch ไม่ครบ): ${skipped}`);
  console.log(`   ซ้ำในไฟล์เอง (ใช้ตัวล่าสุด): ${dupInFile}`);

  if (mapped.length === 0) {
    console.error("❌ ไม่มีข้อมูลให้ import");
    process.exit(1);
  }

  // ── Upsert เป็น batch ─────────────────────────
  console.log(`\n🚀 Upsert ลง Supabase table "${TABLE}" (batch ${BATCH_SIZE})...`);
  let done = 0;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const chunk = mapped.slice(i, i + BATCH_SIZE);
    const { error } = await supabase
      .from(TABLE)
      .upsert(chunk, { onConflict: "branch_code,submit_date,submit_time_slot" });
    if (error) {
      console.error(`❌ Batch ${i}-${i + chunk.length} error:`, error.message);
      console.error("   ตัวอย่างแถว:", JSON.stringify(chunk[0]).slice(0, 300));
      process.exit(1);
    }
    done += chunk.length;
    process.stdout.write(`\r   ${done}/${mapped.length}`);
  }

  console.log(`\n✅ เสร็จสิ้น — import ${done} แถว เข้า ${TABLE}`);
  console.log(`\n📊 ขั้นต่อไป: เปิด Google Sheet → tab "Sales (Test)" จะ sync ภายใน 1 นาที`);
  console.log(`   (หรือกด menu "🔄 Supabase Sync → Sync ตอนนี้" ใน Sheet เพื่อ sync ทันที)`);
}

main().catch(err => {
  console.error("💥 Fatal:", err);
  process.exit(1);
});
