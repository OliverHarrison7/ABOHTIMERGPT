import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname } from "path";
import type { Timer } from "../types.js";

export interface TimerStorage {
  load(): Promise<Timer[]>;
  save(timers: Timer[]): Promise<void>;
}

export class TimerFileStorage implements TimerStorage {
  private pending = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<Timer[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Timer[];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async save(timers: Timer[]): Promise<void> {
    const serialized = JSON.stringify(timers, null, 2);
    this.pending = this.pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, serialized, "utf-8");
      });
    await this.pending;
  }
}
