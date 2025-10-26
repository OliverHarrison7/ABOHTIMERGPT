import { addMilliseconds, differenceInMilliseconds, formatISO } from "date-fns";
import { v4 as uuid } from "uuid";
import type { Timer, TimerUpdateResult } from "../types.js";

interface TimerStoreOptions {
  maxConcurrent?: number;
  initialTimers?: Timer[];
  onChange?: (timers: Timer[]) => void | Promise<void>;
}

const DEFAULT_MAX_CONCURRENT = 5;

export class TimerStore {
  private readonly timers = new Map<string, Timer>();
  private readonly maxConcurrent: number;
  private readonly onChange?: (timers: Timer[]) => void | Promise<void>;
  private pendingPersist: Promise<void> = Promise.resolve();
  private lastPersistError: Error | null = null;

  constructor(options: TimerStoreOptions = {}) {
    this.maxConcurrent = options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
    this.onChange = options.onChange;

    if (options.initialTimers) {
      const now = new Date();
      for (const timer of options.initialTimers) {
        const normalized = this.normalizeTimer(timer, now);
        this.timers.set(normalized.id, normalized);
      }
    }
  }

  getAll(): Timer[] {
    return [...this.timers.values()].sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  }

  getActive(): Timer[] {
    return this.getAll().filter(timer => timer.status === "running" || timer.status === "paused" || timer.status === "scheduled");
  }

  findById(id: string): Timer | undefined {
    return this.timers.get(id);
  }

  async waitForPersistence(): Promise<void> {
    try {
      await this.pendingPersist;
    } catch (error) {
      if (!this.lastPersistError && error instanceof Error) {
        this.lastPersistError = error;
      }
    }

    if (this.lastPersistError) {
      const error = this.lastPersistError;
      this.lastPersistError = null;
      throw error;
    }
  }

  start(input: {
    label?: string;
    durationMs: number;
    category?: Timer["category"];
    repeat?: Timer["repeat"];
  }): TimerUpdateResult {
    if (this.getActive().length >= this.maxConcurrent) {
      throw new Error(`You already have ${this.maxConcurrent} active timers. Cancel one before starting another.`);
    }

    const now = new Date();
    const endsAt = addMilliseconds(now, input.durationMs);
    const id = uuid();
    const timer: Timer = {
      id,
      label: input.label ?? this.suggestLabel(),
      durationMs: input.durationMs,
      remainingMs: input.durationMs,
      status: "running",
      startedAt: formatISO(now),
      endsAt: formatISO(endsAt),
      repeat: input.repeat,
      category: input.category ?? "custom"
    };

    this.timers.set(id, timer);
    this.emitChange();

    return {
      timer,
      message: `Started ${timer.label} for ${Math.round(input.durationMs / 60000)} minutes.`
    };
  }

  pause(id: string): TimerUpdateResult {
    const timer = this.requireTimer(id);
    if (timer.status !== "running") {
      throw new Error("Only running timers can be paused.");
    }

    const remainingMs = this.computeRemaining(timer);
    const updated: Timer = {
      ...timer,
      status: "paused",
      remainingMs,
      endsAt: undefined
    };

    this.timers.set(id, updated);
    this.emitChange();

    return {
      timer: updated,
      message: `${timer.label} paused with ${Math.ceil(remainingMs / 60000)} minutes left.`
    };
  }

  resume(id: string): TimerUpdateResult {
    const timer = this.requireTimer(id);
    if (timer.status !== "paused") {
      throw new Error("Only paused timers can be resumed.");
    }

    const now = new Date();
    const endsAt = addMilliseconds(now, timer.remainingMs);
    const updated: Timer = {
      ...timer,
      status: "running",
      startedAt: timer.startedAt ?? formatISO(now),
      endsAt: formatISO(endsAt)
    };

    this.timers.set(id, updated);
    this.emitChange();

    return {
      timer: updated,
      message: `${timer.label} resumed. ${Math.ceil(timer.remainingMs / 60000)} minutes remaining.`
    };
  }

  cancel(id: string): TimerUpdateResult {
    const timer = this.requireTimer(id);
    const updated: Timer = {
      ...timer,
      status: "cancelled",
      remainingMs: 0,
      endsAt: undefined
    };

    this.timers.set(id, updated);
    this.emitChange();

    return {
      timer: updated,
      message: `${timer.label} cancelled.`
    };
  }

  completeExpiringTimers(now = new Date()): Timer[] {
    const completed: Timer[] = [];
    for (const timer of this.timers.values()) {
      if (timer.status === "running" && timer.endsAt && new Date(timer.endsAt) <= now) {
        const finished: Timer = {
          ...timer,
          status: "completed",
          remainingMs: 0,
          endsAt: formatISO(now)
        };
        this.timers.set(timer.id, finished);
        completed.push(finished);
      }
    }

    if (completed.length > 0) {
      this.emitChange();
    }

    return completed;
  }

  extend(id: string, extraMs: number): TimerUpdateResult {
    const timer = this.requireTimer(id);
    if (timer.status !== "running" && timer.status !== "paused") {
      throw new Error("Only active timers can be extended.");
    }

    const now = new Date();
    const remainingMs = timer.status === "running" ? this.computeRemaining(timer, now) : timer.remainingMs;
    const newRemaining = Math.max(remainingMs + extraMs, 0);
    const deltaLabel = this.describeDelta(extraMs);
    let message: string;
    const updated: Timer =
      newRemaining === 0
        ? {
          ...timer,
          status: "completed",
          remainingMs: 0,
          endsAt: formatISO(now)
        }
        : timer.status === "running"
          ? {
            ...timer,
            remainingMs: newRemaining,
            endsAt: formatISO(addMilliseconds(now, newRemaining))
          }
          : {
            ...timer,
            remainingMs: newRemaining
          };

    if (newRemaining === 0) {
      message = `${timer.label} finished after the adjustment.`;
    } else if (extraMs >= 0) {
      message = `${timer.label} extended by ${deltaLabel}.`;
    } else {
      message = `${timer.label} shortened by ${deltaLabel}.`;
    }

    this.timers.set(id, updated);
    this.emitChange();

    return {
      timer: updated,
      message
    };
  }

  private computeRemaining(timer: Timer, now = new Date()): number {
    if (!timer.endsAt) {
      return timer.remainingMs;
    }
    const diff = differenceInMilliseconds(new Date(timer.endsAt), now);
    return Math.max(diff, 0);
  }

  private requireTimer(id: string): Timer {
    const timer = this.timers.get(id);
    if (!timer) {
      throw new Error("Timer not found.");
    }
    return timer;
  }

  private suggestLabel(): string {
    const base = "Timer";
    const occupied = new Set([...this.timers.values()].map(timer => timer.label));
    let counter = 1;
    while (occupied.has(`${base} ${counter}`)) {
      counter += 1;
    }
    return `${base} ${counter}`;
  }

  private describeDelta(extraMs: number): string {
    const abs = Math.abs(extraMs);
    const minutes = Math.floor(abs / 60000);
    const seconds = Math.floor((abs % 60000) / 1000);

    if (minutes > 0 && seconds > 0) {
      return `${minutes}m ${seconds}s`;
    }
    if (minutes > 0) {
      return `${minutes} minute${minutes === 1 ? "" : "s"}`;
    }
    return `${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  private normalizeTimer(timer: Timer, now: Date): Timer {
    if (timer.status === "running" && timer.endsAt) {
      const remaining = this.computeRemaining(timer, now);
      if (remaining <= 0) {
        return {
          ...timer,
          status: "completed",
          remainingMs: 0,
          endsAt: formatISO(now)
        };
      }
      return {
        ...timer,
        remainingMs: remaining,
        status: "running"
      };
    }

    if (timer.status === "paused") {
      return {
        ...timer,
        endsAt: undefined
      };
    }

    return timer;
  }

  private emitChange(): void {
    if (!this.onChange) {
      return;
    }

    const snapshot = this.getAll();
    this.lastPersistError = null;
    const result = Promise.resolve(this.onChange(snapshot));
    this.pendingPersist = result.catch(error => {
      this.lastPersistError = error instanceof Error ? error : new Error(String(error));
      console.error("TimerStore persistence error", this.lastPersistError);
      throw this.lastPersistError;
    });
  }
}
