import { ROOT_VIEWBOX, RootPaths } from "@/RootMark";
import { cn } from "@/lib/utils";

export function GraphIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("rail-icon", className)}
      aria-hidden="true"
    >
      <path d="M12 12.3 6.3 6.3M12 12.3 18.7 6.6M12 12.3 5.4 17.8M12 12.3 12.6 19.6M12 12.3 19.6 15.2" />
      <circle cx="12" cy="12.3" r="3" />
      <circle cx="6.3" cy="6.3" r="1.6" />
      <circle cx="18.7" cy="6.6" r="2.4" />
      <circle cx="5.4" cy="17.8" r="2.1" />
      <circle cx="12.6" cy="19.6" r="2.1" />
      <circle cx="19.6" cy="15.2" r="1.5" />
    </svg>
  );
}

export function BrandLogo() {
  return (
    <svg
      viewBox="0 0 600 566"
      className="brand-logo"
      aria-hidden="true"
      fill="currentColor"
    >
      <g transform="translate(0,566) scale(0.1,-0.1)">
        <path
          d={`M2228 4575 c-3 -3 -80 -11 -169 -16 -237 -13 -291 -25 -351 -79 -43
-39 -34 -120 20 -175 l37 -37 70 5 c39 3 176 15 305 26 552 48 1077 -5 1330
-135 14 -7 63 -30 110 -52 328 -152 517 -464 523 -862 l2 -135 -69 -3 c-86 -4
-82 -9 -96 126 -34 349 -195 578 -533 754 -170 89 -581 168 -877 168 -112 0
-637 -42 -700 -56 -97 -21 -127 -163 -49 -229 30 -24 108 -43 129 -30 7 4 58
11 114 15 55 5 154 14 218 20 220 22 550 7 748 -35 36 -8 76 -16 90 -18 14 -3
52 -15 85 -26 57 -21 73 -28 163 -68 210 -95 363 -342 350 -566 l-3 -52 -540
-6 c-442 -5 -554 -9 -615 -22 -41 -9 -95 -21 -120 -26 -163 -35 -452 -155
-547 -227 -21 -16 -58 -43 -82 -59 -201 -134 -390 -430 -427 -665 -12 -79 -5
-290 11 -345 35 -115 50 -151 88 -219 22 -39 46 -82 53 -95 41 -77 224 -253
334 -322 36 -23 76 -49 90 -58 23 -16 107 -57 190 -94 383 -172 1046 -190
1366 -37 22 11 46 20 52 20 11 0 104 46 162 80 113 68 247 174 328 261 114
123 211 272 256 394 8 22 24 65 36 95 55 141 62 267 57 990 -4 714 -3 709 -76
921 -45 132 -144 290 -247 395 -248 251 -613 410 -1069 465 -102 12 -737 24
-747 14z m786 -1760 c301 -91 374 -480 127 -668 -337 -257 -779 156 -545 509
94 141 263 206 418 159z`}
        />
      </g>
    </svg>
  );
}

export function ServersIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox={ROOT_VIEWBOX}
      className={cn("rail-icon root-mark", className)}
      aria-hidden="true"
    >
      <RootPaths />
    </svg>
  );
}

export function StatsIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("rail-icon", className)}
      aria-hidden="true"
    >
      <path d="M5 4v14a1 1 0 0 0 1 1h14" />
      <path d="M8 15l3.2-3.4 2.6 2 4.2-4.8" />
      <circle cx="8" cy="15" r="1.1" />
      <circle cx="18" cy="8.8" r="1.1" />
    </svg>
  );
}

export function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn("hs-detail-back-icon", className)}
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function UsersStatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-stat-icon" aria-hidden="true">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export function DriveIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-stat-icon" aria-hidden="true">
      <path d="M4 5h16a1 1 0 0 1 1 1v5H3V6a1 1 0 0 1 1-1z" />
      <path d="M3 11h18v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
      <path d="M7 15h2" />
    </svg>
  );
}

export function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-card-crown-icon" aria-hidden="true">
      <path d="M3 7l4.5 4L12 4l4.5 7L21 7l-1.6 11H4.6L3 7z" />
    </svg>
  );
}

export function KeyRowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-row-icon" aria-hidden="true">
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </svg>
  );
}

export function GlobeLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" className="hs-link-icon" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}
