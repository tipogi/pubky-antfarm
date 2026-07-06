import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { Session } from "@synonymdev/pubky";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatContent } from "./eventContentFormat";
import {
  extractPrivReferences,
  privContentKey,
  resolvePrivRef,
  type PrivRef,
} from "./privPathRefs";
import {
  loadSearchEventContent,
  restoreSessionFromMnemonic,
  restoreSessionFromRecovery,
  SEARCH_EVENTS_LIMIT,
  signOutSession,
  type SearchEvent,
} from "./searchPubky";
import type { EventContentResult } from "./pubky";
import { useSearchEventStream } from "./useSearchEventStream";

function shortPath(path: string): string {
  return path.length > 48 ? `${path.slice(0, 28)}…${path.slice(-16)}` : path;
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5L21 21" />
    </svg>
  );
}

export { SearchIcon };

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function PrivRefsPanel({
  rowIndex,
  refs,
  session,
  sessionUserZ32,
  privContentByRow,
  onResolve,
}: {
  rowIndex: number;
  refs: PrivRef[];
  session: Session | null;
  sessionUserZ32: string | null;
  privContentByRow: Record<string, EventContentResult | "loading">;
  onResolve: (rowIndex: number, refs: PrivRef[]) => void;
}) {
  useEffect(() => {
    if (session && sessionUserZ32 && refs.length > 0) {
      onResolve(rowIndex, refs);
    }
  }, [rowIndex, refs, session, sessionUserZ32, onResolve]);

  if (refs.length === 0) return null;

  return (
    <div className="search-priv-refs">
      <p className="search-detail-section-title">
        Private references{refs.length > 1 ? ` (${refs.length})` : ""}
      </p>
      {!session && (
        <p className="search-priv-refs-hint muted">
          Import recovery file to resolve private references.
        </p>
      )}
      <ul className="search-priv-ref-list">
        {refs.map((ref) => {
          const key = privContentKey(rowIndex, ref.path);
          const content = privContentByRow[key];
          return (
            <li key={key} className="search-priv-ref-item">
              <details className="search-recovery search-priv-ref">
                <summary
                  className="search-recovery-summary search-priv-ref-summary"
                  title={ref.raw}
                >
                  {shortPath(ref.path)}
                </summary>
                {session && content === "loading" && (
                  <p className="hs-events-content-status muted">Resolving…</p>
                )}
                {session && content && content !== "loading" && content.ok && (
                  <pre className="hs-events-content-pre">
                    {formatContent(content)}
                  </pre>
                )}
                {session &&
                  content &&
                  content !== "loading" &&
                  !content.ok && (
                    <p className="hs-events-content-status error">
                      {content.error ?? "Failed to resolve"}
                    </p>
                  )}
                {!session && (
                  <p className="hs-events-content-status muted">
                    Sign in to resolve this reference.
                  </p>
                )}
              </details>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EventDetailPanel({
  event,
  rowIndex,
  content,
  privRefs,
  session,
  sessionUserZ32,
  privContentByRow,
  onResolve,
  onClose,
}: {
  event: SearchEvent;
  rowIndex: number;
  content: EventContentResult | "loading" | undefined;
  privRefs: PrivRef[];
  session: Session | null;
  sessionUserZ32: string | null;
  privContentByRow: Record<string, EventContentResult | "loading">;
  onResolve: (rowIndex: number, refs: PrivRef[]) => void;
  onClose: () => void;
}) {
  const isPriv = event.scope === "priv";
  const isPut = event.eventType === "PUT";

  return (
    <aside className="search-detail-pane" aria-label="Event details">
      <div className="search-detail-head">
        <div className="search-detail-title-block">
          <h2 className="search-detail-title" title={event.path}>
            {shortPath(event.path)}
          </h2>
          <p className="search-detail-sub">
            <span
              className={`hs-events-type-badge ${isPut ? "put" : "del"}`}
            >
              {event.eventType}
            </span>
            {isPriv && <span className="search-priv-badge">priv</span>}
            {event.cursor && (
              <span className="search-detail-sub-meta">
                cursor {event.cursor}
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          className="search-detail-close close-btn"
          onClick={onClose}
          aria-label="Close details"
        >
          ×
        </button>
      </div>

      <div className="search-detail-body">
        <dl className="search-detail-meta">
          <div className="search-detail-meta-row">
            <dt>Path</dt>
            <dd title={event.uri}>{event.path}</dd>
          </div>
          <div className="search-detail-meta-row">
            <dt>Cursor</dt>
            <dd>{event.cursor ?? "—"}</dd>
          </div>
          <div className="search-detail-meta-row">
            <dt>Hash</dt>
            <dd title={event.contentHash ?? undefined}>
              {event.contentHash ?? "—"}
            </dd>
          </div>
          <div className="search-detail-meta-row">
            <dt>URI</dt>
            <dd className="search-detail-uri">{event.uri}</dd>
          </div>
        </dl>

        {isPut && (
          <section className="search-detail-content-section">
            <p className="search-detail-section-title">Content</p>
            {content === "loading" || content === undefined ? (
              <p className="hs-events-content-status muted">Loading content…</p>
            ) : content.ok ? (
              <>
                <pre className="hs-events-content-pre search-detail-content-pre">
                  {formatContent(content)}
                </pre>
                <PrivRefsPanel
                  rowIndex={rowIndex}
                  refs={privRefs}
                  session={session}
                  sessionUserZ32={sessionUserZ32}
                  privContentByRow={privContentByRow}
                  onResolve={onResolve}
                />
              </>
            ) : (
              <p className="hs-events-content-status error">
                {content.error ?? "Failed to load content"}
              </p>
            )}
          </section>
        )}

        {!isPut && (
          <p className="muted search-detail-empty-content">
            Delete events have no content to display.
          </p>
        )}
      </div>
    </aside>
  );
}

export function SearchView() {
  const [input, setInput] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [sessionUserZ32, setSessionUserZ32] = useState<string | null>(null);

  const { status, events, error, privError, searchedKey } =
    useSearchEventStream(activeKey, { session, sessionUserZ32 });
  const [scopeFilter, setScopeFilter] = useState<"all" | "pub" | "priv">("all");
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [contentByRow, setContentByRow] = useState<
    Record<number, EventContentResult | "loading">
  >({});
  const [privRefsByRow, setPrivRefsByRow] = useState<Record<number, PrivRef[]>>(
    {}
  );
  const [privContentByRow, setPrivContentByRow] = useState<
    Record<string, EventContentResult | "loading">
  >({});

  const sessionRef = useRef<Session | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [mnemonic, setMnemonic] = useState("");
  const [mnemonicError, setMnemonicError] = useState<string | null>(null);
  const [mnemonicLoading, setMnemonicLoading] = useState(false);
  const [authMethod, setAuthMethod] = useState<"recovery" | "mnemonic">(
    "recovery"
  );

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      void signOutSession(sessionRef.current);
    };
  }, []);

  const isActive = activeKey !== null;

  useEffect(() => {
    if (!isActive) inputRef.current?.focus();
  }, [isActive]);

  const clearContentState = () => {
    setSelectedIndex(null);
    setContentByRow({});
    setPrivRefsByRow({});
    setPrivContentByRow({});
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) {
      setInputError("Enter a public key");
      return;
    }
    setInputError(null);
    clearContentState();
    setActiveKey(trimmed);
  };

  const handleReset = () => {
    setInput("");
    setInputError(null);
    setActiveKey(null);
    clearContentState();
  };

  const resolvePrivRefs = useCallback(
    (rowIndex: number, refs: PrivRef[]) => {
      if (!session || !sessionUserZ32) return;

      for (const ref of refs) {
        const key = privContentKey(rowIndex, ref.path);
        setPrivContentByRow((prev) => {
          if (prev[key] !== undefined) return prev;
          return { ...prev, [key]: "loading" };
        });

        void resolvePrivRef(session, ref, sessionUserZ32).then((result) => {
          setPrivContentByRow((prev) => ({ ...prev, [key]: result }));
        });
      }
    },
    [session, sessionUserZ32]
  );

  const selectEvent = (index: number, event: SearchEvent) => {
    if (selectedIndex === index) {
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex(index);

    if (event.eventType !== "PUT") return;

    if (contentByRow[index] === undefined) {
      setContentByRow((prev) => ({ ...prev, [index]: "loading" }));
      void loadSearchEventContent(event, session).then((result) => {
        setContentByRow((prev) => ({ ...prev, [index]: result }));
        if (result.ok && result.body) {
          const refs = extractPrivReferences(
            result.body,
            sessionUserZ32 ?? event.ownerZ32
          );
          if (refs.length > 0) {
            setPrivRefsByRow((prev) => ({ ...prev, [index]: refs }));
          }
        }
      });
    }
  };

  const handleRecoveryImport = async (e: FormEvent) => {
    e.preventDefault();
    if (!recoveryFile) {
      setRecoveryError("Select a recovery file");
      return;
    }
    if (!passphrase) {
      setRecoveryError("Enter a passphrase");
      return;
    }

    setRecoveryError(null);
    setRecoveryLoading(true);
    clearContentState();

    try {
      if (session) {
        await signOutSession(session);
      }

      const { session: nextSession, publicKeyZ32 } =
        await restoreSessionFromRecovery(recoveryFile, passphrase);

      setSession(nextSession);
      setSessionUserZ32(publicKeyZ32);
      setInput(publicKeyZ32);
      setPassphrase("");
      setRecoveryFile(null);
      setActiveKey(publicKeyZ32);
    } catch (err) {
      setRecoveryError(
        err instanceof Error ? err.message : "Recovery import failed"
      );
      setSession(null);
      setSessionUserZ32(null);
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleMnemonicImport = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = mnemonic.trim();
    if (!trimmed) {
      setMnemonicError("Enter a mnemonic");
      return;
    }

    setMnemonicError(null);
    setMnemonicLoading(true);
    clearContentState();

    try {
      if (session) {
        await signOutSession(session);
      }

      const { session: nextSession, publicKeyZ32 } =
        await restoreSessionFromMnemonic(trimmed);

      setSession(nextSession);
      setSessionUserZ32(publicKeyZ32);
      setInput(publicKeyZ32);
      setMnemonic("");
      setActiveKey(publicKeyZ32);
    } catch (err) {
      setMnemonicError(
        err instanceof Error ? err.message : "Mnemonic import failed"
      );
      setSession(null);
      setSessionUserZ32(null);
    } finally {
      setMnemonicLoading(false);
    }
  };

  useEffect(() => {
    setScopeFilter("all");
  }, [searchedKey]);

  useEffect(() => {
    if (!session && scopeFilter === "priv") setScopeFilter("all");
  }, [session, scopeFilter]);

  useEffect(() => {
    if (selectedIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedIndex(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedIndex]);

  const selectedEvent =
    selectedIndex !== null ? (events[selectedIndex] ?? null) : null;

  const privCount = events.reduce(
    (n, e) => n + (e.scope === "priv" ? 1 : 0),
    0
  );
  const pubCount = events.length - privCount;

  const matchesScope = (event: SearchEvent): boolean => {
    if (scopeFilter === "all") return true;
    const priv = event.scope === "priv";
    return scopeFilter === "priv" ? priv : !priv;
  };

  const countLabel =
    status === "connecting"
      ? "Connecting…"
      : events.length > 0
        ? `${events.length} event${events.length === 1 ? "" : "s"}`
        : status === "streaming"
          ? "No events yet"
          : "";

  return (
    <div
      className={`content-body search-body ${isActive ? "is-active" : "is-idle"}`}
    >
      <div className="search-shell">
        <div className="search-shell-spacer" aria-hidden />
        <form className="search-form" onSubmit={handleSubmit}>
          <div className="search-field">
            <SearchIcon className="search-field-icon" />
            <input
              ref={inputRef}
              type="text"
              className="search-input"
              placeholder="pubky public key (z32)"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (inputError) setInputError(null);
              }}
              spellCheck={false}
              autoComplete="off"
              aria-label="Public key"
            />
          </div>
          <button type="submit" className="search-submit action">
            Search
          </button>
          {(input || isActive) && (
            <button
              type="button"
              className="search-reset-btn"
              onClick={handleReset}
              aria-label="Clear search"
              title="Clear search"
            >
              <TrashIcon className="search-reset-icon" />
            </button>
          )}
        </form>
        <div className="search-advanced-region">
          {inputError && <p className="search-error">{inputError}</p>}

          <details
            className="search-recovery"
            key={session ? "auth" : "anon"}
          >
          <summary className="search-recovery-summary">
            Advanced: authenticate to read private paths
          </summary>
          {!session && (
          <>
          <p className="search-recovery-hint muted">
            Sign in with your keypair to read the owner&apos;s encrypted{" "}
            <code>/priv/</code> paths.
          </p>

          <div className="search-advanced-body">
            <div
              className="search-auth-tabs"
              role="tablist"
              aria-label="Authentication method"
            >
              <button
                type="button"
                role="tab"
                aria-selected={authMethod === "recovery"}
                className={`search-auth-tab${authMethod === "recovery" ? " active" : ""}`}
                onClick={() => setAuthMethod("recovery")}
              >
                Recovery file
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMethod === "mnemonic"}
                className={`search-auth-tab${authMethod === "mnemonic" ? " active" : ""}`}
                onClick={() => setAuthMethod("mnemonic")}
              >
                Mnemonic
              </button>
            </div>

            {authMethod === "recovery" ? (
              <>
                <form
                  className="search-recovery-form"
                  onSubmit={handleRecoveryImport}
                >
                  <label className="search-field-group">
                    <span className="search-field-label">Recovery file</span>
                    <input
                      type="file"
                      className="search-recovery-file"
                      accept="*/*"
                      onChange={(e) => {
                        setRecoveryFile(e.target.files?.[0] ?? null);
                        if (recoveryError) setRecoveryError(null);
                      }}
                      aria-label="Recovery file"
                    />
                  </label>
                  <label className="search-field-group">
                    <span className="search-field-label">Passphrase</span>
                    <input
                      type="password"
                      className="search-input search-recovery-passphrase"
                      placeholder="Enter passphrase"
                      value={passphrase}
                      onChange={(e) => {
                        setPassphrase(e.target.value);
                        if (recoveryError) setRecoveryError(null);
                      }}
                      autoComplete="off"
                      aria-label="Recovery passphrase"
                    />
                  </label>
                  <button
                    type="submit"
                    className="search-submit action"
                    disabled={recoveryLoading}
                  >
                    {recoveryLoading ? "Authenticating…" : "Authenticate"}
                  </button>
                </form>
                {recoveryError && (
                  <p className="search-error">{recoveryError}</p>
                )}
              </>
            ) : (
              <>
                <form
                  className="search-recovery-form"
                  onSubmit={handleMnemonicImport}
                >
                  <label className="search-field-group">
                    <span className="search-field-label">Mnemonic phrase</span>
                    <input
                      type="text"
                      className="search-input search-mnemonic-input"
                      placeholder="word1 word2 word3 …"
                      value={mnemonic}
                      onChange={(e) => {
                        setMnemonic(e.target.value);
                        if (mnemonicError) setMnemonicError(null);
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      aria-label="Mnemonic phrase"
                    />
                  </label>
                  <button
                    type="submit"
                    className="search-submit action"
                    disabled={mnemonicLoading}
                  >
                    {mnemonicLoading ? "Authenticating…" : "Authenticate"}
                  </button>
                </form>
                {mnemonicError && (
                  <p className="search-error">{mnemonicError}</p>
                )}
              </>
            )}
          </div>
          </>
          )}
        </details>
        </div>
      </div>

      {isActive && (
        <div className="search-panel">
        {searchedKey && (
          <div className="search-status">
            <span className="search-status-key" title={searchedKey}>
              {searchedKey}
            </span>
            <div className="search-status-badges">
              {countLabel && (
                <span
                  className={`hs-events-head-badge${status === "connecting" ? " loading" : events.length ? " ok" : ""}`}
                >
                  {countLabel}
                </span>
              )}
              {status === "streaming" && (
                <span className="search-live-badge" aria-label="Live stream">
                  Live
                </span>
              )}
              {session && (
                <span className="search-signed-in-badge" aria-label="Signed in">
                  Signed in
                </span>
              )}
            </div>
          </div>
        )}

        {error && <p className="search-error">{error}</p>}

        {events.length > 0 && (
          <div className="search-scope-bar">
            <div
              className="search-auth-tabs search-scope-tabs"
              role="tablist"
              aria-label="Filter events by scope"
            >
              <button
                type="button"
                role="tab"
                aria-selected={scopeFilter === "all"}
                className={`search-auth-tab${scopeFilter === "all" ? " active" : ""}`}
                onClick={() => setScopeFilter("all")}
              >
                All ({events.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={scopeFilter === "pub"}
                className={`search-auth-tab${scopeFilter === "pub" ? " active" : ""}`}
                onClick={() => setScopeFilter("pub")}
              >
                Public ({pubCount})
              </button>
              {session && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={scopeFilter === "priv"}
                  className={`search-auth-tab${scopeFilter === "priv" ? " active" : ""}`}
                  onClick={() => setScopeFilter("priv")}
                >
                  Private ({privCount})
                </button>
              )}
            </div>
            {privError && (
              <span className="search-priv-note" title={privError}>
                Private events unavailable
              </span>
            )}
          </div>
        )}

        {activeKey && status === "connecting" && (
          <div className="search-connecting">
            <span className="search-spinner" aria-hidden />
            <p className="hs-events-loading muted">
              Opening event stream (up to {SEARCH_EVENTS_LIMIT} historical
              events)…
            </p>
          </div>
        )}

        {events.length > 0 && (
          <div className="search-events-layout">
            <div className="hs-events-records search-events-records">
              <Table className="table-fixed border-collapse text-xs">
                <TableHeader>
                  <TableRow className="border-0 hover:bg-transparent">
                    <TableHead className="sticky top-0 z-[1] h-auto w-[15%] border-b border-white/[0.06] bg-[rgba(20,20,22,0.92)] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/45 backdrop-blur-sm">
                      Cursor
                    </TableHead>
                    <TableHead className="sticky top-0 z-[1] h-auto w-[8%] border-b border-white/[0.06] bg-[rgba(20,20,22,0.92)] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/45 backdrop-blur-sm">
                      Type
                    </TableHead>
                    <TableHead className="sticky top-0 z-[1] h-auto w-[7%] border-b border-white/[0.06] bg-[rgba(20,20,22,0.92)] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/45 backdrop-blur-sm">
                      Scope
                    </TableHead>
                    <TableHead className="sticky top-0 z-[1] h-auto w-[45%] border-b border-white/[0.06] bg-[rgba(20,20,22,0.92)] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/45 backdrop-blur-sm">
                      Path
                    </TableHead>
                    <TableHead className="sticky top-0 z-[1] h-auto w-[25%] border-b border-white/[0.06] bg-[rgba(20,20,22,0.92)] px-2.5 py-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-white/45 backdrop-blur-sm">
                      Hash
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="[&_tr:last-child_td]:border-b-0">
                  {events.map((event, index) => {
                    if (!matchesScope(event)) return null;
                    const isPriv = event.scope === "priv";
                    const selected = selectedIndex === index;
                    return (
                      <TableRow
                        key={`${event.cursor}-${index}`}
                        className={`search-row-clickable border-0 hover:bg-transparent${isPriv ? " search-row-priv" : ""}${selected ? " search-row-selected" : ""}`}
                        onClick={() => selectEvent(index, event)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            selectEvent(index, event);
                          }
                        }}
                      >
                        <TableCell
                          className="hs-events-time w-[15%] border-b border-white/[0.06] px-2.5 py-2 align-top"
                          title={event.cursor}
                        >
                          {event.cursor ?? "—"}
                        </TableCell>
                        <TableCell className="hs-events-type w-[8%] border-b border-white/[0.06] px-2.5 py-2 align-top">
                          <span
                            className={`hs-events-type-badge ${event.eventType === "PUT" ? "put" : "del"}`}
                          >
                            {event.eventType}
                          </span>
                        </TableCell>
                        <TableCell className="hs-events-scope w-[7%] border-b border-white/[0.06] px-2.5 py-2 align-top">
                          {isPriv ? (
                            <span className="search-priv-badge">priv</span>
                          ) : (
                            <span className="search-pub-badge">pub</span>
                          )}
                        </TableCell>
                        <TableCell
                          className="hs-events-path w-[45%] border-b border-white/[0.06] px-2.5 py-2 align-top"
                          title={event.uri}
                        >
                          {shortPath(event.path)}
                        </TableCell>
                        <TableCell
                          className="hs-events-hash w-[25%] border-b border-white/[0.06] px-2.5 py-2 align-top"
                          title={event.contentHash ?? undefined}
                        >
                          {event.contentHash ? event.contentHash : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

          </div>
        )}

        {selectedEvent && selectedIndex !== null && (
          <div
            className="search-modal-backdrop"
            onClick={() => setSelectedIndex(null)}
          >
            <div
              className="search-modal"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <EventDetailPanel
                event={selectedEvent}
                rowIndex={selectedIndex}
                content={contentByRow[selectedIndex]}
                privRefs={privRefsByRow[selectedIndex] ?? []}
                session={session}
                sessionUserZ32={sessionUserZ32}
                privContentByRow={privContentByRow}
                onResolve={resolvePrivRefs}
                onClose={() => setSelectedIndex(null)}
              />
            </div>
          </div>
        )}

        {activeKey &&
          status === "streaming" &&
          events.length === 0 &&
          !error && (
            <p className="muted hs-events-empty">No events for this key yet.</p>
          )}
        </div>
      )}
    </div>
  );
}
