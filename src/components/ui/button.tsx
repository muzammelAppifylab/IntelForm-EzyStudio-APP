import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/ui/cn"
import { Slot } from "radix-ui"

/**
 * IntelForm Button spec (v2.1): one primary per view; primary and secondary carry the 2px ink edge
 * (`border-primary-border`); Figtree 500 14px (`text-label`); sizes sm 32px, default 40px (dashboard),
 * lg 48px (respondent forms); radius-md (12px); label never wraps; focus is the 2px ring + 2px offset.
 * Hover steps the fill over 120ms; `press` sinks it to 97% while held.
 */
const buttonVariants = cva(
  "focus-ring press inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md text-label whitespace-nowrap transition-[color,background-color,border-color,opacity,scale] duration-(--duration-fast) ease-out disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-2 border-primary-border bg-primary text-primary-foreground hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border-2 border-primary-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        secondary: "border-2 border-primary-border bg-secondary text-secondary-foreground hover:bg-accent hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-link underline underline-offset-4 hover:decoration-2",
      },
      size: {
        default: "h-(--control-md) px-4 has-[>svg]:px-3",
        xs: "h-6 gap-1 px-2 text-caption font-medium has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-(--control-sm) gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-(--control-lg) px-6 text-answer font-medium has-[>svg]:px-4",
        icon: "size-(--control-md)",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-(--control-sm)",
        "icon-lg": "size-(--control-lg)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
