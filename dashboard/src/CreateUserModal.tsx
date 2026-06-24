import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { RunAction } from "./App";
import type { Homeserver } from "./useDashboard";

function KeyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export function CreateUserModal({
  hs,
  maxUsers,
  busy,
  onClose,
  onAction,
}: {
  hs: Homeserver;
  maxUsers: number;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [withProfile, setWithProfile] = useState(true);
  const unlimited = maxUsers === 0;
  const atCapacity = !unlimited && hs.userCount >= maxUsers;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || atCapacity) return;

    onAction(async () => {
      const res = await api.addUser(hs.seed, withProfile);
      if (res.ok) onClose();
      return res;
    });
  };

  return (
    <div className="hs-action-modal-overlay" onClick={onClose}>
      <div
        className="hs-action-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-user-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hs-action-modal-head">
          <div>
            <h2 id="create-user-modal-title">Create user</h2>
            <p className="hs-action-modal-sub">
              on {hs.label} · seed {hs.seed}
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
          <div className="hs-modal-panel hs-create-user-panel">
            <p className="hs-create-user-copy muted">
              Signs up a new pubky key on this homeserver and publishes its pkarr
              record — useful for testing external apps against these keys.
            </p>

            <label className="hs-batch-row enabled hs-create-user-profile">
              <span className="hs-batch-row-check">
                <input
                  id="create-user-profile"
                  type="checkbox"
                  checked={withProfile}
                  disabled={busy || atCapacity}
                  onChange={(e) => setWithProfile(e.target.checked)}
                />
                <span className="hs-batch-row-label">With profile</span>
              </span>
              <span className="hs-create-user-profile-hint">
                Writes profile.json and avatar to the homeserver
              </span>
            </label>

            {atCapacity && (
              <p className="hs-create-user-warn">
                Homeserver is at capacity ({hs.userCount} / {maxUsers}). Stop
                the simulator or raise the limit before adding users.
              </p>
            )}
          </div>

          <div className="hs-action-modal-foot">
            <button type="button" className="action" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="action primary"
              disabled={busy || atCapacity}
            >
              <KeyIcon className="hs-create-user-submit-icon" />
              Create key
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function AddUserKeyButton({
  disabled,
  onClick,
}: {
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="hs-detail-meta-item hs-detail-add-key"
      disabled={disabled}
      onClick={onClick}
      title="Create a new user key"
    >
      <PlusIcon className="hs-link-icon" />
      key
    </button>
  );
}
