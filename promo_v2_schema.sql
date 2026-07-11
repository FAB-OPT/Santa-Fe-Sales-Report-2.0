-- ═════════════════════════════════════════════════════
-- FEATURE V2: Promo edit + Admin toggle
-- ═════════════════════════════════════════════════════

-- (1) Allow UPDATE on promo_submissions (unlock edit)
DROP POLICY IF EXISTS promo_no_update  ON promo_submissions;
DROP POLICY IF EXISTS promo_update_all ON promo_submissions;
CREATE POLICY promo_update_all ON promo_submissions FOR UPDATE USING (true);

-- add tracking columns for edits
ALTER TABLE promo_submissions
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_count INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_edited_by TEXT;

-- auto-increment edit_count + updated_at เมื่อ UPDATE
CREATE OR REPLACE FUNCTION promo_bump_edit() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := NOW();
  NEW.edit_count := COALESCE(OLD.edit_count, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_promo_bump_edit ON promo_submissions;
CREATE TRIGGER trg_promo_bump_edit
  BEFORE UPDATE ON promo_submissions
  FOR EACH ROW EXECUTE FUNCTION promo_bump_edit();

-- (2) App settings table (key/value)
CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- default: promo enabled
INSERT INTO app_settings (key, value) VALUES ('promo_enabled', 'true')
  ON CONFLICT (key) DO NOTHING;

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_read   ON app_settings;
DROP POLICY IF EXISTS app_settings_write  ON app_settings;
DROP POLICY IF EXISTS app_settings_insert ON app_settings;

CREATE POLICY app_settings_read   ON app_settings FOR SELECT USING (true);
CREATE POLICY app_settings_insert ON app_settings FOR INSERT WITH CHECK (true);
CREATE POLICY app_settings_write  ON app_settings FOR UPDATE USING (true);

SELECT 'Done ✓ promo edit unlocked + app_settings created' AS status;
