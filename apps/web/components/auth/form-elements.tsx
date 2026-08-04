import type { InputHTMLAttributes, ButtonHTMLAttributes } from "react";

export function FormField({
  label,
  id,
  error,
  ...inputProps
}: {
  label: string;
  id: string;
  // Explicitly `| undefined`, not just optional (`error?:`) — under
  // exactOptionalPropertyTypes, `error?: string` forbids a caller from
  // passing the key with value `undefined`, distinct from omitting it
  // entirely. Every real call site legitimately produces `string |
  // undefined` (Record<string, string> indexed access under
  // noUncheckedIndexedAccess, or `useState<string | undefined>()`), and
  // this component already treats `undefined` as a normal, handled case
  // (`Boolean(error)`, `error && ...` below) — the prop's declared type
  // was simply narrower than the values it was always designed to accept.
  error?: string | undefined;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="font-exo mb-1 block text-sm text-vv-text-secondary">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="w-full rounded border border-vv-divider bg-vv-black px-3 py-2 text-white focus:border-vv-neon-green focus:outline-none focus:ring-1 focus:ring-vv-neon-green"
        {...inputProps}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-vv-loss-red">
          {error}
        </p>
      )}
    </div>
  );
}

export function SubmitButton({
  children,
  loading,
  ...buttonProps
}: {
  children: React.ReactNode;
  loading?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="submit"
      disabled={loading || buttonProps.disabled}
      className="font-exo w-full rounded bg-vv-neon-green px-4 py-2 font-semibold text-vv-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      {...buttonProps}
    >
      {loading ? "Please wait…" : children}
    </button>
  );
}

export function FormBanner({ kind, message }: { kind: "error" | "success"; message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`mb-4 rounded border px-3 py-2 text-sm ${
        kind === "error"
          ? "border-vv-loss-red text-vv-loss-red"
          : "border-vv-success-green text-vv-success-green"
      }`}
    >
      {message}
    </div>
  );
}
