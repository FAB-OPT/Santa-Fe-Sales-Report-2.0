/**
 * Santa Fe — Import ข้อมูลยอดขายเดิมจาก Excel → Supabase `sales_data`
 *
 * ⚠️  WRITES TO PRODUCTION. Confirm prompt is shown before insert.
 *
 * วิธีใช้:
 *   1. npm i xlsx @supabase/supabase-js   (ทำครั้งเดียว)
 *   2. ตั้งค่า FILE ด้านล่างให้ตรงกับชื่อไฟล์ Excel
 *   3. node import_excel.js
 *   4. พิมพ์ YES เพื่อยืนยัน
 *
 * Layout ของ Excel (ชีตแรก, row 1 = section labels, row 2 = column names):
 *   col 0  ผู้จัดการเขตที่รับผิดชอบ
 *   col 1  สาขา  ("5001 แฟชั่น ไอส์แลนด์")
 *   col 2  วันที่ส่งข้อมูล  (Excel serial number)
 *   col 3  ช่วงเวลาที่ส่งข้อมูล  (16 | "สิ้นวัน")
 *   col 4  Plan Sale          col 5  Actual Sale
 *   col 7-11   Sale: Dine In / Take away / Grab / Lineman / Shopee Food
 *   col 13     Total Trans
 *   col 14-18  Trans: Dine In / Take away / Grab / Lineman / Shopee Food
 *   col 24     Customer
 *   col 26     Labour(hour)   col 27  Labour(Baht)
 *   col 31     คนลงข้อมูล
 */

const readline = require("readline");
const XLSX = require("xlsx");
const { createClient } = require("@supabase/supabase-js");

// ── CONFIG ─────────────────────────────────────
const SUPABASE_URL = "https://zroqklbobvixyohfaimc.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inpyb3FrbGJvYnZpeHlvaGZhaW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2NTUzNjMsImV4cCI6MjA5NDIzMTM2M30.BSwbqeQ1jsyvATpOkJ-wV04TGZacagaNpj6S4fPC-J4";
const FILE = "sales_history.xlsx"; // ⚠️ ตั้งชื่อไฟล์ Excel ที่จะ import ตรงนี้
const TABLE = "sales_data";          // ⚠️ production
const BRANCHES_TABLE = "branches";
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
function int(v) { return Math.round(num(v)); }

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

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, ans => { rl.close(); resolve(ans.trim()); });
  });
}

// ── Main ───────────────────────────────────────
async function main() {
  console.log(`📂 อ่านไฟล์: ${FILE}`);
  const wb = XLSX.readFile(FILE);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  console.log(`   พบ ${rows.length} แถวรวม header`);

  const dataRows = rows.slice(2);
  const mapped = [];
  const seen = new Set();
  let skipped = 0, dupInFile = 0;
  for (const r of dataRows) {
    const m = mapRow(r);
    if (!m) { skipped++; continue; }
    const key = `${m.branch_code}|${m.submit_date}|${m.submit_time_slot}`;
    if (seen.has(key)) { dupInFile++; continue; }
    seen.add(key);
    mapped.push(m);
  }
  console.log(`✅ Parse สำเร็จ: ${mapped.length} แถว  (ข้าม ${skipped} · ซ้ำ ${dupInFile})`);

  if (mapped.length === 0) { console.error("❌ ไม่มีข้อมูลให้ import"); process.exit(1); }

  // ── unique branches → upsert branches table ──
  const branchMap = {};
  mapped.forEach(r => {
    if (!branchMap[r.branch_code]) {
      branchMap[r.branch_code] = {
        branch_code: r.branch_code,
        branch_name: r.branch_name,
        district_manager: r.district_manager || "ไม่ระบุ"
      };
    }
  });
  const branches = Object.values(branchMap);
  console.log(`   พบ ${branches.length} สาขาที่จะ upsert ลง ${BRANCHES_TABLE}`);

  // ── Confirm ──
  console.log(`\n⚠️  จะ upsert ${mapped.length} แถว เข้า table "${TABLE}" (PRODUCTION)`);
  console.log(`    onConflict: branch_code, submit_date, submit_time_slot (idempotent)`);
  const ans = await ask(`\nพิมพ์ YES เพื่อยืนยัน: `);
  if (ans !== "YES") { console.log("ยกเลิก."); process.exit(0); }

  // ── Upsert branches first ──
  console.log(`\n🏢 Upsert branches...`);
  const { error: bErr } = await supabase.from(BRANCHES_TABLE)
    .upsert(branches, { onConflict: "branch_code" });
  if (bErr) { console.error(`❌ branches upsert error:`, bErr.message); process.exit(1); }
  console.log(`   ✓ ${branches.length} branches`);

  // ── Upsert sales batched ──
  console.log(`\n🚀 Upsert ${TABLE} (batch ${BATCH_SIZE})...`);
  let done = 0;
  for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
    const chunk = mapped.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(TABLE)
      .upsert(chunk, { onConflict: "branch_code,submit_date,submit_time_slot" });
    if (error) {
      console.error(`\n❌ Batch ${i}-${i + chunk.length} error:`, error.message);
      process.exit(1);
    }
    done += chunk.length;
    process.stdout.write(`\r   ${done}/${mapped.length}`);
  }
  console.log(`\n\n✅ เสร็จสิ้น — import ${done} แถว เข้า ${TABLE}`);
  console.log(`📊 Google Sheet จะ sync ภายใน 1 นาที (หรือกด menu "Sync ตอนนี้" ใน Sheet เพื่อ sync ทันที)`);
}

main().catch(err => { console.error("💥 Fatal:", err); process.exit(1); });
