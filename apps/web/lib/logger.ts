// apps/web/lib/logger.ts
//
// Phase 8.5 observability fix: no structured-logging module existed for
// the Next.js app (the backend's supabase/functions/_shared/logger/
// index.ts equivalent) -- every server-side log in this app was a plain
// console.error("message", errorObject) call, unstructured and
// inconsistent in shape from one call site to the next.
//
// Deliberately DIFFERENT from the backend logger's design in one respect:
// no shared mutable module-level context. The backend's Deno Edge
// Function logger sets a global correlationId/userId per invocation
// because each invocation genuinely gets its own isolated execution
// context. Next.js on Node.js can serve multiple concurrent requests
// within the SAME process/module scope -- a shared mutable "current
// request" object would leak request A's context into request B's log
// lines under real concurrent load. Context is passed explicitly per
// call instead; there is nothing to get wrong under concurrency because
// there is nothing shared to race on.
//
// Portable across both runtimes this app uses (Node.js for Server
// Components/Route Handlers, Edge for middleware.ts) -- no Node-specific
// APIs.

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  correlationId?: string;
  userId?: string;
  route?: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, message: string, context?: LogContext) {
  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...context,
  };
  const serialized = JSON.stringify(line);

  switch (level) {
    case "error":
      console.error(serialized);
      break;
    case "warn":
      console.warn(serialized);
      break;
    default:
      // This module IS the sanctioned structured-logging abstraction
      // (eslint.config.mjs restricts console usage everywhere else to
      // warn/error specifically to push call sites through here instead).
      // eslint-disable-next-line no-console
      console.log(serialized);
  }
}

export const logger = {
  debug: (message: string, context?: LogContext) => emit("debug", message, context),
  info: (message: string, context?: LogContext) => emit("info", message, context),
  warn: (message: string, context?: LogContext) => emit("warn", message, context),
  error: (message: string, context?: LogContext) => emit("error", message, context),
};
