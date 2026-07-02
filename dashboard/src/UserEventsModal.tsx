import { Fragment, useEffect, useState, type CSSProperties } from "react";
import { formatContent } from "./eventContentFormat";
import {
  loadEventContent,
  loadUserEvents,
  USER_EVENTS_PAGE_SIZE,
  type EventContentResult,
  type UserEvent,
} from "./pubky";
import { hubColorFor } from "./hubColors";

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [contentByRow, setContentByRow] = useState<
    Record<number, EventContentResult | "loading">
  >({});

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

  // Reset any open content view when the underlying user/homeserver changes.
  useEffect(() => {
    setOpenRow(null);
    setContentByRow({});
  }, [userPk, homeserverUrl]);

  const toggleContent = (index: number, event: UserEvent) => {
    if (openRow === index) {
      setOpenRow(null);
      return;
    }
    setOpenRow(index);
    if (contentByRow[index] === undefined) {
      setContentByRow((prev) => ({ ...prev, [index]: "loading" }));
      void loadEventContent(event.uri, homeserverUrl).then((result) => {
        setContentByRow((prev) => ({ ...prev, [index]: result }));
      });
    }
  };

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
                      <th className="hs-events-th-view" aria-label="View" />
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event, index) => {
                      const canView = event.type === "PUT";
                      const open = openRow === index;
                      const content = contentByRow[index];
                      return (
                        <Fragment key={`${event.type}-${event.uri}-${index}`}>
                          <tr className={open ? "is-open" : undefined}>
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
                            <td className="hs-events-view">
                              {canView && (
                                <button
                                  type="button"
                                  className={`hs-events-view-btn${open ? " active" : ""}`}
                                  onClick={() => toggleContent(index, event)}
                                  aria-label={
                                    open ? "Hide content" : "View content"
                                  }
                                  aria-expanded={open}
                                  title={open ? "Hide content" : "View content"}
                                >
                                  <EyeIcon className="hs-events-view-icon" />
                                </button>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr className="hs-events-content-row">
                              <td colSpan={5}>
                                {content === "loading" || content === undefined ? (
                                  <p className="hs-events-content-status muted">
                                    Loading content…
                                  </p>
                                ) : content.ok ? (
                                  <pre className="hs-events-content-pre">
                                    {formatContent(content)}
                                  </pre>
                                ) : (
                                  <p className="hs-events-content-status error">
                                    {content.error ?? "Failed to load content"}
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
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
