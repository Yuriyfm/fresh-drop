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
      task.status = input.status === 'success' && input.nextRunAt ? 'pending' : input.status;
      task.nextRunAt = input.nextRunAt;
    }
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
    const nextRunAt = input.nextRunAt ?? (input.status === 'failed'
      ? new Date(Date.now() + Math.max(input.retryAfterSeconds ?? 300, 1) * 1000)
      : new Date());
    const status = input.status === 'success' && input.nextRunAt ? 'pending' : input.status;

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
