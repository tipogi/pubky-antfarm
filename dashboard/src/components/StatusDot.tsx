import { cn } from "@/lib/utils";

export function StatusDot({
  status,
  className,
}: {
  status: "active" | "dormant" | "pending" | string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        status === "active" && "bg-[var(--status-online)]",
        status === "dormant" && "bg-muted-foreground",
        status === "pending" && "bg-muted-foreground",
        className
      )}
      aria-hidden
    />
  );
}
