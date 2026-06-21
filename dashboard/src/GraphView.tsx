import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type WheelEvent as ReactWheelEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { FollowEdge, Homeserver, User } from "./useDashboard";
import type { TickEvent } from "./useActivity";
import { loadAvatar, loadProfile, loadTags } from "./pubky";
import { ROOT_RATIO, ROOT_VIEWBOX, RootPaths } from "./RootMark";

const HUB_SPACING = 560;
const HUB_R = 28;
const USER_R = 15;
const MIN_K = 0.15;
const MAX_K = 2.5;

// Distinct hues for clusters; cycled by homeserver seed.
// Led by the brand palette (blue / yellow / pink), then complementary tints.
const PALETTE = [
  "#fefa3d",
  "#6db5ff",
  "#ff5de7",
  "#54d1ff",
  "#ffb454",
  "#b78cff",
  "#8ce06a",
  "#ff8f6b",
  "#39d3c3",
  "#c0c0c0",
];

function colorFor(seed: number): string {
  return PALETTE[seed % PALETTE.length];
}

// Pick black or white for best contrast against a node's fill color.
function contrastInk(hex: string): string {
  const c = hex.replace("#", "");
  const toLin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = toLin(parseInt(c.slice(0, 2), 16));
  const g = toLin(parseInt(c.slice(2, 4), 16));
  const b = toLin(parseInt(c.slice(4, 6), 16));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.42 ? "#0d0d0d" : "rgba(255,255,255,0.95)";
}

interface Node {
  id: string;
  kind: "hub" | "user";
  x: number;
  y: number;
  r: number;
  color: string;
  hs: Homeserver;
  user?: User;
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

interface Built {
  nodes: Node[];
  hubs: Node[];
  byUserIndex: Map<number, Node>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

function ringRadius(userCount: number): number {
  return Math.max(110, Math.min(250, 80 + userCount * 6));
}

function build(homeservers: Homeserver[]): Built {
  const nodes: Node[] = [];
  const hubs: Node[] = [];
  const byUserIndex = new Map<number, Node>();

  const cols = Math.max(1, Math.ceil(Math.sqrt(homeservers.length)));
  homeservers.forEach((hs, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const hx = col * HUB_SPACING;
    const hy = row * HUB_SPACING;
    const color = colorFor(hs.seed);

    const hub: Node = {
      id: `hub:${hs.label}`,
      kind: "hub",
      x: hx,
      y: hy,
      r: HUB_R,
      color,
      hs,
    };
    nodes.push(hub);
    hubs.push(hub);

    const n = hs.users.length;
    const rr = ringRadius(n);
    hs.users.forEach((user, j) => {
      // Two interleaved rings when a cluster is crowded.
      const ring = n > 16 && j % 2 === 1 ? rr + 58 : rr;
      const angle = (j / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const node: Node = {
        id: `user:${user.index}`,
        kind: "user",
        x: hx + ring * Math.cos(angle),
        y: hy + ring * Math.sin(angle),
        r: USER_R,
        color,
        hs,
        user,
      };
      nodes.push(node);
      byUserIndex.set(user.index, node);
    });
  });

  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const bounds = {
    minX: Math.min(0, ...xs),
    minY: Math.min(0, ...ys),
    maxX: Math.max(0, ...xs),
    maxY: Math.max(0, ...ys),
  };

  return { nodes, hubs, byUserIndex, bounds };
}

function KeyGlyph({ r, ink }: { r: number; ink: string }) {
  // A key (bow + blade with teeth) scaled to the node radius — each user is a pubky key.
  const w = Math.max(1.3, r * 0.15);
  return (
    <g
      className="gv-key"
      pointerEvents="none"
      strokeWidth={w}
      style={{ stroke: ink }}
      transform={`rotate(45) scale(0.7)`}
    >
      <circle cx={-r * 0.34} cy={-r * 0.34} r={r * 0.32} />
      <line x1={-r * 0.12} y1={-r * 0.12} x2={r * 0.62} y2={r * 0.62} />
      <line x1={r * 0.36} y1={r * 0.36} x2={r * 0.58} y2={r * 0.14} />
      <line x1={r * 0.56} y1={r * 0.56} x2={r * 0.78} y2={r * 0.34} />
    </g>
  );
}

function LoupeIcon({ sign }: { sign: "plus" | "minus" }) {
  // Magnifying glass with a +/- inside the lens.
  return (
    <svg viewBox="0 0 24 24" className="gv-ico" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <line x1="15.2" y1="15.2" x2="20.5" y2="20.5" />
      <line x1="7.5" y1="10.5" x2="13.5" y2="10.5" />
      {sign === "plus" && <line x1="10.5" y1="7.5" x2="10.5" y2="13.5" />}
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" className="gv-ico" aria-hidden="true">
      <line x1="12" y1="5.5" x2="12" y2="18.5" />
      <line x1="5.5" y1="12" x2="18.5" y2="12" />
    </svg>
  );
}

function FitIcon() {
  // Corner frame brackets ("fit to view").
  return (
    <svg viewBox="0 0 24 24" className="gv-ico" aria-hidden="true">
      <path d="M4 9V5a1 1 0 0 1 1-1h4" />
      <path d="M20 9V5a1 1 0 0 0-1-1h-4" />
      <path d="M4 15v4a1 1 0 0 0 1 1h4" />
      <path d="M20 15v4a1 1 0 0 1-1 1h-4" />
    </svg>
  );
}

export function GraphView({
  homeservers,
  follows,
  feed,
  onSelect,
  nextIndex,
  busy,
  onCreateHomeserver,
}: {
  homeservers: Homeserver[];
  follows: FollowEdge[];
  feed: TickEvent[];
  onSelect: (hs: Homeserver) => void;
  nextIndex: number;
  busy: boolean;
  onCreateHomeserver: (index: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 640 });
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  // Follows are hidden until a user is clicked; then only that user's follows show.
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  // Create-homeserver flyout.
  const [createOpen, setCreateOpen] = useState(false);
  const [seed, setSeed] = useState(String(nextIndex));
  const seedRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!createOpen) setSeed(String(nextIndex));
  }, [nextIndex, createOpen]);
  useEffect(() => {
    if (createOpen) seedRef.current?.focus();
  }, [createOpen]);
  const seedNum = Number(seed);
  const seedValid = Number.isInteger(seedNum) && seedNum >= 1 && seedNum <= 23;
  const submitCreate = () => {
    if (busy || !seedValid) return;
    onCreateHomeserver(seedNum);
    setCreateOpen(false);
  };

  const built = useMemo(() => build(homeservers), [homeservers]);

  // Track container size for fit math and pointer mapping.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const fit = useMemo(
    () => () => {
      const { minX, minY, maxX, maxY } = built.bounds;
      const pad = 120;
      const w = maxX - minX + pad * 2;
      const h = maxY - minY + pad * 2;
      const k = Math.max(
        MIN_K,
        Math.min(MAX_K, Math.min(size.w / w, size.h / h))
      );
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      setT({ x: size.w / 2 - cx * k, y: size.h / 2 - cy * k, k });
    },
    [built.bounds, size.w, size.h]
  );

  // Auto-fit when the cluster count changes or on first measure.
  const hubCount = built.hubs.length;
  const fittedFor = useRef<string>("");
  useEffect(() => {
    const key = `${hubCount}:${size.w}x${size.h}`;
    if (size.w > 0 && fittedFor.current !== key) {
      fittedFor.current = key;
      fit();
    }
  }, [hubCount, size.w, size.h, fit]);

  // --- Pan ---
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null
  );
  const moved = useRef(false);
  const onMouseDown = (e: ReactMouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    moved.current = false;
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
    setT((p) => ({ ...p, x: drag.current!.tx + dx, y: drag.current!.ty + dy }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  // --- Zoom ---
  const zoomAround = (px: number, py: number, factor: number) => {
    setT((p) => {
      const k = Math.max(MIN_K, Math.min(MAX_K, p.k * factor));
      const wx = (px - p.x) / p.k;
      const wy = (py - p.y) / p.k;
      return { k, x: px - wx * k, y: py - wy * k };
    });
  };
  const onWheel = (e: ReactWheelEvent) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    zoomAround(px, py, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };
  const zoomCenter = (factor: number) => zoomAround(size.w / 2, size.h / 2, factor);

  // The "active" user is the clicked (pinned) one, or otherwise the hovered one.
  const activeUser = useMemo(() => {
    if (selectedUser != null) return selectedUser;
    if (hover && hover.startsWith("user:")) return Number(hover.slice(5));
    return null;
  }, [selectedUser, hover]);

  // Users that participate in at least one cross-homeserver follow.
  const usersWithFollows = useMemo(() => {
    const s = new Set<number>();
    follows.forEach((f) => {
      s.add(f.from);
      s.add(f.to);
    });
    return s;
  }, [follows]);

  // Follows drawn for the active user (revealed on hover, pinned on click).
  const shownFollows = useMemo(
    () =>
      activeUser == null
        ? []
        : follows.filter((f) => f.from === activeUser || f.to === activeUser),
    [follows, activeUser]
  );

  // Highlight set: active user + its hub + follow neighbors; or a hovered hub's cluster.
  const focus = useMemo(() => {
    if (activeUser != null) {
      const set = new Set<string>([`user:${activeUser}`]);
      const node = built.byUserIndex.get(activeUser);
      if (node) set.add(`hub:${node.hs.label}`);
      follows.forEach((f) => {
        if (f.from === activeUser) set.add(`user:${f.to}`);
        if (f.to === activeUser) set.add(`user:${f.from}`);
      });
      return set;
    }
    if (hover && hover.startsWith("hub:")) {
      const set = new Set<string>([hover]);
      const label = hover.slice(4);
      built.nodes.forEach((n) => {
        if (n.kind === "user" && n.hs.label === label) set.add(n.id);
      });
      return set;
    }
    return null;
  }, [activeUser, hover, built, follows]);

  const isLit = (id: string) => !focus || focus.has(id);

  const hoverNode = hover
    ? built.nodes.find((n) => n.id === hover) ?? null
    : null;

  const totalUsers = homeservers.reduce((s, h) => s + h.userCount, 0);
  const activeHs = homeservers.filter((h) => h.status === "active").length;

  return (
    <div className="gv" ref={wrapRef} onWheel={onWheel}>
      <svg
        className="gv-svg"
        width={size.w}
        height={size.h}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={endDrag}
        onClick={() => {
          if (!moved.current) setSelectedUser(null);
        }}
      >
        <defs>
          <pattern
            id="gv-grid"
            width="30"
            height="30"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="2" cy="2" r="1.3" className="gv-grid-dot" />
          </pattern>
          <marker
            id="gv-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L10,5 L0,10 z" className="gv-arrow-head" />
          </marker>
        </defs>

        <rect
          className="gv-bg"
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          fill="url(#gv-grid)"
        />

        <g transform={`translate(${t.x} ${t.y}) scale(${t.k})`}>
          {/* membership spokes: hub -> its users */}
          <g className="gv-spokes">
            {built.nodes.map((n) =>
              n.kind === "user" ? (
                <line
                  key={`spoke:${n.id}`}
                  className={`gv-spoke ${
                    isLit(n.id) && isLit(`hub:${n.hs.label}`) ? "" : "dim"
                  }`}
                  x1={n.x}
                  y1={n.y}
                  x2={
                    built.hubs.find((h) => h.hs.label === n.hs.label)?.x ?? n.x
                  }
                  y2={
                    built.hubs.find((h) => h.hs.label === n.hs.label)?.y ?? n.y
                  }
                  stroke={n.color}
                />
              ) : null
            )}
          </g>

          {/* follows for the selected user only */}
          <g className="gv-follows">
            {shownFollows.map((f) => {
              const a = built.byUserIndex.get(f.from);
              const b = built.byUserIndex.get(f.to);
              if (!a || !b) return null;
              const outgoing = f.from === activeUser;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const dist = Math.hypot(dx, dy) || 1;
              const ux = dx / dist;
              const uy = dy / dist;
              const sx = a.x + ux * a.r;
              const sy = a.y + uy * a.r;
              const tx = b.x - ux * (b.r + 5);
              const ty = b.y - uy * (b.r + 5);
              const mx = (sx + tx) / 2 - uy * Math.min(50, dist * 0.12);
              const my = (sy + ty) / 2 + ux * Math.min(50, dist * 0.12);
              return (
                <g key={`f:${f.from}-${f.to}`}>
                  <path
                    className={`gv-follow hot ${outgoing ? "out" : "in"}`}
                    d={`M ${sx} ${sy} Q ${mx} ${my} ${tx} ${ty}`}
                    markerEnd="url(#gv-arrow)"
                  />
                  <text className="gv-follow-label" x={mx} y={my}>
                    {outgoing ? "follows" : "follower"}
                  </text>
                </g>
              );
            })}
          </g>

          {/* nodes */}
          <g className="gv-nodes">
            {built.nodes.map((n) => {
              const lit = isLit(n.id);
              const active = n.hs.status === "active";
              return (
                <g
                  key={n.id}
                  className={`gv-node ${n.kind} ${lit ? "" : "dim"} ${
                    active ? "on" : "off"
                  } ${
                    n.kind === "user" && selectedUser === n.user?.index
                      ? "sel"
                      : ""
                  }`}
                  transform={`translate(${n.x} ${n.y})`}
                  onMouseEnter={() => setHover(n.id)}
                  onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (moved.current) return;
                    if (n.kind === "user") {
                      // Toggle the user's follows on/off.
                      setSelectedUser((cur) =>
                        cur === n.user!.index ? null : n.user!.index
                      );
                    } else {
                      onSelect(n.hs);
                    }
                  }}
                >
                  {n.kind === "hub" ? (
                    <>
                      <circle
                        className="gv-hub-disc"
                        r={n.r}
                        style={{ fill: n.color }}
                      />
                      {(() => {
                        const rw = n.r * 1.5;
                        const rh = rw * ROOT_RATIO;
                        return (
                          <svg
                            className="gv-hub-root"
                            x={-rw / 2}
                            y={-rh / 2}
                            width={rw}
                            height={rh}
                            viewBox={ROOT_VIEWBOX}
                            pointerEvents="none"
                          >
                            <RootPaths />
                          </svg>
                        );
                      })()}
                      <text className="gv-hub-label" y={-n.r - 12}>
                        {n.hs.label}
                      </text>
                      <text className="gv-hub-count" y={n.r + 18}>
                        {n.hs.userCount} users
                      </text>
                    </>
                  ) : (
                    <>
                      <circle
                        className="gv-user-core"
                        r={n.r}
                        style={{ fill: n.color }}
                      />
                      <KeyGlyph r={n.r} ink={contrastInk(n.color)} />
                      {usersWithFollows.has(n.user!.index) && (
                        <circle
                          className="gv-follow-badge"
                          cx={n.r * 0.72}
                          cy={-n.r * 0.72}
                          r={4.5}
                        />
                      )}
                    </>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {/* hover detail card */}
      {hoverNode && (
        <HoverCard
          node={hoverNode}
          left={hoverNode.x * t.k + t.x}
          top={hoverNode.y * t.k + t.y}
        />
      )}

      {/* create + zoom / fit controls */}
      <div className="gv-controls">
        <div className={`gv-create-bar ${createOpen ? "open" : ""}`}>
          <button
            className="gv-create-toggle"
            onClick={() => setCreateOpen((o) => !o)}
            aria-label="Create homeserver"
            aria-expanded={createOpen}
            title="Create homeserver"
          >
            <PlusIcon />
          </button>
          {createOpen && (
            <div className="gv-create-fields">
              <span className="gv-create-label">Seed</span>
              <input
                ref={seedRef}
                type="number"
                min={1}
                max={23}
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitCreate();
                  if (e.key === "Escape") setCreateOpen(false);
                }}
                aria-label="Homeserver seed index"
              />
              <button
                className="gv-create-go"
                onClick={submitCreate}
                disabled={busy || !seedValid}
              >
                Create
              </button>
            </div>
          )}
        </div>
        <button
          onClick={() => zoomCenter(1.2)}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <LoupeIcon sign="plus" />
        </button>
        <button
          onClick={() => zoomCenter(1 / 1.2)}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <LoupeIcon sign="minus" />
        </button>
        <button
          className="gv-fit"
          onClick={fit}
          aria-label="Fit to view"
          title="Fit to view"
        >
          <FitIcon />
        </button>
      </div>

      {/* legend */}
      <div className="gv-legend">
        <span>
          <span className="dot active" /> active {activeHs}
        </span>
        <span>
          <span className="dot dormant" /> dormant {homeservers.length - activeHs}
        </span>
        <span className="muted small">
          {homeservers.length} homeservers · {totalUsers} users ·{" "}
          {activeUser != null
            ? `user #${activeUser}: ${shownFollows.length} follows`
            : "hover a user to reveal follows · click to pin"}
        </span>
      </div>

      <Timeline feed={feed} />
    </div>
  );
}

/**
 * Reads a user's real profile (name + avatar) straight from their homeserver
 * via the pubky client, falling back to whatever the backend already provided
 * while the fetch is in flight.
 */
function useProfile(pk: string | null) {
  const [name, setName] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    setName(null);
    setAvatar(null);
    setTags([]);
    if (!pk) return;
    let alive = true;
    loadProfile(pk).then((profile) => {
      if (!alive || !profile) return;
      if (profile.name) setName(profile.name);
      loadAvatar(profile.image).then((url) => {
        if (alive && url) setAvatar(url);
      });
    });
    loadTags(pk).then((t) => {
      if (alive) setTags(t);
    });
    return () => {
      alive = false;
    };
  }, [pk]);

  return { name, avatar, tags };
}

function HoverCard({
  node,
  left,
  top,
}: {
  node: Node;
  left: number;
  top: number;
}) {
  const pk = node.kind === "user" ? node.user?.publicKey ?? null : null;
  const { name, avatar, tags } = useProfile(pk);
  const idx = node.user?.index;
  const title =
    node.kind === "hub"
      ? node.hs.label
      : name ?? node.user?.name ?? `user #${idx}`;
  const fullKey =
    node.kind === "user" ? node.user?.publicKey : node.hs.publicKey;
  return (
    <div className="gv-card" style={{ left, top }} role="tooltip">
      <div className="gv-card-head">
        {node.kind === "user" && avatar ? (
          <img className="gv-card-avatar" src={avatar} alt="" />
        ) : (
          <span
            className="gv-card-avatar fallback"
            style={{ background: node.color }}
          >
            {node.kind === "user" ? "👤" : node.hs.label.slice(0, 2)}
          </span>
        )}
        <div className="gv-card-title">
          <strong>{title}</strong>
          <span className="gv-card-sub">
            {node.kind === "user" ? `@ ${node.hs.label}` : "homeserver"}
          </span>
        </div>
      </div>

      {fullKey && (
        <code className="gv-card-pk" title={fullKey}>
          {shortKey(fullKey)}
        </code>
      )}

      {node.kind === "user" && tags.length > 0 && (
        <div className="gv-card-tags">
          {tags.slice(0, 6).map((t) => {
            const c = tagColor(t);
            return (
              <span
                key={t}
                className="gv-tag"
                style={{ background: c, color: contrastInk(c), borderColor: c }}
              >
                {t}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function shortKey(key: string): string {
  return key.length > 16 ? `${key.slice(0, 8)}…${key.slice(-6)}` : key;
}

// Stable brand color per tag label.
const TAG_COLORS = [
  "#6db5ff",
  "#fefa3d",
  "#ff5de7",
  "#8ce06a",
  "#ffb454",
  "#b78cff",
];
function tagColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

function Timeline({ feed }: { feed: TickEvent[] }) {
  // feed is newest-first; show oldest-left.
  const data = [...feed].reverse();
  const max = Math.max(
    1,
    ...data.map((d) => d.users + d.posts + d.tags + d.follows)
  );
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="gv-timeline">
      <div className="gv-timeline-bars">
        {data.length === 0 && (
          <span className="muted small">Waiting for activity…</span>
        )}
        {data.map((d, i) => {
          const total = d.users + d.posts + d.tags + d.follows;
          return (
            <div
              key={d.tick}
              className="gv-bar-wrap"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover((h) => (h === i ? null : h))}
            >
              {hover === i && (
                <div className="gv-bar-tip">
                  tick {d.tick} · {total} entities
                </div>
              )}
              <div
                className="gv-bar"
                style={{ height: `${(total / max) * 100}%` }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
