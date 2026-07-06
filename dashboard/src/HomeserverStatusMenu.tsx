import { useEffect, useRef, useState } from "react";
import { api, type ControlResponse } from "./api";
import type { Homeserver, HomeserverStatus } from "./useDashboard";

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-status-menu-chevron" aria-hidden="true">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-status-menu-choice-arrow" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function StatusPill({ status }: { status: HomeserverStatus }) {
  return (
    <>
      <span className={`hs-card-pill-dot ${status}`} aria-hidden />
      {status}
    </>
  );
}

const choiceCopy: Record<
  HomeserverStatus,
  { title: string; hint: string }
> = {
  active: { title: "Active", hint: "Bring hub online" },
  dormant: { title: "Dormant", hint: "Pause hub traffic" },
};

export function HomeserverStatusMenu({
  hs,
  busy,
  onAction,
}: {
  hs: Homeserver;
  busy: boolean;
  onAction: (fn: () => Promise<ControlResponse>) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = hs.status === "active";
  const other: HomeserverStatus = active ? "dormant" : "active";
  const copy = choiceCopy[other];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [hs.status]);

  const transition = () => {
    setOpen(false);
    onAction(() =>
      active ? api.stopHomeserver(hs.seed) : api.seedHomeserver(hs.seed)
    );
  };

  return (
    <div className={`hs-status-menu${open ? " open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className={`hs-card-pill ${hs.status} hs-status-menu-trigger`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <StatusPill status={hs.status} />
        <ChevronDownIcon />
      </button>

      {open && (
        <div className="hs-status-menu-flyout" role="listbox" aria-label="Homeserver status">
          <span className="hs-status-menu-kicker">Switch to</span>
          <button
            type="button"
            role="option"
            className={`hs-status-menu-choice ${other}`}
            onClick={() => transition()}
          >
            <span className={`hs-status-menu-choice-dot ${other}`} aria-hidden />
            <span className="hs-status-menu-choice-copy">
              <span className="hs-status-menu-choice-title">{copy.title}</span>
              <span className="hs-status-menu-choice-hint">{copy.hint}</span>
            </span>
            <ArrowRightIcon />
          </button>
        </div>
      )}
    </div>
  );
}
