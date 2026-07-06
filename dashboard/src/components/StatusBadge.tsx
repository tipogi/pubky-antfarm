import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/StatusDot";

export function StatusBadge({
  status,
  pending,
  className,
}: {
  status: string;
  pending?: boolean;
  className?: string;
}) {
  const label = pending ? "creating…" : status;
  const variant =
    pending || status === "dormant"
      ? "dormant"
      : status === "active"
        ? "active"
        : "outline";

  return (
    <Badge variant={variant} className={className}>
      <StatusDot status={pending ? "pending" : status} />
      {label}
    </Badge>
  );
}
