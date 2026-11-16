import * as React from "react"
import { cn } from "@/components/ui/cn"
import { Slider as SliderPrimitive } from "radix-ui"

/**
 * Range input: 6px `progress-track` rail (`radius-full`), `border-ink` fill, and a 20px `primary`
 * thumb with the 2px ink edge (the selected-state pairing). The thumb grows on hover and sinks while
 * dragged. `aria-label` / `aria-labelledby` go to every thumb, which is the focusable element.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root>) {
  const thumbs = React.useMemo(
    () => (Array.isArray(value) ? value : Array.isArray(defaultValue) ? defaultValue : [min]),
    [value, defaultValue, min]
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        "relative flex w-full touch-none items-center select-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className="relative grow cursor-pointer overflow-hidden rounded-full bg-progress-track data-[orientation=horizontal]:h-1.5 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-1.5"
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute bg-border-ink data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full"
        />
      </SliderPrimitive.Track>
      {thumbs.map((_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          className="focus-ring block size-5 shrink-0 cursor-grab rounded-full border-2 border-border-ink bg-primary transition-[background-color,scale] duration-(--duration-fast) ease-out hover:scale-110 hover:bg-primary-hover active:cursor-grabbing active:scale-95 data-[disabled]:pointer-events-none"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
