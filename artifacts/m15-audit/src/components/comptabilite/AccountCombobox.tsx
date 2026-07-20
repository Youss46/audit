/**
 * AccountCombobox — Sélecteur de compte SYSCOHADA avec recherche en direct.
 *
 * Remplace le champ texte libre dans la grille d'édition des écritures du
 * Cabinet (comptabilite-cabinet.tsx). Propose une autocomplétion sur le Plan
 * Comptable Général SYSCOHADA via GET /accounts?search=...
 *
 * Props :
 *   value       — numéro de compte courant (ex. "622")
 *   onChange    — callback appelé avec le nouveau numéro de compte
 *   disabled    — désactive le sélecteur
 *   className   — classes Tailwind supplémentaires sur le trigger
 */

import * as React from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useListAccounts, type PlanComptableAccount } from "@workspace/api-client-react";

interface AccountComboboxProps {
  value: string;
  onChange: (accountNumber: string) => void;
  disabled?: boolean;
  className?: string;
}

export function AccountCombobox({
  value,
  onChange,
  disabled = false,
  className,
}: AccountComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  // Debounce 250 ms pour limiter les appels API pendant la frappe.
  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: accounts = [], isLoading } = useListAccounts(
    debouncedSearch ? { search: debouncedSearch } : undefined,
    { query: { enabled: open } },
  );

  // Libellé affiché sur le bouton trigger (numéro + nom si connu).
  const triggerLabel = React.useMemo(() => {
    if (!value) return "Sélectionner…";
    const found = (accounts as PlanComptableAccount[]).find((a) => a.accountNumber === value);
    if (found) return `${found.accountNumber} — ${found.name}`;
    return value;
  }, [value, accounts]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-7 min-w-[13rem] max-w-[22rem] justify-between font-mono text-xs px-2",
            className,
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-[26rem] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Rechercher un compte (numéro ou libellé)…"
            value={search}
            onValueChange={setSearch}
            className="text-xs"
          />
          <CommandList>
            {isLoading ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Chargement…
              </div>
            ) : accounts.length === 0 ? (
              <CommandEmpty className="text-xs py-4">
                {debouncedSearch
                  ? "Aucun compte trouvé pour cette recherche."
                  : "Tapez un numéro ou un libellé pour rechercher."}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {(accounts as PlanComptableAccount[]).map((account) => (
                  <CommandItem
                    key={account.accountNumber}
                    value={account.accountNumber}
                    onSelect={(selected) => {
                      onChange(selected);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="text-xs cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5 shrink-0",
                        value === account.accountNumber ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <span className="font-mono mr-2 text-muted-foreground w-16 shrink-0">
                      {account.accountNumber}
                    </span>
                    <span className="truncate">{account.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
