/**
 * Module M23 — Comptabilité Analytique par Projet / Département
 *
 * Route: /cabinet/client/:clientId/analytique
 * Access: expert_comptable + collaborateur (write), stagiaire (read)
 *
 * Two tabs:
 *   1. Configuration — gérer les axes analytiques et leurs sections
 *   2. Tableau Analytique — compte de résultat analytique par code
 */

import * as React from "react";
import { useRoute } from "wouter";
import {
  useListAnalyticalAxes,
  useCreateAnalyticalAxis,
  useUpdateAnalyticalAxis,
  useDeleteAnalyticalAxis,
  useListAnalyticalCodes,
  useCreateAnalyticalCode,
  useUpdateAnalyticalCode,
  useDeleteAnalyticalCode,
  useGetAnalyticalReport,
  getListAnalyticalAxesQueryKey,
  getListAnalyticalCodesQueryKey,
} from "@workspace/api-client-react";
import type { AnalyticalAxis, AnalyticalCode } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { ClientAccountingNav } from "@/components/comptabilite/ClientAccountingNav";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Pencil,
  Trash2,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronRight,
  BarChart2,
  Layers,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function fmtFcfa(n: number) {
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " FCFA";
}

function buildYears() {
  const y = new Date().getFullYear();
  return [y, y - 1, y - 2, y - 3];
}

// ---------------------------------------------------------------------------
// Configuration Tab
// ---------------------------------------------------------------------------

function AxisForm({
  open,
  onClose,
  clientId,
  axis,
}: {
  open: boolean;
  onClose: () => void;
  clientId: number;
  axis?: AnalyticalAxis;
}) {
  const createAxis = useCreateAnalyticalAxis();
  const updateAxis = useUpdateAnalyticalAxis();
  const qc = useQueryClient();
  const [name, setName] = React.useState(axis?.name ?? "");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setName(axis?.name ?? ""); setError(null); }
  }, [open, axis]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError("Le nom de l'axe est requis."); return; }
    try {
      if (axis) {
        await updateAxis.mutateAsync({ id: axis.id, data: { name: name.trim() } });
      } else {
        await createAxis.mutateAsync({ data: { clientId, name: name.trim() } });
      }
      qc.invalidateQueries({ queryKey: getListAnalyticalAxesQueryKey({ clientId }) });
      onClose();
    } catch {
      setError("Erreur lors de l'enregistrement.");
    }
  }

  const isPending = createAxis.isPending || updateAxis.isPending;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{axis ? "Modifier l'axe analytique" : "Nouvel axe analytique"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>Nom de l'axe (ex : Projets, Départements, Chantiers)</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex : Projets" autoFocus />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "…" : (axis ? "Enregistrer" : "Créer")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CodeForm({
  open,
  onClose,
  axisId,
  clientId,
  code,
}: {
  open: boolean;
  onClose: () => void;
  axisId: number;
  clientId: number;
  code?: AnalyticalCode;
}) {
  const createCode = useCreateAnalyticalCode();
  const updateCode = useUpdateAnalyticalCode();
  const qc = useQueryClient();
  const [codeVal, setCodeVal] = React.useState(code?.code ?? "");
  const [label, setLabel] = React.useState(code?.label ?? "");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) { setCodeVal(code?.code ?? ""); setLabel(code?.label ?? ""); setError(null); }
  }, [open, code]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!codeVal.trim()) { setError("Le code est requis."); return; }
    if (!label.trim()) { setError("Le libellé est requis."); return; }
    try {
      if (code) {
        await updateCode.mutateAsync({ id: code.id, data: { code: codeVal.trim(), label: label.trim() } });
      } else {
        await createCode.mutateAsync({ data: { axisId, code: codeVal.trim(), label: label.trim() } });
      }
      qc.invalidateQueries({ queryKey: getListAnalyticalCodesQueryKey({ axisId }) });
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg.includes("409") || msg.includes("existe") ? `Le code "${codeVal.trim().toUpperCase()}" existe déjà sur cet axe.` : "Erreur lors de l'enregistrement.");
    }
  }

  const isPending = createCode.isPending || updateCode.isPending;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{code ? "Modifier la section" : "Nouvelle section analytique"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>Code mnémonique (ex : PRJ-GEXPA, DEP-RD)</Label>
            <Input value={codeVal} onChange={(e) => setCodeVal(e.target.value.toUpperCase())} placeholder="ex : PRJ-GEXPA" className="font-mono uppercase" autoFocus />
          </div>
          <div className="space-y-1">
            <Label>Libellé (ex : Projet GexpA, Pôle R&D)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex : Projet GexpA" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "…" : (code ? "Enregistrer" : "Créer")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConfigTab({ clientId }: { clientId: number }) {
  const { user } = useAuth();
  const canWrite = user?.role === "expert_comptable" || user?.role === "collaborateur";
  const qc = useQueryClient();

  const { data: axes = [], isLoading } = useListAnalyticalAxes(
    { clientId, includeInactive: true },
    { query: { queryKey: getListAnalyticalAxesQueryKey({ clientId, includeInactive: true }) } },
  );

  const deleteAxis = useDeleteAnalyticalAxis();
  const updateAxis = useUpdateAnalyticalAxis();
  const deleteCode = useDeleteAnalyticalCode();
  const updateCode = useUpdateAnalyticalCode();

  const [axisFormOpen, setAxisFormOpen] = React.useState(false);
  const [editingAxis, setEditingAxis] = React.useState<AnalyticalAxis | undefined>();
  const [codeFormOpen, setCodeFormOpen] = React.useState(false);
  const [editingCode, setEditingCode] = React.useState<AnalyticalCode | undefined>();
  const [activeCodeAxisId, setActiveCodeAxisId] = React.useState<number | null>(null);
  const [expandedAxes, setExpandedAxes] = React.useState<Set<number>>(new Set());

  const { data: allCodes = [] } = useListAnalyticalCodes(
    { clientId, includeInactive: true },
    { query: { queryKey: getListAnalyticalCodesQueryKey({ clientId, includeInactive: true }) } },
  );

  const codesByAxis = React.useMemo(() => {
    const map = new Map<number, AnalyticalCode[]>();
    for (const c of allCodes) {
      const arr = map.get(c.axisId) ?? [];
      arr.push(c);
      map.set(c.axisId, arr);
    }
    return map;
  }, [allCodes]);

  function toggleAxis(id: number) {
    setExpandedAxes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleDeleteAxis(id: number) {
    await deleteAxis.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListAnalyticalAxesQueryKey({ clientId }) });
  }

  async function handleToggleAxisActive(axis: AnalyticalAxis) {
    await updateAxis.mutateAsync({ id: axis.id, data: { isActive: !axis.isActive } });
    qc.invalidateQueries({ queryKey: getListAnalyticalAxesQueryKey({ clientId, includeInactive: true }) });
  }

  async function handleDeleteCode(id: number, axisId: number) {
    await deleteCode.mutateAsync({ id });
    qc.invalidateQueries({ queryKey: getListAnalyticalCodesQueryKey({ axisId }) });
    qc.invalidateQueries({ queryKey: getListAnalyticalCodesQueryKey({ clientId, includeInactive: true }) });
  }

  async function handleToggleCodeActive(code: AnalyticalCode) {
    await updateCode.mutateAsync({ id: code.id, data: { isActive: !code.isActive } });
    qc.invalidateQueries({ queryKey: getListAnalyticalCodesQueryKey({ axisId: code.axisId }) });
    qc.invalidateQueries({ queryKey: getListAnalyticalCodesQueryKey({ clientId, includeInactive: true }) });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Créez des axes (ex : <em>Projets</em>) puis ajoutez des sections sous chaque axe (ex : <em>Projet GexpA</em>).
        </p>
        {canWrite && (
          <Button size="sm" onClick={() => { setEditingAxis(undefined); setAxisFormOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" /> Nouvel axe
          </Button>
        )}
      </div>

      {isLoading && <div className="text-center py-8 text-muted-foreground text-sm">Chargement…</div>}

      {!isLoading && axes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground text-sm">
            Aucun axe analytique configuré.{canWrite && " Créez votre premier axe ci-dessus."}
          </CardContent>
        </Card>
      )}

      {axes.map((axis) => {
        const codes = codesByAxis.get(axis.id) ?? [];
        const expanded = expandedAxes.has(axis.id);

        return (
          <Card key={axis.id} className={cn(!axis.isActive && "opacity-60")}>
            <CardHeader className="py-3 px-4">
              <div className="flex items-center justify-between">
                <button
                  className="flex items-center gap-2 text-left"
                  onClick={() => toggleAxis(axis.id)}
                >
                  {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <Layers className="h-4 w-4 text-primary" />
                  <span className="font-semibold">{axis.name}</span>
                  <Badge variant="outline" className="text-xs">
                    {codes.length} section{codes.length !== 1 ? "s" : ""}
                  </Badge>
                  {!axis.isActive && <Badge variant="secondary" className="text-xs">Inactif</Badge>}
                </button>

                {canWrite && (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => { setActiveCodeAxisId(axis.id); setEditingCode(undefined); setCodeFormOpen(true); }}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Section
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => { setEditingAxis(axis); setAxisFormOpen(true); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn("h-7 px-2 text-xs", axis.isActive ? "text-amber-600" : "text-emerald-600")}
                      onClick={() => handleToggleAxisActive(axis)}
                    >
                      {axis.isActive ? "Désactiver" : "Réactiver"}
                    </Button>
                    {codes.length === 0 && (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Supprimer l'axe « {axis.name} » ?</AlertDialogTitle>
                            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Annuler</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDeleteAxis(axis.id)}>Supprimer</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    )}
                  </div>
                )}
              </div>
            </CardHeader>

            {expanded && (
              <CardContent className="pt-0 pb-3">
                {codes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic px-4 py-2">Aucune section. {canWrite && "Cliquez sur « + Section » pour en ajouter."}</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">Code</TableHead>
                        <TableHead className="text-xs">Libellé</TableHead>
                        <TableHead className="text-xs">Statut</TableHead>
                        {canWrite && <TableHead />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {codes.map((code) => (
                        <TableRow key={code.id} className={cn(!code.isActive && "opacity-50")}>
                          <TableCell className="font-mono text-xs font-semibold">{code.code}</TableCell>
                          <TableCell className="text-sm">{code.label}</TableCell>
                          <TableCell>
                            <Badge variant={code.isActive ? "default" : "secondary"} className="text-xs">
                              {code.isActive ? "Actif" : "Inactif"}
                            </Badge>
                          </TableCell>
                          {canWrite && (
                            <TableCell className="text-right">
                              <div className="flex gap-1 justify-end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => { setEditingCode(code); setActiveCodeAxisId(axis.id); setCodeFormOpen(true); }}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className={cn("h-6 px-2 text-xs", code.isActive ? "text-amber-600" : "text-emerald-600")}
                                  onClick={() => handleToggleCodeActive(code)}
                                >
                                  {code.isActive ? "Désactiver" : "Réactiver"}
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive">
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Supprimer la section « {code.label} » ?</AlertDialogTitle>
                                      <AlertDialogDescription>Impossible si des ventilations existent sur cette section.</AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeleteCode(code.id, axis.id)}>Supprimer</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </div>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

      <AxisForm
        open={axisFormOpen}
        onClose={() => { setAxisFormOpen(false); setEditingAxis(undefined); }}
        clientId={clientId}
        axis={editingAxis}
      />
      {activeCodeAxisId !== null && (
        <CodeForm
          open={codeFormOpen}
          onClose={() => { setCodeFormOpen(false); setEditingCode(undefined); }}
          axisId={activeCodeAxisId}
          clientId={clientId}
          code={editingCode}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Analytical Dashboard Tab
// ---------------------------------------------------------------------------

function CircularMarginGauge({ pct }: { pct: number }) {
  const clamped = Math.max(-100, Math.min(100, pct));
  const radius = 36;
  const circ = 2 * Math.PI * radius;
  const fill = (Math.abs(clamped) / 100) * circ;
  const isNeg = clamped < 0;

  return (
    <div className="relative inline-flex items-center justify-center w-24 h-24">
      <svg width="96" height="96" viewBox="0 0 96 96">
        <circle cx="48" cy="48" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="48"
          cy="48"
          r={radius}
          fill="none"
          stroke={isNeg ? "#ef4444" : pct >= 30 ? "#10b981" : "#f59e0b"}
          strokeWidth="8"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeDashoffset={circ / 4}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-base font-bold tabular-nums", isNeg ? "text-red-600" : pct >= 30 ? "text-emerald-600" : "text-amber-600")}>
          {clamped.toFixed(1)}%
        </span>
        <span className="text-[10px] text-muted-foreground">Marge</span>
      </div>
    </div>
  );
}

function DashboardTab({ clientId }: { clientId: number }) {
  const years = buildYears();
  const [year, setYear] = React.useState(years[0]);
  const [axisId, setAxisId] = React.useState<number | null>(null);
  const [selectedCode, setSelectedCode] = React.useState<number | null>(null);
  const [expandedCodes, setExpandedCodes] = React.useState<Set<number>>(new Set());

  const { data: axes = [] } = useListAnalyticalAxes(
    { clientId },
    { query: { queryKey: getListAnalyticalAxesQueryKey({ clientId }) } },
  );

  // Auto-select first axis when list loads.
  React.useEffect(() => {
    if (axes.length > 0 && axisId === null) setAxisId(axes[0].id);
  }, [axes, axisId]);

  const { data: report, isLoading } = useGetAnalyticalReport(
    { clientId, axisId: axisId ?? 0, year },
    { query: { enabled: axisId !== null, queryKey: ["getAnalyticalReport", clientId, axisId, year] } },
  );

  const rows = report?.rows ?? [];
  const selectedRow = selectedCode !== null ? rows.find((r) => r.codeId === selectedCode) : null;

  function toggleExpand(id: number) {
    setExpandedCodes((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-5">
      {/* Selectors */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Axe analytique</Label>
          <Select
            value={axisId ? String(axisId) : ""}
            onValueChange={(v) => { setAxisId(Number(v)); setSelectedCode(null); }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Sélectionner un axe…" />
            </SelectTrigger>
            <SelectContent>
              {axes.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Exercice</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {axes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucun axe analytique configuré. Créez-en un dans l'onglet « Configuration ».
          </CardContent>
        </Card>
      )}

      {isLoading && axisId !== null && (
        <div className="text-center py-8 text-muted-foreground text-sm">Calcul en cours…</div>
      )}

      {report && rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Aucune écriture ventilée pour cet axe sur l'exercice {year}.
          </CardContent>
        </Card>
      )}

      {report && rows.length > 0 && (
        <>
          {/* Summary table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Compte de Résultat Analytique — {report.axisName} — {year}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Section</TableHead>
                    <TableHead className="text-right">Produits (Cl. 7)</TableHead>
                    <TableHead className="text-right">Charges (Cl. 6)</TableHead>
                    <TableHead className="text-right">Marge Analytique</TableHead>
                    <TableHead className="text-right pr-4">Rentabilité</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isNeg = row.netMargin < 0;
                    const isLow = row.marginPct !== null && row.marginPct >= 0 && row.marginPct < 30;
                    const expanded = expandedCodes.has(row.codeId);

                    return (
                      <React.Fragment key={row.codeId}>
                        <TableRow
                          className={cn(
                            "cursor-pointer",
                            isNeg && "bg-red-50 dark:bg-red-950/20",
                            isLow && !isNeg && "bg-amber-50 dark:bg-amber-950/20",
                            selectedCode === row.codeId && "ring-1 ring-inset ring-primary",
                          )}
                          onClick={() => {
                            setSelectedCode(selectedCode === row.codeId ? null : row.codeId);
                            toggleExpand(row.codeId);
                          }}
                        >
                          <TableCell className="pl-4">
                            <div className="flex items-center gap-2">
                              {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                              <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                              <span className="font-medium">{row.label}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-blue-700">{row.totalRevenue > 0 ? fmtFcfa(row.totalRevenue) : "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-amber-700">{row.totalExpense > 0 ? fmtFcfa(row.totalExpense) : "—"}</TableCell>
                          <TableCell className={cn("text-right tabular-nums font-semibold", isNeg ? "text-red-700" : "text-emerald-700")}>
                            <div className="flex items-center justify-end gap-1">
                              {isNeg ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                              {fmtFcfa(row.netMargin)}
                            </div>
                          </TableCell>
                          <TableCell className="text-right pr-4">
                            {row.marginPct !== null ? (
                              <Badge
                                variant="outline"
                                className={cn(
                                  "tabular-nums",
                                  isNeg ? "bg-red-100 text-red-700 border-red-200" :
                                  isLow ? "bg-amber-100 text-amber-700 border-amber-200" :
                                  "bg-emerald-100 text-emerald-700 border-emerald-200",
                                )}
                              >
                                {row.marginPct.toFixed(1)} %
                              </Badge>
                            ) : "—"}
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail */}
                        {expanded && (
                          <TableRow className="bg-muted/20">
                            <TableCell colSpan={5} className="p-4">
                              <div className="grid md:grid-cols-2 gap-6">
                                {/* Mini P&L detail */}
                                <div className="space-y-3">
                                  {(row.revenueByAccount ?? []).length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-blue-700 mb-1 uppercase tracking-wide">Produits ventilés</p>
                                      {(row.revenueByAccount ?? []).map((a) => (
                                        <div key={a.accountNumber} className="flex justify-between text-xs py-0.5">
                                          <span className="font-mono text-muted-foreground mr-2">{a.accountNumber}</span>
                                          <span className="truncate flex-1">{a.accountName}</span>
                                          <span className="tabular-nums font-medium text-blue-700 ml-2">{fmtFcfa(a.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {(row.expenseByAccount ?? []).length > 0 && (
                                    <div>
                                      <p className="text-xs font-semibold text-amber-700 mb-1 uppercase tracking-wide">Charges ventilées</p>
                                      {(row.expenseByAccount ?? []).map((a) => (
                                        <div key={a.accountNumber} className="flex justify-between text-xs py-0.5">
                                          <span className="font-mono text-muted-foreground mr-2">{a.accountNumber}</span>
                                          <span className="truncate flex-1">{a.accountName}</span>
                                          <span className="tabular-nums font-medium text-amber-700 ml-2">{fmtFcfa(a.amount)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                                    <span>Marge Analytique</span>
                                    <span className={row.netMargin >= 0 ? "text-emerald-700" : "text-red-700"}>{fmtFcfa(row.netMargin)}</span>
                                  </div>
                                </div>
                                {/* Circular gauge */}
                                <div className="flex flex-col items-center justify-center gap-2">
                                  {row.marginPct !== null ? (
                                    <CircularMarginGauge pct={row.marginPct} />
                                  ) : (
                                    <div className="text-xs text-muted-foreground text-center">
                                      Marge non calculable<br />(pas de produits ventilés)
                                    </div>
                                  )}
                                  <p className="text-xs text-muted-foreground text-center">
                                    {row.label}
                                  </p>
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function Analytique() {
  const [, params] = useRoute<{ clientId: string }>("/cabinet/client/:clientId/analytique");
  const clientId = params?.clientId ? Number(params.clientId) : null;

  if (!clientId) return null;

  return (
    <div className="space-y-4">
      <ClientAccountingNav activeTab="analytique" />

      <div>
        <h1 className="text-xl font-bold tracking-tight">Comptabilité Analytique</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Ventilation des écritures par axe (Projets, Départements…) et compte de résultat analytique.
        </p>
      </div>

      <Tabs defaultValue="config">
        <TabsList>
          <TabsTrigger value="config">
            <Layers className="h-4 w-4 mr-2" />
            Configuration
          </TabsTrigger>
          <TabsTrigger value="dashboard">
            <BarChart2 className="h-4 w-4 mr-2" />
            Tableau Analytique
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-4">
          <ConfigTab clientId={clientId} />
        </TabsContent>

        <TabsContent value="dashboard" className="mt-4">
          <DashboardTab clientId={clientId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
