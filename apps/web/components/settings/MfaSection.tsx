"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Step = "idle" | "enrolling" | "confirming" | "recovery-codes" | "disabling";

interface Props {
  initiallyEnrolled: boolean;
  initialCodesRemaining: number;
  /** The already-enrolled factor's id, fetched server-side -- needed so
   * the disable flow can prompt for a fresh code (mfa/verify) if the
   * session isn't already aal2, without a separate "list my factors" API. */
  initialFactorId: string | null;
}

/**
 * Security Settings' MFA section (Phase 3C, Milestone 6). A client
 * component because enrollment is a genuine multi-step flow (enroll -> show
 * QR/secret -> confirm a code -> show recovery codes exactly once) that
 * can't be a plain server-rendered page, matching the one prior precedent
 * for client-side interactivity on this page (RevokeOthersButton, Phase
 * 3B). Calls the existing/extended mfa/{enroll,verify,disable} and
 * mfa/recovery-codes/{regenerate} routes directly -- no new API surface
 * beyond what Milestone 7 already defines.
 */
export function MfaSection({ initiallyEnrolled, initialCodesRemaining, initialFactorId }: Props) {
  const router = useRouter();
  const [enrolled, setEnrolled] = useState(initiallyEnrolled);
  const [codesRemaining, setCodesRemaining] = useState(initialCodesRemaining);
  const [step, setStep] = useState<Step>("idle");
  const [factorId, setFactorId] = useState<string | null>(initialFactorId);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsReauth, setNeedsReauth] = useState(false);
  const [reauthCode, setReauthCode] = useState("");

  async function startEnrollment() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/enroll", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to start MFA enrollment.");
        return;
      }
      setFactorId(body.data.factor_id);
      setQrUrl(body.data.qr_url);
      setSecret(body.data.secret);
      setStep("enrolling");
    } catch {
      setError("Failed to start MFA enrollment.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmEnrollment(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId, code, context: "reauth" }),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Invalid code. Please try again.");
        return;
      }
      setRecoveryCodes(body.data.recovery_codes ?? []);
      setCodesRemaining(body.data.recovery_codes?.length ?? 0);
      setEnrolled(true);
      setStep("recovery-codes");
      setCode("");
    } catch {
      setError("Failed to confirm MFA enrollment.");
    } finally {
      setLoading(false);
    }
  }

  function finishEnrollment() {
    setStep("idle");
    setQrUrl(null);
    setSecret(null);
    setFactorId(null);
    setRecoveryCodes([]);
    router.refresh();
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/disable", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        if (body?.error?.code === "AUTH_MFA_REQUIRED") {
          // Session isn't already aal2 (e.g. it's been a while since
          // login, or the user reached this session via a recovery code,
          // which deliberately never satisfies this check -- see
          // mfa-enforcement.ts). Offer a fresh-code entry instead of a
          // dead-end error.
          setNeedsReauth(true);
          setError(null);
          return;
        }
        setError(body?.error?.message ?? "Failed to disable MFA.");
        return;
      }
      setEnrolled(false);
      setCodesRemaining(0);
      setStep("idle");
      router.refresh();
    } catch {
      setError("Failed to disable MFA.");
    } finally {
      setLoading(false);
    }
  }

  async function reauthenticateThenDisable(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) {
      setError("Could not determine your MFA factor. Please reload the page.");
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const verifyRes = await fetch("/api/auth/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId, code: reauthCode, context: "reauth" }),
      });
      const verifyBody = await verifyRes.json();
      if (!verifyRes.ok) {
        setError(verifyBody?.error?.message ?? "Invalid code.");
        return;
      }

      setReauthCode("");
      setNeedsReauth(false);

      const disableRes = await fetch("/api/auth/mfa/disable", { method: "POST" });
      const disableBody = await disableRes.json();
      if (!disableRes.ok) {
        setError(disableBody?.error?.message ?? "Failed to disable MFA.");
        return;
      }

      setEnrolled(false);
      setCodesRemaining(0);
      setStep("idle");
      router.refresh();
    } catch {
      setError("Failed to disable MFA.");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateCodes() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/mfa/recovery-codes/regenerate", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error?.message ?? "Failed to regenerate recovery codes.");
        return;
      }
      setRecoveryCodes(body.data.recovery_codes ?? []);
      setCodesRemaining(body.data.recovery_codes?.length ?? 0);
      setStep("recovery-codes");
    } catch {
      setError("Failed to regenerate recovery codes.");
    } finally {
      setLoading(false);
    }
  }

  function downloadCodes() {
    const blob = new Blob([recoveryCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "championsstake-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="font-exo text-vv-loss-red mb-3 text-sm">
          {error}
        </p>
      ) : null}

      {step === "idle" && (
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`font-exo rounded px-2 py-1 text-xs font-semibold ${
              enrolled
                ? "bg-vv-success-green/10 text-vv-success-green"
                : "bg-vv-text-tertiary/10 text-vv-text-tertiary"
            }`}
          >
            {enrolled ? "MFA enabled" : "MFA not enabled"}
          </span>
          {enrolled ? (
            <>
              <span className="font-exo text-vv-text-secondary text-sm">
                {codesRemaining} recovery code{codesRemaining === 1 ? "" : "s"} remaining
              </span>
              <button
                type="button"
                onClick={regenerateCodes}
                disabled={loading}
                className="font-exo border-vv-divider rounded border px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Regenerate recovery codes
              </button>
              <button
                type="button"
                onClick={() => setStep("disabling")}
                disabled={loading}
                className="font-exo bg-vv-loss-red rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                Disable MFA
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={startEnrollment}
              disabled={loading}
              className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
            >
              Enable MFA
            </button>
          )}
        </div>
      )}

      {step === "enrolling" && qrUrl && (
        <div className="border-vv-divider mt-2 rounded border p-4">
          <p className="font-exo text-vv-text-secondary mb-3 text-sm">
            Scan this QR code with your authenticator app, then enter the 6-digit code it shows.
          </p>
          {/* eslint-disable-next-line @next/next/no-img-element -- GoTrue-hosted QR data URI, not a Next.js-optimizable local asset. */}
          <img src={qrUrl} alt="MFA enrollment QR code" width={200} height={200} />
          {secret ? (
            <p className="font-exo text-vv-text-tertiary mt-2 text-xs">
              Can&apos;t scan? Enter this key manually:{" "}
              <code className="text-vv-text-secondary">{secret}</code>
            </p>
          ) : null}
          <form onSubmit={confirmEnrollment} className="mt-4 flex items-center gap-2">
            <label htmlFor="mfa-confirm-code" className="sr-only">
              6-digit authenticator code
            </label>
            <input
              id="mfa-confirm-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="border-vv-divider bg-vv-black font-exo w-28 rounded border px-2 py-1.5 text-sm text-white"
              placeholder="000000"
            />
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-50"
            >
              Confirm
            </button>
          </form>
        </div>
      )}

      {step === "recovery-codes" && (
        <div className="border-vv-divider mt-2 rounded border p-4">
          <p className="font-exo text-vv-loss-red mb-2 text-sm font-semibold">
            Save these recovery codes now — they will not be shown again.
          </p>
          <p className="font-exo text-vv-text-tertiary mb-3 text-xs">
            Each code can be used once to sign in if you lose access to your authenticator.
          </p>
          <ul className="font-exo grid grid-cols-2 gap-1.5 text-sm text-white">
            {recoveryCodes.map((c) => (
              <li key={c} className="rounded px-2 py-1">
                {c}
              </li>
            ))}
          </ul>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={downloadCodes}
              className="font-exo border-vv-divider rounded border px-3 py-1.5 text-sm text-white"
            >
              Download codes
            </button>
            <button
              type="button"
              onClick={finishEnrollment}
              className="font-exo bg-vv-neon-green rounded px-3 py-1.5 text-sm font-semibold text-black"
            >
              I&apos;ve saved my codes
            </button>
          </div>
        </div>
      )}

      {step === "disabling" && !needsReauth && (
        <form onSubmit={disableMfa} className="border-vv-divider mt-2 rounded border p-4">
          <p className="font-exo text-vv-text-secondary mb-3 text-sm">
            Disabling MFA requires a recently-verified authenticator code. This will also delete
            your unused recovery codes.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={loading}
              className="font-exo bg-vv-loss-red rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Confirm disable MFA
            </button>
            <button
              type="button"
              onClick={() => setStep("idle")}
              className="font-exo border-vv-divider rounded border px-3 py-1.5 text-sm text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {step === "disabling" && needsReauth && (
        <form
          onSubmit={reauthenticateThenDisable}
          className="border-vv-divider mt-2 rounded border p-4"
        >
          <p className="font-exo text-vv-text-secondary mb-3 text-sm">
            Enter a current code from your authenticator app to confirm it&apos;s really you before
            disabling MFA.
          </p>
          <div className="flex items-center gap-2">
            <label htmlFor="mfa-disable-reauth-code" className="sr-only">
              6-digit authenticator code
            </label>
            <input
              id="mfa-disable-reauth-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={reauthCode}
              onChange={(e) => setReauthCode(e.target.value)}
              className="border-vv-divider bg-vv-black font-exo w-28 rounded border px-2 py-1.5 text-sm text-white"
              placeholder="000000"
            />
            <button
              type="submit"
              disabled={loading || reauthCode.length !== 6}
              className="font-exo bg-vv-loss-red rounded px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              Verify and disable
            </button>
            <button
              type="button"
              onClick={() => {
                setNeedsReauth(false);
                setStep("idle");
              }}
              className="font-exo border-vv-divider rounded border px-3 py-1.5 text-sm text-white"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
