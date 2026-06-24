import { useEffect, useState, type CSSProperties } from "react";
import {
  loadUserEvents,
  USER_EVENTS_PAGE_SIZE,
  type UserEvent,
} from "./pubky";
import { hubColorFor } from "./hubColors";

function shortPath(path: string): string {
  return path.length > 48 ? `${path.slice(0, 28)}…${path.slice(-16)}` : path;
}

function shortHash(hash: string): string {
  return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : hash;
}

function EventActionIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12 8v4l3 3" />
      <circle cx="12" cy="12" r="9" />
    </svg>
  );
}

export { EventActionIcon };

export function UserEventsModal({
  label,
  seed,
  userPk,
  homeserverUrl,
  kindLabel = "Events",
  onClose,
}: {
  label: string;
  seed: number;
  userPk: string;
  homeserverUrl: string;
  kindLabel?: string;
  onClose: () => void;
}) {
  const { color } = hubColorFor(seed);
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<UserEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void loadUserEvents(userPk, homeserverUrl).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setEvents(result.events);
        setError(null);
      } else {
        setEvents([]);
        setError(result.error ?? "Failed to load events");
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [userPk, homeserverUrl]);

  const countLabel = loading
    ? "Loading…"
    : events && events.length > 0
      ? `${events.length} event${events.length === 1 ? "" : "s"}`
      : "No events";

  return (
    <div className="hs-action-modal-overlay" onClick={onClose}>
      <div
        className="hs-action-modal hs-events-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="user-events-modal-title"
        aria-busy={loading}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="hs-action-modal-head hs-events-modal-head"
          style={{ "--hs-accent": color } as CSSProperties}
        >
          <div className="hs-events-head-main">
            <span className="hs-events-head-icon" aria-hidden>
              <EventActionIcon className="hs-events-head-icon-svg" />
            </span>

            <div className="hs-events-head-body">
              <div className="hs-events-head-title-row">
                <h2 id="user-events-modal-title">{label}</h2>
                <span
                  className={`hs-events-head-badge${loading ? " loading" : events?.length ? " ok" : ""}`}
                >
                  {countLabel}
                </span>
              </div>
              <p className="hs-events-head-kind">{kindLabel}</p>
              {!loading && error && (
                <p className="hs-events-head-error">{error}</p>
              )}
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

        <div className="hs-action-modal-form hs-events-modal-body">
          {loading ? (
            <p className="hs-events-loading muted">
              Fetching up to {USER_EVENTS_PAGE_SIZE} events from homeserver…
            </p>
          ) : !error && events && events.length > 0 ? (
            <>
              <div className="hs-events-records">
                <table className="hs-events-table">
                  <thead>
                    <tr>
                      <th>Cursor</th>
                      <th>Type</th>
                      <th>Path</th>
                      <th>Hash</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event, index) => (
                      <tr key={`${event.type}-${event.uri}-${index}`}>
                        <td className="hs-events-time" title={event.cursor}>
                          {event.cursor ?? "—"}
                        </td>
                        <td className="hs-events-type">
                          <span
                            className={`hs-events-type-badge ${event.type === "PUT" ? "put" : "del"}`}
                          >
                            {event.type}
                          </span>
                        </td>
                        <td className="hs-events-path" title={event.uri}>
                          {shortPath(event.path)}
                        </td>
                        <td
                          className="hs-events-hash"
                          title={event.contentHash ?? undefined}
                        >
                          {event.contentHash
                            ? shortHash(event.contentHash)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <details className="hs-events-json">
                <summary>Raw JSON</summary>
                <pre>{JSON.stringify(events, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p className="muted hs-events-empty">
              {error ?? "No events for this user yet."}
            </p>
          )}

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
