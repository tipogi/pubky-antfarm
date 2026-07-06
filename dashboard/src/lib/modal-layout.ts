import { cn } from "./utils";

/** Compact action modal shell (420px forms). */
export const modalContentSm = (...extra: (string | undefined)[]) =>
  cn(
    "flex flex-col gap-2 px-6 pb-4 pt-5 sm:max-w-[420px]",
    ...extra
  );

/** Wide content modal shell (tables, details). */
export const modalContentWide = (...extra: (string | undefined)[]) =>
  cn("flex flex-col gap-0 overflow-hidden p-0", ...extra);

export const modalHeader = (...extra: (string | undefined)[]) =>
  cn("space-y-0.5 pb-2", ...extra);

export const modalHeaderWide = (...extra: (string | undefined)[]) =>
  cn("space-y-1 border-b border-white/12 px-6 pb-3 pt-5", ...extra);

export const modalForm = (...extra: (string | undefined)[]) =>
  cn("flex flex-col gap-2", ...extra);

export const modalField = (...extra: (string | undefined)[]) =>
  cn("flex flex-col gap-1", ...extra);

export const modalFooter = (...extra: (string | undefined)[]) =>
  cn("gap-2 pt-0 sm:space-x-2", ...extra);

export const modalFooterWide = (...extra: (string | undefined)[]) =>
  cn("border-t border-white/12 px-6 py-3", ...extra);

export const modalLabel = (...extra: (string | undefined)[]) =>
  cn("text-xs font-medium text-muted-foreground", ...extra);

export const modalInput = (...extra: (string | undefined)[]) =>
  cn("h-9 text-[13px]", ...extra);

export const modalHint = (...extra: (string | undefined)[]) =>
  cn("text-xs leading-snug text-muted-foreground", ...extra);

export const modalBody = (...extra: (string | undefined)[]) =>
  cn("flex flex-col gap-3 px-6 py-3", ...extra);

/** Radio row with title + optional description (Create homeserver, etc.). */
export const modalRadioOption = (selected: boolean) =>
  cn(
    "flex cursor-pointer items-start gap-2 rounded-[10px] border border-transparent px-2.5 py-2 transition-colors hover:bg-white/[0.04]",
    selected && "bg-white/[0.06]"
  );

/** Single-line radio row (Create post, etc.). */
export const modalRadioOptionCompact = (selected: boolean) =>
  cn(
    "flex cursor-pointer items-center gap-2 rounded-[10px] border border-transparent px-2.5 py-1.5 transition-colors hover:bg-white/[0.04]",
    selected && "bg-white/[0.06]"
  );

export const modalCheckboxRow = (...extra: (string | undefined)[]) =>
  cn(
    "flex flex-col gap-1.5 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-3",
    ...extra
  );

export const modalHelpText = (...extra: (string | undefined)[]) =>
  cn("text-[13px] leading-snug text-muted-foreground", ...extra);
