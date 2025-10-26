export type TimerStatus = "scheduled" | "running" | "paused" | "completed" | "cancelled";

export interface Timer {
  id: string;
  label: string;
  durationMs: number;
  remainingMs: number;
  status: TimerStatus;
  startedAt?: string;
  endsAt?: string;
  repeat?: {
    intervalMs: number;
    occurrences?: number;
  };
  category?: "focus" | "break" | "custom";
}

export interface TimerUpdateResult {
  timer: Timer;
  message: string;
  completed?: Timer[];
}
