import { initLogger, type Span } from "braintrust";

const DEFAULT_PROJECT_ID = "8304bf54-fbce-4f06-8274-61ef8deb1e33";
const DEFAULT_APP_URL = "https://www.braintrust.dev";

type TelemetryLogger = ReturnType<typeof initLogger>;
type AskRouteLabSpanType = "llm" | "task";

let logger: TelemetryLogger | undefined;
let loggerKey = "";

const braintrustKey = () => String(process.env.BRAINTRUST_API_KEY ?? "").trim();

function getLogger() {
  const apiKey = braintrustKey();
  if (!apiKey) return undefined;
  if (logger && loggerKey === apiKey) return logger;
  loggerKey = apiKey;
  logger = initLogger({
    apiKey,
    projectId: String(process.env.ROUTELAB_BRAINTRUST_PROJECT_ID ?? DEFAULT_PROJECT_ID).trim(),
    appUrl: String(process.env.BRAINTRUST_APP_URL ?? DEFAULT_APP_URL).trim(),
    asyncFlush: true,
    noExitFlush: true,
    onFlushError: (error) => console.error("Ask RouteLab Braintrust flush failed", error),
  });
  return logger;
}

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
const safeString = (value: unknown, limit = 8_000) => String(value ?? "").trim().slice(0, limit);

export type AskRouteLabTelemetryEvent = {
  interactionId: string;
  parent?: string;
  question: string;
  workspace: string;
  status: "completed" | "failed";
  planKind: string;
  planner: string;
  output: {
    text: string;
    facts: string[];
    action?: string;
    openui?: string;
  };
};

export function sanitizeAskRouteLabTelemetryEvent(value: unknown): AskRouteLabTelemetryEvent {
  const event = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const output = event.output && typeof event.output === "object" ? event.output as Record<string, unknown> : {};
  return {
    interactionId: safeString(event.interactionId, 180) || "unknown",
    parent: safeString(event.parent, 8_000) || undefined,
    question: safeString(event.question, 1_500),
    workspace: safeString(event.workspace, 180) || "unknown",
    status: event.status === "failed" ? "failed" : "completed",
    planKind: safeString(event.planKind, 80) || "unknown",
    planner: safeString(event.planner, 80) || "unknown",
    output: {
      text: safeString(output.text, 8_000),
      facts: Array.isArray(output.facts) ? output.facts.slice(0, 20).map((fact) => safeString(fact, 1_000)).filter(Boolean) : [],
      action: safeString(output.action, 180) || undefined,
      openui: safeString(output.openui, 8_000) || undefined,
    },
  };
}

export async function traceAskRouteLabOperation<T>({
  name,
  type = "task",
  parent,
  input,
  metadata,
}: {
  name: string;
  type?: AskRouteLabSpanType;
  parent?: string;
  input: unknown;
  metadata?: Record<string, unknown>;
}, operation: (span?: Span) => Promise<T>): Promise<{ value: T; parent?: string; enabled: boolean }> {
  const activeLogger = getLogger();
  let span: Span | undefined;
  let exportedParent: string | undefined;
  if (activeLogger) {
    try {
      span = activeLogger.startSpan({
        name,
        type,
        parent: safeString(parent, 8_000) || undefined,
        event: { input, metadata },
      });
      exportedParent = await span.export();
    } catch (error) {
      console.error("Ask RouteLab Braintrust span could not start", error);
    }
  }

  try {
    const value = await operation(span);
    span?.log({ output: value });
    return { value, parent: exportedParent, enabled: Boolean(span) };
  } catch (error) {
    span?.log({ error: errorMessage(error) });
    throw error;
  } finally {
    span?.end();
    if (activeLogger) {
      try {
        await activeLogger.flush();
      } catch (error) {
        console.error("Ask RouteLab Braintrust flush failed", error);
      }
    }
  }
}

export async function traceAskRouteLabChild<T>(parent: Span | undefined, {
  name,
  type,
  input,
  metadata,
}: {
  name: string;
  type: AskRouteLabSpanType;
  input: unknown;
  metadata?: Record<string, unknown>;
}, operation: (span?: Span) => Promise<T>): Promise<T> {
  let span: Span | undefined;
  try {
    span = parent?.startSpan({ name, type, event: { input, metadata } });
  } catch (error) {
    console.error("Ask RouteLab Braintrust child span could not start", error);
  }
  try {
    const value = await operation(span);
    span?.log({ output: value });
    return value;
  } catch (error) {
    span?.log({ error: errorMessage(error) });
    throw error;
  } finally {
    span?.end();
  }
}
