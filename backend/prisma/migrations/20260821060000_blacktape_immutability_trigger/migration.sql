-- K-BLACKTAPE is meant to be append-only by design (see BlacktapeService —
-- the code only ever calls .create(), never .update()/.delete()). Until
-- now that was enforced by convention alone: nothing at the database
-- level stopped a stray UPDATE/DELETE run directly via psql, a future
-- bug, or a migration that touches the table by accident. This trigger
-- makes the guarantee real regardless of how the table is reached.

CREATE OR REPLACE FUNCTION prevent_blacktape_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'blacktape_entries is append-only — % is not permitted (K-BLACKTAPE integrity trigger)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER blacktape_entries_no_update
BEFORE UPDATE ON blacktape_entries
FOR EACH ROW EXECUTE FUNCTION prevent_blacktape_mutation();

CREATE TRIGGER blacktape_entries_no_delete
BEFORE DELETE ON blacktape_entries
FOR EACH ROW EXECUTE FUNCTION prevent_blacktape_mutation();
