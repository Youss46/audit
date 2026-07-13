import type { MissionStatus, UserRole, TransactionStatus, PaymentMethod, PaymentType, TransactionType, TransactionSource, ClosureStatus } from "@workspace/api-client-react"

// Shared French labels/colors for the mission workflow state machine and the
// RBAC role badges, so every screen (dashboard, clients, missions, GED, team)
// renders them identically.
// `status` is null when the client has no mission open yet -- this is
// distinct from "en_attente" (a mission exists and is awaiting review).
export function getStatusColor(status: MissionStatus | null | undefined) {
  switch (status) {
    case 'en_attente': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    case 'en_cours': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'anomalie': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
    case 'valide': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
    case 'visa_emis': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case null:
    case undefined:
      return 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

export function getStatusLabel(status: MissionStatus | null | undefined) {
  switch (status) {
    case 'en_attente': return 'En attente'
    case 'en_cours': return 'En cours'
    case 'anomalie': return 'Anomalie'
    case 'valide': return 'Validé'
    case 'visa_emis': return 'Visa émis'
    case null:
    case undefined:
      return 'Aucune mission'
    default: return status
  }
}

export function getRoleLabel(role: UserRole | string | null | undefined) {
  switch (role) {
    case 'expert_comptable': return 'Expert-comptable'
    case 'collaborateur': return 'Collaborateur'
    case 'stagiaire': return 'Stagiaire'
    case 'client_pme': return 'Espace PME'
    default: return '—'
  }
}

export function getRoleBadgeColor(role: UserRole | string | null | undefined) {
  switch (role) {
    case 'expert_comptable': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'collaborateur': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'stagiaire': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    case 'client_pme': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

// Module M14 (Journal de Conformité - Espace Cabinet): human-readable
// French sentence per backend action_type code, for the compliance log.
// Backend codes stay English/upper-snake-case (see AuditAction in
// artifacts/api-server/src/lib/audit.ts) -- this is purely the display
// layer, following the same split as getAnomalyLabel/getAnomalyShortLabel.
export function getAuditActionLabel(action: string, entityId?: string | null) {
  const ref = entityId ? ` #${entityId}` : ''
  switch (action) {
    case 'AUTH_REGISTER': return 'Création du cabinet et du premier compte Expert-comptable'
    case 'AUTH_LOGIN': return 'Connexion à la plateforme'
    case 'CLIENT_CREATE': return `Création du dossier client${ref}`
    case 'CLIENT_UPDATE': return `Modification du dossier client${ref}`
    case 'CLIENT_DELETE': return `Suppression du dossier client${ref}`
    case 'MISSION_CREATE': return `Ouverture d'une mission de visa${ref}`
    case 'MISSION_UPDATE': return `Mise à jour d'une mission de visa${ref}`
    case 'CHECKLIST_VALIDATE': return `Validation d'un point de la checklist${ref}`
    case 'CHECKLIST_NOTE': return `Ajout d'une note sur la checklist${ref}`
    case 'VISA_ISSUED': return `Émission du visa de conformité${ref}`
    case 'DOCUMENT_UPLOAD': return `Téléversement d'un document${ref}`
    case 'DOCUMENT_DELETE': return `Suppression d'un document${ref}`
    case 'USER_CREATE': return `Création d'un compte collaborateur${ref}`
    case 'USER_UPDATE': return `Modification d'un compte collaborateur${ref}`
    case 'USER_DELETE': return `Suppression d'un compte collaborateur${ref}`
    case 'TRANSACTION_CREATE': return `Déclaration d'une nouvelle opération${ref}`
    case 'TRANSACTION_APPROVE': return `Validation et comptabilisation de l'écriture${ref}`
    case 'TRANSACTION_REJECT': return `Invalidation d'une opération${ref}`
    case 'TRANSACTION_SETTLE': return `Règlement d'une facture à crédit${ref}`
    case 'TRANSACTION_JOURNAL_LINES_UPDATE': return `Ajustement des comptes de l'écriture${ref}`
    case 'CASH_REGISTER_CREATE': return `Ouverture d'une caisse${ref}`
    case 'DAILY_CLOSURE_CLOSE': return `Clôture de caisse du jour${ref}`
    case 'CASH_ENTRIES_SYNC': return `Synchronisation des mouvements de caisse${ref}`
    case 'LIASSE_FISCALE_EXPORT': return `Export de la liasse fiscale${ref}`
    case 'TRANSACTION_FORCE_VALIDATE': return `Validation forcée d'une écriture en anomalie${ref}`
    case 'AI_OVERRIDE': return `Correction manuelle d'une valeur pré-remplie par l'IA${ref}`
    default: return action
  }
}

export function isAiOverrideAction(action: string) {
  return action === 'AI_OVERRIDE'
}

// Modules P3/M3 (Comptabilité simplifiée & Comptabilité et travaux): shared
// French labels/colors for the journal-entry (transaction) workflow.
export function getTransactionStatusLabel(status: TransactionStatus | string | null | undefined) {
  switch (status) {
    case 'a_valider': return 'À valider'
    case 'valide': return 'Validé'
    case 'anomalie': return 'Anomalie'
    default: return status ?? '—'
  }
}

export function getTransactionStatusColor(status: TransactionStatus | string | null | undefined) {
  switch (status) {
    case 'a_valider': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300'
    case 'valide': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'anomalie': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

export function getTransactionTypeLabel(type: TransactionType | string | null | undefined) {
  return type === 'recette' ? 'Recette' : type === 'depense' ? 'Dépense' : '—'
}

export function getPaymentMethodLabel(method: PaymentMethod | string | null | undefined) {
  switch (method) {
    case 'especes': return 'Espèces'
    case 'mobile_money': return 'Wave / Orange Money'
    case 'cheque': return 'Chèque'
    case 'virement': return 'Virement'
    default: return '—'
  }
}

export function getPaymentTypeLabel(type: PaymentType | string | null | undefined) {
  return type === 'cash' ? 'Immédiat (Au comptant)' : type === 'credit' ? 'Plus tard (À crédit)' : '—'
}

export function getTransactionSourceLabel(source: TransactionSource | string | null | undefined) {
  switch (source) {
    case 'settlement': return 'Règlement de facture'
    case 'manual_cabinet': return 'Saisie cabinet'
    case 'pme_entry': return 'Déclaration client'
    default: return '—'
  }
}

// Module P5 (Caisse Terrain): the daily closure workflow state.
export function getClosureStatusLabel(status: ClosureStatus | string | null | undefined) {
  switch (status) {
    case 'OPEN': return 'Ouverte'
    case 'CLOSED': return 'Clôturée'
    default: return status ?? '—'
  }
}

export function getClosureStatusColor(status: ClosureStatus | string | null | undefined) {
  switch (status) {
    case 'OPEN': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'CLOSED': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

export function formatFcfa(amount: number | null | undefined) {
  if (amount == null) return '—'
  return `${amount.toLocaleString('fr-FR')} FCFA`
}

// Module M8 (Anomalie & Doublon Detector): rule-based flags returned by the
// backend as plain codes (see ANOMALY_CODES) -- this maps each code to the
// exact professionally-worded French warning shown to the accountant.
export function getAnomalyLabel(code: string) {
  switch (code) {
    case 'DOUBLON_SUSPECT':
      return "Doublon suspecté : une autre opération de ce client, du même montant, a été déclarée à moins de 24h de celle-ci."
    case 'INCOHERENCE_COMPTABLE':
      return "Incohérence comptable : le compte imputé ne correspond pas à la nature de l'opération (charge/produit)."
    case 'MONTANT_ANORMAL':
      return "Montant anormalement élevé pour cette catégorie, comparé à la moyenne des 3 derniers mois de ce client."
    default:
      return "Anomalie détectée sur cette opération."
  }
}

export function getAnomalyShortLabel(code: string) {
  switch (code) {
    case 'DOUBLON_SUSPECT': return 'Doublon suspect'
    case 'INCOHERENCE_COMPTABLE': return 'Incohérence comptable'
    case 'MONTANT_ANORMAL': return 'Montant anormal'
    default: return 'Anomalie'
  }
}
