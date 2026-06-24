import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { api, type UserStorageStats } from "./api";
import type { RunAction } from "./App";
import { BatchEventsModal } from "./BatchEventsModal";
import { PkarrRecordModal } from "./PkarrRecordModal";
import { PkarrRecordIcon } from "./PkarrRecordIcon";
import { loadProfile, loadAvatar, type UserStorageContext } from "./pubky";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";
import type { Homeserver } from "./useDashboard";

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function userHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Bare z32 pubky public key — not a URI. */
function isValidPubkyKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.includes("://") || key.includes("/")) return false;
  return /^[a-z0-9]{40,64}$/.test(key);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function KeyGlyph() {
  return (
    <svg viewBox="0 0 24 24" className="hs-users-id-key-icon" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function usageRatio(used: number, quotaMb: number | null | undefined): number {
  if (quotaMb == null || quotaMb === 0) return 0;
  return Math.min(1, used / (quotaMb * 1024 * 1024));
}

type QuotaRisk = "low" | "medium" | "high";

function quotaRisk(used: number, quotaMb: number | null | undefined): QuotaRisk {
  const ratio = usageRatio(used, quotaMb);
  if (quotaMb == null || quotaMb === 0) return "low";
  if (ratio >= 0.85) return "high";
  if (ratio >= 0.55) return "medium";
  return "low";
}

function UserAvatar({
  publicKey,
  avatar,
  name,
}: {
  publicKey: string;
  avatar?: string | null;
  name: string;
}) {
  return (
    <span
      className={`hs-users-avatar${avatar ? " has-avatar" : ""}`}
      style={{ "--chip-hue": userHue(publicKey) } as CSSProperties}
      aria-hidden
      title={name}
    >
      {avatar ? (
        <img className="hs-users-avatar-img" src={avatar} alt="" loading="lazy" />
      ) : (
        <svg viewBox={ROOT_VIEWBOX} className="hs-users-avatar-icon">
          <RootPaths />
        </svg>
      )}
    </span>
  );
}

function StorageCell({
  used,
  quotaMb,
  loading,
}: {
  used: number;
  quotaMb: number | null | undefined;
  loading: boolean;
}) {
  if (loading) {
    return <span className="hs-users-muted">…</span>;
  }

  const unlimited = quotaMb == null || quotaMb === 0;
  const ratio = usageRatio(used, quotaMb);
  const pct = Math.round(ratio * 100);
  const risk = quotaRisk(used, quotaMb);

  return (
    <div className="hs-store">
      <div className="hs-store-head">
        <span className="hs-store-used">{formatBytes(used)}</span>
        <span className="hs-store-limit">
          {unlimited ? "unlimited" : `/ ${quotaMb} MB`}
        </span>
        {!unlimited && <span className={`hs-store-pct ${risk}`}>{pct}%</span>}
      </div>
      <div
        className={`hs-store-track ${unlimited ? "unlimited" : risk}`}
        role="meter"
        aria-valuenow={unlimited ? undefined : pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {unlimited ? (
          <span className="hs-store-flow" aria-hidden />
        ) : (
          <span
            className="hs-store-fill"
            style={{ width: `${Math.max(used > 0 ? 4 : 0, Math.min(100, ratio * 100))}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

interface RowState {
  storage?: UserStorageStats;
  displayName?: string;
  avatar?: string | null;
}

type ActionKind = "follow" | "tag" | "batch";

type FollowTagModal = {
  kind: "follow" | "tag";
  userIndex: number;
  displayName: string;
};

interface ActionModalState {
  kind: ActionKind;
  userIndex: number;
  displayName: string;
}

function FollowActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M19 8v6M16 11h6" />
    </svg>
  );
}

function TagActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7.5" cy="7.5" r="1.25" fill="currentColor" stroke="none" />
    </svg>
  );
}

function SpamActionIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-user-action-icon" aria-hidden="true">
      <circle cx="5" cy="12" r="1.75" fill="currentColor" stroke="none" />
      <path d="M9 8.5a5.5 5.5 0 0 1 0 7" />
      <path d="M12 6a9 9 0 0 1 0 12" />
      <path d="M15 3.5a12.5 12.5 0 0 1 0 17" />
    </svg>
  );
}

function PkarrActionIcon() {
  return <PkarrRecordIcon className="hs-user-action-icon" />;
}

function UserActionButtons({
  disabled,
  onFollow,
  onTag,
  onBatch,
  onPkarr,
}: {
  disabled: boolean;
  onFollow: () => void;
  onTag: () => void;
  onBatch: () => void;
  onPkarr: () => void;
}) {
  return (
    <div className="hs-user-action-btns" role="group" aria-label="User actions">
      <button
        type="button"
        className="hs-user-action-trigger"
        disabled={disabled}
        onClick={onFollow}
        title="Follow another user"
      >
        <span className="hs-user-action-glyph">
          <FollowActionIcon />
        </span>
        <span className="hs-user-action-label">Follow</span>
      </button>
      <button
        type="button"
        className="hs-user-action-trigger"
        disabled={disabled}
        onClick={onTag}
        title="Tag a user or post"
      >
        <span className="hs-user-action-glyph">
          <TagActionIcon />
        </span>
        <span className="hs-user-action-label">Tag</span>
      </button>
      <button
        type="button"
        className="hs-user-action-trigger"
        disabled={disabled}
        onClick={onBatch}
        title="Spam random posts and tags"
      >
        <span className="hs-user-action-glyph">
          <SpamActionIcon />
        </span>
        <span className="hs-user-action-label">Spam</span>
      </button>
      <button
        type="button"
        className="hs-user-action-trigger"
        disabled={disabled}
        onClick={onPkarr}
        title="View pkarr record"
      >
        <span className="hs-user-action-glyph">
          <PkarrActionIcon />
        </span>
        <span className="hs-user-action-label">Pkarr</span>
      </button>
    </div>
  );
}

function UserActionModal({
  modal,
  busy,
  onClose,
  onAction,
}: {
  modal: FollowTagModal;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [target, setTarget] = useState("");
  const [label, setLabel] = useState("");

  const isFollow = modal.kind === "follow";
  const targetKey = target.trim();
  const keyValid = isFollow ? targetKey.length > 0 : isValidPubkyKey(targetKey);
  const labelValid = label.trim().length > 0;
  const title = isFollow ? "Follow user" : "Tag user";
  const canSubmit = isFollow ? keyValid : keyValid && labelValid;

  const handleTargetChange = (value: string) => {
    setTarget(value);
    if (!isFollow && !isValidPubkyKey(value.trim())) {
      setLabel("");
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onAction(async () => {
      const res = isFollow
        ? await api.follow(modal.userIndex, targetKey)
        : await api.tag(modal.userIndex, targetKey, label.trim());
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
        aria-labelledby="hs-action-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hs-action-modal-head">
          <div>
            <h2 id="hs-action-modal-title">{title}</h2>
            <p className="hs-action-modal-sub">
              as #{modal.userIndex} · {modal.displayName}
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
              <span className="hs-action-modal-label">Target pubky</span>
              <input
                type="text"
                className="hs-action-modal-input"
                placeholder="z32 public key"
                value={target}
                onChange={(e) => handleTargetChange(e.target.value)}
                disabled={busy}
                spellCheck={false}
                autoFocus
              />
              {!isFollow && targetKey.length > 0 && !keyValid && (
                <span className="hs-action-modal-hint">
                  Enter a z32 public key, not a URL
                </span>
              )}
            </label>

            {!isFollow && (
              <label className="hs-action-modal-field">
                <span className="hs-action-modal-label">Label</span>
                <input
                  type="text"
                  className="hs-action-modal-input hs-action-modal-input-text"
                  placeholder="Tag label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  disabled={busy || !keyValid}
                  spellCheck={false}
                />
              </label>
            )}
          </div>

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
              disabled={busy || !canSubmit}
            >
              {isFollow ? "Follow" : "Tag"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function HomeserverUsersView({
  hs,
  pkarrRelay,
  busy,
  onAction,
  onCopyKey,
}: {
  hs: Homeserver;
  pkarrRelay: string;
  busy: boolean;
  onAction: RunAction;
  onCopyKey: (key: string) => void | Promise<void>;
}) {
  const [rows, setRows] = useState<Record<number, RowState>>({});
  const [storageLoading, setStorageLoading] = useState(true);
  const [actionModal, setActionModal] = useState<ActionModalState | null>(null);
  const [pkarrModal, setPkarrModal] = useState<{
    label: string;
    kindLabel: string;
    publicKey: string;
  } | null>(null);

  // Stable key so SSE state refreshes (new `users` array refs) don't retrigger fetches.
  const usersKey = useMemo(
    () => hs.users.map((u) => `${u.index}:${u.publicKey}`).join("|"),
    [hs.users],
  );

  useEffect(() => {
    let alive = true;
    setStorageLoading(true);

    api
      .fetchUsersStorage(hs.seed)
      .then((stats) => {
        if (!alive) return;
        setRows((prev) => {
          const next = { ...prev };
          for (const s of stats) {
            next[s.index] = { ...next[s.index], storage: s };
          }
          return next;
        });
      })
      .catch(() => {
        // Old server binary or network error — show zeros instead of perpetual "…".
      })
      .finally(() => {
        if (alive) setStorageLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [hs.seed, usersKey]);

  useEffect(() => {
    let alive = true;

    for (const user of hs.users) {
      const ctx: UserStorageContext = {
        pk: user.publicKey,
        homeserverUrl: hs.httpUrl,
        userIndex: user.index,
      };
      loadProfile(ctx).then((profile) => {
        if (!alive) return;
        setRows((prev) => ({
          ...prev,
          [user.index]: {
            ...prev[user.index],
            displayName: profile?.name ?? user.name,
          },
        }));
        if (!profile?.image) return;
        loadAvatar(profile.image, ctx).then((url) => {
          if (!alive || !url) return;
          setRows((prev) => ({
            ...prev,
            [user.index]: { ...prev[user.index], avatar: url },
          }));
        });
      });
    }

    return () => {
      alive = false;
    };
  }, [hs.httpUrl, usersKey]);

  const openModal = (kind: ActionKind, userIndex: number, displayName: string) => {
    setActionModal({ kind, userIndex, displayName });
  };

  const openPkarrModal = (
    userIndex: number,
    displayName: string,
    publicKey: string
  ) => {
    setPkarrModal({
      label: displayName,
      kindLabel: `User #${userIndex} · ${hs.label}`,
      publicKey,
    });
  };

  const { color, keyColor } = hubColorFor(hs.seed);
  const totalUsed = hs.users.reduce(
    (sum, u) => sum + (rows[u.index]?.storage?.usedBytes ?? 0),
    0
  );
  const profiled = hs.users.filter((u) => rows[u.index]?.avatar).length;
  const quotaLabel =
    hs.storageQuotaMb != null ? `${hs.storageQuotaMb} MB / user` : "Unlimited";

  return (
    <div
      className="hs-detail"
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
    >
      {hs.users.length === 0 ? (
        <p className="muted hs-detail-empty">No users on this homeserver yet.</p>
      ) : (
        <>
          <div className="hs-users-toolbar">
            <span className="hs-users-stat">
              <span className="hs-users-stat-value">{hs.users.length}</span>
              <span className="hs-users-stat-label">
                {hs.users.length === 1 ? "user" : "users"}
              </span>
            </span>
            <span className="hs-users-stat-sep" aria-hidden />
            <span className="hs-users-stat">
              <span className="hs-users-stat-value">
                {storageLoading ? "…" : formatBytes(totalUsed)}
              </span>
              <span className="hs-users-stat-label">stored</span>
            </span>
            <span className="hs-users-stat-sep" aria-hidden />
            <span className="hs-users-stat">
              <span className="hs-users-stat-value">{quotaLabel}</span>
              <span className="hs-users-stat-label">quota</span>
            </span>
            {profiled > 0 && (
              <span className="hs-users-stat hs-users-stat-soft">
                <span className="hs-users-stat-value">{profiled}</span>
                <span className="hs-users-stat-label">with profile</span>
              </span>
            )}
          </div>

          <div className="hs-users-table-wrap">
            <table className="hs-users-table">
              <thead>
                <tr>
                  <th className="hs-users-th-num">#</th>
                  <th>User</th>
                  <th>Storage</th>
                  <th className="hs-users-th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {hs.users.map((user) => {
                  const row = rows[user.index];
                  const storage = row?.storage;
                  const used = storage?.usedBytes ?? 0;
                  const quotaMb = storage?.storageQuotaMb ?? hs.storageQuotaMb;
                  const displayName = row?.displayName ?? user.name;

                  return (
                    <tr key={user.index}>
                      <td className="hs-users-num">
                        <span className="hs-users-rank">{user.index}</span>
                      </td>
                      <td className="hs-users-id">
                        <div className="hs-users-id-cell">
                          <UserAvatar
                            publicKey={user.publicKey}
                            avatar={row?.avatar}
                            name={displayName}
                          />
                          <div className="hs-users-id-text">
                            <span className="hs-users-id-name" title={displayName}>
                              {displayName}
                            </span>
                            <button
                              type="button"
                              className="hs-users-id-key"
                              title={`${user.publicKey} — click to copy`}
                              onClick={() => void onCopyKey(user.publicKey)}
                            >
                              <KeyGlyph />
                              {shortKey(user.publicKey)}
                            </button>
                          </div>
                        </div>
                      </td>
                      <td className="hs-users-storage">
                        <StorageCell
                          used={used}
                          quotaMb={quotaMb}
                          loading={storageLoading && !storage}
                        />
                      </td>
                      <td className="hs-users-actions">
                        <UserActionButtons
                          disabled={busy}
                          onFollow={() => openModal("follow", user.index, displayName)}
                          onTag={() => openModal("tag", user.index, displayName)}
                          onBatch={() => openModal("batch", user.index, displayName)}
                          onPkarr={() =>
                            openPkarrModal(user.index, displayName, user.publicKey)
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {actionModal?.kind === "batch" ? (
        <BatchEventsModal
          key={`batch-${actionModal.userIndex}`}
          userIndex={actionModal.userIndex}
          displayName={actionModal.displayName}
          busy={busy}
          onClose={() => setActionModal(null)}
          onAction={onAction}
        />
      ) : actionModal && (actionModal.kind === "follow" || actionModal.kind === "tag") ? (
        <UserActionModal
          key={`${actionModal.kind}-${actionModal.userIndex}`}
          modal={{
            kind: actionModal.kind,
            userIndex: actionModal.userIndex,
            displayName: actionModal.displayName,
          }}
          busy={busy}
          onClose={() => setActionModal(null)}
          onAction={onAction}
        />
      ) : null}

      {pkarrModal && (
        <PkarrRecordModal
          label={pkarrModal.label}
          kindLabel={pkarrModal.kindLabel}
          seed={hs.seed}
          publicKey={pkarrModal.publicKey}
          pkarrRelay={pkarrRelay}
          onClose={() => setPkarrModal(null)}
        />
      )}
    </div>
  );
}
