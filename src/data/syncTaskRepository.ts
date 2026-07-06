import { Pool } from 'pg';
import type { SearchShardFamily } from '../sync/searchShard';

export type SyncTaskSource = 'search' | 'artist_albums';
export type SyncTaskStatus = 'pending' | 'running' | 'completed' | 'exhausted' | 'failed' | 'rate_limited';

export type SyncTask = {
  id: string;
  source: SyncTaskSource;
  query: string;
  market: string;
  offset: number;
  limit: number;
  status: SyncTaskStatus;
  priority: number;
  attempts: number;
  nextRunAt?: Date;
  family: SearchShardFamily | null;
  token: string | null;
  depth: number;
  parentTaskId: string | null;
  spotifyTotal: number | null;
  pagesFetched: number;
  itemsSeen: number;
  uniqueAdded: number;
  duplicatesSeen: number;
  emptyPages: number;
  lastOffset: number | null;
  avgLatencyMs: number | null;
  rateLimitedCount: number;
  lastError: string | null;
  lastRunAt?: Date;
  completedAt?: Date;
  wasSplit: boolean;
};

export type SyncTaskInput = {
  source: SyncTaskSource;
  query: string;
  market: string;
  offset?: number;
  limit?: number;
  priority?: number;
  nextRunAt?: Date;
  family?: SearchShardFamily | null;
  token?: string | null;
  depth?: number;
  parentTaskId?: string | null;
};

export type CompleteSyncTaskInput = {
  id: string;
  status: Exclude<SyncTaskStatus, 'pending' | 'running'>;
  itemsFound: number;
  itemsSaved: number;
  errorMessage?: string | null;
  retryAfterSeconds?: number | null;
  nextRunAt?: Date;
  spotifyTotal?: number | null;
  pagesFetched?: number;
  itemsSeen?: number;
  uniqueAdded?: number;
  duplicatesSeen?: number;
  emptyPages?: number;
  lastOffset?: number | null;
  avgLatencyMs?: number | null;
  rateLimitedCount?: number;
  completedAt?: Date;
  priority?: number;
  wasSplit?: boolean;
  requestCount?: number;
  artistCacheHits?: number;
  artistRequestsSaved?: number;
};

export type SyncTaskRepository = {
  enqueueTasks(tasks: SyncTaskInput[]): Promise<{ inserted: number }>;
  claimPendingTasks(limit: number, now?: Date): Promise<SyncTask[]>;
  completeTask(input: CompleteSyncTaskInput): Promise<void>;
  releaseTasks(taskIds: string[], nextRunAt: Date, errorMessage?: string | null): Promise<void>;
  postponePendingTasks(nextRunAt: Date, errorMessage?: string | null): Promise<number>;
  deactivateLegacySearchTasks(now?: Date): Promise<number>;
};

type SyncTaskRow = {
  id: string;
  source: SyncTaskSource;
  query: string;
  market: string;
  offset_value: number;
  limit_value: number;
  status: SyncTaskStatus;
  priority: number;
  attempts: number;
  next_run_at: Date | null;
  family: SearchShardFamily | null;
  token: string | null;
  depth: number;
  parent_query_id: string | null;
  spotify_total: number | null;
  pages_fetched: number;
  items_seen: number;
  unique_added: number;
  duplicates_seen: number;
  empty_pages: number;
  last_offset: number | null;
  avg_latency_ms: number | null;
  rate_limited_count: number;
  last_error: string | null;
  last_run_at: Date | null;
  completed_at: Date | null;
  was_split: boolean;
};

const FALLBACK_COMPLETED_NEXT_RUN_DELAY_MS = 365 * 24 * 60 * 60 * 1000;

export class InMemorySyncTaskRepository implements SyncTaskRepository {
  private readonly tasks = new Map<string, SyncTask>();
  private nextId = 1;

  async enqueueTasks(tasks: SyncTaskInput[]): Promise<{ inserted: number }> {
    let inserted = 0;

    for (const input of tasks) {
      const key = getTaskKey(input);

      if (this.tasks.has(key)) {
        continue;
      }

      this.tasks.set(key, {
        id: String(this.nextId),
        source: input.source,
        query: input.query,
        market: input.market,
        offset: input.offset ?? 0,
        limit: input.limit ?? 50,
        status: 'pending',
        priority: input.priority ?? 100,
        attempts: 0,
        nextRunAt: input.nextRunAt,
        family: input.family ?? null,
        token: input.token ?? null,
        depth: input.depth ?? 0,
        parentTaskId: input.parentTaskId ?? null,
        spotifyTotal: null,
        pagesFetched: 0,
        itemsSeen: 0,
        uniqueAdded: 0,
        duplicatesSeen: 0,
        emptyPages: 0,
        lastOffset: null,
        avgLatencyMs: null,
        rateLimitedCount: 0,
        lastError: null,
        lastRunAt: undefined,
        completedAt: undefined,
        wasSplit: false,
      });
      this.nextId += 1;
      inserted += 1;
    }

    return { inserted };
  }

  async claimPendingTasks(limit: number, now = new Date()): Promise<SyncTask[]> {
    reactivateDueTasks(Array.from(this.tasks.values()), now);

    const tasks = Array.from(this.tasks.values())
      .filter((task) => task.status === 'pending' && (!task.nextRunAt || task.nextRunAt <= now))
      .sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id))
      .slice(0, limit);

    for (const task of tasks) {
      task.status = 'running';
      task.attempts += 1;
      task.lastRunAt = now;
    }

    return tasks.map((task) => ({ ...task }));
  }

  async completeTask(input: CompleteSyncTaskInput): Promise<void> {
    const task = Array.from(this.tasks.values()).find((candidate) => candidate.id === input.id);

    if (!task) {
      return;
    }

    task.status = input.status;
    task.nextRunAt = getNextRunAt(input, input.completedAt ?? new Date());
    task.priority = input.priority ?? task.priority;
    task.spotifyTotal = input.spotifyTotal ?? task.spotifyTotal;
    task.pagesFetched = input.pagesFetched ?? task.pagesFetched;
    task.itemsSeen = input.itemsSeen ?? task.itemsSeen;
    task.uniqueAdded = input.uniqueAdded ?? task.uniqueAdded;
    task.duplicatesSeen = input.duplicatesSeen ?? task.duplicatesSeen;
    task.emptyPages = input.emptyPages ?? task.emptyPages;
    task.lastOffset = input.lastOffset ?? task.lastOffset;
    task.avgLatencyMs = input.avgLatencyMs ?? task.avgLatencyMs;
    task.rateLimitedCount = input.rateLimitedCount ?? task.rateLimitedCount;
    task.lastError = input.errorMessage ?? null;
    task.completedAt = input.completedAt;
    task.wasSplit = input.wasSplit ?? false;
  }

  async releaseTasks(taskIds: string[], nextRunAt: Date, errorMessage?: string | null): Promise<void> {
    for (const taskId of taskIds) {
      const task = Array.from(this.tasks.values()).find((candidate) => candidate.id === taskId);

      if (!task || task.status !== 'running') {
        continue;
      }

      task.status = 'pending';
      task.nextRunAt = nextRunAt;
      task.lastError = errorMessage ?? task.lastError;
    }
  }

  async postponePendingTasks(nextRunAt: Date, errorMessage?: string | null): Promise<number> {
    let updated = 0;

    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') {
        continue;
      }

      if (task.nextRunAt && task.nextRunAt >= nextRunAt) {
        continue;
      }

      task.nextRunAt = nextRunAt;
      task.lastError = errorMessage ?? task.lastError;
      updated += 1;
    }

    return updated;
  }

  async deactivateLegacySearchTasks(now = new Date()): Promise<number> {
    let updated = 0;

    for (const task of this.tasks.values()) {
      if (task.source !== 'search' || task.family !== null) {
        continue;
      }

      task.status = 'completed';
      task.nextRunAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
      task.completedAt = now;
      task.lastError = 'Legacy fixed search shard replaced by adaptive sharding.';
      updated += 1;
    }

    return updated;
  }
}

export class PostgresSyncTaskRepository implements SyncTaskRepository {
  private readonly pool: Pool;

  constructor(options: { pool: Pool }) {
    this.pool = options.pool;
  }

  async enqueueTasks(tasks: SyncTaskInput[]): Promise<{ inserted: number }> {
    let inserted = 0;

    for (const task of tasks) {
      const result = await this.pool.query(
        `
          insert into sync_tasks (
            source,
            query,
            market,
            offset_value,
            limit_value,
            priority,
            next_run_at,
            family,
            token,
            depth,
            parent_query_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          on conflict (source, query, market, offset_value) do nothing
        `,
        [
          task.source,
          task.query,
          task.market,
          task.offset ?? 0,
          task.limit ?? 50,
          task.priority ?? 100,
          task.nextRunAt ?? new Date(),
          task.family ?? null,
          task.token ?? null,
          task.depth ?? 0,
          task.parentTaskId ?? null,
        ],
      );
      inserted += result.rowCount ?? 0;
    }

    return { inserted };
  }

  async claimPendingTasks(limit: number, now = new Date()): Promise<SyncTask[]> {
    await this.pool.query(
      `
        update sync_tasks
        set status = 'pending',
            updated_at = now()
        where status in ('completed', 'exhausted', 'rate_limited')
          and next_run_at <= $1
      `,
      [now],
    );

    const result = await this.pool.query<SyncTaskRow>(
      `
        update sync_tasks
        set status = 'running',
            attempts = attempts + 1,
            last_run_at = $2,
            updated_at = now()
        where id in (
          select id
          from sync_tasks
          where status = 'pending'
            and next_run_at <= $2
          order by priority asc, id asc
          limit $1
          for update skip locked
        )
        returning
          id,
          source,
          query,
          market,
          offset_value,
          limit_value,
          status,
          priority,
          attempts,
          next_run_at,
          family,
          token,
          depth,
          parent_query_id,
          spotify_total,
          pages_fetched,
          items_seen,
          unique_added,
          duplicates_seen,
          empty_pages,
          last_offset,
          avg_latency_ms,
          rate_limited_count,
          last_error,
          last_run_at,
          completed_at,
          was_split
      `,
      [limit, now],
    );

    return result.rows.map(mapTaskRow);
  }

  async completeTask(input: CompleteSyncTaskInput): Promise<void> {
    await this.pool.query(
      `
        update sync_tasks
        set status = $2,
            items_found = $3,
            items_saved = $4,
            error_message = $5,
            next_run_at = $6,
            spotify_total = $7,
            pages_fetched = $8,
            items_seen = $9,
            unique_added = $10,
            duplicates_seen = $11,
            empty_pages = $12,
            last_offset = $13,
            avg_latency_ms = $14,
            rate_limited_count = $15,
            last_error = $16,
            completed_at = $17,
            priority = $18,
            was_split = $19,
            updated_at = now()
        where id = $1
      `,
      [
        input.id,
        input.status,
        input.itemsFound,
        input.itemsSaved,
        input.errorMessage ?? null,
        getNextRunAt(input, input.completedAt ?? new Date()),
        input.spotifyTotal ?? null,
        input.pagesFetched ?? 0,
        input.itemsSeen ?? 0,
        input.uniqueAdded ?? 0,
        input.duplicatesSeen ?? 0,
        input.emptyPages ?? 0,
        input.lastOffset ?? null,
        input.avgLatencyMs ?? null,
        input.rateLimitedCount ?? 0,
        input.errorMessage ?? null,
        input.completedAt ?? null,
        input.priority ?? 100,
        input.wasSplit ?? false,
      ],
    );
  }

  async releaseTasks(taskIds: string[], nextRunAt: Date, errorMessage?: string | null): Promise<void> {
    if (taskIds.length === 0) {
      return;
    }

    await this.pool.query(
      `
        update sync_tasks
        set status = 'pending',
            next_run_at = $2,
            error_message = coalesce($3, error_message),
            last_error = coalesce($3, last_error),
            updated_at = now()
        where id = any($1::bigint[])
          and status = 'running'
      `,
      [taskIds, nextRunAt, errorMessage ?? null],
    );
  }

  async postponePendingTasks(nextRunAt: Date, errorMessage?: string | null): Promise<number> {
    const result = await this.pool.query(
      `
        update sync_tasks
        set next_run_at = $1,
            error_message = coalesce($2, error_message),
            last_error = coalesce($2, last_error),
            updated_at = now()
        where status = 'pending'
          and next_run_at < $1
      `,
      [nextRunAt, errorMessage ?? null],
    );

    return result.rowCount ?? 0;
  }

  async deactivateLegacySearchTasks(now = new Date()): Promise<number> {
    const result = await this.pool.query(
      `
        update sync_tasks
        set status = 'completed',
            next_run_at = $1,
            completed_at = now(),
            error_message = 'Legacy fixed search shard replaced by adaptive sharding.',
            last_error = 'Legacy fixed search shard replaced by adaptive sharding.',
            updated_at = now()
        where source = 'search'
          and family is null
      `,
      [new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000)],
    );

    return result.rowCount ?? 0;
  }
}

function mapTaskRow(row: SyncTaskRow): SyncTask {
  return {
    id: row.id,
    source: row.source,
    query: row.query,
    market: row.market,
    offset: row.offset_value,
    limit: row.limit_value,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    nextRunAt: row.next_run_at ?? undefined,
    family: row.family,
    token: row.token,
    depth: row.depth,
    parentTaskId: row.parent_query_id,
    spotifyTotal: row.spotify_total,
    pagesFetched: row.pages_fetched,
    itemsSeen: row.items_seen,
    uniqueAdded: row.unique_added,
    duplicatesSeen: row.duplicates_seen,
    emptyPages: row.empty_pages,
    lastOffset: row.last_offset,
    avgLatencyMs: row.avg_latency_ms,
    rateLimitedCount: row.rate_limited_count,
    lastError: row.last_error,
    lastRunAt: row.last_run_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    wasSplit: row.was_split,
  };
}

function getTaskKey(task: SyncTaskInput): string {
  return `${task.source}:${task.query}:${task.market}:${task.offset ?? 0}`;
}

function getNextRunAt(input: CompleteSyncTaskInput, baseDate: Date): Date {
  if (input.nextRunAt) {
    return input.nextRunAt;
  }

  if (input.status === 'rate_limited' && input.retryAfterSeconds !== null && input.retryAfterSeconds !== undefined) {
    return new Date(baseDate.getTime() + Math.max(input.retryAfterSeconds, 1) * 1000);
  }

  if (input.status === 'completed' || input.status === 'exhausted') {
    return new Date(baseDate.getTime() + FALLBACK_COMPLETED_NEXT_RUN_DELAY_MS);
  }

  return baseDate;
}

function reactivateDueTasks(tasks: SyncTask[], now: Date): void {
  for (const task of tasks) {
    if (
      (task.status === 'completed' || task.status === 'exhausted' || task.status === 'rate_limited') &&
      (!task.nextRunAt || task.nextRunAt <= now)
    ) {
      task.status = 'pending';
    }
  }
}
