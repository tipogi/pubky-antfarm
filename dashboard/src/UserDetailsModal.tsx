import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { api, type UserKeys } from "./api";
import { hubColorFor } from "./hubColors";

function DetailsActionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <circle cx="12" cy="7.75" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

export { DetailsActionIcon };

function CopyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 12.5l5 5 11-11" />
    </svg>
  );
}

function CopyButton({
  value,
  label,
  ariaLabel,
}: {
  value: string;
  label?: ReactNode;
  ariaLabel: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard unavailable (e.g. non-secure context); ignore.
    }
  };

  return (
    <button
      type="button"
      className={`hs-details-copy${copied ? " copied" : ""}`}
      onClick={copy}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      {copied ? (
        <CheckIcon className="hs-details-copy-icon" />
      ) : (
        <CopyIcon className="hs-details-copy-icon" />
      )}
      {label != null && (
        <span className="hs-details-copy-label">{copied ? "Copied" : label}</span>
      )}
    </button>
  );
}

export function UserDetailsModal({
  label,
  seed,
  userIndex,
  kindLabel = "User details",
  onClose,
}: {
  label: string;
  seed: number;
  userIndex: number;
  /** Accepted for call-site symmetry; details are fetched by index. */
  publicKey?: string;
  kindLabel?: string;
  onClose: () => void;
}) {
  const { color } = hubColorFor(seed);
  const [loading, setLoading] = useState(true);
  const [keys, setKeys] = useState<UserKeys | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    api
      .fetchUserKeys(userIndex)
      .then((result) => {
        if (cancelled) return;
        setKeys(result);
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setKeys(null);
        setError(e instanceof Error ? e.message : "Failed to load keys");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userIndex]);

  const words = keys?.mnemonic ? keys.mnemonic.trim().split(/\s+/) : [];

  return (
    <div className="hs-action-modal-overlay" onClick={onClose}>
      <div
        className="hs-action-modal hs-details-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-details-modal-title"
        aria-busy={loading}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="hs-action-modal-head hs-details-modal-head"
          style={{ "--hs-accent": color } as CSSProperties}
        >
          <div className="hs-details-head-main">
            <div className="hs-details-head-body">
              <div className="hs-details-head-title-row">
                <h2 id="user-details-modal-title">{label}</h2>
                <span className="hs-details-head-badge">#{userIndex}</span>
              </div>
              <p className="hs-details-head-kind">{kindLabel}</p>
            </div>
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

        <div className="hs-action-modal-form hs-details-modal-body">
          <div className="hs-details-phrase-head">
            <span className="hs-details-field-label">
              Recovery phrase
              {!loading && !error && (
                <span className="hs-details-count">{words.length} words</span>
              )}
            </span>
            {!loading && !error && keys && (
              <CopyButton
                value={keys.mnemonic}
                label="Copy"
                ariaLabel="Copy recovery phrase"
              />
            )}
          </div>

          {loading ? (
            <p className="hs-details-loading muted">Deriving seed…</p>
          ) : error ? (
            <p className="hs-details-error">{error}</p>
          ) : keys ? (
            <ol className="hs-details-mnemonic">
              {words.map((word, i) => (
                <li key={`${word}-${i}`} className="hs-details-word">
                  <span className="hs-details-word-num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="hs-details-word-text">{word}</span>
                </li>
              ))}
            </ol>
          ) : null}

          <div className="hs-action-modal-foot">
            <button type="button" className="action" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
