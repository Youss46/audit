/**
 * Mailer — envoi d'emails transactionnels via Resend.
 *
 * Variable d'environnement requise :
 *   RESEND_API_KEY   — clé API Resend (https://resend.com/api-keys)
 *
 * Variable optionnelle :
 *   SMTP_FROM        — adresse expéditrice (défaut : "M15-AUDIT <noreply@m15-audit.ci>")
 *                      Doit correspondre à un domaine vérifié dans votre dashboard Resend.
 *
 * Si RESEND_API_KEY est absente, les emails sont journalisés dans la console
 * sans être envoyés — le serveur ne plante jamais sur un échec d'email.
 */

import { Resend } from "resend";
import { logger } from "./logger";

// ── Initialisation ────────────────────────────────────────────────────────────

const RESEND_API_KEY = process.env["RESEND_API_KEY"];
const FROM = process.env["SMTP_FROM"] ?? "M15-AUDIT <noreply@m15-audit.ci>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!resend) {
  logger.warn(
    "Resend non configuré (RESEND_API_KEY manquant). " +
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
  if (!resend) {
    logger.info(
      { to: opts.to, subject: opts.subject },
      "[MAILER-DRY-RUN] Email non envoyé (RESEND_API_KEY non configuré)",
    );
    return;
  }

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
    });

    if (error) {
      logger.error({ error, to: opts.to, subject: opts.subject }, "Resend — erreur d'envoi");
    } else {
      logger.info({ to: opts.to, subject: opts.subject }, "Email envoyé via Resend");
    }
  } catch (err) {
    // Non-fatal : un échec d'email ne doit jamais planter le serveur.
    logger.error({ err, to: opts.to, subject: opts.subject }, "Resend — exception inattendue");
  }
}

// ── Templates HTML ────────────────────────────────────────────────────────────

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

export function mailInvitation(opts: {
  to: string;
  fullName: string;
  firmName: string;
  temporaryPassword: string;
  loginUrl: string;
}): MailOptions {
  return {
    to: opts.to,
    subject: `Bienvenue sur M15-AUDIT — Vos accès`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a2e">
        <div style="background:#0f3460;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:20px">M15 <strong>AUDIT</strong></h1>
        </div>
        <div style="background:#f8f9fa;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="margin-top:0;color:#0f3460">Bienvenue, ${opts.fullName} !</h2>
          <p>
            Vous avez été invité(e) à rejoindre <strong>${opts.firmName}</strong>
            sur la plateforme <strong>M15-AUDIT</strong>.
          </p>
          <p>Voici vos identifiants de première connexion :</p>
          <div style="background:#e8f4fd;border-left:4px solid #0f3460;padding:16px;margin:24px 0;border-radius:4px">
            <p style="margin:4px 0">📧 <strong>Email :</strong> ${opts.to}</p>
            <p style="margin:4px 0">🔑 <strong>Mot de passe temporaire :</strong> <code style="background:#fff;padding:2px 6px;border-radius:4px">${opts.temporaryPassword}</code></p>
          </div>
          <p>
            <a href="${opts.loginUrl}" style="display:inline-block;background:#0f3460;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">
              Se connecter
            </a>
          </p>
          <p style="color:#856404;background:#fff3cd;border-radius:4px;padding:12px">
            ⚠️ Vous devrez choisir un nouveau mot de passe lors de votre première connexion.
          </p>
          <hr style="border:none;border-top:1px solid #dee2e6;margin:24px 0"/>
          <p style="font-size:12px;color:#6c757d;margin:0">
            Ce message est envoyé automatiquement par la plateforme M15-AUDIT.
            Si vous n'attendiez pas cette invitation, ignorez ce message.
          </p>
        </div>
      </div>
    `,
  };
}

export function mailPasswordChanged(opts: {
  to: string;
  fullName: string;
}): MailOptions {
  return {
    to: opts.to,
    subject: `M15-AUDIT — Mot de passe mis à jour`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a2e">
        <div style="background:#0f3460;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:20px">M15 <strong>AUDIT</strong></h1>
        </div>
        <div style="background:#f8f9fa;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="margin-top:0;color:#0f3460">Mot de passe mis à jour</h2>
          <p>Bonjour <strong>${opts.fullName}</strong>,</p>
          <p>
            Votre mot de passe sur <strong>M15-AUDIT</strong> a été modifié avec succès.
            Votre compte est maintenant actif.
          </p>
          <p>
            Si vous n'êtes pas à l'origine de cette modification, contactez immédiatement
            votre administrateur.
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

export function mailThreadResolu(opts: {
  to: string;
  fullName: string;
  targetLabel: string;
  resolvedByName: string;
  loginUrl: string;
}): MailOptions {
  return {
    to: opts.to,
    subject: `M15-AUDIT — Votre demande a été traitée`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1a1a2e">
        <div style="background:#0f3460;padding:24px 32px;border-radius:8px 8px 0 0">
          <h1 style="color:#ffffff;margin:0;font-size:20px">M15 <strong>AUDIT</strong></h1>
        </div>
        <div style="background:#f8f9fa;padding:32px;border-radius:0 0 8px 8px">
          <h2 style="margin-top:0;color:#155724">✅ Demande traitée</h2>
          <p>Bonjour <strong>${opts.fullName}</strong>,</p>
          <p>
            Votre discussion concernant <strong>${opts.targetLabel}</strong>
            a été marquée comme résolue par <strong>${opts.resolvedByName}</strong>.
          </p>
          <p>
            <a href="${opts.loginUrl}" style="display:inline-block;background:#0f3460;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">
              Voir mon espace
            </a>
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
