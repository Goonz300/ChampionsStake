/**
 * A hand-built product-interface visual representing a live bracket: four
 * challenger nodes resolving into two semifinal nodes, resolving into one
 * final -- with a status strip underneath. Every coordinate is authored by
 * hand (no chart library, no stock asset) specifically so this reads as "a
 * real competition interface" rather than decorative artwork. Server
 * component: the only motion (the scan line, the pulsing status dot) is
 * pure CSS, already governed by prefers-reduced-motion in globals.css.
 *
 * Color use is deliberate, not "green everywhere": the bracket's resolved
 * path is neon green (the one on-brand "selected/active" signal), inactive
 * nodes/lines stay neutral gray, and the status strip reuses the exact
 * semantic tones the real app's own status-labels.ts uses (positive/live =
 * vv-success-green, warning/in-progress = vv-bright-yellow, neutral = gray).
 */
export function ArenaVisual() {
  return (
    <div className="mkt-border mkt-grid relative overflow-hidden rounded-xl bg-vv-surface">
      <div aria-hidden="true" className="mkt-vignette pointer-events-none absolute inset-0" />
      <div
        aria-hidden="true"
        className="mkt-scan-line pointer-events-none absolute inset-x-0 top-0 h-24 animate-mkt-scan opacity-40"
      />

      {/* Toolbar */}
      <div className="border-vv-divider relative flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="bg-vv-divider h-1.5 w-1.5 rounded-full" />
          <span aria-hidden="true" className="bg-vv-divider h-1.5 w-1.5 rounded-full" />
          <span aria-hidden="true" className="bg-vv-divider h-1.5 w-1.5 rounded-full" />
          <span className="font-mono text-vv-text-tertiary ml-2 text-[10px] uppercase tracking-widest">
            challenge_bracket.sys
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="bg-vv-success-green h-1.5 w-1.5 animate-mkt-pulse-dot rounded-full"
          />
          <span className="font-mono text-vv-text-tertiary text-[10px] uppercase tracking-widest">
            Session Active
          </span>
        </div>
      </div>

      {/* Bracket */}
      <div className="relative px-4 pb-2 pt-6">
        <svg
          viewBox="0 0 400 260"
          role="img"
          aria-label="Diagram of a four-participant challenge bracket resolving through a semifinal round into a final match"
          className="w-full"
        >
          <g fill="none" strokeWidth="1.5">
            <path d="M90,47 H125 V77 H160" stroke="#39FF14" />
            <path d="M90,107 H125 V77 H160" stroke="#333333" />
            <path d="M90,167 H125 V197 H160" stroke="#333333" />
            <path d="M90,227 H125 V197 H160" stroke="#333333" />
            <path d="M230,77 H265 V137 H300" stroke="#39FF14" />
            <path d="M230,197 H265 V137 H300" stroke="#333333" />
          </g>

          {/* Round 1 */}
          {[
            { y: 30, label: "C-01", active: true },
            { y: 90, label: "C-02", active: false },
            { y: 150, label: "C-03", active: false },
            { y: 210, label: "C-04", active: false },
          ].map((node) => (
            <g key={node.label}>
              <rect
                x="20"
                y={node.y}
                width="70"
                height="34"
                rx="4"
                fill="#1A1A1A"
                stroke={node.active ? "#39FF14" : "#333333"}
              />
              <text
                x="55"
                y={node.y + 21}
                textAnchor="middle"
                className="font-mono"
                fontSize="10"
                fill={node.active ? "#FFFFFF" : "#999999"}
                letterSpacing="0.5"
              >
                {node.label}
              </text>
            </g>
          ))}

          {/* Semifinal */}
          {[
            { y: 60, label: "SF-1", active: true },
            { y: 180, label: "SF-2", active: false },
          ].map((node) => (
            <g key={node.label}>
              <rect
                x="160"
                y={node.y}
                width="70"
                height="34"
                rx="4"
                fill="#1A1A1A"
                stroke={node.active ? "#39FF14" : "#333333"}
              />
              <text
                x="195"
                y={node.y + 21}
                textAnchor="middle"
                className="font-mono"
                fontSize="10"
                fill={node.active ? "#FFFFFF" : "#999999"}
                letterSpacing="0.5"
              >
                {node.label}
              </text>
            </g>
          ))}

          {/* Final */}
          <rect x="300" y="120" width="76" height="34" rx="4" fill="#000000" stroke="#39FF14" />
          <text
            x="338"
            y="141"
            textAnchor="middle"
            className="font-mono"
            fontSize="10"
            fill="#FFFFFF"
            letterSpacing="0.5"
          >
            FINAL
          </text>
        </svg>
      </div>

      {/* Status strip -- same three-tone convention as lib/vault/status-labels.ts's
          STATUS_TONE_CLASSES: neutral/warning/positive, reused deliberately. */}
      <div className="border-vv-divider relative space-y-2.5 border-t px-4 py-4">
        {[
          { pair: "C-01 / C-02", status: "RESOLVED", tone: "text-vv-text-tertiary", dot: "bg-vv-divider" },
          { pair: "C-03 / C-04", status: "IN PROGRESS", tone: "text-vv-bright-yellow", dot: "bg-vv-bright-yellow" },
          { pair: "SF-1 / SF-2", status: "AWAITING RESULT", tone: "text-vv-neon-green", dot: "bg-vv-neon-green" },
        ].map((row) => (
          <div key={row.pair} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${row.dot}`} />
              <span className="font-mono text-vv-text-secondary text-[11px] tracking-wide">
                {row.pair}
              </span>
            </div>
            <span className={`font-mono text-[10px] uppercase tracking-widest ${row.tone}`}>
              {row.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
