import * as React from "react"
import { cn } from "@/lib/utils"

export interface AmountInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  value?: string | number
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/** Format a raw digit string to locale-formatted string (fr-FR spaces as thousands separator). */
function formatRaw(raw: string): string {
  if (!raw) return ""
  const n = parseInt(raw, 10)
  if (isNaN(n)) return ""
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n)
}

/** Strip everything that isn't a digit. */
function toRaw(val: string | number | undefined | null): string {
  if (val === undefined || val === null || val === "" || val === 0) return ""
  return String(val).replace(/\D/g, "")
}

/**
 * A drop-in replacement for `<Input type="number">` on monetary (FCFA) fields.
 * - Displays the value with automatic thousands-separator (e.g. "1 500 000")
 * - Fires `onChange` with `e.target.value` set to the raw digit string ("1500000")
 *   so existing handlers work without modification.
 * - Uses `inputMode="numeric"` for the correct mobile keyboard.
 */
const AmountInput = React.forwardRef<HTMLInputElement, AmountInputProps>(
  ({ className, value, onChange, placeholder, ...props }, ref) => {
    const [display, setDisplay] = React.useState(() => formatRaw(toRaw(value)))

    // Sync display when value is changed externally (e.g. form reset, pre-fill)
    const prevRef = React.useRef<string | number | undefined | null>(value)
    React.useEffect(() => {
      if (prevRef.current !== value) {
        prevRef.current = value
        setDisplay(formatRaw(toRaw(value)))
      }
    })

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const raw = e.target.value.replace(/\s/g, "").replace(/\D/g, "")
      setDisplay(formatRaw(raw))
      if (onChange) {
        // Emit a synthetic event carrying the raw digit string so callers receive
        // a plain number-string ("150000") rather than the formatted display value.
        // Use a plain object for target to avoid "Illegal invocation" from native
        // HTMLInputElement prototype setters.
        const syntheticEvent = {
          ...e,
          target: { value: raw },
        } as unknown as React.ChangeEvent<HTMLInputElement>
        onChange(syntheticEvent)
      }
    }

    return (
      <input
        type="text"
        inputMode="numeric"
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        value={display}
        onChange={handleChange}
        placeholder={placeholder}
        {...props}
      />
    )
  }
)
AmountInput.displayName = "AmountInput"

export { AmountInput }
