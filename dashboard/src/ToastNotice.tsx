import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";

export interface ToastData {
  ok: boolean;
  text: string;
  /** When true the toast represents in-flight work: it stays until replaced
   * (no auto-dismiss) and renders a neutral spinner instead of ok/err. */
  pending?: boolean;
}

const DISMISS_MS = 4200;
const EXIT_MS = 280;

export function ToastNotice({
  toast,
  onDismiss,
}: {
  toast: ToastData | null;
  onDismiss: () => void;
}) {
  const [shown, setShown] = useState<ToastData | null>(null);
  const [leaving, setLeaving] = useState(false);
  const timers = useRef<number[]>([]);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  const clearTimers = useCallback(() => {
    for (const id of timers.current) window.clearTimeout(id);
    timers.current = [];
  }, []);

  const exit = useCallback(() => {
    clearTimers();
    setLeaving(true);
    timers.current.push(
      window.setTimeout(() => {
        setShown(null);
        setLeaving(false);
        onDismissRef.current();
      }, EXIT_MS)
    );
  }, [clearTimers]);

  useEffect(() => {
    if (!toast) return;

    clearTimers();
    setShown(toast);
    setLeaving(false);

    // Pending toasts persist until a result toast replaces them.
    if (!toast.pending) {
      timers.current.push(
        window.setTimeout(exit, DISMISS_MS - EXIT_MS)
      );
    }

    return clearTimers;
  }, [toast, clearTimers, exit]);

  if (!shown) return null;

  const variant = shown.pending ? "pending" : shown.ok ? "ok" : "err";
  const label =
    variant === "pending" ? "Working" : variant === "ok" ? "Success" : "Error";

  return (
    <div className="notice-stack" role="status" aria-live="polite">
      <article
        className={`notice ${variant}${leaving ? " leaving" : ""}`}
        style={{ "--notice-duration": `${DISMISS_MS}ms` } as CSSProperties}
      >
        <span className="notice-icon" aria-hidden>
          {variant === "pending" ? (
            <NoticeSpinner />
          ) : variant === "ok" ? (
            <NoticeCheckIcon />
          ) : (
            <NoticeAlertIcon />
          )}
        </span>

        <div className="notice-body">
          <span className="notice-label">{label}</span>
          <p className="notice-text">{shown.text}</p>
        </div>

        {!shown.pending && (
          <button
            type="button"
            className="notice-close"
            aria-label="Dismiss notification"
            onClick={exit}
          >
            ×
          </button>
        )}

        {!shown.pending && (
          <div className="notice-progress" aria-hidden>
            <span className="notice-progress-bar" />
          </div>
        )}
      </article>
    </div>
  );
}

function NoticeSpinner() {
  return (
    <svg viewBox="0 0 24 24" className="notice-icon-svg notice-spinner" aria-hidden>
      <circle cx="12" cy="12" r="9" className="notice-spinner-track" />
      <path d="M21 12a9 9 0 0 0-9-9" className="notice-spinner-head" />
    </svg>
  );
}

function NoticeCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="notice-icon-svg" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function NoticeAlertIcon() {
  return (
    <svg viewBox="0 0 24 24" className="notice-icon-svg" aria-hidden>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    </svg>
  );
}
