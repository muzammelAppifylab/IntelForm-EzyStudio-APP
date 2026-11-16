import { Loader2Icon } from "lucide-react"
import { cn } from "@/components/ui/cn"

/**
 * Busy indicator, 16px by default (icon-sized inside a Button), coloured by the surrounding text. Decorative unless `label` is
 * set (then it is a `status` with that name): inside a button the button's own text ("Saving…")
 * says what is happening. Under reduced motion it stops turning and stays as a static icon.
 */
function Spinner({
  className,
  label,
  ...props
}: Omit<React.ComponentProps<typeof Loader2Icon>, "size"> & { label?: string }) {
  return (
    <Loader2Icon
      data-slot="spinner"
      {...(label ? { role: "status", "aria-label": label } : { "aria-hidden": true })}
      // 16px through the size attributes rather than a class, so a Button's own icon sizing still applies.
      size={16}
      className={cn("shrink-0 animate-spin motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Spinner }
