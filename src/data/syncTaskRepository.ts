import { Pool } from 'pg';

export type SyncTaskSource = 'search' | 'artist_albums';
export type SyncTaskStatus = 'pending' | 'running' | 'success' | 'failed';

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
};

export type SyncTaskInput = {
  source: SyncTaskSource;
  query: string;
  market: string;
  offset?: number;
  limit?: number;
  priority?: number;
  nextRunAt?: Date;
};

export type CompleteSyncTaskInput = {
  id: string;
  status: 'success' | 'failed';
  itemsFound: number;
  itemsSaved: number;
  errorMessage?: string | null;
  retryAfterSeconds?: number | null;
  nextRunAt?: Date;
};

export type SyncTaskRepository = {
  enqueueTasks(tasks: SyncTaskInput[]): Promise<{ inserted: number }>;
  claimPendingTasks(limit: number, now?: Date): Promise<SyncTask[]>;
  completeTask(input: CompleteSyncTaskInput): Promise<void>;
  releaseTasks(taskIds: string[], nextRunAt: Date, errorMessage?: string | null): Promise<void>;
  postponePendingTasks(nextRunAt: Date, errorMessage?: string | null): Promise<number>;
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
};

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
      });
      this.nextId += 1;
      inserted += 1;
    }

    return { inserted };
  }

  async claimPendingTasks(limit: number, now = new Date()): Promise<SyncTask[]> {
    const tasks = Array.from(this.tasks.values())
      .filter((task) => task.status === 'pending' && (!task.nextRunAt || task.nextRunAt <= now))
      .sort((a, b) => a.priority - b.priority || Number(a.id) - Number(b.id))
      .slice(0, limit);

    for (const task of tasks) {
      task.status = 'running';
      task.attempts += 1;
    }

    return tasks.map((task) => ({ ...task }));
  }

  async completeTask(input: CompleteSyncTaskInput): Promise<void> {
    const task = Array.from(this.tasks.values()).find((candidate) => candidate.id === input.id);

    if (task) {
      const nextRunAt = getNextRunAt(input);
      task.status = getStoredTaskStatus(input, nextRunAt);
      task.nextRunAt = nextRunAt;
    }
  }

  async releaseTasks(taskIds: string[], nextRunAt: Date, _errorMessage?: string | null): Promise<void> {
    for (const taskId of taskIds) {
      const task = Array.from(this.tasks.values()).find((candidate) => candidate.id === taskId);

      if (!task || task.status !== 'running') {
        continue;
      }

      task.status = 'pending';
      task.nextRunAt = nextRunAt;
    }
  }

  async postponePendingTasks(nextRunAt: Date, _errorMessage?: string | null): Promise<number> {
    let updated = 0;

    for (const task of this.tasks.values()) {
      if (task.status !== 'pending') {
        continue;
      }

      if (task.nextRunAt && task.nextRunAt >= nextRunAt) {
        continue;
      }

      task.nextRunAt = nextRunAt;
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
          insert into sync_tasks (source, query, market, offset_value, limit_value, priority, next_run_at)
          values ($1, $2, $3, $4, $5, $6, $7)
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
        ],
      );
      inserted += result.rowCount ?? 0;
    }

    return { inserted };
  }

  async claimPendingTasks(limit: number, now = new Date()): Promise<SyncTask[]> {
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
        returning id, source, query, market, offset_value, limit_value, status, priority, attempts
      `,
      [limit, now],
    );

    return result.rows.map(mapTaskRow);
  }

  async completeTask(input: CompleteSyncTaskInput): Promise<void> {
    const nextRunAt = getNextRunAt(input);
    const status = getStoredTaskStatus(input, nextRunAt);

    await this.pool.query(
      `
        update sync_tasks
        set status = $2,
            items_found = $3,
            items_saved = $4,
            error_message = $5,
            next_run_at = $6,
            updated_at = now()
        where id = $1
      `,
      [input.id, status, input.itemsFound, input.itemsSaved, input.errorMessage ?? null, nextRunAt],
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
            updated_at = now()
        where status = 'pending'
          and next_run_at < $1
      `,
      [nextRunAt, errorMessage ?? null],
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
  };
}

function getTaskKey(task: SyncTaskInput): string {
  return `${task.source}:${task.query}:${task.market}:${task.offset ?? 0}`;
}

function getStoredTaskStatus(input: CompleteSyncTaskInput, nextRunAt?: Date): SyncTaskStatus {
  if (input.status === 'success') {
    return nextRunAt ? 'pending' : 'success';
  }

  return nextRunAt ? 'pending' : 'failed';
}

function getNextRunAt(input: CompleteSyncTaskInput): Date | undefined {
  if (input.nextRunAt) {
    return input.nextRunAt;
  }

  if (input.status === 'failed' && input.retryAfterSeconds !== null && input.retryAfterSeconds !== undefined) {
    return new Date(Date.now() + Math.max(input.retryAfterSeconds, 1) * 1000);
  }

  return undefined;
}
