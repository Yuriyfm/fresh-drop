import { describe, expect, it, vi } from 'vitest';
import type { Release } from '../domain/release';
import { InMemoryReleaseRepository } from '../data/releaseRepository';
import { InMemorySyncTaskRepository } from '../data/syncTaskRepository';
import { runReleaseCrawler } from './releaseCrawlerService';

describe('runReleaseCrawler', () => {
  it('processes search tasks, saves recent releases, and enqueues artist expansion tasks', async () => {
    const release = makeRelease();
    const source = {
      fetchReleaseSearchPage: vi.fn().mockResolvedValue({
        releases: [release],
        total: 100,
        nextOffset: 50,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, {
      market: 'TR',
      batchSize: 1,
      searchLimit: 50,
      artistAlbumsLimit: 10,
      retentionDays: 30,
      searchQueries: ['tag:new'],
      enableArtistExpansion: true,
      searchTaskCooldownMinutes: 720,
    }, new Date('2026-07-02T12:00:00.000Z'));

    expect(result).toMatchObject({
      tasksClaimed: 1,
      tasksSucceeded: 1,
      tasksFailed: 0,
      itemsFound: 1,
      itemsSaved: 1,
    });
    expect(source.fetchReleaseSearchPage).toHaveBeenCalledWith({
      query: 'tag:new',
      market: 'TR',
      limit: 50,
      offset: 0,
    });

    const nextTasks = await tasks.claimPendingTasks(10);
    expect(nextTasks.map((task) => `${task.source}:${task.query}:${task.offset}`).sort()).toEqual([
      'artist_albums:artist-1:0',
      'search:tag:new:50',
    ]);
  });

  it('does not save releases outside the retention window', async () => {
    const source = {
      fetchReleaseSearchPage: vi.fn().mockResolvedValue({
        releases: [makeRelease({ id: 'old', releaseDate: '2026-05-01' })],
        total: 1,
        nextOffset: null,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    const result = await runReleaseCrawler(source, releases, tasks, {
      market: 'TR',
      batchSize: 1,
      searchLimit: 50,
      artistAlbumsLimit: 10,
      retentionDays: 30,
      searchQueries: ['tag:new'],
      enableArtistExpansion: false,
      searchTaskCooldownMinutes: 720,
    }, new Date('2026-07-02T12:00:00.000Z'));

    expect(result.itemsFound).toBe(1);
    expect(result.itemsSaved).toBe(0);
  });

  it('skips artist expansion tasks when disabled', async () => {
    const source = {
      fetchReleaseSearchPage: vi.fn().mockResolvedValue({
        releases: [makeRelease()],
        total: 1,
        nextOffset: null,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    await runReleaseCrawler(source, releases, tasks, {
      market: 'TR',
      batchSize: 1,
      searchLimit: 50,
      artistAlbumsLimit: 10,
      retentionDays: 30,
      searchQueries: ['tag:new'],
      enableArtistExpansion: false,
      searchTaskCooldownMinutes: 720,
    }, new Date('2026-07-02T12:00:00.000Z'));

    await expect(tasks.claimPendingTasks(10)).resolves.toEqual([]);
  });

  it('makes completed terminal search tasks recurring after the configured cooldown', async () => {
    const source = {
      fetchReleaseSearchPage: vi.fn().mockResolvedValue({
        releases: [makeRelease()],
        total: 1,
        nextOffset: null,
      }),
      fetchArtistAlbumsPage: vi.fn(),
    };
    const releases = new InMemoryReleaseRepository();
    const tasks = new InMemorySyncTaskRepository();

    await runReleaseCrawler(source, releases, tasks, {
      market: 'TR',
      batchSize: 1,
      searchLimit: 50,
      artistAlbumsLimit: 10,
      retentionDays: 30,
      searchQueries: ['tag:new'],
      enableArtistExpansion: false,
      searchTaskCooldownMinutes: 720,
    }, new Date('2026-07-02T12:00:00.000Z'));

    const recurring = await tasks.claimPendingTasks(10, new Date('2026-07-03T00:00:00.000Z'));

    expect(recurring).toEqual([
      expect.objectContaining({
        source: 'search',
        query: 'tag:new',
        offset: 0,
      }),
    ]);
  });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
    genres: ['pop'],
    country: 'unknown' as const,
    popularity: 50,
  };

  return {
    id: 'release-1',
    spotifyUrl: 'https://open.spotify.com/album/release-1',
    coverUrl: null,
    title: 'Release One',
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-07-02',
    releaseDatePrecision: 'day',
    genres: ['pop'],
    country: 'unknown',
    popularity: 50,
    ...overrides,
  };
}
