export const DHT_VIEWBOX = "0 0 24 24";

/**
 * Radar / orbit mark used for DHT nodes: concentric rings, a sweep line, and
 * satellite dots. Rings/line inherit `currentColor` via stroke; the dots via
 * fill. Set `color` (or wrap in a coloured context) to tint it.
 */
export function DhtPaths() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="10.2" />
      <circle cx="12" cy="12" r="6.6" />
      <circle cx="12" cy="12" r="3.1" />
      <line x1="12" y1="12" x2="19.4" y2="5.4" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="5.7" cy="9.6" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="16.6" cy="15.3" r="1.35" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.7" r="1.35" fill="currentColor" stroke="none" />
    </g>
  );
}
