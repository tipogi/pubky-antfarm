import { api, type ControlResponse } from "./api";
import type { Homeserver } from "./useDashboard";

function ProcessIcon({ down }: { down: boolean }) {
  if (down) {
    return (
      <svg viewBox="0 0 24 24" className="hs-process-pill-icon" aria-hidden="true">
        <rect x="7" y="7" width="10" height="10" rx="1.5" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="hs-process-pill-icon" aria-hidden="true">
      <path d="M12 3v5" />
      <path d="M7.05 7.05a7 7 0 1 0 9.9 0" />
    </svg>
  );
}

export function ProcessPill({
  hs,
  busy,
  onAction,
}: {
  hs: Homeserver;
  busy: boolean;
  onAction: (fn: () => Promise<ControlResponse>) => void;
}) {
  if (hs.seed === 0) return null;

  const down = hs.down;
  const toggle = () => {
    onAction(() => (down ? api.upHomeserver(hs.seed) : api.downHomeserver(hs.seed)));
  };

  return (
    <button
      type="button"
      className={`hs-card-pill hs-process-pill ${down ? "process-off" : "process-on"}`}
      disabled={busy}
      aria-pressed={down}
      onClick={toggle}
      title={
        down
          ? "Process stopped — click to bring back up (same key + DB)"
          : "HTTP process running — click to stop (connection refused)"
      }
    >
      <ProcessIcon down={down} />
      {down ? "Down" : "Running"}
    </button>
  );
}
