import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

type LogLevel = "info" | "warn" | "error";

interface LogFields {
  [key: string]: unknown;
}

interface RequestContext {
  requestId: string;
  route: string;
}

const isDev = process.env.NODE_ENV !== "production";
const explicitConsole = process.env.LOG_TO_CONSOLE;
const LOG_TO_CONSOLE =
  explicitConsole === "1" || (isDev && explicitConsole !== "0");
const configuredLogPath = process.env.LOG_FILE_PATH?.trim();
const defaultLogPath = path.join(process.cwd(), "logs", "app.log");
const resolvedLogPath = configuredLogPath || defaultLogPath;
let ensureLogPathPromise: Promise<string> | null = null;

function ensureLogPath(): Promise<string> {
  if (!ensureLogPathPromise) {
    ensureLogPathPromise = mkdir(path.dirname(resolvedLogPath), {
      recursive: true,
    }).then(() => resolvedLogPath);
  }
  return ensureLogPathPromise;
}

function writeToFile(line: string): void {
  void ensureLogPath()
    .then((logPath) => appendFile(logPath, `${line}\n`, "utf8"))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          event: "logger.file_write_failed",
          errorMessage: message,
          logPath: resolvedLogPath,
        }),
      );
    });
}

function toErrorFields(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
    };
  }
  return {
    errorMessage: String(error),
  };
}

function write(level: LogLevel, event: string, fields: LogFields = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const line = JSON.stringify(payload);
  writeToFile(line);

  if (!LOG_TO_CONSOLE) return;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createRequestContext(request: Request, route: string): RequestContext {
  const headerRequestId = request.headers.get("x-request-id")?.trim();
  return {
    requestId: headerRequestId || crypto.randomUUID(),
    route,
  };
}

export function logInfo(event: string, fields?: LogFields): void {
  write("info", event, fields);
}

export function logWarn(event: string, fields?: LogFields): void {
  write("warn", event, fields);
}

export function logError(event: string, error: unknown, fields?: LogFields): void {
  write("error", event, { ...fields, ...toErrorFields(error) });
}

export function publicErrorMessage(
  error: unknown,
  fallback = "Unexpected API error.",
): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
