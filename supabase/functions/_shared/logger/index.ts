// supabase/functions/_shared/logger/index.ts
//
// Structured (JSON-line) logging. Edge Functions' logs are captured by
// Supabase's log drain, which indexes JSON fields — plain console.log
// strings are far less useful there than structured objects, so every log
// line here is a single JSON object with a consistent shape.

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  correlationId?: string;
  requestId?: string;
  userId?: string;
  functionName?: string;
  [key: string]: unknown;
}

let globalContext: LogContext = {};

/** Set once per invocation (see middleware/compose.ts) so every subsequent
 * log line in that invocation automatically includes correlation/request IDs
 * without every call site having to pass them explicitly. */
export function setLogContext(context: LogContext): void {
  globalContext = { ...globalContext, ...context };
}

export function clearLogContext(): void {
  globalContext = {};
}

function emit(
  level: LogLevel,
  message: string,
  extra?: Record<string, unknown>,
) {
  const line = {
    level,
    message,
    timestamp: new Date().toISOString(),
    ...globalContext,
    ...extra,
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
      console.log(serialized);
  }
}

export const logger = {
  debug: (message: string, extra?: Record<string, unknown>) =>
    emit("debug", message, extra),
  info: (message: string, extra?: Record<string, unknown>) =>
    emit("info", message, extra),
  warn: (message: string, extra?: Record<string, unknown>) =>
    emit("warn", message, extra),
  error: (message: string, extra?: Record<string, unknown>) =>
    emit("error", message, extra),
};
