/**
 * Module M22 — Pilotage & Rentabilité du Cabinet
 *
 * Route: /cabinet/interne/rentabilite
 * Access: expert_comptable (dashboard + settings), collaborateur (timesheet input only)
 *
 * Two tabs:
 *   1. Feuille de Temps — weekly timesheet grid for collaborators
 *   2. Rentabilité Clients — per-client profitability dashboard (expert only)
 */

import * as React from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useListTimesheetEntries,
  useCreateTimesheetEntry,
  useUpdateTimesheetEntry,
  useDeleteTimesheetEntry,
  useGetProfitabilityReport,
  useListClientContracts,
  useCreateClientContract,
  useDeleteClientContract,
  useListUserRates,
  useUpsertUserRate,
  useListMissionExpenses,
  getListMissionExpensesQueryKey,
  useCreateMissionExpense,
  useDeleteMissionExpense,
} from "@workspace/api-client-react";
import type { MissionExpense } from "@workspace/api-client-react";
import { getToken, getApiBase } from "@/lib/auth";
import type {
  TimesheetEntry,
  CabinetUserRate,
  ClientContract,
} from "@workspace/api-client-react";
import { useListClients } from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input"
import { AmountInput } from "@/components/ui/amount-input";
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
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
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Plus,
  Pencil,
  Trash2,
  Settings,
  Download,
  Receipt,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TASK_TYPES = [
  "SAISIE",
  "REVISION",
  "CONSEIL",
  "SOCIAL",
  "FISCALITE",
  "ADMINISTRATIF",
] as const;
type TaskType = (typeof TASK_TYPES)[number];

const TASK_LABELS: Record<TaskType, string> = {
  SAISIE: "Saisie comptable",
  REVISION: "Révision",
  CONSEIL: "Conseil",
  SOCIAL: "Social / RH",
  FISCALITE: "Fiscalité",
  ADMINISTRATIF: "Administratif",
};

const TASK_COLORS: Record<TaskType, string> = {
  SAISIE: "#3b82f6",
  REVISION: "#8b5cf6",
  CONSEIL: "#10b981",
  SOCIAL: "#f59e0b",
  FISCALITE: "#ef4444",
  ADMINISTRATIF: "#6b7280",
};

const CHART_COLORS = Object.values(TASK_COLORS);

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatFCFA(n: number) {
  return new Intl.NumberFormat("fr-FR", { style: "decimal", maximumFractionDigits: 0 }).format(n) + " FCFA";
}

function formatPct(n: number | null) {
  if (n === null) return "—";
  return n.toFixed(1) + " %";
}

/** Monday of the ISO week that contains `date`. */
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

const DAY_NAMES = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MONTH_NAMES = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

// ---------------------------------------------------------------------------
// Sub-component: TimesheetEntryForm
// ---------------------------------------------------------------------------

interface EntryFormProps {
  open: boolean;
  onClose: () => void;
  defaultDate?: string; // "YYYY-MM-DD"
  entry?: TimesheetEntry; // when editing
}

function TimesheetEntryForm({ open, onClose, defaultDate, entry }: EntryFormProps) {
  const { data: clients = [] } = useListClients();
  const createEntry = useCreateTimesheetEntry();
  const updateEntry = useUpdateTimesheetEntry();
  const queryClient = useQueryClient();

  const [clientId, setClientId] = React.useState<string>(entry ? String(entry.clientId) : "");
  const [date, setDate] = React.useState(entry ? isoDate(new Date(entry.date)) : (defaultDate ?? isoDate(new Date())));
  const [hours, setHours] = React.useState(entry ? String(entry.durationHours) : "1");
  const [taskType, setTaskType] = React.useState<TaskType>(entry ? (entry.taskType as TaskType) : "SAISIE");
  const [description, setDescription] = React.useState(entry?.description ?? "");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setClientId(entry ? String(entry.clientId) : "");
      setDate(entry ? isoDate(new Date(entry.date)) : (defaultDate ?? isoDate(new Date())));
      setHours(entry ? String(entry.durationHours) : "1");
      setTaskType(entry ? (entry.taskType as TaskType) : "SAISIE");
      setDescription(entry?.description ?? "");
      setError(null);
    }
  }, [open, entry, defaultDate]);

  const isoDateTime = (d: string) => new Date(d).toISOString();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsedHours = parseFloat(hours);
    if (!clientId) { setError("Veuillez sélectionner un client."); return; }
    if (isNaN(parsedHours) || parsedHours < 0.25 || parsedHours > 24) {
      setError("La durée doit être entre 0,25 h et 24 h."); return;
    }
    try {
      if (entry) {
        await updateEntry.mutateAsync({
          id: entry.id,
          data: { clientId: Number(clientId), date: isoDateTime(date), durationHours: parsedHours, taskType, description: description || null },
        });
      } else {
        await createEntry.mutateAsync({
          data: { clientId: Number(clientId), date: isoDateTime(date), durationHours: parsedHours, taskType, description: description || null },
        });
      }
      queryClient.invalidateQueries({ queryKey: ["listTimesheetEntries"] });
      onClose();
    } catch {
      setError("Erreur lors de l'enregistrement. Veuillez réessayer.");
    }
  }

  const isPending = createEntry.isPending || updateEntry.isPending;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{entry ? "Modifier la saisie" : "Nouvelle saisie de temps"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1">
            <Label>Client</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger>
                <SelectValue placeholder="Sélectionner un client…" />
              </SelectTrigger>
              <SelectContent>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label>Durée (heures)</Label>
              <Input type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} required />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Type de tâche</Label>
            <Select value={taskType} onValueChange={(v) => setTaskType(v as TaskType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TASK_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    <span className="inline-block w-3 h-3 rounded-full mr-2" style={{ background: TASK_COLORS[t] }} />
                    {TASK_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Note (optionnel)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex: Saisie factures fournisseurs S1" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" type="button" onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Enregistrement…" : (entry ? "Enregistrer" : "Saisir")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: WeeklyTimesheetGrid
// ---------------------------------------------------------------------------

function WeeklyTimesheetGrid() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [weekStart, setWeekStart] = React.useState(() => startOfWeek(new Date()));
  const [formOpen, setFormOpen] = React.useState(false);
  const [formDefaultDate, setFormDefaultDate] = React.useState<string | undefined>();
  const [editingEntry, setEditingEntry] = React.useState<TimesheetEntry | undefined>();
  const deleteEntry = useDeleteTimesheetEntry();

  const weekEnd = addDays(weekStart, 6);

  const { data: entries = [], isLoading } = useListTimesheetEntries(
    {
      dateFrom: weekStart.toISOString(),
      dateTo: addDays(weekEnd, 1).toISOString(),
    },
    {
      query: {
        queryKey: ["listTimesheetEntries", "week", weekStart.toISOString()],
      },
    },
  );

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  const entriesByDay = new Map<string, TimesheetEntry[]>();
  for (const entry of entries) {
    const key = isoDate(new Date(entry.date));
    const arr = entriesByDay.get(key) ?? [];
    arr.push(entry);
    entriesByDay.set(key, arr);
  }

  const totalHours = entries.reduce((s, e) => s + e.durationHours, 0);

  async function handleDelete(id: number) {
    await deleteEntry.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: ["listTimesheetEntries"] });
  }

  function openNewEntry(date?: Date) {
    setEditingEntry(undefined);
    setFormDefaultDate(date ? isoDate(date) : undefined);
    setFormOpen(true);
  }

  function openEditEntry(entry: TimesheetEntry) {
    setEditingEntry(entry);
    setFormDefaultDate(undefined);
    setFormOpen(true);
  }

  const weekLabel = `${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]} — ${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;

  return (
    <div className="space-y-4">
      {/* Week navigator */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Semaine précédente
        </Button>
        <div className="text-center">
          <span className="font-semibold text-sm">{weekLabel}</span>
          <div className="text-xs text-muted-foreground mt-0.5">{totalHours.toFixed(2)} h saisies cette semaine</div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekStart(addDays(weekStart, 7))}>
            Semaine suivante <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
          <Button size="sm" onClick={() => openNewEntry()}>
            <Plus className="h-4 w-4 mr-1" /> Nouvelle saisie
          </Button>
        </div>
      </div>

      {/* Weekly grid */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Chargement…</div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {weekDays.map((day, idx) => {
            const key = isoDate(day);
            const dayEntries = entriesByDay.get(key) ?? [];
            const dayTotal = dayEntries.reduce((s, e) => s + e.durationHours, 0);
            const isToday = isoDate(new Date()) === key;
            const isWeekend = idx >= 5;

            return (
              <div
                key={key}
                className={cn(
                  "rounded-lg border p-3",
                  isToday && "border-primary/50 bg-primary/5",
                  isWeekend && !isToday && "bg-muted/30",
                )}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn("text-sm font-semibold", isToday && "text-primary")}>
                      {DAY_NAMES[idx]} {day.getDate()} {MONTH_NAMES[day.getMonth()]}
                    </span>
                    {isToday && <Badge variant="secondary" className="text-xs">Aujourd'hui</Badge>}
                  </div>
                  <div className="flex items-center gap-2">
                    {dayTotal > 0 && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {dayTotal.toFixed(2)} h
                      </span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => openNewEntry(day)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Ajouter
                    </Button>
                  </div>
                </div>

                {dayEntries.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic pl-1">Aucune saisie</p>
                ) : (
                  <div className="space-y-1.5">
                    {dayEntries.map((entry) => (
                      <div
                        key={entry.id}
                        className="flex items-center justify-between rounded-md bg-card border px-3 py-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="shrink-0 w-2.5 h-2.5 rounded-full"
                            style={{ background: TASK_COLORS[entry.taskType as TaskType] }}
                          />
                          <div className="min-w-0">
                            <div className="text-sm font-medium truncate">{entry.clientName}</div>
                            <div className="text-xs text-muted-foreground truncate">
                              {TASK_LABELS[entry.taskType as TaskType]}
                              {entry.description ? ` — ${entry.description}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-2">
                          <span className="text-sm font-semibold tabular-nums">{entry.durationHours} h</span>
                          {(user?.role === "expert_comptable" || entry.userId === user?.id) && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={() => openEditEntry(entry)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Supprimer cette saisie ?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      {entry.durationHours} h — {TASK_LABELS[entry.taskType as TaskType]} — {entry.clientName}
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Annuler</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDelete(entry.id)}>
                                      Supprimer
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <TimesheetEntryForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingEntry(undefined); }}
        defaultDate={formDefaultDate}
        entry={editingEntry}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: RatesSettingsDialog
// ---------------------------------------------------------------------------

function RatesSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: rates = [] } = useListUserRates();
  const upsertRate = useUpsertUserRate();
  const queryClient = useQueryClient();

  const [editing, setEditing] = React.useState<{ userId: number; fullName: string; cost: string; billing: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSave() {
    if (!editing) return;
    const cost = parseFloat(editing.cost);
    const billing = parseFloat(editing.billing);
    if (isNaN(cost) || cost < 0 || isNaN(billing) || billing < 0) {
      setError("Les tarifs doivent être des nombres positifs."); return;
    }
    setError(null);
    await upsertRate.mutateAsync({ userId: editing.userId, data: { hourlyCostRate: cost, billingHourlyRate: billing } });
    queryClient.invalidateQueries({ queryKey: ["listUserRates"] });
    setEditing(null);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Tarifs horaires des collaborateurs
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Collaborateur</TableHead>
                <TableHead className="text-right">Coût Interne (FCFA/h)</TableHead>
                <TableHead className="text-right">Tarif Facturable (FCFA/h)</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground text-sm py-6">
                    Aucun tarif configuré. Cliquez sur « Modifier » pour en ajouter.
                  </TableCell>
                </TableRow>
              )}
              {rates.map((rate) => (
                <TableRow key={rate.id}>
                  <TableCell className="font-medium">{rate.userFullName}</TableCell>
                  {editing?.userId === rate.userId ? (
                    <>
                      <TableCell>
                        <AmountInput
                          min="0"
                          className="h-8 text-right"
                          value={editing.cost}
                          onChange={(e) => setEditing({ ...editing, cost: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <AmountInput
                          min="0"
                          className="h-8 text-right"
                          value={editing.billing}
                          onChange={(e) => setEditing({ ...editing, billing: e.target.value })}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" onClick={handleSave} disabled={upsertRate.isPending}>Sauver</Button>
                          <Button size="sm" variant="outline" onClick={() => { setEditing(null); setError(null); }}>✕</Button>
                        </div>
                      </TableCell>
                    </>
                  ) : (
                    <>
                      <TableCell className="text-right tabular-nums">{rate.hourlyCostRate.toLocaleString("fr-FR")}</TableCell>
                      <TableCell className="text-right tabular-nums">{rate.billingHourlyRate.toLocaleString("fr-FR")}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditing({ userId: rate.userId, fullName: rate.userFullName, cost: String(rate.hourlyCostRate), billing: String(rate.billingHourlyRate) })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {error && <p className="text-sm text-destructive mt-2">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: ContractsSettingsDialog
// ---------------------------------------------------------------------------

function ContractsSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: contracts = [] } = useListClientContracts({});
  const { data: clients = [] } = useListClients();
  const createContract = useCreateClientContract();
  const deleteContract = useDeleteClientContract();
  const queryClient = useQueryClient();

  const [newClientId, setNewClientId] = React.useState("");
  const [newFee, setNewFee] = React.useState("");
  const [newStart, setNewStart] = React.useState(isoDate(new Date()));
  const [error, setError] = React.useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fee = parseFloat(newFee);
    if (!newClientId) { setError("Sélectionner un client."); return; }
    if (isNaN(fee) || fee < 0) { setError("Le montant du forfait doit être positif."); return; }
    await createContract.mutateAsync({
      data: { clientId: Number(newClientId), monthlyFlatFee: fee, startDate: new Date(newStart).toISOString() },
    });
    queryClient.invalidateQueries({ queryKey: ["listClientContracts"] });
    setNewClientId(""); setNewFee(""); setNewStart(isoDate(new Date()));
  }

  async function handleDelete(id: number) {
    await deleteContract.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: ["listClientContracts"] });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Forfaits Mensuels Clients
          </DialogTitle>
        </DialogHeader>
        <div className="mt-2 space-y-4">
          {/* Existing contracts */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead className="text-right">Forfait Mensuel</TableHead>
                <TableHead>Début</TableHead>
                <TableHead>Fin</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-4">Aucun forfait configuré.</TableCell>
                </TableRow>
              )}
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.clientName}</TableCell>
                  <TableCell className="text-right tabular-nums">{c.monthlyFlatFee.toLocaleString("fr-FR")} FCFA</TableCell>
                  <TableCell className="text-sm">{isoDate(new Date(c.startDate))}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.endDate ? isoDate(new Date(c.endDate)) : "En cours"}</TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Supprimer ce forfait ?</AlertDialogTitle>
                          <AlertDialogDescription>{c.clientName} — {c.monthlyFlatFee.toLocaleString("fr-FR")} FCFA/mois</AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Annuler</AlertDialogCancel>
                          <AlertDialogAction onClick={() => handleDelete(c.id)}>Supprimer</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Add new contract */}
          <form onSubmit={handleCreate} className="border rounded-lg p-4 space-y-3 bg-muted/30">
            <p className="text-sm font-semibold">Ajouter un forfait</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Client</Label>
                <Select value={newClientId} onValueChange={setNewClientId}>
                  <SelectTrigger className="h-8">
                    <SelectValue placeholder="Sélectionner…" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Forfait Mensuel (FCFA)</Label>
                <AmountInput className="h-8" min="0" value={newFee} onChange={(e) => setNewFee(e.target.value)} placeholder="150 000" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date de début</Label>
                <Input className="h-8" type="date" value={newStart} onChange={(e) => setNewStart(e.target.value)} />
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button size="sm" type="submit" disabled={createContract.isPending}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Enregistrer le forfait
            </Button>
          </form>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Fermer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sub-component: ProfitabilityDashboard
// ---------------------------------------------------------------------------

function ProfitabilityDashboard() {
  const now = new Date();
  const [year, setYear] = React.useState(now.getFullYear());
  const [month, setMonth] = React.useState(now.getMonth() + 1);
  const [ratesOpen, setRatesOpen] = React.useState(false);
  const [contractsOpen, setContractsOpen] = React.useState(false);
  const [exportingPdf, setExportingPdf] = React.useState(false);
  // Expense management dialog
  const [expenseDialog, setExpenseDialog] = React.useState<{ clientId: number; clientName: string } | null>(null);
  const [expenseForm, setExpenseForm] = React.useState({ label: "", amount: "", category: "AUTRE" as MissionExpense["category"] });
  const [expenseError, setExpenseError] = React.useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useGetProfitabilityReport(year, month, {
    query: { queryKey: ["getProfitabilityReport", year, month] },
  });

  // Expense queries/mutations (only when dialog is open)
  const { data: expenses = [], isLoading: expensesLoading } = useListMissionExpenses(
    { clientId: expenseDialog?.clientId ?? 0, year, month },
    { query: { enabled: !!expenseDialog, queryKey: getListMissionExpensesQueryKey({ clientId: expenseDialog?.clientId ?? 0, year, month }) } },
  );
  const createExpense = useCreateMissionExpense({
    mutation: {
      onSuccess: () => {
        setExpenseForm({ label: "", amount: "", category: "AUTRE" });
        setExpenseError(null);
        queryClient.invalidateQueries({ queryKey: getListMissionExpensesQueryKey({ clientId: expenseDialog?.clientId ?? 0, year, month }) });
      },
      onError: (e: unknown) => setExpenseError((e as { data?: { error?: string } }).data?.error ?? "Erreur"),
    },
  });
  const deleteExpense = useDeleteMissionExpense({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMissionExpensesQueryKey({ clientId: expenseDialog?.clientId ?? 0, year, month }) }),
    },
  });

  function prevMonth() {
    if (month === 1) { setMonth(12); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 12) { setMonth(1); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  }

  function handleExportCsv() {
    if (!data) return;
    const header = ["Client", "Forfait mensuel (FCFA)", "Heures", "Coût collaborateurs (FCFA)", "Marge nette (FCFA)", "Rentabilité (%)"];
    const rows = data.rows.map((r) => [r.clientName, r.monthlyFlatFee, r.totalHours.toFixed(1), r.internalCost, r.netMargin, r.marginPct?.toFixed(1) ?? ""]);
    const csv = [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Rentabilite_${MONTH_NAMES[month - 1]}_${year}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handleExportPdf() {
    setExportingPdf(true);
    try {
      const token = getToken();
      const resp = await fetch(`${getApiBase()}/api/cabinet-analytics/profitability/${year}/${month}/export-pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error("Erreur lors de la génération du PDF");
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rentabilite_${MONTH_NAMES[month - 1]}_${year}.pdf`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — the user sees no PDF
    } finally {
      setExportingPdf(false);
    }
  }

  const kpis = data?.globalKpis;

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={prevMonth}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold min-w-[160px] text-center">
            {MONTH_NAMES[month - 1]} {year}
          </span>
          <Button variant="outline" size="sm" onClick={nextMonth}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={!data || data.rows.length === 0}>
            <Download className="h-4 w-4 mr-1" /> CSV
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPdf} disabled={exportingPdf || !data || data.rows.length === 0}>
            {exportingPdf ? <span className="animate-spin mr-1">⟳</span> : <Download className="h-4 w-4 mr-1" />} PDF
          </Button>
          <Button variant="outline" size="sm" onClick={() => setRatesOpen(true)}>
            <Settings className="h-4 w-4 mr-1" /> Tarifs collaborateurs
          </Button>
          <Button variant="outline" size="sm" onClick={() => setContractsOpen(true)}>
            <Settings className="h-4 w-4 mr-1" /> Forfaits clients
          </Button>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-muted-foreground text-sm">Calcul en cours…</div>
      )}
      {error && (
        <div className="text-center py-12 text-destructive text-sm">Erreur lors du chargement du rapport.</div>
      )}

      {data && (
        <>
          {/* Global KPI cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Heures totales
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{(kpis?.totalHours ?? 0).toFixed(1)} h</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Coût Interne Total
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums text-amber-600">
                  {formatFCFA(kpis?.totalInternalCost ?? 0)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Honoraires Facturés
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold tabular-nums text-blue-600">
                  {formatFCFA(kpis?.totalFees ?? 0)}
                </div>
              </CardContent>
            </Card>
            <Card className={cn((kpis?.grossMargin ?? 0) < 0 && "border-red-300")}>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Marge Brute Cabinet
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className={cn(
                  "text-2xl font-bold tabular-nums flex items-center gap-2",
                  (kpis?.grossMargin ?? 0) >= 0 ? "text-emerald-600" : "text-red-600",
                )}>
                  {(kpis?.grossMargin ?? 0) >= 0
                    ? <TrendingUp className="h-5 w-5 shrink-0" />
                    : <TrendingDown className="h-5 w-5 shrink-0" />}
                  {formatFCFA(kpis?.grossMargin ?? 0)}
                </div>
                <div className="text-sm text-muted-foreground mt-1">
                  Marge : {formatPct(kpis?.grossMarginPct ?? null)}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Client profitability table */}
          {data.rows.length === 0 ? (
            <Card>
              <CardContent className="text-center py-12 text-muted-foreground text-sm">
                Aucune saisie de temps pour {MONTH_NAMES[month - 1]} {year}.
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Rentabilité par Client</CardTitle>
                <div className="flex items-center gap-4 text-xs text-muted-foreground mt-1">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded bg-red-500" />
                    Marge négative (Non rentable)
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-3 h-3 rounded bg-amber-400" />
                    Marge {"<"} 30 %
                  </span>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Client</TableHead>
                      <TableHead className="text-right">Forfait Mensuel</TableHead>
                      <TableHead className="text-right">Heures</TableHead>
                      <TableHead className="text-right">Coût Collaborateurs</TableHead>
                      <TableHead className="text-right">Marge Nette</TableHead>
                      <TableHead className="text-right">Rentabilité</TableHead>
                      <TableHead className="text-right">Débours</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map((row) => (
                      <TableRow
                        key={row.clientId}
                        className={cn(
                          row.isUnprofitable && "bg-red-50 dark:bg-red-950/20",
                          row.isLowMargin && !row.isUnprofitable && "bg-amber-50 dark:bg-amber-950/20",
                        )}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {row.isUnprofitable && (
                              <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
                            )}
                            {row.clientName}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {row.monthlyFlatFee > 0 ? formatFCFA(row.monthlyFlatFee) : <span className="text-muted-foreground text-xs">Non configuré</span>}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{row.totalHours.toFixed(1)} h</TableCell>
                        <TableCell className="text-right tabular-nums text-amber-700">{formatFCFA(row.internalCost)}</TableCell>
                        <TableCell className={cn(
                          "text-right tabular-nums font-semibold",
                          row.netMargin >= 0 ? "text-emerald-700" : "text-red-700",
                        )}>
                          {formatFCFA(row.netMargin)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.marginPct !== null ? (
                            <Badge
                              className={cn(
                                "tabular-nums",
                                row.isUnprofitable
                                  ? "bg-red-100 text-red-700 border-red-200"
                                  : row.isLowMargin
                                  ? "bg-amber-100 text-amber-700 border-amber-200"
                                  : "bg-emerald-100 text-emerald-700 border-emerald-200",
                              )}
                              variant="outline"
                            >
                              {row.marginPct.toFixed(1)} %
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
                            onClick={() => setExpenseDialog({ clientId: row.clientId, clientName: row.clientName })}
                          >
                            <Receipt className="h-3.5 w-3.5" />
                            Gérer
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Task breakdown pie chart */}
          {data.taskBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Répartition du Temps par Type de Tâche</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Distribution des heures saisies — aide à identifier les gains potentiels de l'automatisation (OCR, IA).
                </p>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <ResponsiveContainer width="100%" height={260}>
                    <PieChart>
                      <Pie
                        data={data.taskBreakdown}
                        dataKey="hours"
                        nameKey="taskType"
                        cx="50%"
                        cy="50%"
                        outerRadius={100}
                        label={({ taskType, pct }) => `${pct.toFixed(0)}%`}
                        labelLine={false}
                      >
                        {data.taskBreakdown.map((entry) => (
                          <Cell
                            key={entry.taskType}
                            fill={TASK_COLORS[entry.taskType as TaskType]}
                          />
                        ))}
                      </Pie>
                      <RechartsTooltip
                        formatter={(value: number, name: string) => [
                          `${value.toFixed(2)} h`,
                          TASK_LABELS[name as TaskType] ?? name,
                        ]}
                      />
                      <Legend
                        formatter={(value) => TASK_LABELS[value as TaskType] ?? value}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="shrink-0 space-y-2 min-w-[200px]">
                    {data.taskBreakdown.map((item) => (
                      <div key={item.taskType} className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ background: TASK_COLORS[item.taskType as TaskType] }}
                          />
                          <span className="text-sm">{TASK_LABELS[item.taskType as TaskType]}</span>
                        </div>
                        <div className="text-sm text-right tabular-nums text-muted-foreground">
                          {item.hours.toFixed(1)} h <span className="text-xs">({item.pct.toFixed(1)}%)</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <RatesSettingsDialog open={ratesOpen} onClose={() => setRatesOpen(false)} />
      <ContractsSettingsDialog open={contractsOpen} onClose={() => setContractsOpen(false)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Rentabilite() {
  const { user } = useAuth();

  // stagiaire has read-only access: no timesheet input
  const canInputTime = user?.role === "expert_comptable" || user?.role === "collaborateur";
  const canViewDashboard = user?.role === "expert_comptable";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Pilotage Interne & Rentabilité</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Suivi du temps collaborateurs, coûts internes et rentabilité par client.
        </p>
      </div>

      <Tabs defaultValue={canInputTime ? "timesheet" : "dashboard"}>
        <TabsList>
          {canInputTime && (
            <TabsTrigger value="timesheet">
              <Clock className="h-4 w-4 mr-2" />
              Feuille de Temps
            </TabsTrigger>
          )}
          {canViewDashboard && (
            <TabsTrigger value="dashboard">
              <TrendingUp className="h-4 w-4 mr-2" />
              Rentabilité Clients
            </TabsTrigger>
          )}
        </TabsList>

        {canInputTime && (
          <TabsContent value="timesheet" className="mt-6">
            <WeeklyTimesheetGrid />
          </TabsContent>
        )}
        {canViewDashboard && (
          <TabsContent value="dashboard" className="mt-6">
            <ProfitabilityDashboard />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
