-- Custom SQL (legal compliance): the audit log is append-only.
--
-- Nothing may change or remove a written audit row — not the application, not a script with the application's
-- credentials. The only UPDATE allowed is the one the foreign keys perform (ON DELETE SET NULL of user_id / firm_id
-- when a user or a firm row is removed), and only if every other column stays the same. DELETE and TRUNCATE are
-- refused. A superuser can still drop the trigger — that is a deliberate, visible act outside the program.
-- Idempotent: safe to re-apply.

CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id = OLD.id AND NEW.at = OLD.at AND NEW.action = OLD.action
       AND NEW.entity_type IS NOT DISTINCT FROM OLD.entity_type AND NEW.entity_id IS NOT DISTINCT FROM OLD.entity_id
       AND NEW.data IS NOT DISTINCT FROM OLD.data
       AND (NEW.user_id IS NOT DISTINCT FROM OLD.user_id OR NEW.user_id IS NULL)
       AND (NEW.firm_id IS NOT DISTINCT FROM OLD.firm_id OR NEW.firm_id IS NULL) THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'audit_log is append-only (% refused)', TG_OP
    USING ERRCODE = '42501', HINT = 'Дневникот на активности не смее да се менува ниту брише.';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

DROP TRIGGER IF EXISTS audit_log_no_truncate ON audit_log;
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();
