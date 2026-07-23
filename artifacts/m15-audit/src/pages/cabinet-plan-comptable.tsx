/**
 * Page /cabinet/plan-comptable
 *
 * Espace plein-écran pour la recherche intelligente IA dans le Plan Comptable
 * SYSCOHADA. Cabinet staff uniquement.
 */

import { CabinetAccountSmartSearch } from "@/components/ai/CabinetAccountSmartSearch"
import { Sparkles } from "lucide-react"

export default function CabinetPlanComptable() {
  return (
    <div className="flex flex-col h-full -m-4 md:-m-8">
      {/* Page header */}
      <div className="shrink-0 px-6 pt-6 pb-4 border-b bg-card">
        <div className="flex items-center gap-3 mb-1">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground tracking-tight">
              Plan Comptable SYSCOHADA
            </h1>
            <p className="text-sm text-muted-foreground">
              Recherche Intelligente IA · 1 403 comptes Classes 1–9
            </p>
          </div>
        </div>
      </div>

      {/* Search surface */}
      <div className="flex-1 overflow-hidden px-6 py-4">
        <div className="mx-auto max-w-2xl h-full">
          <CabinetAccountSmartSearch />
        </div>
      </div>
    </div>
  )
}
