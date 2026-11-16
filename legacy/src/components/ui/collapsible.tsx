import * as React from "react"
import { ChevronRightIcon } from "lucide-react"
import { cn } from "@/components/ui/cn"
import { Collapsible as CollapsiblePrimitive } from "radix-ui"

function Collapsible({ ...props }: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />
}

/**
 * The toggle. Put a `CollapsibleChevron` inside it to show the state: it turns a quarter while open.
 */
function CollapsibleTrigger({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      className={cn("group/collapsible focus-ring cursor-pointer", className)}
      {...props}
    />
  )
}

function CollapsibleChevron({ className, ...props }: React.ComponentProps<typeof ChevronRightIcon>) {
  return (
    <ChevronRightIcon
      data-slot="collapsible-chevron"
      aria-hidden
      className={cn(
        "size-4 shrink-0 transition-transform duration-(--duration-base) ease-out group-data-[state=open]/collapsible:rotate-90",
        className
      )}
      {...props}
    />
  )
}

/** Opens and closes by animating its height over 200ms ease-out (instant under reduced motion). */
function CollapsibleContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  return (
    <CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden ease-out data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down",
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleChevron, CollapsibleContent }
