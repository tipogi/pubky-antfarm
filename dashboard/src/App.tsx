import {
  useState,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  useDashboard,
  type Homeserver,
} from "./useDashboard";
import { useActivity } from "./useActivity";
import { api, type ControlResponse } from "./api";
import { GraphView } from "./GraphView";
import { CreateHomeserverModal, AddHomeserverTile } from "./CreateHomeserverModal";
import { CreateUserModal, AddUserKeyButton } from "./CreateUserModal";
import { HomeserverStatusMenu } from "./HomeserverStatusMenu";
import { IslandPill } from "./IslandPill";
import { ProcessPill } from "./ProcessPill";
import { AnalyticsView } from "./AnalyticsView";
import { SearchView, SearchIcon } from "./SearchView";
import { HomeserverUsersView } from "./HomeserverUsersView";
import { Toaster } from "@/components/ui/sonner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { showDashboardToast, type ToastData } from "@/lib/toast";
import {
  BrandLogo,
  ChevronLeftIcon,
  CrownIcon,
  DriveIcon,
  GlobeLinkIcon,
  GraphIcon,
  KeyRowIcon,
  ServersIcon,
  StatsIcon,
  UsersStatIcon,
} from "@/components/icons/rail";
import { PkarrRecordModal } from "./PkarrRecordModal";
import { PkarrRecordIcon } from "./PkarrRecordIcon";
import { hubColorFor } from "./hubColors";
import { ROOT_VIEWBOX, RootPaths } from "./RootMark";
import { loadProfile, loadAvatar, type UserStorageContext } from "./pubky";

export type RunAction = (
  fn: () => Promise<ControlResponse>,
  pendingText?: string
) => void;

type View = "graph" | "homeservers" | "stats" | "search";

export default function App() {
  const { state, connected } = useDashboard();
  const feed = useActivity();
  const [detailHs, setDetailHs] = useState<Homeserver | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("homeservers");
  const [createHsOpen, setCreateHsOpen] = useState(false);
  const [pkarrModal, setPkarrModal] = useState<{
    label: string;
    seed: number;
    publicKey: string;
    pkarrRelay: string;
  } | null>(null);

  // Placeholders shown optimistically while a create request is in flight.
  const [pendingHomeservers, setPendingHomeservers] = useState<Homeserver[]>([]);

  const realHomeservers = state?.homeservers ?? [];
  const realSeeds = new Set(realHomeservers.map((hs) => hs.seed));
  // Real nodes win; keep a placeholder only until its real node arrives via SSE.
  const homeservers = [
    ...realHomeservers,
    ...pendingHomeservers.filter((p) => !realSeeds.has(p.seed)),
  ];
  const active = homeservers.filter((hs) => hs.status === "active").length;
  const totalUsers = homeservers.reduce((sum, hs) => sum + hs.userCount, 0);
  const topUserCount = homeservers.reduce(
    (max, hs) => Math.max(max, hs.userCount),
    0
  );
  const nextIndex =
    homeservers.reduce((max, hs) => Math.max(max, hs.seed), 0) + 1;

  useEffect(() => {
    if (view !== "homeservers") {
      setDetailHs(null);
      setCreateHsOpen(false);
    }
  }, [view]);

  // Drop optimistic placeholders once the real homeserver lands over SSE.
  useEffect(() => {
    if (!state) return;
    const seeds = new Set(state.homeservers.map((hs) => hs.seed));
    setPendingHomeservers((prev) => prev.filter((p) => !seeds.has(p.seed)));
  }, [state]);

  const resolveHs = (hs: Homeserver) =>
    homeservers.find((h) => h.label === hs.label) ?? hs;

  const showToast = (next: ToastData) => showDashboardToast(next);

  const runAction: RunAction = async (fn, pendingText) => {
    // Don't fire writes while the SSE stream is down (backend booting or a
    // mid-session drop) — they'd hit a backend that isn't ready yet.
    if (!connected) {
      showToast({ ok: false, text: "Reconnecting to antfarm…" });
      return;
    }
    setBusy(true);
    // Give instant feedback while the (network/DHT-bound) action runs in the
    // background — the caller has usually already closed its modal.
    if (pendingText) showToast({ ok: true, text: pendingText, pending: true });
    const res = await fn();
    setBusy(false);
    showToast({
      ok: res.ok,
      text: res.ok ? res.message ?? "Done" : res.error ?? "Failed",
    });
  };

  // Create a homeserver with an optimistic placeholder node: the node appears
  // immediately, reconciles when the SSE snapshot arrives, and is rolled back if
  // the create fails.
  const createHomeserver = (index: number, island = false, activate = false) => {
    if (!connected) {
      showToast({ ok: false, text: "Reconnecting to antfarm…" });
      return;
    }

    setPendingHomeservers((prev) =>
      prev.some((p) => p.seed === index)
        ? prev
        : [
            ...prev,
            {
              label: `hs${index + 1}`,
              seed: index,
              publicKey: "",
              httpUrl: "",
              status: activate ? "active" : "dormant",
              userCount: 0,
              users: [],
              island,
              down: false,
              pending: true,
            },
          ]
    );

    runAction(async () => {
      const created = await api.createHomeserver(index, island);
      if (!created.ok) {
        setPendingHomeservers((prev) => prev.filter((p) => p.seed !== index));
        return created;
      }
      if (activate) {
        return api.seedHomeserver(index);
      }
      return created;
    }, `Creating hs${index + 1}…`);
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
    <TooltipProvider delayDuration={300}>
    <div className="app">
      <nav className="rail" aria-label="Views">
        <div className="rail-brand" role="img" aria-label="Antfarm">
          <BrandLogo />
        </div>
        <div className="rail-nav" role="tablist">
          <RailButton
            label="Homeservers"
            active={view === "homeservers"}
            onClick={() => setView("homeservers")}
            icon={<ServersIcon />}
          />
          <RailButton
            label="Graph"
            active={view === "graph"}
            onClick={() => setView("graph")}
            icon={<GraphIcon />}
          />
          <RailButton
            label="Search"
            active={view === "search"}
            onClick={() => setView("search")}
            icon={<SearchIcon className="rail-icon rail-icon-search" />}
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
        {view === "search" ? (
          <SearchView />
        ) : !state ? (
          <div className="content-body">
            <p className="muted">Connecting to antfarm…</p>
          </div>
        ) : view === "graph" ? (
          <div className="content-body graph">
            {homeservers.length > 0 ? (
              <GraphView
                network={state.network}
                homeservers={homeservers}
                follows={state.follows ?? []}
                feed={feed}
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
                  homeservers={homeservers}
                  pkarrRelay={state.network.pkarrRelay}
                  busy={busy}
                  onAction={runAction}
                  onCopyKey={copyKey}
                />
              ) : (
                <div className="hs-card-grid">
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
                onCreate={createHomeserver}
              />
            )}
          </>
        ) : view === "stats" ? (
          <div className="content-body analytics-body">
            <AnalyticsView state={state} feed={feed} connected={connected} />
          </div>
        ) : null}
      </main>

      {pkarrModal && (
        <PkarrRecordModal
          label={pkarrModal.label}
          seed={pkarrModal.seed}
          publicKey={pkarrModal.publicKey}
          pkarrRelay={pkarrModal.pkarrRelay}
          onClose={() => setPkarrModal(null)}
        />
      )}

      <Toaster />
    </div>
    </TooltipProvider>
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          role="tab"
          aria-selected={active}
          aria-label={label}
          className={`rail-btn ${active ? "active" : ""}`}
          onClick={onClick}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

/** Strip the protocol and trailing slash so only host:port shows. */
function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
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
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const { color, keyColor } = hubColorFor(hs.seed);
  const unlimited = maxUsers === 0;
  const atCapacity = !unlimited && hs.userCount >= maxUsers;
  const pkarrUrl = `${pkarrRelay.replace(/\/$/, "")}/${hs.publicKey}`;

  return (
    <>
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
              <IslandPill hs={hs} busy={busy} onAction={onAction} />
              {hs.seed !== 0 && (
                <ProcessPill hs={hs} busy={busy} onAction={onAction} />
              )}
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
              {hs.down ? (
                <span
                  className="hs-detail-meta-item hs-detail-url muted"
                  title="Process stopped — use Running/Down to bring it back up"
                >
                  <GlobeLinkIcon />
                  {shortUrl(hs.httpUrl)}
                </span>
              ) : (
                <a
                  className="hs-detail-meta-item hs-detail-url"
                  href={hs.httpUrl}
                  target="_blank"
                  rel="noreferrer"
                  title={`Open ${hs.httpUrl}`}
                >
                  <GlobeLinkIcon />
                  {shortUrl(hs.httpUrl)}
                </a>
              )}
              <span className="hs-detail-meta-item">seed {hs.seed}</span>
              <span className={`hs-detail-meta-item ${atCapacity ? "warn" : ""}`}>
                {unlimited
                  ? `${hs.userCount} ${hs.userCount === 1 ? "user" : "users"} · unlimited`
                  : `${hs.userCount} / ${maxUsers} users`}
              </span>
              <span className="hs-detail-meta-links">
                <button
                  type="button"
                  className="hs-detail-meta-item hs-detail-pkarr"
                  title={`View pkarr record (${pkarrUrl})`}
                  onClick={() => void onPkarrRecord()}
                >
                  <PkarrRecordIcon className="hs-link-icon" />
                  Pkarr
                </button>
                <AddUserKeyButton
                  disabled={busy || hs.down}
                  onClick={() => setCreateUserOpen(true)}
                />
              </span>
            </div>
          </div>
        </div>
      </header>

      {createUserOpen && (
        <CreateUserModal
          hs={hs}
          maxUsers={maxUsers}
          busy={busy}
          onClose={() => setCreateUserOpen(false)}
          onAction={onAction}
        />
      )}
    </>
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
      className={`hs-card ${hs.status}${leader ? " leader" : ""}${
        hs.pending ? " pending" : ""
      }${hs.down ? " down" : ""}`}
      style={
        {
          "--hs-accent": color,
          "--hs-key": keyColor,
        } as CSSProperties
      }
      onClick={hs.pending ? undefined : onClick}
    >
      {active && !hs.down && <span className="hs-card-wire" aria-hidden />}

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
            <span className={`hs-card-pill ${hs.pending ? "dormant" : hs.status}`}>
              <span
                className={`hs-card-pill-dot ${hs.pending ? "dormant" : hs.status}`}
                aria-hidden
              />
              {hs.pending ? "creating…" : hs.status}
            </span>
            {hs.island && (
              <span
                className="hs-card-pill hs-island-pill island-on"
                title="Island — users can't be referenced"
              >
                Island
              </span>
            )}
            {hs.down && (
              <span
                className="hs-card-pill hs-process-pill process-off"
                title="Process stopped"
              >
                Down
              </span>
            )}
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
        homeserverUrl={hs.down ? "" : hs.httpUrl}
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
          {hs.down ? (
            <span
              className="hs-card-link muted"
              title="Process stopped"
              aria-hidden
            >
              <GlobeLinkIcon />
            </span>
          ) : (
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
          )}
        </span>
      </div>
    </article>
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
    if (!homeserverUrl) return;
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
