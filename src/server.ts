import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import { TimerManager, TimerSnapshot } from "./timers.js";

export interface TimerServerContext {
  server: McpServer;
  timers: TimerManager;
}

const MAX_DURATION_SECONDS = 3600;

export function parseDurationSeconds(input: string): number {
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    throw new Error("Duration must not be empty.");
  }

  const mmSsMatch = normalized.match(/^(\d{1,2}):([0-5]?\d)$/);
  if (mmSsMatch) {
    const minutes = Number(mmSsMatch[1]);
    const seconds = Number(mmSsMatch[2]);
    const total = minutes * 60 + seconds;
    if (total <= 0) {
      throw new Error("Duration must be greater than zero seconds.");
    }
    return total;
  }

  const unitMultipliers: Record<string, number> = {
    h: 3600,
    hr: 3600,
    hrs: 3600,
    hour: 3600,
    hours: 3600,
    m: 60,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1
  };

  const unitPattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
  let match: RegExpExecArray | null;
  let totalFromUnits = 0;
  let matchedUnits = false;

  while ((match = unitPattern.exec(normalized)) !== null) {
    matchedUnits = true;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) {
      continue;
    }
    const unitKey = match[2].replace(/s$/, "") as keyof typeof unitMultipliers;
    const multiplier = unitMultipliers[unitKey] ?? unitMultipliers[match[2] as keyof typeof unitMultipliers];
    if (!multiplier) {
      continue;
    }
    totalFromUnits += Math.round(value * multiplier);
  }

  if (matchedUnits) {
    const cleanupPattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)\b/g;
    const leftover = normalized
      .replace(cleanupPattern, " ")
      .replace(/\band\b/g, " ")
      .replace(/[,]/g, " ")
      .trim();
    if (/\d/.test(leftover)) {
      throw new Error(`Could not parse duration "${input}".`);
    }
    if (totalFromUnits <= 0) {
      throw new Error("Duration must be greater than zero seconds.");
    }
    return totalFromUnits;
  }

  const bareSeconds = Number(normalized);
  if (Number.isFinite(bareSeconds) && bareSeconds > 0) {
    return Math.round(bareSeconds);
  }

  throw new Error(`Could not parse duration "${input}".`);
}

const startTimerSchema = z
  .object({
    duration: z
      .preprocess(value => {
        if (typeof value === "string") {
          return parseDurationSeconds(value);
        }
        return value;
      }, z.number().int().positive().max(MAX_DURATION_SECONDS))
      .describe("Duration in seconds, or a string like \"5 minutes\"."),
    action: z.literal("start").optional()
  })
  .transform(data => ({
    action: "start" as const,
    duration: data.duration
  }));

const stopTimerSchema = z.object({
  action: z.literal("stop"),
  id: z.string().uuid()
});

const listTimerSchema = z.object({
  action: z.literal("list")
});

const timerInputSchema = z.union([startTimerSchema, stopTimerSchema, listTimerSchema]);

type TimerInput = z.infer<typeof timerInputSchema>;

export function createTimerServer(): TimerServerContext {
  const timers = new TimerManager();
  const server = new McpServer(
    {
      name: "Timer Demo",
      version: packageJson.version,
      description: "Minimal timer app built with the OpenAI Apps SDK."
    },
    {
      capabilities: {
        logging: {}
      }
    }
  );

  server.registerTool(
    "timer",
    {
      title: "Timer",
      description: "Start, stop, or list timers.",
      inputSchema: {
        action: z.enum(["start", "stop", "list"]).optional(),
        duration: z
          .union([
            z.number().int().positive().max(MAX_DURATION_SECONDS),
            z
              .string()
              .min(1)
              .describe('Examples: "5 minutes", "30s", or "1m 30s".')
          ])
          .optional(),
        id: z.string().uuid().optional()
      },
      annotations: {
        readOnlyHint: false
      }
    },
    async (input, extra) => {
      const parsed: TimerInput = timerInputSchema.parse(input);

      switch (parsed.action) {
        case "start": {
          const snapshot = timers.start(parsed.duration);

          return buildResult(`Started a ${formatDurationFromSeconds(parsed.duration)} timer.`, timers.list());
        }
        case "stop": {
          const snapshot = timers.stop(parsed.id);
          return buildResult(`Stopped timer ${snapshot.id}.`, timers.list());
        }
        case "list":
        default: {
          const message = timers.list().length === 0 ? "No timers running." : "Here are the active timers.";
          return buildResult(message, timers.list());
        }
      }
    }
  );

  return {
    server,
    timers
  };
}

function buildResult(message: string, timers: TimerSnapshot[]) {
  return {
    content: [
      {
        type: "text" as const,
        text: message
      }
    ],
    structuredContent: buildStructuredContent(timers),
    output: {
      timers
    }
  };
}

function buildStructuredContent(timers: TimerSnapshot[]) {
  if (timers.length === 0) {
    return {
      app: "Timer Demo",
      inlineCard: {
        surface: "inline_card",
        heading: "Timer Demo",
        body: "No active timers. Use the widget to start one.",
        accessibilityLabel: "No active timers."
      }
    };
  }

  const body = timers
    .map(timer => {
      const remaining = formatRemaining(timer.remainingMs);
      const total = Math.round(timer.durationMs / 1000);
      return `Timer: ${remaining} left (was ${total}s)`;
    })
    .join("\n");

  return {
    app: "Timer Demo",
    inlineCard: {
      surface: "inline_card",
      heading: "Active Timers",
      body,
      accessibilityLabel: "Timers currently running."
    }
  };
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }
  return `${seconds}s`;
}

function formatDurationFromSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (minutes > 0) {
    parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  }
  if (seconds > 0) {
    parts.push(`${seconds} second${seconds === 1 ? "" : "s"}`);
  }

  if (parts.length === 0) {
    return "0 seconds";
  }

  if (parts.length === 1) {
    return parts[0];
  }

  return `${parts[0]} and ${parts[1]}`;
}
