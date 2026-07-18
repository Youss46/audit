/**
 * Mailer — envoi d'emails transactionnels via SMTP.
 *
 * Variables d'environnement requises (optionnelles — si absentes, les emails
 * sont simplement journalisés sans être envoyés) :
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * Exemple de configuration Brevo / Mailtrap / Gmail :
 *   SMTP_HOST=smtp-relay.brevo.com
 *   SMTP_PORT=587
 *   SMTP_USER=votre@email.com
 *   SMTP_PASS=votre_mot_de_passe_smtp
 *   SMTP_FROM="M15-AUDIT <noreply@m15-audit.ci>"
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";

// ── Configuration SMTP ────────────────────────────────────────────────────────

const SMTP_HOST = process.env["SMTP_HOST"];
const SMTP_PORT = Number(process.env["SMTP_PORT"] ?? "587");
const SMTP_USER = process.env["SMTP_USER"];
const SMTP_PASS = process.env["SMTP_PASS"];
const SMTP_FROM = process.env["SMTP_FROM"] ?? "M15-AUDIT <noreply@m15-audit.ci>";

const isSmtpConfigured = Boolean(SMTP_HOST && SMTP_USER && SMTP_PASS);

const transporter = isSmtpConfigured
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    })
  : null;

if (!isSmtpConfigured) {
  logger.warn(
    "SMTP non configuré (SMTP_HOST/SMTP_USER/SMTP_PASS manquants). " +
    "Les emails seront journalisés mais non envoyés.",
  );
}

// ── Interface commune ─────────────────────────────────────────────────────────

interface MailOptions {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail(opts: MailOptions): Promise<void> {
  if (!transporter) {
    logger.info(
      { to: opts.to, subject: opts.subject },
      "[MAILER-DRY-RUN] Email non envoyé (SMTP non configuré)",
    );
    return;
  }

  try {
    await transporter.sendMail({ from: SMTP_FROM, ...opts });
    logger.info({ to: opts.to, subject: opts.subject }, "Email envoyé");
  } catch (err) {
    // Non-fatal : on ne laisse jamais un échec d'email planter le serveur.
    logger.error({ err, to: opts.to, subject: opts.subject }, "Échec envoi email");
  }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function mailLicenceExpirationProche(opts: {
  to: string;
  firmName: string;
  joursRestants: number;
  dateExpiration: string;
}): MailOptions {
  const urgence = opts.joursRestants <= 3 ? "🚨 URGENT" : "⚠️ Rappel";
  return {
    to: opts.to,
    subject: `${urgence} — Votre licence M15-AUDIT expire dans ${opts.joursRestants} jour(s)`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a2e">
        <div style="background:#0f3460;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:20px">M15 <strong>AUDIT</strong></h1>
        </div>
        <div style="background:#f8f9fa;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="color:#c0392b;margin-top:0">
            ${urgence} — Expiration de licence imminente
          </h2>
          <p>Bonjour,</p>
          <p>
            La licence d'activation de votre cabinet <strong>${opts.firmName}</strong>
            sur la plateforme <strong>M15-AUDIT</strong> arrive à expiration dans
            <strong>${opts.joursRestants} jour(s)</strong>.
          </p>
          <div style="background:#fff3cd;border-left:4px solid #ffc107;padding:16px;margin:24px 0;border-radius:4px">
            <p style="margin:0">
              📅 <strong>Date d'expiration :</strong> ${opts.dateExpiration}
            </p>
          </div>
          <p>
            Sans renouvellement, <strong>l'accès à votre espace sera bloqué</strong>
            à partir de cette date.
          </p>
          <p>
            Pour renouveler votre abonnement, contactez votre administrateur M15-AUDIT
            ou écrivez-nous à
            <a href="mailto:contact@m15-audit.ci">contact@m15-audit.ci</a>.
          </p>
          <hr style="border:none;border-top:1px solid #dee2e6;margin:24px 0"/>
          <p style="font-size:12px;color:#6c757d;margin:0">
            Ce message est envoyé automatiquement par la plateforme M15-AUDIT.
            Merci de ne pas y répondre directement.
          </p>
        </div>
      </div>
    `,
  };
}

export function mailLicenceExpiree(opts: {
  to: string;
  firmName: string;
}): MailOptions {
  return {
    to: opts.to,
    subject: `Votre licence M15-AUDIT a expiré — Accès suspendu`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a2e">
        <div style="background:#0f3460;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:20px">M15 <strong>AUDIT</strong></h1>
        </div>
        <div style="background:#f8f9fa;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="color:#c0392b;margin-top:0">Accès suspendu — Licence expirée</h2>
          <p>Bonjour,</p>
          <p>
            La licence d'activation du cabinet <strong>${opts.firmName}</strong>
            sur la plateforme <strong>M15-AUDIT</strong> est arrivée à expiration.
          </p>
          <p>
            L'accès à votre espace est désormais <strong>temporairement suspendu</strong>.
          </p>
          <p>
            Pour réactiver votre accès, contactez votre administrateur M15-AUDIT
            ou écrivez-nous à
            <a href="mailto:contact@m15-audit.ci">contact@m15-audit.ci</a>.
          </p>
          <hr style="border:none;border-top:1px solid #dee2e6;margin:24px 0"/>
          <p style="font-size:12px;color:#6c757d;margin:0">
            Ce message est envoyé automatiquement par la plateforme M15-AUDIT.
          </p>
        </div>
      </div>
    `,
  };
}

export function mailEssaiExpire(opts: {
  to: string;
  firmName: string;
}): MailOptions {
  return {
    to: opts.to,
    subject: `Votre période d'essai M15-AUDIT est terminée`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a2e">
        <div style="background:#0f3460;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:20px">M15 <strong>AUDIT</strong></h1>
        </div>
        <div style="background:#f8f9fa;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="color:#c0392b;margin-top:0">Fin de la période d'essai</h2>
          <p>Bonjour,</p>
          <p>
            La période d'essai gratuite de 30 jours du cabinet
            <strong>${opts.firmName}</strong> sur M15-AUDIT est maintenant terminée.
          </p>
          <p>
            Pour continuer à utiliser la plateforme, veuillez souscrire à un
            abonnement en contactant votre administrateur M15-AUDIT ou en écrivant à
            <a href="mailto:contact@m15-audit.ci">contact@m15-audit.ci</a>.
          </p>
          <hr style="border:none;border-top:1px solid #dee2e6;margin:24px 0"/>
          <p style="font-size:12px;color:#6c757d;margin:0">
            Ce message est envoyé automatiquement par la plateforme M15-AUDIT.
          </p>
        </div>
      </div>
    `,
  };
}
