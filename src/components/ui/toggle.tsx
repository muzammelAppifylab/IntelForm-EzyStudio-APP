
import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/components/ui/cn"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "focus-ring press inline-flex cursor-pointer items-center justify-center gap-2 rounded-md text-label whitespace-nowrap text-muted-foreground transition-[color,background-color,border-color,scale] duration-(--duration-fast) ease-out hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive border-2 border-transparent data-[state=on]:border-border-ink data-[state=on]:bg-primary data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border-primary-border bg-secondary",
      },
      size: {
        default: "h-(--control-md) min-w-(--control-md) px-2.5",
        sm: "h-(--control-sm) min-w-(--control-sm) px-2",
        lg: "h-(--control-lg) min-w-(--control-lg) px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
