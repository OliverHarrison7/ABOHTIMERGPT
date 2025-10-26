import { z } from "zod";
import { differenceInMilliseconds } from "date-fns";
import { TimerStore } from "../state/timerStore.js";
import type { Timer, TimerUpdateResult } from "../types.js";

const durationSchema = z
  .object({
    minutes: z.number().int().min(0).default(0),
    seconds: z.number().int().min(0).max(59).default(0)
  })
  .refine(value => value.minutes > 0 || value.seconds > 0, {
    message: "Timers must be at least 1 second long."
  });

const baseTimerSchema = z.object({
  label: z.string().min(1).max(48).optional(),
  category: z.enum(["focus", "break", "custom"]).optional()
});

export const startTimerInput = baseTimerSchema.extend({
  duration: durationSchema,
  repeat: z
    .object({
      intervalMinutes: z.number().int().min(1),
      occurrences: z.number().int().min(1).max(12).optional()
    })
    .optional()
});

export const adjustTimerShape = {
  id: z.string().uuid(),
  minutes: z.number().int().min(-120).max(120).optional(),
  seconds: z.number().int().min(-59).max(59).optional()
};

export const adjustTimerInput = z.object(adjustTimerShape).refine(value => (value.minutes ?? 0) !== 0 || (value.seconds ?? 0) !== 0, {
  message: "Adjustments must change the timer by at least one second."
});

export class TimerToolset {
  private readonly store: TimerStore;

  constructor(store = new TimerStore()) {
    this.store = store;
  }

  getSnapshot(): Timer[] {
    return this.store.getAll().map(timer => this.decorateTimer(timer));
  }

  async listTimers(): Promise<{ timers: Timer[]; completed: Timer[] }> {
    const completed = await this.handleTick();
    return { timers: this.getSnapshot(), completed };
  }

  async startTimer(input: z.input<typeof startTimerInput>): Promise<TimerUpdateResult> {
    const completed = await this.handleTick();
    const parsed = startTimerInput.parse(input);
    const repeat =
      parsed.repeat &&
      ({
        intervalMs: parsed.repeat.intervalMinutes * 60000,
        occurrences: parsed.repeat.occurrences
      } satisfies Timer["repeat"]);

    const result = this.store.start({
      durationMs: this.toDurationMs(parsed.duration),
      label: parsed.label,
      category: parsed.category,
      repeat
    });

    const decorated = this.decorateTimer(result.timer);
    await this.store.waitForPersistence();

    return {
      ...result,
      timer: decorated,
      completed: this.mergeCompleted(completed, decorated)
    };
  }

  async pauseTimer(id: string): Promise<TimerUpdateResult> {
    const completed = await this.handleTick();
    const result = this.store.pause(id);
    const decorated = this.decorateTimer(result.timer);
    await this.store.waitForPersistence();

    return {
      ...result,
      timer: decorated,
      completed
    };
  }

  async resumeTimer(id: string): Promise<TimerUpdateResult> {
    const completed = await this.handleTick();
    const result = this.store.resume(id);
    const decorated = this.decorateTimer(result.timer);
    await this.store.waitForPersistence();

    return {
      ...result,
      timer: decorated,
      completed
    };
  }

  async cancelTimer(id: string): Promise<TimerUpdateResult> {
    const completed = await this.handleTick();
    const result = this.store.cancel(id);
    const decorated = this.decorateTimer(result.timer);
    await this.store.waitForPersistence();

    return {
      ...result,
      timer: decorated,
      completed
    };
  }

  async extendTimer(input: z.input<typeof adjustTimerInput>): Promise<TimerUpdateResult> {
    const completed = await this.handleTick();
    const parsed = adjustTimerInput.parse(input);
    const extraMinutes = parsed.minutes ?? 0;
    const extraSeconds = parsed.seconds ?? 0;
    const extraMs = extraMinutes * 60000 + extraSeconds * 1000;

    const result = this.store.extend(parsed.id, extraMs);
    const decorated = this.decorateTimer(result.timer);
    await this.store.waitForPersistence();

    return {
      ...result,
      timer: decorated,
      completed: this.mergeCompleted(completed, decorated)
    };
  }

  async handleTick(now = new Date()): Promise<Timer[]> {
    const completed = this.store.completeExpiringTimers(now);
    if (completed.length > 0) {
      await this.store.waitForPersistence();
    }
    return completed.map(timer => this.decorateTimer(timer));
  }

  private decorateTimer(timer: Timer): Timer {
    if (timer.status !== "running" || !timer.endsAt) {
      return timer;
    }
    const remainingMs = Math.max(differenceInMilliseconds(new Date(timer.endsAt), new Date()), 0);
    return {
      ...timer,
      remainingMs
    };
  }

  private mergeCompleted(completed: Timer[], candidate: Timer): Timer[] {
    if (candidate.status !== "completed") {
      return completed;
    }
    return completed.some(timer => timer.id === candidate.id) ? completed : [...completed, candidate];
  }

  private toDurationMs(duration: z.infer<typeof durationSchema>): number {
    const minutes = duration.minutes ?? 0;
    const seconds = duration.seconds ?? 0;
    return minutes * 60000 + seconds * 1000;
  }
}
