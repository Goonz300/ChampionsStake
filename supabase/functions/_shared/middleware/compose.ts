// supabase/functions/_shared/middleware/compose.ts
//
// The single wrapper every Edge Function's entry point should call. See
// supabase/functions/_template/index.ts for a fully worked example.

import { corsHeadersFor, handlePreflight } from "../security/origin.ts";
import { securityHeaders } from "../security/headers.ts";
import {
  enforceRateLimit,
  type RateLimitOptions,
} from "../security/rate-limit.ts";
import { getClientIp } from "../security/client-ip.ts";
import {
  type AuthenticatedUser,
  verifyOptionalRequestJwt,
  verifyRequestJwt,
} from "../auth/jwt.ts";
import {
  assertSessionNotInvalidated,
  loadUserProfile,
  type UserProfile,
} from "../auth/session.ts";
import { errorResponse } from "../response/index.ts";
import { clearLogContext, logger, setLogContext } from "../logger/index.ts";
import { withTiming } from "../metrics/index.ts";
import {
  generateRequestId,
  getOrCreateCorrelationId,
} from "../utils/correlation.ts";
import { clearWithinRequestHandlers } from "../events/index.ts";
import { toEdgeFunctionError } from "../errors/index.ts";

export interface EdgeContext {
  request: Request;
  user: AuthenticatedUser | null;
  profile: UserProfile | null;
  correlationId: string;
  requestId: string;
}

export interface EdgeFunctionOptions {
  functionName: string;
  /** 'required' verifies a JWT and loads the profile; 'optional' loads them
   * if present but allows anonymous requests through; 'none' skips auth
   * entirely (e.g. a signed-request-only webhook receiver). */
  auth?: "required" | "optional" | "none";
  rateLimit?: (ctx: EdgeContext) => RateLimitOptions | null;
  /**
   * Layer 15 (Middleware Integration) / Layer 6 (Velocity Detection): runs
   * AFTER the handler (business logic) has already produced its response,
   * never before. This is deliberate, not a simplification -- fraud
   * scoring in this codebase is flag-only and has been since AI-001
   * ("scores above threshold auto-flag for moderator queue, never
   * auto-block funds without human review in v1"). A pipeline stage that
   * ran fraud scoring BEFORE business logic could only ever choose between
   * two options this codebase has already rejected: blocking the action
   * outright (contradicts the human-review rule) or scoring on
   * not-yet-committed state (nothing to count yet). Placing it here keeps
   * that rule intact while still giving every function a single, named
   * place to opt into a velocity/fraud check instead of hand-wiring it
   * inline (see challenge-create, tournament-register, payment-transfer).
   * Errors are logged and swallowed -- a fraud-check failure must never
   * fail the request whose outcome it's merely annotating.
   */
  fraudCheck?: (ctx: EdgeContext, response: Response) => Promise<void>;
}

type Handler = (ctx: EdgeContext) => Promise<Response>;

export function withEdgeFunction(
  options: EdgeFunctionOptions,
  handler: Handler,
) {
  return async (request: Request): Promise<Response> => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const correlationId = getOrCreateCorrelationId(request);
    const requestId = generateRequestId();
    clearWithinRequestHandlers();
    setLogContext({
      correlationId,
      requestId,
      functionName: options.functionName,
    });

    let capturedCtx: EdgeContext | undefined;

    try {
      const response = await withTiming(options.functionName, async () => {
        let user: AuthenticatedUser | null = null;

        if ((options.auth ?? "required") === "required") {
          user = await verifyRequestJwt(request);
        } else if (options.auth === "optional") {
          user = await verifyOptionalRequestJwt(request);
        }

        const profile = user ? await loadUserProfile(user) : null;
        if (user && profile) assertSessionNotInvalidated(user, profile);
        if (user) setLogContext({ userId: user.id });

        const ctx: EdgeContext = {
          request,
          user,
          profile,
          correlationId,
          requestId,
        };

        if (options.rateLimit) {
          const rl = options.rateLimit(ctx);
          if (rl) await enforceRateLimit(rl);
        } else {
          // Layer 2 (Global API Rate Limiter): a function that never opted
          // into an endpoint-specific limit still gets the configured
          // default (EDGE_RATE_LIMIT_WINDOW_SECONDS/MAX_REQUESTS) rather
          // than no protection at all. Keyed by user when authenticated,
          // else by IP, scoped per function so one anonymous endpoint's
          // traffic can't exhaust another's budget.
          const identity = user
            ? `user:${user.id}`
            : `ip:${getClientIp(request) ?? "unknown"}`;
          await enforceRateLimit({
            key: `global:${options.functionName}:${identity}`,
          });
        }

        capturedCtx = ctx;
        return handler(ctx);
      });

      if (options.fraudCheck && capturedCtx) {
        try {
          await options.fraudCheck(capturedCtx, response);
        } catch (fraudCheckError) {
          logger.error("Fraud check failed (non-fatal)", {
            error: fraudCheckError instanceof Error
              ? fraudCheckError.message
              : String(fraudCheckError),
          });
        }
      }

      const cors = corsHeadersFor(request);
      for (
        const [key, value] of Object.entries({
          ...cors,
          "X-Correlation-Id": correlationId,
        })
      ) {
        response.headers.set(key, value);
      }
      return response;
    } catch (err) {
      const edgeError = toEdgeFunctionError(err);
      logger.error("Edge function error", {
        error: edgeError.message,
        code: edgeError.code,
        stack: err instanceof Error ? err.stack : undefined,
      });
      const response = errorResponse(err, requestId);
      for (
        const [key, value] of Object.entries({
          ...securityHeaders,
          "X-Correlation-Id": correlationId,
        })
      ) {
        response.headers.set(key, value);
      }
      return response;
    } finally {
      clearLogContext();
      clearWithinRequestHandlers();
    }
  };
}
