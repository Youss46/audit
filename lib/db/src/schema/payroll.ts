import {
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { firmsTable } from "./firms";
import { clientsTable } from "./clients";
import { usersTable } from "./users";
import { transactionsTable } from "./accounting";

// Module M20 (Gestion de la Paie, ITS & CNPS).
// Ivorian payroll: employee registry + monthly payslip calculations (CNPS,
// IS, CN, ITS/IGR) + aggregated ledger posting. All monetary amounts are
// integers in FCFA (no decimal currency, matching every other table in this
// schema). Calculation logic lives in
// artifacts/api-server/src/lib/payroll-engine.ts -- this file only stores
// the inputs (employee profile) and the computed outputs (payslip) so a
// payslip is always auditable/re-derivable from its own stored fields
// without depending on the engine's current code.

export const MARITAL_STATUSES = ["CELIBATAIRE", "MARIE"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const EMPLOYEE_STATUSES = ["ACTIF", "INACTIF"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

// -- Employee_Profiles --------------------------------------------------
export const employeesTable = pgTable(
  "employees",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    // Immatriculation CNPS de l'employé (optionnel tant que la démarche
    // d'affiliation n'est pas finalisée).
    cnpsNumber: text("cnps_number"),
    maritalStatus: text("marital_status").notNull().$type<MaritalStatus>().default("CELIBATAIRE"),
    // Nombre d'enfants à charge -- alimente le quotient familial (parts)
    // utilisé pour l'ITS/IGR. Capped at 5 total parts by the engine, not here.
    dependentChildren: integer("dependent_children").notNull().default(0),
    // Salaire de base mensuel brut, FCFA.
    baseSalary: integer("base_salary").notNull(),
    // Prime de transport mensuelle, FCFA -- exonérée jusqu'au plafond légal
    // (30 000 FCFA/mois), le reste est réintégré dans l'assiette imposable.
    transportAllowance: integer("transport_allowance").notNull().default(0),
    // Autres primes et indemnités imposables (prime de rendement, prime de
    // logement imposable, etc.), FCFA.
    otherTaxablePrimes: integer("other_taxable_primes").notNull().default(0),
    // Taux "Accidents du Travail" (CNPS, charge employeur), en pourcentage
    // (ex: 2 pour 2%). Varie selon le secteur d'activité (2% à 5%) -- 2%
    // est le taux par défaut pour les activités à risque standard.
    workAccidentRate: doublePrecision("work_accident_rate").notNull().default(2),
    // Date d'embauche (AAAA-MM-JJ). Nullable pour la compatibilité des
    // enregistrements antérieurs — les employés sans date d'embauche obtiennent
    // automatiquement 0 % de prime d'ancienneté lors du calcul de la paie.
    hireDate: date("hire_date"),
    status: text("status").notNull().$type<EmployeeStatus>().default("ACTIF"),
    createdById: integer("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("employees_firm_id_idx").on(table.firmId),
    index("employees_client_id_idx").on(table.clientId),
    index("employees_status_idx").on(table.status),
  ],
);

export const insertEmployeeSchema = createInsertSchema(employeesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertEmployee = z.infer<typeof insertEmployeeSchema>;
export type Employee = typeof employeesTable.$inferSelect;

// -- Payslips -------------------------------------------------------------
// One row per employee per pay period ("YYYY-MM"). Stores every amount the
// engine computed so the breakdown shown to the accountant is always the
// exact figure that was (or will be) posted to the ledger, independent of
// later edits to the employee profile or engine constants.
export const payslipsTable = pgTable(
  "payslips",
  {
    id: serial("id").primaryKey(),
    firmId: integer("firm_id")
      .notNull()
      .references(() => firmsTable.id, { onDelete: "cascade" }),
    clientId: integer("client_id")
      .notNull()
      .references(() => clientsTable.id, { onDelete: "cascade" }),
    employeeId: integer("employee_id")
      .notNull()
      .references(() => employeesTable.id, { onDelete: "cascade" }),
    // Période de paie, format "YYYY-MM" (ex: "2026-07").
    period: text("period").notNull(),
    // Salaire brut total (base + primes, avant toute retenue), FCFA.
    grossSalary: integer("gross_salary").notNull(),
    // Assiette imposable/cotisable (brut - part exonérée de la prime de
    // transport), FCFA -- base commune CNPS/IS/CN/ITS.
    grossTaxable: integer("gross_taxable").notNull(),
    // -- Retenues salariales (part employé) --
    cnpsEmployeeAmount: integer("cnps_employee_amount").notNull(),
    isAmount: integer("is_amount").notNull(),
    cnAmount: integer("cn_amount").notNull(),
    itsAmount: integer("its_amount").notNull(),
    netSalary: integer("net_salary").notNull(),
    // -- Charges patronales (part employeur, ne réduisent pas le net) --
    cnpsEmployerRetraite: integer("cnps_employer_retraite").notNull(),
    cnpsEmployerPrestationsFamiliales: integer("cnps_employer_prestations_familiales").notNull(),
    cnpsEmployerAccidentTravail: integer("cnps_employer_accident_travail").notNull(),
    taxeApprentissage: integer("taxe_apprentissage").notNull(),
    taxeFormationContinue: integer("taxe_formation_continue").notNull(),
    // Coût total employeur = grossSalary + toutes les charges patronales.
    totalEmployerCost: integer("total_employer_cost").notNull(),
    // Prime d'ancienneté calculée automatiquement (barème légal ivoirien,
    // 0 % avant 2 ans, 2 % à 2 ans, +1 %/an jusqu'à 25 %). Incluse dans le
    // salaire brut imposable.
    primeAnciennete: integer("prime_anciennete").notNull().default(0),
    // Nombre de parts fiscales retenu pour le calcul de l'ITS/IGR (traçabilité).
    fiscalParts: doublePrecision("fiscal_parts").notNull(),
    // Set once this payslip has been folded into a posted OD ledger entry
    // (POST /payroll/post-ledger) -- prevents editing/double-posting.
    postedTransactionId: integer("posted_transaction_id").references(
      () => transactionsTable.id,
      { onDelete: "set null" },
    ),
    createdById: integer("created_by_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("payslips_firm_id_idx").on(table.firmId),
    index("payslips_client_id_idx").on(table.clientId),
    index("payslips_employee_id_idx").on(table.employeeId),
    index("payslips_period_idx").on(table.period),
    // An employee can only have one payslip per period -- recalculating
    // replaces (upserts) the existing row rather than creating a duplicate.
    unique("payslips_employee_period_unique").on(table.employeeId, table.period),
  ],
);

export const insertPayslipSchema = createInsertSchema(payslipsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPayslip = z.infer<typeof insertPayslipSchema>;
export type Payslip = typeof payslipsTable.$inferSelect;
