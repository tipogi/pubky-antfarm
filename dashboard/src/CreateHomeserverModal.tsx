import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";

type HomeserverStart = "dormant" | "active";

export function AddHomeserverTile({
  nextIndex,
  busy,
  onClick,
}: {
  nextIndex: number;
  busy: boolean;
  onClick: () => void;
}) {
  const { color, keyColor } = hubColorFor(nextIndex);

  return (
    <button
      type="button"
      className="hs-card hs-card-add"
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
      disabled={busy}
      onClick={onClick}
      aria-label={`Deploy homeserver hs${nextIndex + 1}`}
    >
      <header className="hs-card-head">
        <span className="hs-card-avatar" aria-hidden>
          <svg viewBox={ROOT_VIEWBOX} className="hs-card-avatar-icon">
            <RootPaths />
          </svg>
        </span>
        <div className="hs-card-title">
          <div className="hs-card-title-row">
            <h2>Deploy node</h2>
            <span className="hs-card-pill hs-card-add-pill">new</span>
          </div>
          <span className="hs-card-seed">
            hs{nextIndex + 1} · seed {nextIndex}
          </span>
        </div>
      </header>

      <div className="hs-card-add-body">
        <p className="hs-card-add-copy">
          Spin up another homeserver — choose dormant or active in the
          configurator
        </p>
      </div>

      <div className="hs-card-divider" role="separator" />

      <div className="hs-card-row hs-card-add-foot">
        <span className="hs-card-add-cta">
          Configure &amp; deploy
          <svg viewBox="0 0 24 24" className="hs-card-add-arrow" aria-hidden>
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </span>
      </div>
    </button>
  );
}

export function CreateHomeserverModal({
  nextIndex,
  busy,
  onClose,
  onCreate,
}: {
  nextIndex: number;
  busy: boolean;
  onClose: () => void;
  onCreate: (index: number, island: boolean, activate: boolean) => void;
}) {
  const [seed, setSeed] = useState(String(nextIndex));
  const [start, setStart] = useState<HomeserverStart>("dormant");
  const [island, setIsland] = useState(false);
  const seedRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSeed(String(nextIndex));
  }, [nextIndex]);

  useEffect(() => {
    seedRef.current?.focus();
  }, []);

  const seedNum = Number(seed);
  const seedValid = Number.isInteger(seedNum) && seedNum >= 1 && seedNum <= 23;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !seedValid) return;

    // Close immediately; an optimistic node appears and the result arrives as a
    // toast notification.
    onClose();
    onCreate(seedNum, island, start === "active");
  };

  return (
    <div className="hs-action-modal-overlay" onClick={onClose}>
      <div
        className="hs-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-hs-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hs-action-modal-head">
          <div>
            <h2 id="create-hs-modal-title">Create homeserver</h2>
            <p className="hs-action-modal-sub">
              Adds hs{seedValid ? seedNum + 1 : "?"} to the testnet
            </p>
          </div>
          <button
            type="button"
            className="close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <form className="hs-action-modal-form" onSubmit={submit}>
          <div className="hs-modal-panel">
            <label className="hs-action-modal-field">
              <span className="hs-action-modal-label">Seed index</span>
              <input
                ref={seedRef}
                type="number"
                className="hs-action-modal-input"
                min={1}
                max={23}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                disabled={busy}
                aria-describedby="create-hs-seed-hint"
              />
              <span id="create-hs-seed-hint" className="hs-action-modal-help">
                Index 1–23 · seed 0 is reserved for hs1
              </span>
            </label>
          </div>

          <fieldset className="hs-action-modal-field hs-radio-group hs-modal-panel">
            <legend className="hs-action-modal-label">Simulator status</legend>
            <label className="hs-radio-option">
              <input
                type="radio"
                name="hs-start"
                value="dormant"
                checked={start === "dormant"}
                onChange={() => setStart("dormant")}
                disabled={busy}
              />
              <span className="hs-radio-text">
                <strong>Dormant</strong>
                <span className="hs-radio-desc">
                  Reachable via DHT, no simulated activity
                </span>
              </span>
            </label>
            <label className="hs-radio-option">
              <input
                type="radio"
                name="hs-start"
                value="active"
                checked={start === "active"}
                onChange={() => setStart("active")}
                disabled={busy}
              />
              <span className="hs-radio-text">
                <strong>Active</strong>
                <span className="hs-radio-desc">
                  Join the simulator rotation immediately
                </span>
              </span>
            </label>
          </fieldset>

          <label className="hs-batch-row hs-create-user-profile hs-island-option enabled">
            <span className="hs-batch-row-check">
              <input
                type="checkbox"
                checked={island}
                disabled={busy}
                onChange={(e) => setIsland(e.target.checked)}
              />
              <span className="hs-batch-row-label">Island (isolated)</span>
            </span>
            <span className="hs-create-user-profile-hint">
              Other users can't follow or tag this homeserver's users
            </span>
          </label>

          <div className="hs-action-modal-foot">
            <button
              type="button"
              className="action"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="action primary"
              disabled={busy || !seedValid}
            >
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
