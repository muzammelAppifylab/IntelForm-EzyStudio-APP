import * as React from "react"
import { cn } from "@/components/ui/cn"
import { FIELD, INPUT_EXTRA } from "@/components/ds/tokens"

/**
 * Shared field look (TextField spec): `field` background, 1px `input` outline (3:1),
 * 16px text so iOS never zooms, the 2px focus ring, `destructive` outline
 * when `aria-invalid`. Used by Input, Textarea and SelectTrigger. The fragments live in ds/tokens so
 * the public form (which joins classes without tailwind-merge) can build the same look.
 */
const fieldClasses = `${FIELD} rounded-md text-base md:text-body`

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClasses,
        "h-(--control-md) px-3 py-1",
        INPUT_EXTRA,
        className
      )}
      {...props}
    />
  )
}

export { Input, fieldClasses }
