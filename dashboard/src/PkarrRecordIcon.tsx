/** Public-key discovery — key bow with broadcast arcs. */
export function PkarrRecordIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <circle cx="7.5" cy="8" r="3.25" />
      <path d="M9.8 10.2L19 19" />
      <path d="M7.5 4.75a3.25 3.25 0 0 1 0 6.5" />
      <path d="M7.5 2.75a5.25 5.25 0 0 1 0 10.5" />
    </svg>
  );
}
