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

    timers.current.push(
      window.setTimeout(exit, DISMISS_MS - EXIT_MS)
    );

    return clearTimers;
  }, [toast, clearTimers, exit]);

  if (!shown) return null;

  return (
    <div className="notice-stack" role="status" aria-live="polite">
      <article
        className={`notice ${shown.ok ? "ok" : "err"}${leaving ? " leaving" : ""}`}
        style={{ "--notice-duration": `${DISMISS_MS}ms` } as CSSProperties}
      >
        <span className="notice-icon" aria-hidden>
          {shown.ok ? <NoticeCheckIcon /> : <NoticeAlertIcon />}
        </span>

        <div className="notice-body">
          <span className="notice-label">{shown.ok ? "Success" : "Error"}</span>
          <p className="notice-text">{shown.text}</p>
        </div>

        <button
          type="button"
          className="notice-close"
          aria-label="Dismiss notification"
          onClick={exit}
        >
          ×
        </button>

        <div className="notice-progress" aria-hidden>
          <span className="notice-progress-bar" />
        </div>
      </article>
    </div>
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
