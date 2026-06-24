import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { RunAction } from "./App";

const MAX_BATCH = 100;

function parseCount(value: string): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > MAX_BATCH) return null;
  return n;
}

function BatchRow({
  id,
  label,
  enabled,
  value,
  disabled,
  onEnabledChange,
  onChange,
}: {
  id: string;
  label: string;
  enabled: boolean;
  value: string;
  disabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onChange: (value: string) => void;
}) {
  const countValid = !enabled || parseCount(value) !== null;

  return (
    <div className={`hs-batch-row ${enabled ? "enabled" : ""}`}>
      <label className="hs-batch-row-check" htmlFor={`${id}-enabled`}>
        <input
          id={`${id}-enabled`}
          type="checkbox"
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        <span className="hs-batch-row-label">{label}</span>
      </label>
      <input
        id={`${id}-count`}
        type="number"
        min={1}
        max={MAX_BATCH}
        className="hs-batch-row-input"
        value={value}
        disabled={disabled || !enabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {!countValid && enabled && (
        <span className="hs-batch-row-hint">1–{MAX_BATCH}</span>
      )}
    </div>
  );
}

export function BatchEventsModal({
  userIndex,
  displayName,
  busy,
  onClose,
  onAction,
}: {
  userIndex: number;
  displayName: string;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [postsEnabled, setPostsEnabled] = useState(true);
  const [tagsEnabled, setTagsEnabled] = useState(true);
  const [postsCount, setPostsCount] = useState("5");
  const [tagsCount, setTagsCount] = useState("5");

  const posts = postsEnabled ? parseCount(postsCount) : 0;
  const tags = tagsEnabled ? parseCount(tagsCount) : 0;
  const canSubmit =
    !busy &&
    ((postsEnabled && posts !== null && posts > 0) ||
      (tagsEnabled && tags !== null && tags > 0));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onAction(async () => {
      const res = await api.batch({
        from: userIndex,
        posts: postsEnabled && posts ? posts : 0,
        tags: tagsEnabled && tags ? tags : 0,
      });
      if (res.ok) onClose();
      return res;
    });
  };

  return (
    <div className="hs-action-modal-overlay" onClick={onClose}>
      <div
        className="hs-action-modal hs-batch-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hs-batch-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hs-action-modal-head">
          <div>
            <h2 id="hs-batch-modal-title">Spam</h2>
            <p className="hs-action-modal-sub">
              as #{userIndex} · {displayName}
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
          <div className="hs-batch-rows">
            <BatchRow
              id="batch-posts"
              label="Posts"
              enabled={postsEnabled}
              value={postsCount}
              disabled={busy}
              onEnabledChange={setPostsEnabled}
              onChange={setPostsCount}
            />
            <BatchRow
              id="batch-tags"
              label="Tags"
              enabled={tagsEnabled}
              value={tagsCount}
              disabled={busy}
              onEnabledChange={setTagsEnabled}
              onChange={setTagsCount}
            />
          </div>

          <div className="hs-action-modal-foot">
            <button type="button" className="action" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="action primary" disabled={!canSubmit}>
              Spam
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
