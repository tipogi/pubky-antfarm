export const PKARR_VIEWBOX = "0 0 24 24";

/**
 * Signpost mark used for the pkarr relay: a post with a right-pointing sign on
 * top and a left-pointing sign below. Inherits `currentColor` via stroke.
 */
export function PkarrPaths() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="2.6" r="0.9" fill="currentColor" stroke="none" />
      <line x1="12" y1="3.6" x2="12" y2="21" />
      <polygon points="6.5,4.3 17.5,4.3 20.5,6.8 17.5,9.3 6.5,9.3" />
      <polygon points="17.5,11.2 17.5,16.2 6.5,16.2 3.5,13.7 6.5,11.2" />
    </g>
  );
}
