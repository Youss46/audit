import { Building2 } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export type StationOption = { id: number; name: string; city: string }

// Multi-station (P8): shared "Toutes les stations" dropdown used on screens
// that a cross-station caller (cabinet staff, PME owner) needs to scope to
// one physical station. A station-scoped user (pompiste, station manager)
// never sees this -- their JWT stationId already filters everything
// server-side, so callers should gate rendering with `shouldShow` below.
export function shouldShowStationSelector(
  userStationId: number | null | undefined,
  stationCount: number,
) {
  return !userStationId && stationCount > 1
}

export function StationSelector({
  stations,
  value,
  onChange,
  className,
}: {
  stations: StationOption[]
  value: number | "all"
  onChange: (value: number | "all") => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Building2 className="h-4 w-4 text-amber-600 shrink-0" />
      <Select
        value={value === "all" ? "all" : String(value)}
        onValueChange={(v) => onChange(v === "all" ? "all" : Number(v))}
      >
        <SelectTrigger className="w-full sm:w-64">
          <SelectValue placeholder="Toutes les stations" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les stations</SelectItem>
          {stations.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              {s.name} — {s.city}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
