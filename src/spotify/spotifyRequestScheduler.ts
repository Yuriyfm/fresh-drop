type SleepFn = (delayMs: number) => Promise<void>;

export type SpotifyRequestSchedulerConfig = {
  initialRps?: number;
  maxRps?: number;
  minRps?: number;
  maxConcurrency?: number;
  rateIncreaseStep?: number;
  rateDecreaseFactor?: number;
  stableWindowMs?: number;
  retryJitterMs?: number;
  nowFn?: () => number;
  sleepFn?: SleepFn;
  randomFn?: () => number;
};

const DEFAULT_INITIAL_RPS = 1;
const DEFAULT_MAX_RPS = 2;
const DEFAULT_MIN_RPS = 0.1;
const DEFAULT_MAX_CONCURRENCY = 1;
const DEFAULT_RATE_INCREASE_STEP = 0.2;
const DEFAULT_RATE_DECREASE_FACTOR = 0.5;
const DEFAULT_STABLE_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_JITTER_MS = 500;
const DEFAULT_RETRY_AFTER_FALLBACK_MS = 30_000;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 30_000;

export class SpotifyRequestScheduler {
  private readonly maxRps: number;
  private readonly minRps: number;
  private readonly maxConcurrency: number;
  private readonly rateIncreaseStep: number;
  private readonly rateDecreaseFactor: number;
  private readonly stableWindowMs: number;
  private readonly retryJitterMs: number;
  private readonly nowFn: () => number;
  private readonly sleepFn: SleepFn;
  private readonly randomFn: () => number;
  private currentRps: number;
  private nextRequestAt = 0;
  private cooldownUntil = 0;
  private inFlight = 0;
  private lastRateLimitAt = Number.NEGATIVE_INFINITY;
  private lastRateIncreaseAt = 0;
  private schedulingChain = Promise.resolve();
  private readonly concurrencyWaiters: Array<() => void> = [];

  constructor(config: SpotifyRequestSchedulerConfig = {}) {
    this.maxRps = normalizePositiveNumber(config.maxRps, DEFAULT_MAX_RPS, 'Spotify max RPS');
    this.minRps = normalizePositiveNumber(config.minRps, DEFAULT_MIN_RPS, 'Spotify min RPS');
    this.currentRps = clamp(
      normalizePositiveNumber(config.initialRps, DEFAULT_INITIAL_RPS, 'Spotify initial RPS'),
      this.minRps,
      this.maxRps,
    );
    this.maxConcurrency = normalizePositiveInteger(config.maxConcurrency, DEFAULT_MAX_CONCURRENCY, 'Spotify max concurrency');
    this.rateIncreaseStep = normalizePositiveNumber(
      config.rateIncreaseStep,
      DEFAULT_RATE_INCREASE_STEP,
      'Spotify rate increase step',
    );
    this.rateDecreaseFactor = normalizeNumberInRange(
      config.rateDecreaseFactor,
      DEFAULT_RATE_DECREASE_FACTOR,
      0,
      1,
      'Spotify rate decrease factor',
    );
    this.stableWindowMs = normalizeNonNegativeInteger(
      config.stableWindowMs,
      DEFAULT_STABLE_WINDOW_MS,
      'Spotify stable window',
    );
    this.retryJitterMs = normalizeNonNegativeInteger(
      config.retryJitterMs,
      DEFAULT_RETRY_JITTER_MS,
      'Spotify retry jitter',
    );
    this.nowFn = config.nowFn ?? Date.now;
    this.sleepFn = config.sleepFn ?? sleep;
    this.randomFn = config.randomFn ?? Math.random;
    this.lastRateIncreaseAt = this.nowFn();
  }

  async waitForTurn(): Promise<void> {
    await this.enqueueScheduling(async () => {
      await this.waitForConcurrency();

      const now = this.nowFn();
      this.maybeIncreaseRate(now);

      const earliestStartAt = Math.max(this.nextRequestAt, this.cooldownUntil);
      const delayMs = earliestStartAt - now;

      if (delayMs > 0) {
        await this.sleepFn(delayMs);
      }

      const scheduledAt = Math.max(this.nowFn(), this.cooldownUntil);
      this.nextRequestAt = scheduledAt + this.getIntervalMs();
      this.inFlight += 1;
    });
  }

  finishRequest(): void {
    this.inFlight = Math.max(this.inFlight - 1, 0);
    const waiter = this.concurrencyWaiters.shift();

    if (waiter) {
      waiter();
    }
  }

  recordSuccess(): void {
    this.maybeIncreaseRate(this.nowFn());
  }

  recordRateLimit(retryAfterSeconds: number | null): number {
    const now = this.nowFn();
    const retryAfterMs = retryAfterSeconds === null
      ? DEFAULT_RETRY_AFTER_FALLBACK_MS
      : Math.max(retryAfterSeconds, 1) * 1000;
    const jitterMs = this.getJitterMs();
    const cooldownMs = retryAfterMs + jitterMs;

    this.cooldownUntil = Math.max(this.cooldownUntil, now + cooldownMs);
    this.nextRequestAt = Math.max(this.nextRequestAt, this.cooldownUntil);
    this.currentRps = Math.max(this.currentRps * this.rateDecreaseFactor, this.minRps);
    this.lastRateLimitAt = now;
    this.lastRateIncreaseAt = now;

    return cooldownMs;
  }

  getRetryDelayMs(attempt: number): number {
    const baseDelayMs = Math.max(this.getIntervalMs(), DEFAULT_RETRY_BASE_DELAY_MS);
    const exponent = Math.max(Math.trunc(attempt), 1) - 1;
    const delayMs = Math.min(baseDelayMs * 2 ** exponent, MAX_RETRY_DELAY_MS);

    return delayMs + this.getJitterMs();
  }

  getState(): {
    currentRps: number;
    cooldownUntil: number;
    nextRequestAt: number;
  } {
    return {
      currentRps: this.currentRps,
      cooldownUntil: this.cooldownUntil,
      nextRequestAt: this.nextRequestAt,
    };
  }

  private async enqueueScheduling(operation: () => Promise<void>): Promise<void> {
    const scheduled = this.schedulingChain.then(operation);

    this.schedulingChain = scheduled.catch(() => undefined);

    await scheduled;
  }

  private async waitForConcurrency(): Promise<void> {
    while (this.inFlight >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.concurrencyWaiters.push(resolve);
      });
    }
  }

  private maybeIncreaseRate(now: number): void {
    if (this.currentRps >= this.maxRps) {
      return;
    }

    const lastAdaptiveEventAt = Math.max(this.lastRateLimitAt, this.lastRateIncreaseAt);

    if (now - lastAdaptiveEventAt < this.stableWindowMs) {
      return;
    }

    this.currentRps = Math.min(this.currentRps + this.rateIncreaseStep, this.maxRps);
    this.lastRateIncreaseAt = now;
  }

  private getIntervalMs(): number {
    return Math.ceil(1000 / this.currentRps);
  }

  private getJitterMs(): number {
    if (this.retryJitterMs === 0) {
      return 0;
    }

    return Math.round(this.randomFn() * this.retryJitterMs);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizePositiveNumber(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }

  return value;
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

function normalizeNonNegativeInteger(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }

  return value;
}

function normalizeNumberInRange(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
  label: string,
): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value <= min || value > max) {
    throw new Error(`${label} must be greater than ${min} and at most ${max}.`);
  }

  return value;
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
