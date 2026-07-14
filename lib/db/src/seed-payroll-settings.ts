import { db, firmsTable, payrollSettingsTable, PAYROLL_SETTING_DEFAULTS } from "./index";
import { sql, eq } from "drizzle-orm";

// Seeds the Module M20-Settings payroll rate catalog for every existing firm
// that does not yet have any payroll settings rows. Safe to re-run: the
// unique(firmId, ruleKey) constraint makes inserts idempotent via
// onConflictDoNothing().
async function main() {
  const firms = await db.query.firmsTable.findMany({ columns: { id: true, name: true } });

  let seeded = 0;
  for (const firm of firms) {
    const existing = await db.query.payrollSettingsTable.findFirst({
      where: eq(payrollSettingsTable.firmId, firm.id),
      columns: { id: true },
    });

    if (existing) {
      console.log(`  Firm #${firm.id} "${firm.name}" — already seeded, skipping.`);
      continue;
    }

    await db
      .insert(payrollSettingsTable)
      .values(
        PAYROLL_SETTING_DEFAULTS.map(
          (d) =>
            ({
              ...d,
              firmId: firm.id,
              updatedById: null,
            }) as typeof payrollSettingsTable.$inferInsert,
        ),
      )
      .onConflictDoNothing();

    console.log(
      `  Firm #${firm.id} "${firm.name}" — seeded ${PAYROLL_SETTING_DEFAULTS.length} payroll settings.`,
    );
    seeded++;
  }

  console.log(`Done. Seeded payroll settings for ${seeded}/${firms.length} firm(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
