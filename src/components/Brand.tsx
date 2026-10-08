export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 42 46" fill="none" aria-hidden="true">
      <path
        d="m21 2 18 10.5v21L21 44 3 33.5v-21Z"
        fill="var(--surface-inset-base)"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path d="m3 12.5 18 11 18-11M21 23.5V44" stroke="currentColor" strokeWidth="1.5" />
      <path d="m12 18 9-5 9 5-9 5Z" fill="currentColor" />
      <path d="m21 23 9-5v11l-9 5Z" fill="currentColor" />
      <path
        d="m12 18 9 5v11l-9-5Z"
        fill="var(--surface-raised-strong)"
        stroke="currentColor"
        strokeWidth=".8"
      />
    </svg>
  );
}

export function CoreArt({ className = '' }: { className?: string }) {
  return (
    <svg className={`core-art ${className}`} viewBox="0 0 400 340" fill="none" aria-hidden="true">
      <defs>
        <pattern id="core-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M24 0H0v24" stroke="currentColor" strokeOpacity=".08" />
        </pattern>
        <radialGradient id="core-glow">
          <stop stopColor="currentColor" stopOpacity=".12" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="400" height="340" fill="url(#core-grid)" />
      <circle cx="200" cy="170" r="158" fill="url(#core-glow)" />
      <g transform="translate(200 170)">
        <circle r="112" stroke="var(--border-base)" />
        <circle r="138" stroke="var(--border-base)" strokeDasharray="1 9" />
        <path d="M-174 0h348M0-152v304" stroke="var(--border-weak-base)" />
        <ellipse rx="166" ry="51" transform="rotate(-28)" stroke="var(--border-strong-base)" />
        <ellipse
          className="orbit-flow"
          rx="166"
          ry="51"
          transform="rotate(-28)"
          stroke="currentColor"
          strokeDasharray="4 24"
        />
        <g className="core-float">
          <path d="m0-86 73 43v85L0 84l-73-42v-85Z" fill="var(--background-base)" stroke="currentColor" />
          <path d="m0-1 73-42v85L0 84Z" fill="var(--surface-base)" stroke="currentColor" />
          <path d="m-73-43 73 42 73-42M0-86v170" stroke="currentColor" strokeOpacity=".65" />
          {[-20, 0, 20, 40].map((y) => (
            <path key={y} d={`M-73 ${y} 0 ${y + 42} 73 ${y}`} stroke="currentColor" strokeOpacity=".16" />
          ))}
          <path
            d="m0-43 29 17v34L0 25-29 8v-34Z"
            fill="var(--surface-interactive-weak)"
            stroke="currentColor"
          />
          <path d="m0-43 29 17L0-9-29-26Z" fill="currentColor" />
          <path d="M0-9 29-26V8L0 25Z" fill="currentColor" />
        </g>
        <circle cx="-142" cy="68" r="4" fill="currentColor" />
        <path d="M58-81 91-110h43M-59 84-92 114h-34" stroke="var(--icon-weak-base)" strokeWidth=".8" />
        <text x="91" y="-119" fill="var(--text-weak)" fontSize="9" fontFamily="monospace">
          CORE / OCC
        </text>
        <text x="-132" y="130" fill="var(--text-weak)" fontSize="9" fontFamily="monospace">
          LINK ESTABLISHED
        </text>
        <path d="M-4-138h8m-4-4v8M108 0h8m-4-4v8" stroke="currentColor" />
      </g>
    </svg>
  );
}
