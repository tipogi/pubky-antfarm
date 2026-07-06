export const HTTP_VIEWBOX = "0 0 24 24";

/**
 * Globe mark used for the HTTP relay: meridians on a sphere — browser-facing
 * HTTP bridge to the DHT. Inherits `currentColor`.
 */
export function HttpPaths() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </g>
  );
}
