export const PKARR_VIEWBOX = "0 0 24 24";

/**
 * Resolve pin mark used for the pkarr relay: public key at top, pin drops to a
 * resolved address below. Inherits `currentColor`.
 */
export function PkarrPaths() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="6" r="2.6" />
      <line x1="12" y1="8.8" x2="12" y2="15" />
      <path d="M8.3 17.5a3.7 3.7 0 0 0 7.4 0" />
      <circle cx="12" cy="17.5" r="1.35" fill="currentColor" stroke="none" />
    </g>
  );
}
