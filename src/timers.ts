import { EventEmitter } from "events";
import { randomUUID } from "crypto";

export type TimerStatus = "running" | "stopped" | "completed";

export interface TimerSnapshot {
  id: string;
  durationMs: number;
  remainingMs: number;
  status: TimerStatus;
  startedAt: string;
  endsAt: string;
}

interface ActiveTimer {
  id: string;
  durationMs: number;
  startedAt: number;
  endsAt: number;
  interval: NodeJS.Timeout;
}

type TimerEvents = {
  tick: (timer: TimerSnapshot) => void;
  complete: (timer: TimerSnapshot) => void;
  stop: (timer: TimerSnapshot) => void;
};

export class TimerManager {
  private readonly emitter = new EventEmitter();
  private readonly timers = new Map<string, ActiveTimer>();

  on<T extends keyof TimerEvents>(event: T, listener: TimerEvents[T]): () => void {
    this.emitter.on(event, listener);
    return () => this.emitter.off(event, listener);
  }

  start(durationSeconds: number): TimerSnapshot {
    if (durationSeconds <= 0) {
      throw new Error("Duration must be greater than zero seconds.");
    }

    const durationMs = durationSeconds * 1000;
    const id = randomUUID();
    const startedAt = Date.now();
    const endsAt = startedAt + durationMs;

    const interval = setInterval(() => {
      const snapshot = this.snapshotFor(id);
      if (!snapshot) {
        return;
      }
      if (snapshot.remainingMs <= 0) {
        clearInterval(interval);
        this.timers.delete(id);
        const completed: TimerSnapshot = {
          ...snapshot,
          status: "completed",
          remainingMs: 0
        };
        this.emitter.emit("complete", completed);
        return;
      }
      this.emitter.emit("tick", snapshot);
    }, 1000);

    this.timers.set(id, {
      id,
      durationMs,
      startedAt,
      endsAt,
      interval
    });

    const snapshot = this.snapshotFor(id);
    if (!snapshot) {
      throw new Error("Failed to start timer.");
    }
    return snapshot;
  }

  stop(id: string): TimerSnapshot {
    const timer = this.requireActive(id);
    clearInterval(timer.interval);
    this.timers.delete(id);
    const snapshot: TimerSnapshot = {
      id: timer.id,
      durationMs: timer.durationMs,
      remainingMs: 0,
      status: "stopped",
      startedAt: new Date(timer.startedAt).toISOString(),
      endsAt: new Date(Date.now()).toISOString()
    };
    this.emitter.emit("stop", snapshot);
    return snapshot;
  }

  list(): TimerSnapshot[] {
    return [...this.timers.values()]
      .map(timer => this.snapshotFor(timer.id))
      .filter((value): value is TimerSnapshot => Boolean(value));
  }

  snapshotFor(id: string): TimerSnapshot | undefined {
    const timer = this.timers.get(id);
    if (!timer) {
      return undefined;
    }
    const remainingMs = Math.max(timer.endsAt - Date.now(), 0);
    return {
      id: timer.id,
      durationMs: timer.durationMs,
      remainingMs,
      status: remainingMs === 0 ? "completed" : "running",
      startedAt: new Date(timer.startedAt).toISOString(),
      endsAt: new Date(timer.endsAt).toISOString()
    };
  }

  private requireActive(id: string): ActiveTimer {
    const timer = this.timers.get(id);
    if (!timer) {
      throw new Error("Timer not found.");
    }
    return timer;
  }
}
