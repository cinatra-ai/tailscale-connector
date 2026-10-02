import * as React from "react"

import { cn } from "../lib/utils"

// Package-owned external link; keeps its existing attributes and classes.

function ExternalLink({
  className,
  target = "_blank",
  rel = "noopener noreferrer",
  ...props
}: React.ComponentProps<"a">) {
  return (
    <a
      data-slot="external-link"
      target={target}
      rel={rel}
      className={cn(
        "underline underline-offset-4 hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { ExternalLink }
