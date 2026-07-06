import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground shadow",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground border-border",
        active:
          "border-[color-mix(in_srgb,var(--status-online)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-online)_16%,transparent)] text-[var(--status-online)]",
        dormant:
          "border-border bg-secondary/50 text-muted-foreground",
        island:
          "border-[color-mix(in_srgb,var(--priv)_35%,transparent)] bg-[color-mix(in_srgb,var(--priv)_15%,transparent)] text-[var(--priv)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn("shadcn-ui", badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
