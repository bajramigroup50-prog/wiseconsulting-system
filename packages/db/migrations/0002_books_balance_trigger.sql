-- Custom migration (Phase 2): double-entry integrity of the persisted ledger.
--
-- journal_lines_balanced is a DEFERRABLE INITIALLY DEFERRED constraint trigger: within a transaction the
-- posting service may insert/update/delete lines in any order; at COMMIT every touched journal must have
-- sum(debit) = sum(credit), otherwise the whole transaction fails with SQLSTATE 23514 (check_violation).
-- It also guarantees that a line's firm_id equals its journal's firm_id.

CREATE OR REPLACE FUNCTION journal_lines_check_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  jids uuid[];
  jid uuid;
  diff numeric;
  jfirm uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    jids := ARRAY[OLD.journal_id];
  ELSIF TG_OP = 'UPDATE' AND OLD.journal_id IS DISTINCT FROM NEW.journal_id THEN
    jids := ARRAY[OLD.journal_id, NEW.journal_id];
  ELSE
    jids := ARRAY[NEW.journal_id];
  END IF;

  IF TG_OP <> 'DELETE' THEN
    SELECT firm_id INTO jfirm FROM journals WHERE id = NEW.journal_id;
    IF jfirm IS NOT NULL AND jfirm <> NEW.firm_id THEN
      RAISE EXCEPTION 'journal line firm % does not match journal % firm %', NEW.firm_id, NEW.journal_id, jfirm
        USING ERRCODE = '23514';
    END IF;
  END IF;

  FOREACH jid IN ARRAY jids LOOP
    -- the journal itself was deleted in this transaction (lines removed by cascade): nothing to check
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM journals WHERE id = jid);
    SELECT coalesce(sum(debit), 0) - coalesce(sum(credit), 0) INTO diff FROM journal_lines WHERE journal_id = jid;
    IF diff <> 0 THEN
      RAISE EXCEPTION 'journal % is not balanced: debit - credit = %', jid, diff
        USING ERRCODE = '23514', HINT = 'Налогот не е изедначен (должи ≠ побарува).';
    END IF;
  END LOOP;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_lines_check_balance();
