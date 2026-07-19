import { db } from "./index";

// Module M14 (Immutable Audit Trail & Activity Logging): database-level
// enforcement that the audit_logs table is append-only. Even if a future
// route, migration, or direct SQL client attempted an UPDATE or DELETE
// against this table, Postgres itself rejects it -- the guarantee does not
// depend on every caller going through the AuditLogService. Safe to re-run
// (CREATE OR REPLACE / DROP TRIGGER IF EXISTS).
async function main() {
  await db.execute(`
    CREATE OR REPLACE FUNCTION audit_logs_prevent_mutation()
    RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'insufficient_privilege';
    END;
    $$ LANGUAGE plpgsql;
  `);

  await db.execute(`DROP TRIGGER IF EXISTS audit_logs_prevent_update ON audit_logs;`);
  await db.execute(`
    CREATE TRIGGER audit_logs_prevent_update
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();
  `);

  await db.execute(`DROP TRIGGER IF EXISTS audit_logs_prevent_delete ON audit_logs;`);
  await db.execute(`
    CREATE TRIGGER audit_logs_prevent_delete
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION audit_logs_prevent_mutation();
  `);

  console.log("audit_logs immutability trigger installed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
