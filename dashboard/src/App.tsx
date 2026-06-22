import { useState, useEffect, type CSSProperties, type ReactNode } from "react";
import { CopyButton } from "./CopyButton";
import {
  useDashboard,
  type ActivityTotals,
  type Homeserver,
  type NetworkInfo,
  type Range,
  type SimulatorInfo,
} from "./useDashboard";
import { useActivity, type TickEvent } from "./useActivity";
import { api, type ControlResponse } from "./api";
import { GraphView } from "./GraphView";
import { HomeserverUsersView } from "./HomeserverUsersView";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";

export type RunAction = (fn: () => Promise<ControlResponse>) => void;

type View = "graph" | "homeservers" | "stats";

interface Toast {
  ok: boolean;
  text: string;
}

export default function App() {
  const { state, connected } = useDashboard();
  const feed = useActivity();
  const [drawerHs, setDrawerHs] = useState<Homeserver | null>(null);
  const [detailHs, setDetailHs] = useState<Homeserver | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [view, setView] = useState<View>("graph");

  const homeservers = state?.homeservers ?? [];
  const active = homeservers.filter((hs) => hs.status === "active").length;
  const totalUsers = homeservers.reduce((sum, hs) => sum + hs.userCount, 0);
  const nextIndex =
    homeservers.reduce((max, hs) => Math.max(max, hs.seed), 0) + 1;

  useEffect(() => {
    if (view !== "graph") setDrawerHs(null);
    if (view !== "homeservers") setDetailHs(null);
  }, [view]);

  const resolveHs = (hs: Homeserver) =>
    homeservers.find((h) => h.label === hs.label) ?? hs;

  const runAction: RunAction = async (fn) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    setToast({
      ok: res.ok,
      text: res.ok ? res.message ?? "Done" : res.error ?? "Failed",
    });
    window.setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="app">
      <nav className="rail" aria-label="Views">
        <div className="rail-brand" role="img" aria-label="Antfarm">
          <BrandLogo />
        </div>
        <div className="rail-nav" role="tablist">
          <RailButton
            label="Graph"
            active={view === "graph"}
            onClick={() => setView("graph")}
            icon={<GraphIcon />}
          />
          <RailButton
            label="Homeservers"
            active={view === "homeservers"}
            onClick={() => setView("homeservers")}
            icon={<ServersIcon />}
          />
          <RailButton
            label="Stats"
            active={view === "stats"}
            onClick={() => setView("stats")}
            icon={<StatsIcon />}
          />
        </div>
        <div className="rail-foot">
          <span
            className={`rail-status ${connected ? "online" : "offline"}`}
            title={connected ? "Connected" : "Disconnected"}
            aria-label={connected ? "Connected" : "Disconnected"}
          />
        </div>
      </nav>

      <main className="content">
        {!state ? (
          <div className="content-body">
            <p className="muted">Connecting to antfarm…</p>
          </div>
        ) : view === "graph" ? (
          <div className="content-body graph">
            {homeservers.length > 0 ? (
              <GraphView
                homeservers={homeservers}
                follows={state.follows ?? []}
                feed={feed}
                onSelect={setDrawerHs}
                nextIndex={nextIndex}
                busy={busy}
                onCreateHomeserver={(index) =>
                  runAction(() => api.createHomeserver(index))
                }
              />
            ) : (
              <p className="muted">No homeservers running.</p>
            )}
          </div>
        ) : view === "homeservers" ? (
          <>
            <header className="content-head">
              <div className="content-heading">
                <h1>{detailHs ? detailHs.label : "Homeservers"}</h1>
                <p className="content-sub">
                  {detailHs ? (
                    <>
                      seed {detailHs.seed} · {detailHs.userCount}{" "}
                      {detailHs.userCount === 1 ? "user" : "users"} ·{" "}
                      {detailHs.status}
                    </>
                  ) : (
                    <>
                      {homeservers.length}{" "}
                      {homeservers.length === 1 ? "homeserver" : "homeservers"} ·{" "}
                      {active} active · {totalUsers} users
                    </>
                  )}
                </p>
              </div>
            </header>
            <div className="content-body">
              {homeservers.length === 0 ? (
                <p className="muted">No homeservers running.</p>
              ) : detailHs ? (
                <HomeserverUsersView
                  hs={resolveHs(detailHs)}
                  onBack={() => setDetailHs(null)}
                />
              ) : (
                <div className="grid">
                  {homeservers.map((hs) => (
                    <HomeserverCard
                      key={hs.label}
                      hs={hs}
                      onClick={() => setDetailHs(hs)}
                    />
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="content-body">
            <section className="summary">
              <Stat label="Homeservers" value={homeservers.length} />
              <Stat label="Active" value={active} />
              <Stat label="Dormant" value={homeservers.length - active} />
              <Stat label="Users" value={totalUsers} />
            </section>
            <InfoPanel network={state.network} simulator={state.simulator} />
            <ActivityPanel totals={state.activity} feed={feed} />
          </div>
        )}
      </main>

      {view === "graph" && drawerHs && (
        <HomeserverDrawer
          hs={resolveHs(drawerHs)}
          busy={busy}
          onAction={runAction}
          onClose={() => setDrawerHs(null)}
        />
      )}

      {toast && (
        <div className={`toast ${toast.ok ? "ok" : "err"}`}>{toast.text}</div>
      )}
    </div>
  );
}

function RailButton({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      aria-label={label}
      title={label}
      className={`rail-btn ${active ? "active" : ""}`}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

function GraphIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rail-icon" aria-hidden="true">
      {/* hub-and-spoke mesh: central node with varied satellites */}
      <path d="M12 12.3 6.3 6.3M12 12.3 18.7 6.6M12 12.3 5.4 17.8M12 12.3 12.6 19.6M12 12.3 19.6 15.2" />
      <circle cx="12" cy="12.3" r="3" />
      <circle cx="6.3" cy="6.3" r="1.6" />
      <circle cx="18.7" cy="6.6" r="2.4" />
      <circle cx="5.4" cy="17.8" r="2.1" />
      <circle cx="12.6" cy="19.6" r="2.1" />
      <circle cx="19.6" cy="15.2" r="1.5" />
    </svg>
  );
}

function BrandLogo() {
  return (
    <svg
      viewBox="0 0 600 566"
      className="brand-logo"
      aria-hidden="true"
      fill="currentColor"
    >
      <g transform="translate(0,566) scale(0.1,-0.1)">
        <path
          d={`M2228 4575 c-3 -3 -80 -11 -169 -16 -237 -13 -291 -25 -351 -79 -43
-39 -34 -120 20 -175 l37 -37 70 5 c39 3 176 15 305 26 552 48 1077 -5 1330
-135 14 -7 63 -30 110 -52 328 -152 517 -464 523 -862 l2 -135 -69 -3 c-86 -4
-82 -9 -96 126 -34 349 -195 578 -533 754 -170 89 -581 168 -877 168 -112 0
-637 -42 -700 -56 -97 -21 -127 -163 -49 -229 30 -24 108 -43 129 -30 7 4 58
11 114 15 55 5 154 14 218 20 220 22 550 7 748 -35 36 -8 76 -16 90 -18 14 -3
52 -15 85 -26 57 -21 73 -28 163 -68 210 -95 363 -342 350 -566 l-3 -52 -540
-6 c-442 -5 -554 -9 -615 -22 -41 -9 -95 -21 -120 -26 -163 -35 -452 -155
-547 -227 -21 -16 -58 -43 -82 -59 -201 -134 -390 -430 -427 -665 -12 -79 -5
-290 11 -345 35 -115 50 -151 88 -219 22 -39 46 -82 53 -95 41 -77 224 -253
334 -322 36 -23 76 -49 90 -58 23 -16 107 -57 190 -94 383 -172 1046 -190
1366 -37 22 11 46 20 52 20 11 0 104 46 162 80 113 68 247 174 328 261 114
123 211 272 256 394 8 22 24 65 36 95 55 141 62 267 57 990 -4 714 -3 709 -76
921 -45 132 -144 290 -247 395 -248 251 -613 410 -1069 465 -102 12 -737 24
-747 14z m786 -1760 c301 -91 374 -480 127 -668 -337 -257 -779 156 -545 509
94 141 263 206 418 159z`}
        />
      </g>
    </svg>
  );
}

function ServersIcon() {
  return (
    <svg
      viewBox={ROOT_VIEWBOX}
      className="rail-icon root-mark"
      aria-hidden="true"
    >
      <RootPaths />
    </svg>
  );
}

function StatsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="rail-icon" aria-hidden="true">
      {/* axes + rising trend line with end markers */}
      <path d="M5 4v14a1 1 0 0 0 1 1h14" />
      <path d="M8 15l3.2-3.4 2.6 2 4.2-4.8" />
      <circle cx="8" cy="15" r="1.1" />
      <circle cx="18" cy="8.8" r="1.1" />
    </svg>
  );
}

function InfoPanel({
  network,
  simulator,
}: {
  network: NetworkInfo;
  simulator: SimulatorInfo;
}) {
  const range = (r: Range) => `${r[0]}–${r[1]}`;
  return (
    <section className="info-panel">
      <div className="info-group">
        <h3>Network</h3>
        <InfoRow label="Bootstrap" value={network.bootstrap} />
        <InfoRow label="Pkarr relay" value={network.pkarrRelay} link />
      </div>
      <div className="info-group">
        <h3>Simulator</h3>
        <InfoRow label="Tick interval" value={`${simulator.intervalSecs}s`} />
        <InfoRow label="Users / tick" value={range(simulator.usersPerTick)} />
        <InfoRow label="Posts / tick" value={range(simulator.postsPerTick)} />
        <InfoRow label="Tags / tick" value={range(simulator.tagsPerTick)} />
        <InfoRow label="Follows / tick" value={range(simulator.followsPerTick)} />
      </div>
    </section>
  );
}

function InfoRow({
  label,
  value,
  link,
}: {
  label: string;
  value: string;
  link?: boolean;
}) {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      {link ? (
        <a className="info-value link" href={value} target="_blank" rel="noreferrer">
          {value}
        </a>
      ) : (
        <span className="info-value">{value}</span>
      )}
    </div>
  );
}

function ActivityPanel({
  totals,
  feed,
}: {
  totals: ActivityTotals;
  feed: TickEvent[];
}) {
  return (
    <section className="activity-panel">
      <div className="activity-totals">
        <h3>Activity totals</h3>
        <div className="totals-grid">
          <Total label="Ticks" value={totals.ticks} />
          <Total label="Users" value={totals.users} />
          <Total label="Posts" value={totals.posts} />
          <Total label="Tags" value={totals.tags} />
          <Total label="Follows" value={totals.follows} />
        </div>
      </div>
      <div className="activity-feed">
        <h3>Live ticks</h3>
        {feed.length === 0 ? (
          <p className="muted small">Waiting for the next tick…</p>
        ) : (
          <ul className="feed-list">
            {feed.map((ev) => (
              <li key={ev.tick} className="feed-row">
                <span className="feed-tick">tick {ev.tick}</span>
                <span className="feed-deltas">
                  <Delta value={ev.users} label="u" />
                  <Delta value={ev.posts} label="p" />
                  <Delta value={ev.tags} label="t" />
                  <Delta value={ev.follows} label="f" />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <div className="total">
      <span className="total-value">{value}</span>
      <span className="total-label">{label}</span>
    </div>
  );
}

function Delta({ value, label }: { value: number; label: string }) {
  return (
    <span className={`delta ${value > 0 ? "pos" : "zero"}`}>
      +{value}
      <span className="delta-label">{label}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function HomeserverCard({
  hs,
  onClick,
}: {
  hs: Homeserver;
  onClick: () => void;
}) {
  const { color, keyColor } = hubColorFor(hs.seed);

  return (
    <article
      className={`hs-card ${hs.status}`}
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
      onClick={onClick}
    >
      <header className="hs-card-head">
        <span className="hs-card-avatar" aria-hidden>
          <svg viewBox={ROOT_VIEWBOX} className="hs-card-avatar-icon">
            <RootPaths />
          </svg>
        </span>
        <div className="hs-card-title">
          <div className="hs-card-title-row">
            <h2>{hs.label}</h2>
            <span className={`hs-card-pill ${hs.status}`}>
              <span className={`hs-card-pill-dot ${hs.status}`} aria-hidden />
              {hs.status}
            </span>
          </div>
          <span className="hs-card-seed">seed {hs.seed}</span>
        </div>
      </header>

      <div className="hs-card-stats">
        <span className="hs-stat">
          <UsersStatIcon />
          {hs.userCount} {hs.userCount === 1 ? "user" : "users"}
        </span>
      </div>

      <div className="hs-card-divider" role="separator" />

      <div className="hs-card-row">
        <button
          type="button"
          className="hs-card-pk"
          title={hs.publicKey}
          onClick={(e) => {
            e.stopPropagation();
            void navigator.clipboard.writeText(hs.publicKey);
          }}
        >
          <KeyRowIcon />
          {shortKey(hs.publicKey)}
        </button>
        <span className="hs-card-links">
          <a
            className="hs-card-link"
            href={hs.httpUrl}
            target="_blank"
            rel="noreferrer"
            title="Open homeserver URL"
            onClick={(e) => e.stopPropagation()}
          >
            <GlobeLinkIcon />
          </a>
          <button
            type="button"
            className="hs-card-link"
            title="Copy public key"
            onClick={(e) => {
              e.stopPropagation();
              void navigator.clipboard.writeText(hs.publicKey);
            }}
          >
            <DatabaseLinkIcon />
          </button>
        </span>
      </div>
    </article>
  );
}

function UsersStatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-stat-icon" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

function KeyRowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-row-icon" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

function GlobeLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-link-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function DatabaseLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-link-icon" aria-hidden="true">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
    </svg>
  );
}

function StatusToggle({
  hs,
  busy,
  onAction,
}: {
  hs: Homeserver;
  busy: boolean;
  onAction: RunAction;
}) {
  const active = hs.status === "active";

  if (hs.seed === 0) {
    return (
      <span className="status-locked" title="The built-in homeserver is always active">
        Always active
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      className={`status-switch ${active ? "on" : "off"}`}
      disabled={busy}
      onClick={() =>
        onAction(() =>
          active ? api.stopHomeserver(hs.seed) : api.seedHomeserver(hs.seed)
        )
      }
      title={active ? "Set dormant" : "Set active"}
    >
      <span className="status-switch-track">
        <span className="status-switch-thumb" />
      </span>
      <span className="status-switch-text">{active ? "Active" : "Dormant"}</span>
    </button>
  );
}

function HomeserverDrawer({
  hs,
  busy,
  onAction,
  onClose,
}: {
  hs: Homeserver;
  busy: boolean;
  onAction: RunAction;
  onClose: () => void;
}) {
  const [profile, setProfile] = useState(false);
  const { color: hubColor } = hubColorFor(hs.seed);

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <aside
        className="drawer"
        style={{ "--hs-accent": hubColor } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div className="drawer-identity">
            <span className="drawer-swatch" aria-hidden>
              <svg viewBox={ROOT_VIEWBOX} className="drawer-swatch-icon">
                <RootPaths />
              </svg>
            </span>
            <div className="drawer-title-block">
              <h2>{hs.label}</h2>
              <p className="drawer-sub">
                {hs.userCount} {hs.userCount === 1 ? "user" : "users"} · seed{" "}
                {hs.seed}
              </p>
            </div>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <DrawerField label="Public key">
          <code className="mono">{hs.publicKey}</code>
          <CopyButton value={hs.publicKey} />
        </DrawerField>

        <DrawerField label="Homeserver URL">
          <a className="mono link" href={hs.httpUrl} target="_blank" rel="noreferrer">
            {hs.httpUrl}
          </a>
          <CopyButton value={hs.httpUrl} />
        </DrawerField>

        <div className="drawer-actions-row">
          <span className="drawer-actions-label">Simulator</span>
          <span className="drawer-actions-label">User</span>

          <div className="drawer-panel drawer-actions-panel">
            <StatusToggle hs={hs} busy={busy} onAction={onAction} />
          </div>

          <div className="drawer-panel drawer-actions-panel add-user-panel">
            <button
              className="action primary add-user-btn"
              disabled={busy}
              onClick={() => onAction(() => api.addUser(hs.seed, profile))}
            >
              Add
            </button>
            <label className="profile-toggle">
              <input
                type="checkbox"
                checked={profile}
                onChange={(e) => setProfile(e.target.checked)}
              />
              <span>with profile</span>
            </label>
          </div>
        </div>

        <div className="drawer-field drawer-users">
          <span className="drawer-label">Users ({hs.userCount})</span>
          {hs.users.length === 0 ? (
            <p className="muted small drawer-users-empty">No users yet.</p>
          ) : (
            <ul className="user-list">
              {hs.users.map((user) => (
                <li key={user.index} className="user-row">
                  <span className="user-index">#{user.index}</span>
                  <code className="mono user-pk">{user.publicKey}</code>
                  <CopyButton value={user.publicKey} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

function DrawerField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="drawer-field">
      <span className="drawer-label">{label}</span>
      <div className="drawer-value">{children}</div>
    </div>
  );
}
