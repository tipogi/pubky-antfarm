import { api, type ControlResponse } from "./api";
import type { Homeserver } from "./useDashboard";

function IslandIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-island-pill-icon" aria-hidden="true">
      <path d="M12 3c2.5 2 3.5 4.5 3.5 7" />
      <path d="M12 3c-1.2 1-2 2.3-2.4 3.7" />
      <path d="M4 20c2-1.4 3.5-1.4 5.5 0 2-1.4 4-1.4 6 0 1.2-.8 2.3-1 3.5-.7" />
      <path d="M7 20c0-3.5 2.2-6.3 5-6.3s5 2.8 5 6.3" />
    </svg>
  );
}

export function IslandPill({
  hs,
  busy,
  onAction,
}: {
  hs: Homeserver;
  busy: boolean;
  onAction: (fn: () => Promise<ControlResponse>) => void;
}) {
  const island = hs.island;
  const toggle = () => {
    onAction(() => api.setIsland(hs.seed, !island));
  };

  return (
    <button
      type="button"
      className={`hs-card-pill hs-island-pill ${island ? "island-on" : "island-off"}`}
      disabled={busy}
      aria-pressed={island}
      onClick={toggle}
      title={
        island
          ? "Island on — others can't follow or tag this homeserver's users. Click to open."
          : "Island off — this homeserver's users can be referenced. Click to isolate."
      }
    >
      <IslandIcon />
      {island ? "Island" : "Open"}
    </button>
  );
}
