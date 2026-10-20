import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "@/lib/theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolved } = useTheme()

  return (
    <Sonner
      theme={resolved}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-pine" aria-hidden />,
        info: <InfoIcon className="size-4 text-info-subtle-foreground" aria-hidden />,
        warning: <TriangleAlertIcon className="size-4 text-warning-subtle-foreground" aria-hidden />,
        error: <OctagonXIcon className="size-4 text-destructive" aria-hidden />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" aria-hidden />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
          "--width": "22rem",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "font-sans! text-body-sm! shadow-pop! gap-2.5!",
          title: "text-label!",
          description: "text-body-sm! text-muted-foreground!",
          actionButton: "rounded-md! border-2! border-primary-border! bg-primary! text-primary-foreground! text-label!",
          cancelButton: "rounded-md! bg-secondary! text-secondary-foreground! text-label!",
          closeButton: "border-border! bg-popover! text-muted-foreground!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
