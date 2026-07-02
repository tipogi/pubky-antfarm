export const HTTP_VIEWBOX = "0 0 24 24";

/**
 * Radio tower mark used for the HTTP relay: a trussed antenna tower with an
 * emitter on top and broadcast waves either side. Inherits `currentColor`.
 */
export function HttpPaths() {
  return (
    <g
      fill="none"
      stroke="currentColor"
      strokeWidth={1}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
      <line x1="12" y1="6.2" x2="8" y2="22" />
      <line x1="12" y1="6.2" x2="16" y2="22" />
      <line x1="10.7" y1="12" x2="13.3" y2="12" />
      <line x1="9.7" y1="16" x2="14.3" y2="16" />
      <line x1="10.7" y1="12" x2="14.3" y2="16" />
      <line x1="9.7" y1="16" x2="15" y2="20" />
      <path d="M8.6 3.8 Q5.6 6 8.6 8.2" />
      <path d="M6 2.2 Q1.9 6 6 9.8" />
      <path d="M15.4 3.8 Q18.4 6 15.4 8.2" />
      <path d="M18 2.2 Q22.1 6 18 9.8" />
    </g>
  );
}
