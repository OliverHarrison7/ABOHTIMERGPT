import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { resolve } from "path";
import packageJson from "../package.json" with { type: "json" };
import { TimerStore } from "./state/timerStore.js";
import { TimerFileStorage } from "./state/timerStorage.js";
import { TimerToolset, startTimerInput } from "./tools/timerTool.js";
import { buildTimerStructuredContent, buildFullscreenSheet } from "./ui/builders.js";
import type { Timer } from "./types.js";

const storagePath = process.env.TIMERGPT_STORAGE_PATH ?? resolve(process.cwd(), ".timergpt", "timers.json");
const storage = new TimerFileStorage(storagePath);
const initialTimers = await storage.load();
const store = new TimerStore({
  initialTimers,
  onChange: timers => storage.save(timers)
});
const toolset = new TimerToolset(store);

const server = new McpServer(
  {
    name: "TimerGPT",
    version: packageJson.version,
    description: "Conversational timers that stay in flow with ChatGPT."
  },
  {
    capabilities: {
      logging: {}
    }
  }
);

const idArgsShape = { id: z.string().uuid() };
const idSchema = z.object(idArgsShape);
const adjustArgsSchema = z.object({
  id: z.string().uuid(),
  minutes: z.number().int().min(-120).max(120).optional(),
  seconds: z.number().int().min(-59).max(59).optional()
});

type StartTimerArgs = z.input<typeof startTimerInput>;
type IdArgs = z.infer<typeof idSchema>;
type AdjustTimerArgs = z.infer<typeof adjustArgsSchema>;

server.registerTool(
  "timer.start",
  {
    title: "Start Timer",
    description: "Create and start a new countdown timer.",
    inputSchema: startTimerInput.shape,
    annotations: {
      readOnlyHint: false
    }
  },
  async (input: StartTimerArgs) => {
    const result = await toolset.startTimer(input);
    const timers = toolset.getSnapshot();
    const structured = buildTimerStructuredContent({
      primary: result.timer,
      timers,
      includeFullscreen: true,
      pipTimer: result.timer.status === "running" ? result.timer : null,
      completed: result.completed ?? []
    });

    return buildCallToolResult(
      composeMessage(result.message, result.completed),
      structured
    );
  }
);

server.registerTool(
  "timer.pause",
  {
    title: "Pause Timer",
    description: "Pause a running timer.",
    inputSchema: idSchema.shape,
    annotations: {
      readOnlyHint: false
    }
  },
  async ({ id }: IdArgs) => {
    const result = await toolset.pauseTimer(id);
    const timers = toolset.getSnapshot();
    const structured = buildTimerStructuredContent({
      primary: result.timer,
      timers,
      completed: result.completed ?? []
    });

    return buildCallToolResult(
      composeMessage(result.message, result.completed),
      structured
    );
  }
);

server.registerTool(
  "timer.resume",
  {
    title: "Resume Timer",
    description: "Resume a paused timer.",
    inputSchema: idSchema.shape,
    annotations: {
      readOnlyHint: false
    }
  },
  async ({ id }: IdArgs) => {
    const result = await toolset.resumeTimer(id);
    const timers = toolset.getSnapshot();
    const structured = buildTimerStructuredContent({
      primary: result.timer,
      timers,
      pipTimer: result.timer,
      completed: result.completed ?? []
    });

    return buildCallToolResult(
      composeMessage(result.message, result.completed),
      structured
    );
  }
);

server.registerTool(
  "timer.cancel",
  {
    title: "Cancel Timer",
    description: "Cancel a timer that is no longer needed.",
    inputSchema: idSchema.shape,
    annotations: {
      readOnlyHint: false
    }
  },
  async ({ id }: IdArgs) => {
    const result = await toolset.cancelTimer(id);
    const timers = toolset.getSnapshot();
    const structured = buildTimerStructuredContent({
      primary: result.timer,
      timers,
      completed: result.completed ?? []
    });

    return buildCallToolResult(
      composeMessage(result.message, result.completed),
      structured
    );
  }
);

server.registerTool(
  "timer.adjust",
  {
    title: "Adjust Timer",
    description: "Extend or shorten an active timer.",
    inputSchema: adjustArgsSchema.shape,
    annotations: {
      readOnlyHint: false
    }
  },
  async (input: AdjustTimerArgs) => {
    const result = await toolset.extendTimer(input);
    const timers = toolset.getSnapshot();
    const structured = buildTimerStructuredContent({
      primary: result.timer,
      timers,
      completed: result.completed ?? []
    });

    return buildCallToolResult(
      composeMessage(result.message, result.completed),
      structured
    );
  }
);

server.registerTool(
  "timer.list",
  {
    title: "List Timers",
    description: "Review timers that are active, paused, or completed.",
    inputSchema: {},
    annotations: {
      readOnlyHint: true
    }
  },
  async () => {
    const { timers, completed } = await toolset.listTimers();
    const primary = timers[0];
    const structured = buildTimerStructuredContent({
      primary,
      timers,
      includeFullscreen: timers.length > 0,
      completed
    });

    const message = timers.length === 0
      ? "No timers yet. Ask me to start one!"
      : composeMessage("Here are your timers.", completed);

    return buildCallToolResult(message, structured);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);

function composeMessage(primary: string, completed: Timer[] | undefined): string {
  if (!completed || completed.length === 0) {
    return primary;
  }

  const labels = Array.from(new Set(completed.map(timer => timer.label)));
  const summary = labels.join(", ");
  const suffix = labels.length === 1 ? `${summary} finished.` : `${summary} finished.`;
  const separator = primary.trim().endsWith(".") ? " " : ". ";
  return `${primary.trim()}${separator}${suffix}`;
}

function buildCallToolResult(message: string, structured: ReturnType<typeof buildTimerStructuredContent>) {
  return {
    content: [
      {
        type: "text" as const,
        text: message
      }
    ],
    structuredContent: {
      app: "TimerGPT",
      ...structured,
      fullscreen: structured.fullscreen ?? buildFullscreenSheet()
    }
  };
}
