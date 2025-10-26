import type { Timer } from "../types.js";

export interface InlineCard {
  surface: "inline_card";
  heading: string;
  body: string;
  badge?: string;
  cta?: {
    label: string;
    action: "open_inspect" | "resume_timer" | "pause_timer";
    timerId: string;
  };
  accessibilityLabel: string;
}

export interface InspectListRow {
  surface: "inspect";
  id: string;
  title: string;
  subtitle: string;
  status: "scheduled" | "running" | "paused" | "completed" | "cancelled";
  badge?: string;
  cta?: {
    label: string;
    action: "open_fullscreen" | "resume_timer" | "pause_timer";
    timerId: string;
  };
  accessibilityLabel: string;
}

export interface FullscreenSheet {
  surface: "fullscreen";
  heading: string;
  steps: Array<{
    title: string;
    description: string;
  }>;
  summary?: string;
  accessibilityLabel: string;
}

export interface PipWidget {
  surface: "picture_in_picture";
  title: string;
  remaining: string;
  status: Timer["status"];
  cta?: {
    label: string;
    action: "pause_timer" | "resume_timer";
    timerId: string;
  };
  dismissOnComplete: boolean;
}

export interface TimerStructuredContent {
  inlineCard?: InlineCard;
  inspect?: {
    items: InspectListRow[];
  };
  fullscreen?: FullscreenSheet;
  pictureInPicture?: PipWidget;
  completed?: Array<{
    id: string;
    label: string;
    completedAt?: string;
  }>;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0 && seconds > 0) {
    return `${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

export function buildInlineCard(timer: Timer): InlineCard {
  return {
    surface: "inline_card",
    heading: timer.label,
    body: statusCopy(timer),
    badge: timer.category === "focus" ? "Focus" : timer.category === "break" ? "Break" : undefined,
    cta: timer.status === "running"
      ? { label: "Pause", action: "pause_timer", timerId: timer.id }
      : timer.status === "paused"
        ? { label: "Resume", action: "resume_timer", timerId: timer.id }
        : { label: "Open details", action: "open_inspect", timerId: timer.id },
    accessibilityLabel: `Timer ${timer.label}, ${statusCopy(timer)}`
  };
}

export function buildInspectRow(timer: Timer): InspectListRow {
  return {
    surface: "inspect",
    id: timer.id,
    title: timer.label,
    subtitle: statusCopy(timer),
    status: timer.status,
    badge: timer.category === "focus" ? "Focus" : timer.category === "break" ? "Break" : undefined,
    cta: timer.status === "running"
      ? { label: "Pause", action: "pause_timer", timerId: timer.id }
      : timer.status === "paused"
        ? { label: "Resume", action: "resume_timer", timerId: timer.id }
        : timer.status === "completed"
          ? { label: "Open details", action: "open_fullscreen", timerId: timer.id }
          : undefined,
    accessibilityLabel: `Timer ${timer.label}, ${statusCopy(timer)}`
  };
}

export function buildFullscreenSheet(): FullscreenSheet {
  return {
    surface: "fullscreen",
    heading: "Create a custom timer routine",
    steps: [
      {
        title: "Name & duration",
        description: "Choose a label and target time. Defaults keep things simple for quick setups."
      },
      {
        title: "Optional repeats",
        description: "Stack focus and break intervals or configure recurring sessions."
      },
      {
        title: "Review & start",
        description: "Confirm the schedule and start timers instantly."
      }
    ],
    summary: "Stay in flow while ChatGPT keeps time. Ask for adjustments at any point.",
    accessibilityLabel: "Timer creation sheet with three steps for name, repeats, and review."
  };
}

export function buildPip(timer: Timer): PipWidget {
  return {
    surface: "picture_in_picture",
    title: timer.label,
    remaining: formatDuration(timer.remainingMs),
    status: timer.status,
    cta: timer.status === "running"
      ? { label: "Pause", action: "pause_timer", timerId: timer.id }
      : timer.status === "paused"
        ? { label: "Resume", action: "resume_timer", timerId: timer.id }
        : undefined,
    dismissOnComplete: true
  };
}

export function buildTimerStructuredContent(input: {
  primary?: Timer;
  timers: Timer[];
  includeFullscreen?: boolean;
  pipTimer?: Timer | null;
  completed?: Timer[];
}): TimerStructuredContent {
  const { primary, timers, includeFullscreen = false, pipTimer = null, completed = [] } = input;
  const inlineCard = primary ? buildInlineCard(primary) : undefined;
  const inspectItems = timers
    .slice(0, 8)
    .map(timer => buildInspectRow(timer));

  const pipCandidate =
    pipTimer ??
    timers.find(timer => timer.status === "running") ??
    timers.find(timer => timer.status === "paused") ??
    null;

  return {
    inlineCard,
    inspect: inspectItems.length > 0 ? { items: inspectItems } : undefined,
    fullscreen: includeFullscreen ? buildFullscreenSheet() : undefined,
    pictureInPicture: pipCandidate ? buildPip(pipCandidate) : undefined,
    completed: completed.length > 0
      ? completed.map(timer => ({
        id: timer.id,
        label: timer.label,
        completedAt: timer.endsAt
      }))
      : undefined
  };
}

function statusCopy(timer: Timer): string {
  switch (timer.status) {
    case "running":
      return `${formatDuration(timer.remainingMs)} remaining`;
    case "paused":
      return `Paused with ${formatDuration(timer.remainingMs)} left`;
    case "scheduled":
      return `Scheduled to start at ${timer.startedAt ?? "an upcoming time"}`;
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return "";
  }
}
