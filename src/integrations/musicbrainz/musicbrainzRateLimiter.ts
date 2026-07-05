type SleepFn = (delayMs: number) => Promise<void>;

export type MusicBrainzRateLimiterConfig = {
  minIntervalMs?: number;
  nowFn?: () => number;
  sleepFn?: SleepFn;
};

const DEFAULT_MIN_INTERVAL_MS = 1100;

export class MusicBrainzRateLimiter {
  private readonly minIntervalMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: SleepFn;
  private nextRequestAt = 0;
  private chain = Promise.resolve();

  constructor(config: MusicBrainzRateLimiterConfig = {}) {
    this.minIntervalMs = normalizePositiveInteger(config.minIntervalMs, DEFAULT_MIN_INTERVAL_MS, 'MusicBrainz min interval');
    this.nowFn = config.nowFn ?? Date.now;
    this.sleepFn = config.sleepFn ?? sleep;
  }

  async schedule<T>(operation: () => Promise<T>): Promise<T> {
    const scheduled = this.chain.then(async () => {
      const now = this.nowFn();
      const delayMs = this.nextRequestAt - now;

      if (delayMs > 0) {
        await this.sleepFn(delayMs);
      }

      const startedAt = Math.max(this.nowFn(), this.nextRequestAt);
      this.nextRequestAt = startedAt + this.minIntervalMs;

      return operation();
    });

    this.chain = scheduled.then(() => undefined, () => undefined);

    return scheduled;
  }
}

function normalizePositiveInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return value;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
