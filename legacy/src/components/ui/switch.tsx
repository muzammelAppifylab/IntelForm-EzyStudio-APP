import * as React from "react"
import { cn } from "@/components/ui/cn"
import { Switch as SwitchPrimitive } from "radix-ui"

/** Pill track (`radius-full`): `input` when off (3:1), `border-ink` with a `primary` thumb when on; 200ms thumb slide. */
function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch focus-ring inline-flex shrink-0 items-center rounded-full p-0.5 transition-[background-color,scale] duration-(--duration-base) press ease-out disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-5 data-[size=default]:w-9 data-[size=sm]:h-4 data-[size=sm]:w-7 data-[state=checked]:bg-border-ink data-[state=unchecked]:bg-input",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full bg-field transition-transform duration-(--duration-base) ease-out group-data-[size=default]/switch:size-4 group-data-[size=sm]/switch:size-3 data-[state=checked]:bg-primary data-[state=unchecked]:translate-x-0 group-data-[size=default]/switch:data-[state=checked]:translate-x-4 group-data-[size=sm]/switch:data-[state=checked]:translate-x-3"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
