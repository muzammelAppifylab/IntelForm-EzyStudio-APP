import * as React from "react"
import { cn } from "@/components/ui/cn"
import { CheckIcon, MinusIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

/**
 * 16px box, `radius-sm`, `input` outline (3:1); checked and indeterminate fill with `primary` inside a `border-ink` edge.
 * The outline darkens on hover and the mark pops in over 200ms.
 */
function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer focus-ring grid size-4 shrink-0 place-content-center rounded-sm border border-input bg-field text-primary-foreground transition-[background-color,border-color,scale] duration-(--duration-fast) ease-out press data-[state=unchecked]:hover:border-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-border-ink data-[state=checked]:bg-primary data-[state=indeterminate]:border-border-ink data-[state=indeterminate]:bg-primary",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="group/indicator grid animate-pop-in place-content-center text-current"
      >
        <CheckIcon className="size-3.5 group-data-[state=indeterminate]/indicator:hidden" strokeWidth={3} aria-hidden />
        <MinusIcon className="hidden size-3.5 group-data-[state=indeterminate]/indicator:block" strokeWidth={3} aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
