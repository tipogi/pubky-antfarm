import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type {
  FollowEdge,
  Homeserver,
  InfraNode as InfraNodeData,
  InfraNodeKind,
  NetworkInfo,
  User,
} from "./useDashboard";
import type { TickEvent } from "./useActivity";
import { loadAvatar, loadProfile, loadTags, type UserStorageContext } from "./pubky";
import { ROOT_RATIO, ROOT_VIEWBOX, RootPaths } from "./RootMark";
import { DHT_VIEWBOX, DhtPaths } from "./DhtMark";
import { PKARR_VIEWBOX, PkarrPaths } from "./PkarrMark";
import { HTTP_VIEWBOX, HttpPaths } from "./HttpMark";
import { hubColorFor } from "./hubColors";

const HUB_SPACING = 560;
const HUB_R = 40;
const USER_R = 20;
const INFRA_R = 27;
const SOCIAL_Y_OFFSET = 300;
const MIN_K = 0.15;
const MAX_K = 2.5;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// One color per category. Every homeserver shares HS_COLOR, every user shares
// USER_COLOR, and every DHT node (shared testnet peers + per-homeserver
// participants) shares INFRA_COLORS.dht_peer. Identity comes from color, not
// shape, size, or position.
const HS_COLOR = "#4DA3FF";
const USER_COLOR = "#B07CFF";
// DHT nodes reuse the green identity color of the second homeserver (seed 1) as
// shown in the homeserver list, keeping the two in sync.
const DHT_COLOR = hubColorFor(1).color;
// Both relays (pkarr + http) share one relay color.
const RELAY_COLOR = "#E0654F";
const INFRA_COLORS: Record<InfraNodeKind, string> = {
  bootstrap: "#F0C34A",
  dht_peer: DHT_COLOR,
  pkarr_relay: RELAY_COLOR,
  http_relay: RELAY_COLOR,
};

function darkenHex(hex: string, mix = 0.3): string {
  const c = hex.replace("#", "");
  const ch = (i: number) => parseInt(c.slice(i, i + 2), 16);
  const dim = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * (1 - mix))));
  return `#${dim(ch(0)).toString(16).padStart(2, "0")}${dim(ch(2))
    .toString(16)
    .padStart(2, "0")}${dim(ch(4)).toString(16).padStart(2, "0")}`;
}

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
  kind: "infra" | "hub" | "user" | "dht_client";
  x: number;
  y: number;
  r: number;
  color: string;
  hs?: Homeserver;
  user?: User;
  infra?: InfraNodeData;
}

interface Built {
  nodes: Node[];
  hubs: Node[];
  dhtClients: Node[];
  infra: Node[];
  byUserIndex: Map<number, Node>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

function ringRadius(userCount: number): number {
  return Math.max(110, Math.min(250, 80 + userCount * 6));
}

// Positions are placeholders; the real coordinates are assigned by
// scatterFloating so infra sits in the negative space between clusters.
function buildInfra(nodes: InfraNodeData[]): Node[] {
  return nodes.map((infra) => ({
    id: `infra:${infra.id}`,
    kind: "infra" as const,
    x: 0,
    y: 0,
    r: infra.kind === "bootstrap" ? HUB_R : INFRA_R,
    color: INFRA_COLORS[infra.kind],
    infra,
  }));
}

// Spread non-social nodes (shared infra + per-homeserver DHT participants)
// organically with a small, deterministic force-directed relaxation: they repel
// each other (even spacing), get pushed out of homeserver clusters (settling in
// the negative space between them), and are gently reined toward the center so
// they weave through the graph instead of drifting off to the edges.
function scatterFloating(floating: Node[], hubs: Node[], bounds: Built["bounds"]) {
  const N = floating.length;
  if (N === 0) return;

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const footprint =
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
  const reach = Math.max(footprint, 260);

  // Deterministic phyllotaxis seed inside the footprint.
  floating.forEach((node, i) => {
    const a = i * GOLDEN_ANGLE;
    const rad = reach * 0.85 * Math.sqrt((i + 0.5) / N);
    node.x = cx + rad * Math.cos(a);
    node.y = cy + rad * Math.sin(a);
  });

  const sep = 2 * INFRA_R + 46; // desired gap between two floating nodes
  for (let iter = 0; iter < 170; iter++) {
    for (let i = 0; i < N; i++) {
      const node = floating[i];
      let fx = 0;
      let fy = 0;

      for (let j = 0; j < N; j++) {
        if (i === j) continue;
        const o = floating[j];
        const dx = node.x - o.x;
        const dy = node.y - o.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < sep) {
          const f = ((sep - d) / sep) * 6;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
      }

      for (const hub of hubs) {
        const clusterR = ringRadius(hub.hs?.users.length ?? 0) + INFRA_R + 64;
        const dx = node.x - hub.x;
        const dy = node.y - hub.y;
        const d = Math.hypot(dx, dy) || 0.01;
        if (d < clusterR) {
          const f = ((clusterR - d) / clusterR) * 15;
          fx += (dx / d) * f;
          fy += (dy / d) * f;
        }
      }

      const dcx = cx - node.x;
      const dcy = cy - node.y;
      const dc = Math.hypot(dcx, dcy) || 0.01;
      if (dc > reach) {
        const pull = (dc - reach) * 0.08;
        fx += (dcx / dc) * pull;
        fy += (dcy / dc) * pull;
      }

      node.x += fx;
      node.y += fy;
    }
  }
}

function build(homeservers: Homeserver[], yOffset: number): Built {
  const nodes: Node[] = [];
  const hubs: Node[] = [];
  const dhtClients: Node[] = [];
  const byUserIndex = new Map<number, Node>();

  const maxRing = homeservers.reduce(
    (m, hs) => Math.max(m, ringRadius(hs.users.length)),
    HUB_R
  );
  const spacing = Math.max(HUB_SPACING, maxRing * 2 + 140);
  const spiralC = spacing * 0.6;

  homeservers.forEach((hs, i) => {
    const angle = i * GOLDEN_ANGLE;
    const radius = i === 0 ? 0 : Math.max(spacing, spiralC * Math.sqrt(i));
    const hx = radius * Math.cos(angle);
    const hy = radius * Math.sin(angle) + yOffset;

    const hub: Node = {
      id: `hub:${hs.label}`,
      kind: "hub",
      x: hx,
      y: hy,
      r: HUB_R,
      color: HS_COLOR,
      hs,
    };
    nodes.push(hub);
    hubs.push(hub);

    // Each homeserver spins up its own pkarr/mainline DHT participant after
    // creation. Same color and size as the shared testnet DHT peers; position
    // is assigned later by scatterFloating (not tied to this homeserver).
    const dhtClient: Node = {
      id: `dht:${hs.label}`,
      kind: "dht_client",
      x: 0,
      y: 0,
      r: INFRA_R,
      color: INFRA_COLORS.dht_peer,
      hs,
    };
    dhtClients.push(dhtClient);

    const n = hs.users.length;
    const rr = ringRadius(n);
    hs.users.forEach((user, j) => {
      const ring = n > 16 && j % 2 === 1 ? rr + 58 : rr;
      const userAngle = (j / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const node: Node = {
        id: `user:${user.index}`,
        kind: "user",
        x: hx + ring * Math.cos(userAngle),
        y: hy + ring * Math.sin(userAngle),
        r: USER_R,
        color: USER_COLOR,
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

  return { nodes, hubs, dhtClients, infra: [], byUserIndex, bounds };
}

function mergeBounds(
  a: Built["bounds"],
  infra: Node[]
): Built["bounds"] {
  const xs = infra.map((n) => n.x);
  const ys = infra.map((n) => n.y);
  return {
    minX: Math.min(a.minX, ...xs),
    minY: Math.min(a.minY, ...ys),
    maxX: Math.max(a.maxX, ...xs),
    maxY: Math.max(a.maxY, ...ys),
  };
}

function userVisible(
  node: Node,
  expandedHs: string | null,
  spotlightUsers: Set<number>
): boolean {
  if (node.kind !== "user" || !node.user || !node.hs) return false;
  return (
    node.hs.label === expandedHs || spotlightUsers.has(node.user.index)
  );
}

function isSpotlightOnly(
  node: Node,
  expandedHs: string | null,
  spotlightUsers: Set<number>
): boolean {
  if (node.kind !== "user" || !node.user || !node.hs) return false;
  return (
    spotlightUsers.has(node.user.index) && node.hs.label !== expandedHs
  );
}

// Every node type is the same circular token; identity comes from tone + size,
// never from shape.
function InfraShape({ node }: { node: Node }) {
  return (
    <circle
      className="gv-infra-shape"
      r={node.r}
      style={{ fill: node.color, stroke: darkenHex(node.color, 0.4), strokeWidth: 2 }}
    />
  );
}

// Icon glyph centered inside a node, tinted for contrast against its fill.
function NodeGlyph({
  r,
  ink,
  viewBox,
  scale = 1.5,
  children,
}: {
  r: number;
  ink: string;
  viewBox: string;
  scale?: number;
  children: ReactNode;
}) {
  const s = r * scale;
  return (
    <svg
      className="gv-node-glyph"
      x={-s / 2}
      y={-s / 2}
      width={s}
      height={s}
      viewBox={viewBox}
      pointerEvents="none"
      style={{ color: ink }}
    >
      {children}
    </svg>
  );
}

function KeyGlyph({ r, ink }: { r: number; ink: string }) {
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
  network,
  homeservers,
  follows,
  feed,
  nextIndex,
  busy,
  onCreateHomeserver,
}: {
  network: NetworkInfo;
  homeservers: Homeserver[];
  follows: FollowEdge[];
  feed: TickEvent[];
  nextIndex: number;
  busy: boolean;
  onCreateHomeserver: (index: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 900, h: 640 });
  const [t, setT] = useState<Transform>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  // Keep the hover card alive briefly after leaving a node so the pointer can
  // travel onto the card itself (e.g. to click the copy button).
  const hoverClear = useRef<number | null>(null);
  const enterHover = (id: string) => {
    if (hoverClear.current) {
      clearTimeout(hoverClear.current);
      hoverClear.current = null;
    }
    setHover(id);
  };
  const leaveHover = (id: string) => {
    if (hoverClear.current) clearTimeout(hoverClear.current);
    hoverClear.current = window.setTimeout(() => {
      setHover((h) => (h === id ? null : h));
      hoverClear.current = null;
    }, 220);
  };
  const [expandedHs, setExpandedHs] = useState<string | null>(null);
  const [selectedUser, setSelectedUser] = useState<number | null>(null);
  const [spotlightUsers, setSpotlightUsers] = useState<Set<number>>(
    () => new Set()
  );
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

  const built = useMemo(() => {
    const social = build(homeservers, SOCIAL_Y_OFFSET);
    const infra = buildInfra(network.nodes ?? []);
    const floating = [...infra, ...social.dhtClients];
    scatterFloating(floating, social.hubs, social.bounds);
    return {
      ...social,
      infra,
      bounds: mergeBounds(social.bounds, floating),
    };
  }, [homeservers, network.nodes]);

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

  const hubCount = built.hubs.length;
  const fittedFor = useRef<string>("");
  useEffect(() => {
    const key = `${hubCount}:${size.w}x${size.h}:${built.infra.length}`;
    if (size.w > 0 && fittedFor.current !== key) {
      fittedFor.current = key;
      fit();
    }
  }, [hubCount, size.w, size.h, built.infra.length, fit]);

  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null
  );
  const moved = useRef(false);
  const onMouseDown = (e: ReactMouseEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    moved.current = false;
  };
  const onMouseMove = (e: ReactMouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
    const { tx, ty } = d;
    setT((p) => ({ ...p, x: tx + dx, y: ty + dy }));
  };
  const endDrag = () => {
    drag.current = null;
  };

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

  const activeUser = useMemo(() => {
    if (selectedUser != null) return selectedUser;
    if (hover?.startsWith("user:")) return Number(hover.slice(5));
    return null;
  }, [selectedUser, hover]);

  const usersWithFollows = useMemo(() => {
    const s = new Set<number>();
    follows.forEach((f) => {
      s.add(f.from);
      s.add(f.to);
    });
    return s;
  }, [follows]);

  const visibleUsers = useMemo(
    () =>
      built.nodes.filter(
        (n) =>
          n.kind === "user" && userVisible(n, expandedHs, spotlightUsers)
      ),
    [built.nodes, expandedHs, spotlightUsers]
  );

  const focus = useMemo(() => {
    if (activeUser != null) {
      const set = new Set<string>([`user:${activeUser}`]);
      const node = built.byUserIndex.get(activeUser);
      if (node?.hs) set.add(`hub:${node.hs.label}`);
      follows.forEach((f) => {
        if (f.from === activeUser) set.add(`user:${f.to}`);
        if (f.to === activeUser) set.add(`user:${f.from}`);
      });
      return set;
    }
    if (expandedHs) {
      const set = new Set<string>([`hub:${expandedHs}`]);
      const hub = built.hubs.find((h) => h.hs?.label === expandedHs);
      hub?.hs?.users.forEach((u) => set.add(`user:${u.index}`));
      return set;
    }
    return null;
  }, [activeUser, expandedHs, built, follows]);

  const isLit = (id: string) => !focus || focus.has(id);

  const toggleHub = (label: string) => {
    setExpandedHs((cur) => (cur === label ? null : label));
    setSelectedUser(null);
    setSpotlightUsers(new Set());
  };

  const pinUser = (index: number) => {
    if (selectedUser === index) {
      setSelectedUser(null);
      setSpotlightUsers(new Set());
      return;
    }
    const targets = new Set<number>();
    follows.forEach((f) => {
      if (f.from === index) targets.add(f.to);
      if (f.to === index) targets.add(f.from);
    });
    setSelectedUser(index);
    setSpotlightUsers(targets);
  };

  const hoverNode = useMemo(() => {
    if (!hover) return null;
    return (
      built.infra.find((n) => n.id === hover) ??
      built.dhtClients.find((n) => n.id === hover) ??
      built.nodes.find((n) => n.id === hover) ??
      null
    );
  }, [hover, built]);

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
          if (!moved.current) {
            setSelectedUser(null);
            setSpotlightUsers(new Set());
          }
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
          {/* membership spokes: hub -> visible users */}
          <g className="gv-spokes">
            {visibleUsers.map((n) => {
              const hub = built.hubs.find((h) => h.hs?.label === n.hs?.label);
              if (!hub || !n.hs) return null;
              return (
                <line
                  key={`spoke:${n.id}`}
                  className={`gv-spoke ${
                    isLit(n.id) && isLit(`hub:${n.hs.label}`) ? "" : "dim"
                  }`}
                  x1={n.x}
                  y1={n.y}
                  x2={hub.x}
                  y2={hub.y}
                  stroke={n.color}
                />
              );
            })}
          </g>

          {/* on hover, reveal which homeserver a DHT node belongs to */}
          {hoverNode?.kind === "dht_client" &&
            hoverNode.hs &&
            (() => {
              const hub = built.hubs.find(
                (h) => h.hs?.label === hoverNode.hs?.label
              );
              if (!hub) return null;
              return (
                <line
                  className="gv-dht-hover-edge"
                  x1={hoverNode.x}
                  y1={hoverNode.y}
                  x2={hub.x}
                  y2={hub.y}
                  stroke={hoverNode.color}
                />
              );
            })()}

          {/* infrastructure nodes */}
          <g className="gv-infra-nodes">
            {built.infra.map((n) => (
              <g
                key={n.id}
                className="gv-node infra"
                transform={`translate(${n.x} ${n.y})`}
                onMouseEnter={() => enterHover(n.id)}
                onMouseLeave={() => leaveHover(n.id)}
              >
                <InfraShape node={n} />
                {n.infra?.kind === "dht_peer" && (
                  <NodeGlyph r={n.r} ink={contrastInk(n.color)} viewBox={DHT_VIEWBOX}>
                    <DhtPaths />
                  </NodeGlyph>
                )}
                {n.infra?.kind === "pkarr_relay" && (
                  <NodeGlyph r={n.r} ink={contrastInk(n.color)} viewBox={PKARR_VIEWBOX}>
                    <PkarrPaths />
                  </NodeGlyph>
                )}
                {n.infra?.kind === "http_relay" && (
                  <NodeGlyph r={n.r} ink={contrastInk(n.color)} viewBox={HTTP_VIEWBOX}>
                    <HttpPaths />
                  </NodeGlyph>
                )}
              </g>
            ))}
          </g>

          {/* per-homeserver DHT participants (spun up after HS creation) */}
          <g className="gv-dht-clients">
            {built.dhtClients.map((n) => (
              <g
                key={n.id}
                className={`gv-node dht_client ${n.hs?.pending ? "pending" : ""}`}
                transform={`translate(${n.x} ${n.y})`}
                onMouseEnter={() => enterHover(n.id)}
                onMouseLeave={() => leaveHover(n.id)}
              >
                <circle
                  className="gv-dht-client-shape"
                  r={n.r}
                  style={{
                    fill: n.color,
                    stroke: darkenHex(n.color, 0.4),
                    strokeWidth: 1.5,
                  }}
                />
                <NodeGlyph r={n.r} ink={contrastInk(n.color)} viewBox={DHT_VIEWBOX}>
                  <DhtPaths />
                </NodeGlyph>
              </g>
            ))}
          </g>

          {/* social nodes */}
          <g className="gv-nodes">
            {built.nodes.map((n) => {
              if (n.kind === "user" && !userVisible(n, expandedHs, spotlightUsers)) {
                return null;
              }
              const lit = isLit(n.id);
              const active = n.hs?.status === "active";
              const glowId =
                n.kind === "hub"
                  ? `hub-glow-${n.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`
                  : null;
              const spotlight = isSpotlightOnly(n, expandedHs, spotlightUsers);
              return (
                <g
                  key={n.id}
                  className={`gv-node ${n.kind} ${lit ? "" : "dim"} ${
                    active ? "on" : "off"
                  } ${n.hs?.pending ? "pending" : ""} ${
                    n.kind === "user" && selectedUser === n.user?.index
                      ? "sel"
                      : ""
                  } ${n.kind === "hub" && expandedHs === n.hs?.label ? "expanded" : ""} ${
                    spotlight ? "spotlight" : ""
                  }`}
                  transform={`translate(${n.x} ${n.y})`}
                  onMouseEnter={() => enterHover(n.id)}
                  onMouseLeave={() => leaveHover(n.id)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (moved.current) return;
                    if (n.kind === "user" && n.user) {
                      pinUser(n.user.index);
                    } else if (n.kind === "hub" && n.hs && !n.hs.pending) {
                      toggleHub(n.hs.label);
                    }
                  }}
                >
                  {n.kind === "hub" && n.hs ? (
                    <>
                      <defs>
                        <radialGradient
                          id={glowId!}
                          gradientUnits="userSpaceOnUse"
                          cx={0}
                          cy={0}
                          r={n.r + 34}
                        >
                          <stop
                            offset="0%"
                            stopColor={darkenHex(n.color, 0.15)}
                            stopOpacity={0.62}
                          />
                          <stop
                            offset="45%"
                            stopColor={darkenHex(n.color, 0.35)}
                            stopOpacity={0.28}
                          />
                          <stop
                            offset="100%"
                            stopColor={darkenHex(n.color, 0.5)}
                            stopOpacity={0}
                          />
                        </radialGradient>
                      </defs>
                      <circle
                        className="gv-hub-glow"
                        r={n.r + 34}
                        fill={`url(#${glowId})`}
                      />
                      <circle
                        className="gv-hub-core"
                        r={n.r}
                        style={{
                          fill: darkenHex(n.color, 0.1),
                          stroke: darkenHex(n.color, 0.48),
                          strokeWidth: 2.5,
                        }}
                      />
                      {(() => {
                        const rw = n.r * 1.5;
                        const rh = rw * ROOT_RATIO;
                        const ink = contrastInk(n.color);
                        return (
                          <svg
                            className="gv-hub-root"
                            x={-rw / 2}
                            y={-rh / 2}
                            width={rw}
                            height={rh}
                            viewBox={ROOT_VIEWBOX}
                            pointerEvents="none"
                            style={{ fill: ink }}
                          >
                            <RootPaths />
                          </svg>
                        );
                      })()}
                      <text className="gv-hub-label" y={n.r + 22}>
                        {n.hs.label}
                      </text>
                    </>
                  ) : n.kind === "user" && n.user ? (
                    <>
                      <circle
                        className="gv-user-core"
                        r={n.r}
                        style={{ fill: n.color }}
                      />
                      <KeyGlyph r={n.r} ink={contrastInk(n.color)} />
                      {usersWithFollows.has(n.user.index) && (
                        <circle
                          className="gv-follow-badge"
                          cx={n.r * 0.72}
                          cy={-n.r * 0.72}
                          r={4.5}
                        />
                      )}
                    </>
                  ) : null}
                </g>
              );
            })}
          </g>
        </g>
      </svg>

      {hoverNode && (
        <HoverCard
          node={hoverNode}
          left={hoverNode.x * t.k + t.x}
          top={hoverNode.y * t.k + t.y}
          onMouseEnter={() => enterHover(hoverNode.id)}
          onMouseLeave={() => leaveHover(hoverNode.id)}
        />
      )}

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

      <div className="gv-legend">
        <span className="gv-legend-infra muted small">
          <span className="gv-legend-chip" style={{ background: HS_COLOR }} />
          homeserver
          <span className="gv-legend-chip" style={{ background: USER_COLOR }} />
          user
          <span
            className="gv-legend-chip"
            style={{ background: INFRA_COLORS.dht_peer }}
          />
          dht
          <span
            className="gv-legend-chip"
            style={{ background: INFRA_COLORS.bootstrap }}
          />
          bootstrap
          <span
            className="gv-legend-chip"
            style={{ background: INFRA_COLORS.pkarr_relay }}
          />
          pkarr
          <span
            className="gv-legend-chip"
            style={{ background: INFRA_COLORS.http_relay }}
          />
          http relay
        </span>
        <span className="muted small">
          {homeservers.length} homeservers ({activeHs} active) · {totalUsers}{" "}
          users · click a homeserver to expand
        </span>
      </div>

      <Timeline feed={feed} />
    </div>
  );
}

function useProfile(ctx: UserStorageContext | null) {
  const [name, setName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    setName(null);
    setBio(null);
    setAvatar(null);
    setTags([]);
    if (!ctx) return;
    let alive = true;
    loadProfile(ctx).then((profile) => {
      if (!alive) return;
      if (profile?.name) setName(profile.name);
      if (profile?.bio) setBio(profile.bio);
      loadAvatar(profile?.image, ctx).then((url) => {
        if (alive && url) setAvatar(url);
      });
    });
    loadTags(ctx).then((t) => {
      if (alive) setTags(t);
    });
    return () => {
      alive = false;
    };
  }, [ctx?.pk, ctx?.homeserverUrl, ctx?.userIndex]);

  return { name, bio, avatar, tags };
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" className="gv-ico" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="gv-ico" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 6.5" />
    </svg>
  );
}

function CopyKey({ value, display }: { value: string; display: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={`gv-card-pk gv-card-copy ${copied ? "copied" : ""}`}
      title={`Copy ${value}`}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard unavailable */
        }
      }}
    >
      <span className="gv-card-copy-text">{display}</span>
      <span className="gv-card-copy-icon" aria-hidden>
        {copied ? <CheckIcon /> : <CopyIcon />}
      </span>
    </button>
  );
}

function HoverCard({
  node,
  left,
  top,
  onMouseEnter,
  onMouseLeave,
}: {
  node: Node;
  left: number;
  top: number;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const profileCtx =
    node.kind === "user" && node.user && node.hs
      ? {
          pk: node.user.publicKey,
          homeserverUrl: node.hs.httpUrl,
          userIndex: node.user.index,
        }
      : null;
  const { name, bio, avatar, tags } = useProfile(profileCtx);
  const idx = node.user?.index;

  if (node.kind === "infra" && node.infra) {
    return (
      <div
        className="gv-card gv-card-infra"
        style={{ left, top, "--gv-accent": node.color } as CSSProperties}
        role="tooltip"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="gv-card-head">
          <span
            className="gv-card-avatar fallback"
            style={{ background: node.color }}
          >
            {node.infra.label.slice(0, 2).toUpperCase()}
          </span>
          <div className="gv-card-title">
            <strong>{node.infra.label}</strong>
            <span className="gv-card-sub">{node.infra.kind.replace(/_/g, " ")}</span>
          </div>
        </div>
        <CopyKey value={node.infra.address} display={node.infra.address} />
        <p className="gv-card-bio muted small">{infraBlurb(node.infra.kind)}</p>
      </div>
    );
  }

  if (node.kind === "dht_client" && node.hs) {
    return (
      <div
        className="gv-card gv-card-dht-client"
        style={{ left, top, "--gv-accent": node.color } as CSSProperties}
        role="tooltip"
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="gv-card-head">
          <span
            className="gv-card-avatar fallback"
            style={{ background: node.color }}
          >
            DHT
          </span>
          <div className="gv-card-title">
            <strong>{node.hs.label} DHT node</strong>
            <span className="gv-card-sub">pkarr / mainline participant</span>
          </div>
        </div>
        <CopyKey value={node.hs.httpUrl} display={node.hs.httpUrl} />
        <p className="gv-card-bio muted small">
          Spun up when this homeserver was created. Bootstraps into the shared
          testnet DHT and republishes this homeserver&apos;s pkarr record plus
          its users&apos; pkarr keys.
        </p>
      </div>
    );
  }

  const title =
    node.kind === "hub"
      ? node.hs?.label ?? "Homeserver"
      : name ?? node.user?.name ?? `user #${idx}`;
  const fullKey =
    node.kind === "user"
      ? node.user?.publicKey
      : node.hs?.publicKey;

  return (
    <div
      className="gv-card"
      style={{ left, top, "--gv-accent": node.color } as CSSProperties}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="gv-card-head">
        {node.kind === "user" && avatar ? (
          <img className="gv-card-avatar" src={avatar} alt="" />
        ) : (
          <span
            className="gv-card-avatar fallback"
            style={{ background: node.color }}
          >
            {node.kind === "user" ? (
              <svg viewBox={ROOT_VIEWBOX} className="gv-card-avatar-mark">
                <RootPaths />
              </svg>
            ) : (
              node.hs?.label.slice(0, 2)
            )}
          </span>
        )}
        <div className="gv-card-title">
          <strong>{title}</strong>
          <span className="gv-card-sub">
            {node.kind === "user" ? (
              `@ ${node.hs?.label}`
            ) : (
              <span
                className={`gv-card-status ${
                  node.hs?.status === "active" ? "active" : ""
                }`}
              >
                <span className="gv-card-status-dot" />
                {node.hs?.status}
              </span>
            )}
          </span>
        </div>
      </div>

      {fullKey && <CopyKey value={fullKey} display={shortKey(fullKey)} />}

      {node.kind === "user" && bio && <p className="gv-card-bio">{bio}</p>}

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

function infraBlurb(kind: InfraNodeKind): string {
  switch (kind) {
    case "bootstrap":
      return "The fixed DHT bootstrap node on UDP :6881. Every homeserver, client, and DHT peer dials in here to join the shared testnet mainline DHT.";
    case "dht_peer":
      return "An in-memory mainline DHT node in the shared testnet. Stores and serves the pkarr records that map public keys to homeserver addresses.";
    case "pkarr_relay":
      return "An HTTP bridge to the DHT. Lets browsers publish and resolve pkarr records over plain HTTP without speaking the DHT protocol directly.";
    case "http_relay":
      return "An HTTP rendezvous for the auth flow. Relays messages between a client and an authenticator over GET/POST /link/{id}.";
  }
}

const TAG_COLORS = [
  "#293681",
  "#E05454",
  "#1F6F5F",
  "#FF8B5A",
  "#3D45AA",
  "#4D2FB2",
  "#5DD3B6",
];
function tagColor(label: string): string {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) | 0;
  return TAG_COLORS[Math.abs(h) % TAG_COLORS.length];
}

function Timeline({ feed }: { feed: TickEvent[] }) {
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
