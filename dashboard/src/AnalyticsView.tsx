import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ENTITY_KEYS,
  ENTITY_META,
  activityGrandTotal,
  entitiesPerMinute,
  feedAverages,
  formatCompact,
  formatRate,
  simulatorRows,
  tickTotal,
  type EntityKey,
} from "./activityMetrics";
import type { TickEvent } from "./useActivity";
import type {
  DashboardState,
  Edge,
  Homeserver,
  NetworkInfo,
  SimulatorInfo,
} from "./useDashboard";

const SPARKLINE_LEN = 24;

// Warm yellow ramp (lemon → deep amber) used to keep analytics on one tone.
const HUB_YELLOWS = ["#fefa3d", "#ffce2e", "#ffac28", "#f0871c"] as const;

function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="an-hub-crown-icon" aria-hidden="true">
      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.6 11H4.6L3 7z" />
    </svg>
  );
}

function Sparkline({
  data,
  color,
  width = 72,
  height = 28,
}: {
  data: number[];
  color: string;
  width?: number;
  height?: number;
}) {
  if (data.length < 2) {
    return <span className="an-sparkline-empty" aria-hidden />;
  }

  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const span = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = height - ((value - min) / span) * (height - 6) - 3;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      className="an-sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={`spark-${color.replace("#", "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        className="an-sparkline-fill"
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#spark-${color.replace("#", "")})`}
        stroke="none"
      />
      <polyline className="an-sparkline-line" points={points} stroke={color} />
    </svg>
  );
}

function ActivityStreamChart({ feed }: { feed: TickEvent[] }) {
  const data = useMemo(() => [...feed].reverse(), [feed]);
  const max = Math.max(1, ...data.map(tickTotal));
  const [hover, setHover] = useState<number | null>(null);

  return (
    <section className="an-card an-stream">
      <header className="an-card-head">
        <div>
          <h2>Activity stream</h2>
          <p className="an-card-sub">Last {data.length || 0} simulator ticks · stacked by entity</p>
        </div>
        <div className="an-legend">
          {ENTITY_KEYS.map((key) => (
            <span key={key} className="an-legend-item">
              <span className="an-legend-swatch" style={{ background: ENTITY_META[key].color }} />
              {ENTITY_META[key].label}
            </span>
          ))}
        </div>
      </header>

      <div className="an-stream-chart" aria-hidden={data.length === 0}>
        {data.length === 0 ? (
          <div className="an-stream-empty">
            <span className="an-pulse-ring" />
            <p>Waiting for simulator ticks…</p>
          </div>
        ) : (
          data.map((tick, index) => {
            const total = tickTotal(tick);
            return (
              <div
                key={tick.tick}
                className="an-stream-col"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover((value) => (value === index ? null : value))}
              >
                {hover === index && (
                  <div className="an-stream-tip">
                    <strong>Tick {tick.tick}</strong>
                    <span>{total} entities</span>
                    <div className="an-stream-tip-grid">
                      {ENTITY_KEYS.map((key) => (
                        <span key={key}>
                          <i style={{ background: ENTITY_META[key].color }} />
                          {ENTITY_META[key].label} +{tick[key]}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div
                  className="an-stream-stack"
                  style={{ height: `${(total / max) * 100}%` }}
                >
                  {ENTITY_KEYS.map((key) =>
                    tick[key] > 0 ? (
                      <div
                        key={key}
                        className="an-stream-seg"
                        style={{
                          flexGrow: tick[key],
                          background: ENTITY_META[key].color,
                        }}
                      />
                    ) : null
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function EntityMixRing({ feed }: { feed: TickEvent[] }) {
  const totals = useMemo(
    () =>
      ENTITY_KEYS.reduce(
        (acc, key) => {
          acc[key] = feed.reduce((sum, tick) => sum + tick[key], 0);
          return acc;
        },
        { users: 0, posts: 0, tags: 0, follows: 0 } as Record<EntityKey, number>
      ),
    [feed]
  );
  const sum = ENTITY_KEYS.reduce((acc, key) => acc + totals[key], 0) || 1;
  const empty = feed.length === 0 || sum === 0;
  let offset = 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="an-mix">
      <svg viewBox="0 0 100 100" className="an-mix-ring" aria-hidden>
        <circle cx="50" cy="50" r={radius} className="an-mix-track" />
        {!empty &&
          ENTITY_KEYS.map((key) => {
            const fraction = totals[key] / sum;
            const dash = fraction * circumference;
            const circle = (
              <circle
                key={key}
                cx="50"
                cy="50"
                r={radius}
                className="an-mix-seg"
                stroke={ENTITY_META[key].color}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              />
            );
            offset += dash;
            return circle;
          })}
      </svg>
      <div className="an-mix-center">
        <span className="an-mix-value">{empty ? "—" : formatCompact(sum)}</span>
        <span className="an-mix-label">recent mix</span>
      </div>
      <ul className="an-mix-list">
        {ENTITY_KEYS.map((key) => (
          <li key={key}>
            <span className="an-legend-swatch" style={{ background: ENTITY_META[key].color }} />
            <span>{ENTITY_META[key].label}</span>
            <strong>{Math.round((totals[key] / sum) * 100)}%</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HubLoadPanel({
  homeservers,
  maxUsers,
}: {
  homeservers: Homeserver[];
  maxUsers: number;
}) {
  const sorted = useMemo(
    () => [...homeservers].sort((a, b) => b.userCount - a.userCount),
    [homeservers]
  );
  const peak = Math.max(1, ...sorted.map((hs) => hs.userCount));

  return (
    <section className="an-card an-hubs">
      <header className="an-card-head">
        <div>
          <h2>Hub load</h2>
          <p className="an-card-sub">Users per homeserver</p>
        </div>
      </header>
      <ul className="an-hub-list">
        {sorted.map((hs, index) => {
          const color = HUB_YELLOWS[index % HUB_YELLOWS.length];
          const pct = (hs.userCount / peak) * 100;
          const capPct =
            maxUsers > 0 ? Math.min(100, (hs.userCount / maxUsers) * 100) : null;
          const leader = hs.userCount === peak && hs.userCount > 0;
          return (
            <li key={hs.label}>
              <div className="an-hub-row-top">
                <span className="an-hub-name">
                  {leader && (
                    <span
                      className="an-hub-crown"
                      title="Most populated homeserver"
                    >
                      <CrownIcon />
                    </span>
                  )}
                  {hs.label}
                </span>
                <span className="an-hub-count">
                  {hs.userCount}
                  {maxUsers > 0 ? ` / ${maxUsers}` : ""}
                </span>
              </div>
              <div className="an-hub-bar">
                <div
                  className="an-hub-bar-fill"
                  style={
                    {
                      width: `${pct}%`,
                      "--hs-accent": color,
                    } as CSSProperties
                  }
                />
                {capPct !== null && capPct >= 85 && (
                  <span
                    className="an-hub-cap-mark"
                    style={{ left: `${Math.min(capPct, 100)}%` }}
                    title="Capacity limit"
                  />
                )}
              </div>
              <span className={`an-hub-status ${hs.status}`}>{hs.status}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CrossHubFlows({ edges, homeservers }: { edges: Edge[]; homeservers: Homeserver[] }) {
  const labelFor = (key: string) =>
    homeservers.find((hs) => hs.publicKey === key || hs.label === key)?.label ??
    `${key.slice(0, 8)}…`;

  const top = useMemo(
    () => [...edges].sort((a, b) => b.follows - a.follows).slice(0, 6),
    [edges]
  );
  const max = Math.max(1, ...top.map((edge) => edge.follows));

  return (
    <section className="an-card an-flows">
      <header className="an-card-head">
        <div>
          <h2>Cross-hub follows</h2>
          <p className="an-card-sub">Social density between homeservers</p>
        </div>
        <span className="an-flow-total">{edges.length} edges</span>
      </header>
      {top.length === 0 ? (
        <p className="an-muted">No cross-homeserver follows yet.</p>
      ) : (
        <ul className="an-flow-list">
          {top.map((edge) => (
            <li key={`${edge.from}-${edge.to}`}>
              <span className="an-flow-label">
                {labelFor(edge.from)} → {labelFor(edge.to)}
              </span>
              <div className="an-flow-bar-wrap">
                <div
                  className="an-flow-bar"
                  style={{ width: `${(edge.follows / max) * 100}%` }}
                />
              </div>
              <span className="an-flow-count">{edge.follows}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveTickFeed({ feed }: { feed: TickEvent[] }) {
  return (
    <section className="an-card an-feed">
      <header className="an-card-head">
        <div>
          <h2>Live ticks</h2>
          <p className="an-card-sub">Newest first</p>
        </div>
      </header>
      {feed.length === 0 ? (
        <p className="an-muted">Waiting for the next tick…</p>
      ) : (
        <ul className="an-feed-list">
          {feed.map((tick) => (
            <li key={tick.tick} className="an-feed-row">
              <span className="an-feed-tick">#{tick.tick}</span>
              <div className="an-feed-pills">
                {ENTITY_KEYS.map((key) =>
                  tick[key] > 0 ? (
                    <span
                      key={key}
                      className="an-entity-pill"
                      style={
                        {
                          "--pill-color": ENTITY_META[key].color,
                        } as CSSProperties
                      }
                    >
                      +{tick[key]} {ENTITY_META[key].short}
                    </span>
                  ) : null
                )}
                {tickTotal(tick) === 0 && (
                  <span className="an-entity-pill idle">idle</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConfigPanel({
  network,
  simulator,
  feed,
}: {
  network: NetworkInfo;
  simulator: SimulatorInfo;
  feed: TickEvent[];
}) {
  const observed = feedAverages(feed);
  const rows = simulatorRows(simulator, observed);
  const range = (value: [number, number]) => `${value[0]}–${value[1]}`;

  return (
    <section className="an-card an-config">
      <header className="an-card-head">
        <div>
          <h2>Network & simulator</h2>
          <p className="an-card-sub">Configured ranges vs recent tick averages</p>
        </div>
      </header>

      <div className="an-config-grid">
        <div className="an-config-block">
          <h3>Network</h3>
          <dl className="an-kv">
            <div>
              <dt>Bootstrap</dt>
              <dd>{network.bootstrap}</dd>
            </div>
            <div>
              <dt>Pkarr relay</dt>
              <dd>
                <a href={network.pkarrRelay} target="_blank" rel="noreferrer">
                  {network.pkarrRelay}
                </a>
              </dd>
            </div>
          </dl>
        </div>

        <div className="an-config-block">
          <h3>Simulator</h3>
          <dl className="an-kv">
            <div>
              <dt>Tick interval</dt>
              <dd>{simulator.intervalSecs}s</dd>
            </div>
            <div>
              <dt>Max users / HS</dt>
              <dd>
                {simulator.maxUsersPerHomeserver > 0
                  ? simulator.maxUsersPerHomeserver
                  : "Unlimited"}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <div className="an-compare">
        {rows.map((row) => (
          <div key={row.key} className="an-compare-row">
            <span className="an-compare-label">{row.label}</span>
            <span className="an-compare-range">{range(row.range)}</span>
            <div className="an-compare-meter">
              <span
                className="an-compare-expected"
                style={{
                  left: `${(row.expected / Math.max(row.range[1], row.range[0], 1)) * 100}%`,
                }}
                title="Expected midpoint"
              />
              <span
                className={`an-compare-observed ${row.inRange ? "ok" : "warn"}`}
                style={{
                  width: `${Math.min(100, (row.observed / Math.max(row.range[1], row.range[0], 1)) * 100)}%`,
                  background: ENTITY_META[row.key].color,
                }}
              />
            </div>
            <span className={`an-compare-value ${row.inRange ? "ok" : "warn"}`}>
              {row.observed.toFixed(1)} avg
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  hint,
  accent,
  spark,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: string;
  spark?: number[];
}) {
  return (
    <article className="an-kpi" style={accent ? ({ "--kpi-accent": accent } as CSSProperties) : undefined}>
      <div className="an-kpi-top">
        <span className="an-kpi-label">{label}</span>
        {spark && accent && <Sparkline data={spark} color={accent} />}
      </div>
      <span className="an-kpi-value">{value}</span>
      {hint && <span className="an-kpi-hint">{hint}</span>}
    </article>
  );
}

export function AnalyticsView({
  state,
  feed,
  connected,
}: {
  state: DashboardState;
  feed: TickEvent[];
  connected: boolean;
}) {
  const { homeservers, activity, simulator, network, edges } = state;
  const active = homeservers.filter((hs) => hs.status === "active").length;
  const totalUsers = homeservers.reduce((sum, hs) => sum + hs.userCount, 0);
  const rate = entitiesPerMinute(feed, simulator.intervalSecs);
  const crossFollows = state.follows?.length ?? 0;

  const [history, setHistory] = useState<Record<string, number[]>>(() => ({
    ticks: [],
    entities: [],
    users: [],
    posts: [],
    tags: [],
    follows: [],
  }));

  useEffect(() => {
    setHistory((prev) => ({
      ticks: [...prev.ticks, activity.ticks].slice(-SPARKLINE_LEN),
      entities: [...prev.entities, activityGrandTotal(activity)].slice(-SPARKLINE_LEN),
      users: [...prev.users, activity.users].slice(-SPARKLINE_LEN),
      posts: [...prev.posts, activity.posts].slice(-SPARKLINE_LEN),
      tags: [...prev.tags, activity.tags].slice(-SPARKLINE_LEN),
      follows: [...prev.follows, activity.follows].slice(-SPARKLINE_LEN),
    }));
  }, [activity]);

  const throughputSpark = useMemo(
    () => [...feed].reverse().map(tickTotal).slice(-SPARKLINE_LEN),
    [feed]
  );

  const grandTotal = activityGrandTotal(activity);

  return (
    <div className="analytics">
      <header className="an-hero">
        <div className="an-hero-copy">
          <p className="an-eyebrow">Simulator analytics</p>
          <h1>Network pulse</h1>
          <p className="an-hero-sub">
            Live throughput, entity mix, and homeserver load from the antfarm simulator.
          </p>
        </div>
        <div className="an-hero-meta">
          <span className={`an-live ${connected ? "online" : "offline"}`}>
            <span className="an-live-dot" />
            {connected ? "Live" : "Reconnecting"}
          </span>
          <div className="an-rate">
            <span className="an-rate-value">{formatRate(rate)}</span>
            <span className="an-rate-label">entities / min</span>
          </div>
        </div>
      </header>

      <section className="an-kpi-row">
        <KpiCard
          label="Throughput"
          value={rate === null ? "—" : `${formatRate(rate)}/m`}
          hint={`${simulator.intervalSecs}s tick interval`}
          accent="#fefa3d"
          spark={throughputSpark}
        />
        <KpiCard
          label="Entities created"
          value={formatCompact(grandTotal)}
          hint={`${activity.ticks} ticks total`}
          accent="#ffc93c"
          spark={history.entities}
        />
        <KpiCard
          label="Homeservers"
          value={String(homeservers.length)}
          hint={`${active} active · ${homeservers.length - active} dormant`}
          accent="#ff9e2c"
        />
        <KpiCard
          label="Users online"
          value={formatCompact(totalUsers)}
          hint={`${crossFollows} cross-hub follow edges`}
          accent="#e07b1e"
          spark={history.users}
        />
      </section>

      <ActivityStreamChart feed={feed} />

      <div className="an-grid">
        <div className="an-grid-main">
          <section className="an-card an-totals">
            <header className="an-card-head">
              <div>
                <h2>Cumulative totals</h2>
                <p className="an-card-sub">Since antfarm start</p>
              </div>
            </header>
            <div className="an-totals-grid">
              <article className="an-total-tile">
                <Sparkline data={history.ticks} color="#8a8a8a" />
                <span className="an-total-value">{activity.ticks}</span>
                <span className="an-total-label">Ticks</span>
              </article>
              {ENTITY_KEYS.map((key) => (
                <article key={key} className="an-total-tile">
                  <Sparkline data={history[key]} color={ENTITY_META[key].color} />
                  <span className="an-total-value">{activity[key]}</span>
                  <span className="an-total-label">{ENTITY_META[key].label}</span>
                </article>
              ))}
            </div>
          </section>

          <LiveTickFeed feed={feed} />
        </div>

        <aside className="an-grid-side">
          <EntityMixRing feed={feed} />
          <HubLoadPanel
            homeservers={homeservers}
            maxUsers={simulator.maxUsersPerHomeserver}
          />
          <CrossHubFlows edges={edges ?? []} homeservers={homeservers} />
        </aside>
      </div>

      <ConfigPanel network={network} simulator={simulator} feed={feed} />
    </div>
  );
}
