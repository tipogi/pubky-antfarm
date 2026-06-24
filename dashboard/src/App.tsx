import {
  useState,
  useEffect,
  useCallback,
  type CSSProperties,
  type ReactNode,
} from "react";
import { CopyButton } from "./CopyButton";
import {
  useDashboard,
  type Homeserver,
} from "./useDashboard";
import { useActivity } from "./useActivity";
import { api, type ControlResponse } from "./api";
import { GraphView } from "./GraphView";
import { CreateHomeserverModal, AddHomeserverTile } from "./CreateHomeserverModal";
import { HomeserverStatusMenu } from "./HomeserverStatusMenu";
import { AnalyticsView } from "./AnalyticsView";
import { HomeserverUsersView } from "./HomeserverUsersView";
import { ToastNotice, type ToastData } from "./ToastNotice";
import { PkarrRecordModal } from "./PkarrRecordModal";
import { PkarrRecordIcon } from "./PkarrRecordIcon";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";
import { loadProfile, loadAvatar, type UserStorageContext } from "./pubky";

export type RunAction = (fn: () => Promise<ControlResponse>) => void;

type View = "graph" | "homeservers" | "stats";

export default function App() {
  const { state, connected } = useDashboard();
  const feed = useActivity();
  const [drawerHs, setDrawerHs] = useState<Homeserver | null>(null);
  const [detailHs, setDetailHs] = useState<Homeserver | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [view, setView] = useState<View>("graph");
  const [createHsOpen, setCreateHsOpen] = useState(false);
  const [pkarrModal, setPkarrModal] = useState<{
    label: string;
    seed: number;
    publicKey: string;
    pkarrRelay: string;
  } | null>(null);

  const homeservers = state?.homeservers ?? [];
  const active = homeservers.filter((hs) => hs.status === "active").length;
  const totalUsers = homeservers.reduce((sum, hs) => sum + hs.userCount, 0);
  const topUserCount = homeservers.reduce(
    (max, hs) => Math.max(max, hs.userCount),
    0
  );
  const nextIndex =
    homeservers.reduce((max, hs) => Math.max(max, hs.seed), 0) + 1;

  useEffect(() => {
    if (view !== "graph") setDrawerHs(null);
    if (view !== "homeservers") {
      setDetailHs(null);
      setCreateHsOpen(false);
    }
  }, [view]);

  const resolveHs = (hs: Homeserver) =>
    homeservers.find((h) => h.label === hs.label) ?? hs;

  const dismissToast = useCallback(() => setToast(null), []);

  const showToast = (next: ToastData) => setToast(next);

  const runAction: RunAction = async (fn) => {
    setBusy(true);
    const res = await fn();
    setBusy(false);
    showToast({
      ok: res.ok,
      text: res.ok ? res.message ?? "Done" : res.error ?? "Failed",
    });
  };

  const copyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      showToast({ ok: true, text: "Public key copied to clipboard" });
    } catch {
      showToast({ ok: false, text: "Could not copy to clipboard" });
    }
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
            {detailHs ? (
              <HomeserverDetailHeader
                hs={resolveHs(detailHs)}
                maxUsers={state.simulator.maxUsersPerHomeserver}
                pkarrRelay={state.network.pkarrRelay}
                busy={busy}
                onBack={() => setDetailHs(null)}
                onCopyKey={copyKey}
                onAction={runAction}
                onPkarrRecord={() =>
                  setPkarrModal({
                    label: resolveHs(detailHs).label,
                    seed: resolveHs(detailHs).seed,
                    publicKey: resolveHs(detailHs).publicKey,
                    pkarrRelay: state.network.pkarrRelay,
                  })
                }
              />
            ) : (
              <header className="content-head">
                <div className="content-heading">
                  <h1>Homeservers</h1>
                  <p className="content-sub">
                    {homeservers.length}{" "}
                    {homeservers.length === 1 ? "homeserver" : "homeservers"} ·{" "}
                    {active} active · {totalUsers} users
                  </p>
                </div>
              </header>
            )}
            <div className="content-body">
              {detailHs ? (
                <HomeserverUsersView
                  hs={resolveHs(detailHs)}
                  pkarrRelay={state.network.pkarrRelay}
                  busy={busy}
                  onAction={runAction}
                  onCopyKey={copyKey}
                />
              ) : (
                <div className="grid">
                  {homeservers.map((hs) => (
                    <HomeserverCard
                      key={hs.label}
                      hs={hs}
                      maxUsers={state.simulator.maxUsersPerHomeserver}
                      leader={topUserCount > 0 && hs.userCount === topUserCount}
                      onClick={() => setDetailHs(hs)}
                    />
                  ))}
                  <AddHomeserverTile
                    nextIndex={nextIndex}
                    busy={busy}
                    onClick={() => setCreateHsOpen(true)}
                  />
                </div>
              )}
            </div>
            {createHsOpen && (
              <CreateHomeserverModal
                nextIndex={nextIndex}
                busy={busy}
                onClose={() => setCreateHsOpen(false)}
                onAction={runAction}
              />
            )}
          </>
        ) : (
          <div className="content-body analytics-body">
            <AnalyticsView state={state} feed={feed} connected={connected} />
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

      {pkarrModal && (
        <PkarrRecordModal
          label={pkarrModal.label}
          seed={pkarrModal.seed}
          publicKey={pkarrModal.publicKey}
          pkarrRelay={pkarrModal.pkarrRelay}
          onClose={() => setPkarrModal(null)}
        />
      )}

      <ToastNotice toast={toast} onDismiss={dismissToast} />
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

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-detail-back-icon" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function HomeserverDetailHeader({
  hs,
  maxUsers,
  pkarrRelay,
  busy,
  onBack,
  onCopyKey,
  onPkarrRecord,
  onAction,
}: {
  hs: Homeserver;
  maxUsers: number;
  pkarrRelay: string;
  busy: boolean;
  onBack: () => void;
  onCopyKey: (key: string) => void | Promise<void>;
  onPkarrRecord: () => void | Promise<void>;
  onAction: RunAction;
}) {
  const { color, keyColor } = hubColorFor(hs.seed);
  const unlimited = maxUsers === 0;
  const atCapacity = !unlimited && hs.userCount >= maxUsers;
  const pkarrUrl = `${pkarrRelay.replace(/\/$/, "")}/${hs.publicKey}`;

  return (
    <header
      className="content-head hs-detail-head"
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
    >
      <button type="button" className="hs-detail-back" onClick={onBack}>
        <ChevronLeftIcon />
        <span>Homeservers</span>
      </button>

      <div className="hs-detail-hero">
        <span className="hs-detail-avatar" aria-hidden>
          <svg viewBox={ROOT_VIEWBOX} className="hs-card-avatar-icon">
            <RootPaths />
          </svg>
        </span>

        <div className="hs-detail-body">
          <div className="hs-detail-title-row">
            <h1>{hs.label}</h1>
            <HomeserverStatusMenu hs={hs} busy={busy} onAction={onAction} />
          </div>

          <button
            type="button"
            className="hs-detail-key-row"
            title="Copy public key"
            onClick={() => void onCopyKey(hs.publicKey)}
          >
            <KeyRowIcon />
            <span className="hs-detail-key-full">{hs.publicKey}</span>
          </button>

          <div className="hs-detail-meta">
            <span className="hs-detail-meta-item">seed {hs.seed}</span>
            <span className="hs-detail-meta-item">
              {hs.userCount} {hs.userCount === 1 ? "user" : "users"}
            </span>
            <span className={`hs-detail-meta-item ${atCapacity ? "warn" : ""}`}>
              {unlimited
                ? "Unlimited capacity"
                : `${hs.userCount} / ${maxUsers} capacity`}
            </span>
            <span className="hs-detail-meta-links">
              <a
                className="hs-detail-meta-item hs-detail-open"
                href={hs.httpUrl}
                target="_blank"
                rel="noreferrer"
                title="Open homeserver URL"
              >
                <GlobeLinkIcon />
                Open
              </a>
              <button
                type="button"
                className="hs-detail-meta-item hs-detail-pkarr"
                title={`View pkarr record (${pkarrUrl})`}
                onClick={() => void onPkarrRecord()}
              >
                <PkarrRecordIcon className="hs-link-icon" />
                Pkarr
              </button>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}

function HomeserverCard({
  hs,
  maxUsers,
  leader,
  onClick,
}: {
  hs: Homeserver;
  maxUsers: number;
  leader: boolean;
  onClick: () => void;
}) {
  const { color, keyColor } = hubColorFor(hs.seed);
  const unlimited = maxUsers === 0;
  const fillPct = unlimited
    ? 0
    : Math.min(100, (hs.userCount / maxUsers) * 100);
  const nearFull = !unlimited && fillPct >= 80;
  const active = hs.status === "active";

  return (
    <article
      className={`hs-card ${hs.status}${leader ? " leader" : ""}`}
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
      onClick={onClick}
    >
      {active && <span className="hs-card-wire" aria-hidden />}

      <header className="hs-card-head">
        <span className="hs-card-avatar" aria-hidden>
          <svg viewBox={ROOT_VIEWBOX} className="hs-card-avatar-icon">
            <RootPaths />
          </svg>
        </span>
        <div className="hs-card-title">
          <div className="hs-card-title-row">
            <h2>{hs.label}</h2>
            {leader && (
              <span className="hs-card-crown" title="Most populated homeserver">
                <CrownIcon />
              </span>
            )}
            <span className={`hs-card-pill ${hs.status}`}>
              <span className={`hs-card-pill-dot ${hs.status}`} aria-hidden />
              {hs.status}
            </span>
          </div>
          <span className="hs-card-seed">seed {hs.seed}</span>
        </div>
      </header>

      <div className="hs-card-meter">
        <div className="hs-card-meter-head">
          <span className="hs-card-meter-label">
            <UsersStatIcon />
            {hs.userCount} {hs.userCount === 1 ? "user" : "users"}
          </span>
          <span className={`hs-card-meter-value ${nearFull ? "warn" : ""}`}>
            {unlimited ? "Unlimited" : `${Math.round(fillPct)}%`}
          </span>
        </div>
        <div
          className={`hs-card-meter-track${unlimited ? " unlimited" : ""}${
            nearFull ? " warn" : ""
          }`}
          role="progressbar"
          aria-valuemin={0}
          aria-valuenow={unlimited ? undefined : hs.userCount}
          aria-valuemax={unlimited ? undefined : maxUsers}
          aria-label="Capacity"
        >
          {unlimited ? (
            <span className="hs-card-meter-flow" aria-hidden />
          ) : (
            <span
              className="hs-card-meter-fill"
              style={{ width: `${fillPct}%` }}
              aria-hidden
            />
          )}
        </div>
        <div className="hs-card-meter-foot">
          <span className="hs-card-meter-caption">
            {unlimited ? "No capacity limit" : `${hs.userCount} / ${maxUsers} slots`}
          </span>
          {hs.storageQuotaMb != null && (
            <span
              className="hs-card-meter-storage"
              title="Per-user storage quota"
            >
              <DriveIcon />
              {hs.storageQuotaMb} MB
            </span>
          )}
        </div>
      </div>

      <UserStack
        users={hs.users}
        userCount={hs.userCount}
        homeserverUrl={hs.httpUrl}
      />

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

function DriveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-stat-icon" aria-hidden="true">
      <path d="M4 5h16a1 1 0 0 1 1 1v5H3V6a1 1 0 0 1 1-1z" />
      <path d="M3 11h18v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M7 15h2" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-card-crown-icon" aria-hidden="true">
      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.6 11H4.6L3 7z" />
    </svg>
  );
}

const MAX_AVATARS = 6;

function userHue(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function UserChip({
  user,
  homeserverUrl,
}: {
  user: Homeserver["users"][number];
  homeserverUrl: string;
}) {
  const [avatar, setAvatar] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const ctx: UserStorageContext = {
      pk: user.publicKey,
      homeserverUrl,
      userIndex: user.index,
    };
    loadProfile(ctx)
      .then((profile) => {
        if (!alive || !profile) return;
        if (profile.name) setName(profile.name);
        if (!profile.image) return;
        return loadAvatar(profile.image, ctx).then((url) => {
          if (alive && url) setAvatar(url);
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [user.publicKey, user.index, homeserverUrl]);

  return (
    <span
      className={`hs-user-chip${avatar ? " has-avatar" : ""}`}
      style={{ "--chip-hue": userHue(user.publicKey) } as CSSProperties}
      title={name || user.name || user.publicKey}
    >
      {avatar ? (
        <img className="hs-user-chip-img" src={avatar} alt="" loading="lazy" />
      ) : (
        <svg
          viewBox={ROOT_VIEWBOX}
          className="hs-user-chip-icon"
          aria-hidden="true"
        >
          <RootPaths />
        </svg>
      )}
    </span>
  );
}

function UserStack({
  users,
  userCount,
  homeserverUrl,
}: {
  users: Homeserver["users"];
  userCount: number;
  homeserverUrl: string;
}) {
  if (userCount === 0) {
    return (
      <div className="hs-card-stack empty">
        <span className="hs-card-stack-empty-dot" aria-hidden />
        <span className="hs-card-stack-empty-text">Awaiting first user</span>
      </div>
    );
  }

  const shown = users.slice(0, MAX_AVATARS);
  const overflow = userCount - shown.length;

  return (
    <div className="hs-card-stack" aria-label={`${userCount} users`}>
      <div className="hs-card-avatars">
        {shown.map((user) => (
          <UserChip
            key={user.index}
            user={user}
            homeserverUrl={homeserverUrl}
          />
        ))}
        {overflow > 0 && (
          <span className="hs-user-chip more" title={`${overflow} more`}>
            +{overflow}
          </span>
        )}
      </div>
    </div>
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
