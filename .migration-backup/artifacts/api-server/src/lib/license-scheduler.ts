/**
 * Scheduler de licences — tâche automatique quotidienne.
 *
 * S'exécute une première fois au démarrage du serveur, puis toutes les 24h.
 *
 * Étapes :
 *  1. Expiration des licences échues (active → expired)
 *  2. Suspension des cabinets dont toutes les licences sont expirées/révoquées
 *  3. Suspension des cabinets dont la période d'essai de 30 jours est terminée
 *  4. Envoi d'emails d'avertissement (J-7, J-3, J-1) pour les licences proches
 *     de l'expiration
 */

import { db, firmsTable, subscriptionLicensesTable } from "@workspace/db";
import { and, eq, lt, lte, gte, ne, sql, inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  sendMail,
  mailLicenceExpirationProche,
  mailLicenceExpiree,
  mailEssaiExpire,
} from "./mailer";

// Durée de la période d'essai en jours.
const TRIAL_DURATION_DAYS = 30;

// Jalons d'avertissement email (en jours avant l'expiration).
const WARNING_DAYS = [7, 3, 1];

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ── Étape 1 : Expiration des licences échues ──────────────────────────────────

async function expirerLicencesEchues(now: Date): Promise<number[]> {
  const expiredRows = await db
    .update(subscriptionLicensesTable)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(subscriptionLicensesTable.status, "active"),
        lt(subscriptionLicensesTable.endDate, now),
      ),
    )
    .returning({ id: subscriptionLicensesTable.id, firmId: subscriptionLicensesTable.firmId });

  if (expiredRows.length > 0) {
    logger.info(
      { count: expiredRows.length, ids: expiredRows.map((r) => r.id) },
      "Licences expirées",
    );
  }

  return [...new Set(expiredRows.map((r) => r.firmId))];
}

// ── Étape 2 : Suspension des cabinets sans licence active ─────────────────────

async function suspendreCABINETsSansLicence(
  firmIds: number[],
  now: Date,
): Promise<void> {
  if (firmIds.length === 0) return;

  // Pour chaque firm touchée, vérifie qu'il ne reste vraiment plus de licence active.
  for (const firmId of firmIds) {
    const activeLicenses = await db
      .select({ id: subscriptionLicensesTable.id })
      .from(subscriptionLicensesTable)
      .where(
        and(
          eq(subscriptionLicensesTable.firmId, firmId),
          eq(subscriptionLicensesTable.status, "active"),
          gte(subscriptionLicensesTable.endDate, now),
        ),
      )
      .limit(1);

    if (activeLicenses.length === 0) {
      // Passe le cabinet en suspendu et récupère l'email pour notification.
      const [firm] = await db
        .update(firmsTable)
        .set({ status: "suspended" })
        .where(
          and(
            eq(firmsTable.id, firmId),
            ne(firmsTable.status, "suspended"), // idempotent
          ),
        )
        .returning({
          id: firmsTable.id,
          name: firmsTable.name,
          contactEmail: firmsTable.contactEmail,
        });

      if (firm) {
        logger.warn({ firmId: firm.id, firmName: firm.name }, "Cabinet suspendu — licence expirée");
        if (firm.contactEmail) {
          await sendMail(
            mailLicenceExpiree({ to: firm.contactEmail, firmName: firm.name }),
          );
        }
      }
    }
  }
}

// ── Étape 3 : Suspension des essais expirés ───────────────────────────────────

async function suspendreEssaisExpires(now: Date): Promise<void> {
  const trialLimit = new Date(now);
  trialLimit.setDate(trialLimit.getDate() - TRIAL_DURATION_DAYS);

  const expired = await db
    .update(firmsTable)
    .set({ status: "suspended" })
    .where(
      and(
        eq(firmsTable.status, "trial"),
        lt(firmsTable.createdAt, trialLimit),
      ),
    )
    .returning({
      id: firmsTable.id,
      name: firmsTable.name,
      contactEmail: firmsTable.contactEmail,
    });

  for (const firm of expired) {
    logger.warn({ firmId: firm.id, firmName: firm.name }, "Cabinet suspendu — fin de la période d'essai");
    if (firm.contactEmail) {
      await sendMail(
        mailEssaiExpire({ to: firm.contactEmail, firmName: firm.name }),
      );
    }
  }
}

// ── Étape 4 : Emails d'avertissement avant expiration ────────────────────────

async function envoyerAvertissementsExpiration(now: Date): Promise<void> {
  const today = startOfDay(now);

  for (const jours of WARNING_DAYS) {
    const jourCible = startOfDay(addDays(today, jours));
    const lendemain = addDays(jourCible, 1);

    // Licences actives dont endDate tombe exactement dans la fenêtre J-N.
    const licences = await db
      .select({
        firmId: subscriptionLicensesTable.firmId,
        endDate: subscriptionLicensesTable.endDate,
      })
      .from(subscriptionLicensesTable)
      .where(
        and(
          eq(subscriptionLicensesTable.status, "active"),
          gte(subscriptionLicensesTable.endDate, jourCible),
          lt(subscriptionLicensesTable.endDate, lendemain),
        ),
      );

    for (const lic of licences) {
      const firm = await db.query.firmsTable.findFirst({
        where: eq(firmsTable.id, lic.firmId),
      });
      if (!firm?.contactEmail) continue;

      await sendMail(
        mailLicenceExpirationProche({
          to: firm.contactEmail,
          firmName: firm.name,
          joursRestants: jours,
          dateExpiration: formatDate(new Date(lic.endDate)),
        }),
      );
    }
  }
}

// ── Cycle principal ───────────────────────────────────────────────────────────

async function runLicenseCycle(): Promise<void> {
  const now = new Date();
  logger.info("Scheduler licences — démarrage du cycle");

  try {
    const affectedFirmIds = await expirerLicencesEchues(now);
    await suspendreCABINETsSansLicence(affectedFirmIds, now);
    await suspendreEssaisExpires(now);
    await envoyerAvertissementsExpiration(now);
    logger.info("Scheduler licences — cycle terminé");
  } catch (err) {
    logger.error({ err }, "Scheduler licences — erreur pendant le cycle");
  }
}

// ── Point d'entrée ────────────────────────────────────────────────────────────

const INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 heures

export function startLicenseScheduler(): void {
  // Exécution immédiate au démarrage.
  runLicenseCycle();
  // Puis toutes les 24 heures.
  setInterval(runLicenseCycle, INTERVAL_MS);
  logger.info("Scheduler licences — démarré (cycle toutes les 24h)");
}
