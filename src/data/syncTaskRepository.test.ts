import { afterEach, describe, expect, it, vi } from 'vitest';
import { InMemorySyncTaskRepository } from './syncTaskRepository';

describe('InMemorySyncTaskRepository', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('requeues retryable failed tasks after the retry delay', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);

    await tasks.enqueueTasks([{ source: 'search', query: 'tag:new', market: 'TR' }]);

    const [claimed] = await tasks.claimPendingTasks(1, now);
    await tasks.completeTask({
      id: claimed.id,
      status: 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: 'Spotify API request failed with status 429.',
      retryAfterSeconds: 120,
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

    await tasks.enqueueTasks([{ source: 'search', query: 'tag:new', market: 'TR' }]);

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
      { source: 'search', query: 'tag:new', market: 'TR' },
      { source: 'search', query: 'ab year:2026', market: 'TR' },
    ]);

    const claimed = await tasks.claimPendingTasks(2, now);
    await tasks.releaseTasks([claimed[1].id], new Date('2026-07-03T12:05:00.000Z'));

    await expect(tasks.claimPendingTasks(2, new Date('2026-07-03T12:04:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(2, new Date('2026-07-03T12:05:00.000Z'))).resolves.toEqual([
      expect.objectContaining({
        id: claimed[1].id,
        query: 'ab year:2026',
        attempts: 2,
      }),
    ]);
  });

  it('postpones pending tasks until the shared retry window', async () => {
    const tasks = new InMemorySyncTaskRepository();
    const now = new Date('2026-07-03T12:00:00.000Z');

    await tasks.enqueueTasks([
      { source: 'search', query: 'tag:new', market: 'TR' },
      { source: 'search', query: 'ab year:2026', market: 'TR' },
      { source: 'search', query: 'cd year:2026', market: 'TR', nextRunAt: new Date('2026-07-03T12:10:00.000Z') },
    ]);

    const postponed = await tasks.postponePendingTasks(new Date('2026-07-03T12:05:00.000Z'));

    expect(postponed).toBe(2);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:04:59.000Z'))).resolves.toEqual([]);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:05:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ query: 'tag:new' }),
      expect.objectContaining({ query: 'ab year:2026' }),
    ]);
    await expect(tasks.claimPendingTasks(10, new Date('2026-07-03T12:10:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ query: 'cd year:2026' }),
    ]);
  });
});
