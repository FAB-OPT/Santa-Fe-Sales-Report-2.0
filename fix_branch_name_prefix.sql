-- ═════════════════════════════════════════════════════
-- FIX: branch_name มีรหัสสาขานำหน้า ("5035 เซ็นทรัลพัทยา บีช")
--
-- ที่มา: FAB Hub เก็บชื่อสาขาแบบมีรหัสนำหน้าเสมอ (getBranchFullName)
--        → fab_session.branchName → S.branch → sales_data.branch_name
--        ต่างจากตาราง branches ที่เก็บสะอาด ("เซ็นทรัลพัทยา บีช")
--
-- โค้ดฝั่ง client แก้ไปแล้วตั้งแต่ 16 ก.ค. (commit 10b70d6 · _cleanBranchName)
-- แต่เครื่องที่เปิดแท็บเก่าค้าง / cache หน้าเดิม ยังส่งค่าเพี้ยนเข้ามาเรื่อย ๆ
-- → ต้องกันที่ฝั่ง DB ถึงจะจบจริง (เครื่องเก่าอัปเดตเองไม่ได้)
--
-- รันไฟล์นี้ใน Supabase → SQL Editor (รันทั้งไฟล์ทีเดียวได้)
-- ═════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────
-- 1) ฟังก์ชันตัดรหัสนำหน้า — ใช้ร่วมกันทุก trigger
-- ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION clean_branch_name() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.branch_name IS NOT NULL THEN
    NEW.branch_name := regexp_replace(NEW.branch_name, '^[0-9]+\s+', '');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────
-- 2) ล้างข้อมูลเก่าใน sales_data (4 แถว · สาขา 5035)
--    ปิด trg_sales_bump_edit ชั่วคราว ไม่งั้น edit_count จะเด้งเป็น 1
--    แล้วสาขาจะเหลือสิทธิ์แก้ยอดน้อยลง (lock 3 ครั้ง · commit 653703f)
-- ─────────────────────────────────────────────────────
ALTER TABLE sales_data DISABLE TRIGGER trg_sales_bump_edit;

UPDATE sales_data
SET    branch_name = regexp_replace(branch_name, '^[0-9]+\s+', '')
WHERE  branch_name ~ '^[0-9]+\s+';

ALTER TABLE sales_data ENABLE TRIGGER trg_sales_bump_edit;


-- ─────────────────────────────────────────────────────
-- 3) ติดตั้ง trigger กันตกยาว — ทุก insert/update จะถูกล้างอัตโนมัติ
--    ชื่อ trigger ขึ้นต้น 'trg_sales_c...' → รันหลัง 'trg_sales_bump_edit'
--    (Postgres เรียง trigger ตามชื่อ) ทั้งคู่แตะคนละคอลัมน์ ไม่ชนกัน
-- ─────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_sales_clean_branch_name ON sales_data;
CREATE TRIGGER trg_sales_clean_branch_name
  BEFORE INSERT OR UPDATE ON sales_data
  FOR EACH ROW EXECUTE FUNCTION clean_branch_name();

DROP TRIGGER IF EXISTS trg_login_logs_clean_branch_name ON login_logs;
CREATE TRIGGER trg_login_logs_clean_branch_name
  BEFORE INSERT OR UPDATE ON login_logs
  FOR EACH ROW EXECUTE FUNCTION clean_branch_name();


-- ─────────────────────────────────────────────────────
-- 4) ล้าง login_logs ย้อนหลัง (373 แถว · 59 สาขา)
--    เป็น log การเข้า-ออกระบบ ไม่กระทบตัวเลขยอดขาย
--    ทำไปแล้วเมื่อ 13 ส.ค. 2569 — เก็บไว้ให้รันซ้ำได้ (idempotent)
-- ─────────────────────────────────────────────────────
UPDATE login_logs
SET    branch_name = regexp_replace(branch_name, '^[0-9]+\s+', '')
WHERE  branch_name ~ '^[0-9]+\s+';


-- ─────────────────────────────────────────────────────
-- 5) ตรวจผล
-- ─────────────────────────────────────────────────────
SELECT 'sales_data' AS tbl, count(*) AS rows_left
FROM   sales_data  WHERE branch_name ~ '^[0-9]+\s+'
UNION ALL
SELECT 'login_logs', count(*)
FROM   login_logs  WHERE branch_name ~ '^[0-9]+\s+';

SELECT tgname AS trigger_name, tgrelid::regclass AS on_table, tgenabled AS enabled
FROM   pg_trigger
WHERE  tgname IN ('trg_sales_clean_branch_name',
                  'trg_login_logs_clean_branch_name',
                  'trg_sales_bump_edit')
ORDER  BY on_table, trigger_name;

SELECT 'Done ✓ branch_name จะถูกตัดรหัสนำหน้าอัตโนมัติทุก insert/update แล้ว' AS status;
