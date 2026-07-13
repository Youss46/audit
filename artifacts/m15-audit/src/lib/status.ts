import type { MissionStatus, UserRole } from "@workspace/api-client-react"

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
