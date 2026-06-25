import { useState, type FormEvent } from "react";
import { api } from "./api";
import type { RunAction } from "./App";

export type SocialPostKind = "mention" | "repost" | "repost_mention";

function isValidPubkyKey(value: string): boolean {
  const key = value.trim();
  if (!key || key.includes("://") || key.includes("/")) return false;
  return /^[a-z0-9]{40,64}$/.test(key);
}

function isValidPostUri(value: string): boolean {
  const uri = value.trim();
  return (
    uri.startsWith("pubky://") && uri.includes("/pub/pubky.app/posts/")
  );
}

export function SocialPostModal({
  userIndex,
  displayName,
  publicKey,
  busy,
  onClose,
  onAction,
}: {
  userIndex: number;
  displayName: string;
  publicKey: string;
  busy: boolean;
  onClose: () => void;
  onAction: RunAction;
}) {
  const [kind, setKind] = useState<SocialPostKind>("mention");
  const [mentionKey, setMentionKey] = useState("");
  const [postUri, setPostUri] = useState("");

  const mentionValid = isValidPubkyKey(mentionKey);
  const postUriValid = isValidPostUri(postUri);

  const canSubmit =
    !busy &&
    ((kind === "mention" && mentionValid) ||
      (kind === "repost" && postUriValid) ||
      (kind === "repost_mention" && mentionValid && postUriValid));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onAction(async () => {
      const res = await api.socialPost({
        from: publicKey,
        kind,
        mentionKey:
          kind === "mention" || kind === "repost_mention"
            ? mentionKey.trim()
            : undefined,
        postUri:
          kind === "repost" || kind === "repost_mention"
            ? postUri.trim()
            : undefined,
      });
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
        aria-labelledby="hs-social-post-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hs-action-modal-head">
          <div>
            <h2 id="hs-social-post-modal-title">Create</h2>
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
          <div className="hs-modal-panel">
            <fieldset className="hs-action-modal-field hs-radio-group">
              <legend className="hs-action-modal-label">Post type</legend>
              <label className="hs-radio-option">
                <input
                  type="radio"
                  name="social-post-kind"
                  value="mention"
                  checked={kind === "mention"}
                  disabled={busy}
                  onChange={() => setKind("mention")}
                />
                <span className="hs-radio-text">Mention</span>
              </label>
              <label className="hs-radio-option">
                <input
                  type="radio"
                  name="social-post-kind"
                  value="repost"
                  checked={kind === "repost"}
                  disabled={busy}
                  onChange={() => setKind("repost")}
                />
                <span className="hs-radio-text">Repost</span>
              </label>
              <label className="hs-radio-option">
                <input
                  type="radio"
                  name="social-post-kind"
                  value="repost_mention"
                  checked={kind === "repost_mention"}
                  disabled={busy}
                  onChange={() => setKind("repost_mention")}
                />
                <span className="hs-radio-text">Repost + mention</span>
              </label>
            </fieldset>

            {(kind === "mention" || kind === "repost_mention") && (
              <label className="hs-action-modal-field">
                <span className="hs-action-modal-label">Mention user key</span>
                <input
                  type="text"
                  className="hs-action-modal-input"
                  placeholder="z32 public key"
                  value={mentionKey}
                  onChange={(e) => setMentionKey(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  autoFocus
                />
                {mentionKey.trim().length > 0 && !mentionValid && (
                  <span className="hs-action-modal-hint">
                    Enter a z32 public key, not a URL
                  </span>
                )}
              </label>
            )}

            {(kind === "repost" || kind === "repost_mention") && (
              <label className="hs-action-modal-field">
                <span className="hs-action-modal-label">Post URI</span>
                <input
                  type="text"
                  className="hs-action-modal-input"
                  placeholder="pubky://…/pub/pubky.app/posts/…"
                  value={postUri}
                  onChange={(e) => setPostUri(e.target.value)}
                  disabled={busy}
                  spellCheck={false}
                  autoFocus={kind === "repost"}
                />
                {postUri.trim().length > 0 && !postUriValid && (
                  <span className="hs-action-modal-hint">
                    Must be a pubky.app post URI
                  </span>
                )}
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
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
