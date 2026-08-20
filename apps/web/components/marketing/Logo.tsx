import Link from "next/link";

/**
 * Shared wordmark for the public marketing site. Typographic only -- no
 * image asset exists for the brand yet, and a precise, well-kerned type
 * mark reads as more deliberate than a placeholder icon would.
 */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/"
      className={`mkt-focus-ring font-exo inline-flex items-center gap-2 text-[15px] font-bold tracking-tight text-white ${className}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-vv-neon-green" />
      <span>
        Champions<span className="text-vv-neon-green">Stake</span>
      </span>
    </Link>
  );
}
