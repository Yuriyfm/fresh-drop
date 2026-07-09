import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemorySyncTaskRepository, PostgresSyncTaskRepository } from './syncTaskRepository';

describe('InMemorySyncTaskRepository', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requeues retryable failed tasks after the retry delay', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await tasks.enqueueTasks([{ source: 'search', query: 'tag:new', market: 'TR', family: 'plain', token: '' }]);

    const [claimed] = await tasks.claimPendingTasks(1, now);
    await tasks.completeTask({
      id: claimed.id,
      status: 'rate_limited',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: 'Spotify API request failed with status 429.',
      retryAfterSeconds: 120,
      nextRunAt: new Date('2026-07-03T12:02:00.000Z'),
    });

    await expect(tasks.claimPendingTasks(1, new Date('2026-07-03T12:01:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(1, new Date('2026-07-03T12:02:00.000Z'))).resolves.toEqual([
      expect.objectContaining({
        id: claimed.id,
        source: 'search',
        query: 'tag:new',
        market: 'TR',
        attempts: 2,
      }),
    ]);
  });

  it('keeps terminal failed tasks out of the queue', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await tasks.enqueueTasks([{ source: 'search', query: 'tag:new', market: 'TR', family: 'plain', token: '' }]);

    const [claimed] = await tasks.claimPendingTasks(1, now);
    await tasks.completeTask({
      id: claimed.id,
      status: 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: 'Spotify API request failed with status 401.',
    });

    await expect(tasks.claimPendingTasks(1, new Date('2026-07-04T12:00:00.000Z'))).resolves.toEqual([]);
  });

  it('returns claimed tasks back to pending without increasing attempts', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');

    await tasks.enqueueTasks([
      { source: 'search', query: 'tag:new', market: 'TR', family: 'plain', token: '' },
      { source: 'search', query: 'tag:new ab', market: 'TR', family: 'plain', token: 'ab', depth: 2 },
    ]);

    const claimed = await tasks.claimPendingTasks(2, now);
    await tasks.releaseTasks([claimed[1].id], new Date('2026-07-03T12:05:00.000Z'));

    await expect(tasks.claimPendingTasks(2, new Date('2026-07-03T12:04:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(2, new Date('2026-07-03T12:05:00.000Z'))).resolves.toEqual([
      expect.objectContaining({
        id: claimed[1].id,
        query: 'tag:new ab',
        attempts: 2,
      }),
    ]);
  });

  it('postpones pending tasks until the shared retry window', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');

    await tasks.enqueueTasks([
      { source: 'search', query: 'tag:new', market: 'TR', family: 'plain', token: '' },
      { source: 'search', query: 'tag:new ab', market: 'TR', family: 'plain', token: 'ab', depth: 2 },
      { source: 'search', query: 'tag:new cd', market: 'TR', family: 'plain', token: 'cd', depth: 2, nextRunAt: new Date('2026-07-03T12:10:00.000Z') },
    ]);

    const postponed = await tasks.postponePendingTasks(new Date('2026-07-03T12:05:00.000Z'));

    expect(postponed).toBe(2);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:04:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:05:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ query: 'tag:new' }),
      expect.objectContaining({ query: 'tag:new ab' }),
    ]);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:10:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ query: 'tag:new cd' }),
    ]);
  });

  it('postpones all runnable tasks until the shared retry window', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');
    const retryAt = new Date('2026-07-03T12:10:00.000Z');

    await tasks.enqueueTasks([
      { source: 'search', query: 'tag:new', market: 'TR', family: 'plain', token: '' },
      { source: 'search', query: 'tag:new album:a', market: 'TR', family: 'album', token: 'a', depth: 1 },
      { source: 'search', query: 'tag:new album:b', market: 'TR', family: 'album', token: 'b', depth: 1 },
    ]);

    const [pendingTask, completedTask, exhaustedTask] = await tasks.claimPendingTasks(3, now);
    await tasks.releaseTasks([pendingTask.id], now);
    await tasks.completeTask({
      id: completedTask.id,
      status: 'completed',
      itemsFound: 100,
      itemsSaved: 1,
      nextRunAt: new Date('2026-07-03T12:05:00.000Z'),
    });
    await tasks.completeTask({
      id: exhaustedTask.id,
      status: 'exhausted',
      itemsFound: 300,
      itemsSaved: 0,
      nextRunAt: new Date('2026-07-03T12:06:00.000Z'),
    });

    const postponed = await tasks.postponeRunnableTasks(retryAt);

    expect(postponed).toBe(3);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:09:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(10, retryAt)).resolves.toEqual([
      expect.objectContaining({ id: pendingTask.id }),
      expect.objectContaining({ id: completedTask.id }),
      expect.objectContaining({ id: exhaustedTask.id }),
    ]);
  });

  it('reactivates completed and exhausted search shards after their next run time', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');

    await tasks.enqueueTasks([
      { source: 'search', query: 'tag:new album:a', market: 'TR', family: 'album', token: 'a', depth: 1 },
    ]);

    const [claimed] = await tasks.claimPendingTasks(1, now);
    await tasks.completeTask({
      id: claimed.id,
      status: 'exhausted',
      itemsFound: 300,
      itemsSaved: 1,
      nextRunAt: new Date('2026-07-03T18:00:00.000Z'),
      priority: 42,
      itemsSeen: 300,
      uniqueAdded: 1,
      duplicatesSeen: 299,
      pagesFetched: 6,
    });

    await expect(tasks.claimPendingTasks(1, new Date('2026-07-03T17:59:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(1, new Date('2026-07-03T18:00:00.000Z'))).resolves.toEqual([
      expect.objectContaining({
        query: 'tag:new album:a',
        attempts: 2,
        priority: 42,
      }),
    ]);
  });
});

describe('PostgresSyncTaskRepository', () => {
  it('stores a non-null next_run_at fallback for completed tasks without explicit retry time', async () => {
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const tasks = new PostgresSyncTaskRepository({
      pool: { query } as never,
    });
    const completedAt = new Date('2026-07-04T16:00:00.000Z');

    await tasks.completeTask({
      id: '42',
      status: 'completed',
      itemsFound: 10,
      itemsSaved: 3,
      completedAt,
      priority: 100,
      wasSplit: false,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[1]?.[5]).toBeInstanceOf(Date);
    expect((query.mock.calls[0]?.[1]?.[5] as Date).toISOString()).toBe('2027-07-04T16:00:00.000Z');
  });
});
