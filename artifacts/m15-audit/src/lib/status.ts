import type { MissionStatus, UserRole, TransactionStatus, PaymentMethod, PaymentType, TransactionType, TransactionSource, ClosureStatus, TaxRegime } from "@workspace/api-client-react"

// Module M21 (Télédéclaration TVA): régime fiscal ivoirien, French label per
// backend enum key (see TAX_REGIMES in lib/db/src/schema/clients.ts). Backend
// stays English/upper-snake-case -- this is purely the display layer.
// True for any account in the VAT collection/deduction classes (443 TVA
// Collectée, 445 TVA Déductible) -- mirrors isVatAccount() server-side
// (artifacts/api-server/src/lib/vat-engine.ts), used to disable/hide VAT
// account entry for a client whose dossier is not VAT-registered.
export function isVatAccount(accountNumber: string) {
  return accountNumber.startsWith('443') || accountNumber.startsWith('445')
}

export function getTaxRegimeLabel(regime: TaxRegime | string | null | undefined) {
  switch (regime) {
    case 'REEL_NORMAL': return 'Réel Normal'
    case 'REEL_SIMPLIFIE': return 'Réel Simplifié'
    case 'ENTREPRENANT': return 'Entreprenant'
    case 'EXONERE': return 'Exonéré / Non assujetti'
    default: return '—'
  }
}

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
    case 'super_admin': return 'Super Administrateur'
    case 'expert_comptable': return 'Expert-comptable'
    case 'collaborateur': return 'Collaborateur'
    case 'stagiaire': return 'Stagiaire'
    case 'client_pme': return 'Espace PME'
    // Module M29: generic fallback -- callers that have the current user
    // object should prefer getUserRoleLabel(user) below, which shows the
    // specific staff role (e.g. "Agent Terrain / Pompiste") instead.
    case 'client_staff': return 'Collaborateur PME'
    default: return '—'
  }
}

export function getRoleBadgeColor(role: UserRole | string | null | undefined) {
  switch (role) {
    case 'super_admin': return 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300'
    case 'expert_comptable': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'collaborateur': return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
    case 'stagiaire': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    case 'client_pme': return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300'
    case 'client_staff': return 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

// Module M29 (RBAC & Gestion du Personnel PME).
//
// "client_pme" (the company owner) and "client_staff" (its employees) share
// the same Espace PME portal, scoped to one client dossier -- see
// PORTAL_ROLES / isPortalRole() server-side (lib/db/src/schema/users.ts).
// Kept as a small frontend-only mirror since the frontend never imports
// @workspace/db.
export function isPortalRole(role: UserRole | string | null | undefined) {
  return role === 'client_pme' || role === 'client_staff'
}

// Compte Super Administrateur système — accès exclusif à la console /admin/*.
export function isSuperAdmin(role: UserRole | string | null | undefined) {
  return role === 'super_admin'
}

// Shows the specific staff role label (e.g. "Agent Terrain / Pompiste") for
// a client_staff account, falling back to getRoleLabel() for every other
// role -- prefer this over getRoleLabel() wherever the full user object is
// available (topbar, user menu, staff list).
export function getUserRoleLabel(user: { role?: UserRole | string | null; roleLabel?: string | null } | null | undefined) {
  if (user?.role === 'client_staff' && user.roleLabel) return user.roleLabel
  return getRoleLabel(user?.role)
}

// A permission gate only ever restricts "client_staff" accounts -- the
// "client_pme" owner and every cabinet role remain unrestricted, mirroring
// requirePermission() server-side (artifacts/api-server/src/middlewares/auth.ts).
export function hasPermission(
  user: { role?: UserRole | string | null; permissions?: string[] | null } | null | undefined,
  ...permissions: string[]
) {
  if (!user) return false
  if (user.role !== 'client_staff') return true
  const granted = user.permissions ?? []
  return permissions.some((p) => granted.includes(p))
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
    // Module M17 (Gestion des Immobilisations & Amortissements).
    case 'FIXED_ASSET_CREATE': return `Enregistrement d'une immobilisation${ref}`
    case 'FIXED_ASSET_UPDATE': return `Mise à jour d'une immobilisation${ref}`
    case 'DEPRECIATION_CLOSING_GENERATE': return `Génération des dotations aux amortissements${ref}`
    // Module M18 (Immobilisations Financières & Emprunts).
    case 'FINANCIAL_ITEM_CREATE': return `Enregistrement d'un emprunt ou d'une immobilisation financière${ref}`
    case 'FINANCIAL_ITEM_UPDATE': return `Mise à jour d'un emprunt ou d'une immobilisation financière${ref}`
    case 'FINANCIAL_ENTRY_GENERATE': return `Génération des écritures d'échéances financières${ref}`
    // Module M19 (Clôture d'Exercice Comptable).
    case 'PERIOD_CLOSE': return `Clôture de la période comptable${ref}`
    // Module M20 (Gestion de la Paie, ITS & CNPS).
    case 'EMPLOYEE_CREATE': return `Création d'une fiche employé${ref}`
    case 'EMPLOYEE_UPDATE': return `Mise à jour d'une fiche employé${ref}`
    case 'PAYROLL_POST': return `Comptabilisation de la paie${ref}`
    // Module M21 (Télédéclaration TVA - Formulaire D-201/VA).
    case 'VAT_SUPPLIER_INFO_UPDATE': return `Correction des informations fournisseur (NCC)${ref}`
    case 'VAT_LIQUIDATION_POST': return `Comptabilisation de la liquidation de TVA${ref}`
    case 'VAT_ANNEX_EXPORT': return `Export de l'annexe D-201/VA (état des taxes déductibles)${ref}`
    // Module M31 (Messagerie Interne du Cabinet).
    case 'CHAT_CHANNEL_CREATE': return `Création d'un salon de discussion${ref}`
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

// Simplified journal-code classification (Journaux view): SYSCOHADA firms
// typically split the general ledger into auxiliary journals -- here
// derived from the payment method / operation type actually recorded,
// since this MVP's matching engine doesn't book to a dedicated journal
// column. HA (Achats), VT (Ventes), BQ (Banque), CA (Caisse).
// Sources that book non-cash adjusting entries (no treasury movement) --
// year-end closings, VAT liquidation, dotations aux amortissements, etc.
// These always classify into "OD" (Opérations Diverses) regardless of
// `type`/`paymentMethod`, since neither reflects a purchase/sale or a
// treasury movement.
const OD_JOURNAL_SOURCES = new Set<TransactionSource | string>([
  "closing_result",
  "a_nouveaux",
  "vat_liquidation",
  "depreciation_closing",
  // Écriture de constitution du capital social (Débit 5211/4613 / Crédit 1013) :
  // toujours comptabilisée dans le Journal OD, jamais en BQ/CA/HA/VT.
  "capital_constitution",
])

export function getJournalCode(entry: {
  type: TransactionType | string
  paymentMethod?: PaymentMethod | string | null
  source?: TransactionSource | string | null
}): "HA" | "VT" | "BQ" | "CA" | "OD" {
  if (entry.source && OD_JOURNAL_SOURCES.has(entry.source)) return "OD"
  if (entry.paymentMethod === "especes") return "CA"
  if (entry.paymentMethod === "virement" || entry.paymentMethod === "cheque" || entry.paymentMethod === "mobile_money") return "BQ"
  if (entry.paymentMethod == null) return "OD"
  return entry.type === "recette" ? "VT" : "HA"
}

export function getJournalCodeLabel(code: "HA" | "VT" | "BQ" | "CA" | "OD") {
  switch (code) {
    case "HA": return "HA — Achats"
    case "VT": return "VT — Ventes"
    case "BQ": return "BQ — Banque"
    case "CA": return "CA — Caisse"
    case "OD": return "OD — Opérations Diverses"
  }
}

export function getTransactionSourceLabel(source: TransactionSource | string | null | undefined) {
  switch (source) {
    case 'settlement': return 'Règlement de facture'
    case 'manual_cabinet': return 'Saisie cabinet'
    case 'pme_entry': return 'Déclaration client'
    case 'ocr_entry': return 'Scan IA'
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

// Module M17 (Gestion des Immobilisations & Amortissements).
export function getFixedAssetStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'ACTIF': return 'Actif'
    case 'RETIRE': return 'Retiré'
    default: return status ?? '—'
  }
}

export function getFixedAssetStatusColor(status: string | null | undefined) {
  switch (status) {
    case 'ACTIF': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'RETIRE': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

export function getDepreciationTypeLabel(type: string | null | undefined) {
  switch (type) {
    case 'LINEAIRE': return 'Linéaire'
    case 'DEGRESSIF': return 'Dégressif'
    default: return type ?? '—'
  }
}

// Add M17 audit action labels.
export function getAuditActionLabelM17(action: string, entityId?: string | null) {
  const ref = entityId ? ` #${entityId}` : ''
  switch (action) {
    case 'FIXED_ASSET_CREATE': return `Enregistrement d'une immobilisation${ref}`
    case 'FIXED_ASSET_UPDATE': return `Mise à jour d'une immobilisation${ref}`
    case 'DEPRECIATION_CLOSING_GENERATE': return `Génération des dotations aux amortissements${ref}`
    default: return null
  }
}

// Module M18 (Immobilisations Financières & Emprunts).
export function getFinancialItemTypeLabel(type: string | null | undefined) {
  switch (type) {
    case 'EMPRUNT_BANCAIRE': return 'Emprunt bancaire'
    case 'IMMOBILISATION_FINANCIERE': return 'Immobilisation financière'
    default: return type ?? '—'
  }
}

export function getFinancialItemStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'ACTIF': return 'Actif'
    case 'SOLDE': return 'Soldé'
    default: return status ?? '—'
  }
}

export function getFinancialItemStatusColor(status: string | null | undefined) {
  switch (status) {
    case 'ACTIF': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'SOLDE': return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

// Module M20 (Gestion de la Paie, ITS & CNPS).
export function getMaritalStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'CELIBATAIRE': return 'Célibataire'
    case 'MARIE': return 'Marié(e)'
    default: return '—'
  }
}

export function getEmployeeStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'ACTIF': return 'Actif'
    case 'INACTIF': return 'Inactif'
    default: return '—'
  }
}

export function getEmployeeStatusColor(status: string | null | undefined) {
  switch (status) {
    case 'ACTIF': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
    case 'INACTIF': return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    default: return 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300'
  }
}

export function getPaymentFrequencyLabel(frequency: string | null | undefined) {
  switch (frequency) {
    case 'MENSUEL': return 'Mensuelle'
    case 'TRIMESTRIEL': return 'Trimestrielle'
    case 'ANNUEL': return 'Annuelle'
    default: return frequency ?? '—'
  }
}
