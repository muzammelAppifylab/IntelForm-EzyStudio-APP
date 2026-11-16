import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/ui/cn"
import { Slot } from "radix-ui"

/**
 * Pill, 24px tall, `caption` weight 500. Status colours use `pine` and the *-subtle pairs; for
 * form and response states prefer `StatusBadge` from components/ds, which also names the state.
 */
const badgeVariants = cva(
  "focus-ring inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-md border border-transparent px-2 text-caption font-medium whitespace-nowrap transition-[color,background-color] duration-(--duration-fast) ease-out [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-ink-950/15 bg-primary text-primary-foreground [a&]:hover:bg-primary-hover",
        secondary:
          "border-border bg-secondary text-secondary-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90",
        outline:
          "border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        ghost: "[a&]:hover:bg-accent [a&]:hover:text-accent-foreground",
        link: "text-link underline-offset-4 [a&]:hover:underline",
        muted: "bg-muted text-muted-foreground",
        success: "bg-success-subtle text-success-subtle-foreground",
        pine: "bg-pine text-pine-foreground",
        warning: "bg-warning-subtle text-warning-subtle-foreground",
        info: "bg-info-subtle text-info-subtle-foreground",
        danger: "bg-danger-subtle text-danger-subtle-foreground",
        highlight: "bg-highlight text-highlight-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
