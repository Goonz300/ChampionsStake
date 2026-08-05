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
import {
  type AuthenticatedUser,
  verifyOptionalRequestJwt,
  verifyRequestJwt,
} from "../auth/jwt.ts";
import { loadUserProfile, type UserProfile } from "../auth/session.ts";
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

    try {
      const response = await withTiming(options.functionName, async () => {
        let user: AuthenticatedUser | null = null;

        if ((options.auth ?? "required") === "required") {
          user = await verifyRequestJwt(request);
        } else if (options.auth === "optional") {
          user = await verifyOptionalRequestJwt(request);
        }

        const profile = user ? await loadUserProfile(user) : null;
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
        }

        return handler(ctx);
      });

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
