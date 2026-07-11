-- ═════════════════════════════════════════════════════
-- FIX: sales_data ไม่มี trigger เพิ่ม edit_count เมื่อ UPDATE
-- ผลกระทบเดิม: สาขาแก้ยอดกี่ครั้งก็ได้ (lock ไม่ทำงาน)
-- ═════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION sales_bump_edit() RETURNS TRIGGER AS $$
BEGIN
  NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
  NEW.last_edited_at := NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_bump_edit ON sales_data;
CREATE TRIGGER trg_sales_bump_edit
  BEFORE UPDATE ON sales_data
  FOR EACH ROW EXECUTE FUNCTION sales_bump_edit();

-- ตรวจสอบว่า trigger ถูกสร้าง
SELECT tgname AS trigger_name,
       tgenabled AS enabled
FROM pg_trigger
WHERE tgname = 'trg_sales_bump_edit';

SELECT 'Done ✓ trigger trg_sales_bump_edit ติดตั้งบน sales_data แล้ว' AS status;
