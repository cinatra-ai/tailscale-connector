import * as React from "react"

import { cn } from "../../lib/utils"

/**
 * Inline external-link primitive. Lives under components/ui (the vendored
 * shadcn-primitives carve-out) so the raw <a> it renders is the single
 * sanctioned anchor in the design system — call sites use <ExternalLink>
 * instead of a raw <a> (ui-design-system Block B). It flows inline inside
 * prose (FieldDescription / AlertDescription), unlike <Button asChild>,
 * and defaults target/rel for safe external navigation.
 */
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
