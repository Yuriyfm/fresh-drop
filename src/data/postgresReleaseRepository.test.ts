import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import type { ArtistSummary, Release } from '../domain/release';
import { PostgresReleaseRepository } from './postgresReleaseRepository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('PostgresReleaseRepository', () => {
  const schemaName = `fresh_drop_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let pool: Pool;
  let repository: PostgresReleaseRepository;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 1,
      options: `-c search_path=${schemaName}`,
    });
    repository = new PostgresReleaseRepository({ pool });

    await pool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await pool.query(readFileSync(resolve(process.cwd(), 'db/schema.sql'), 'utf8'));
  });

  beforeEach(async () => {
    await pool.query('truncate release_artists, artists, releases restart identity cascade');
  });

  afterAll(async () => {
    if (!pool) {
      return;
    }

    await pool.query(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
    await pool.end();
  });

  it('upserts releases, artists, and release artist links', async () => {
    const oldArtist = makeArtist({ id: 'artist-1', name: 'Old Artist', genres: ['Rock'] });
    const updatedArtist = makeArtist({ id: 'artist-1', name: 'Updated Artist', genres: ['Ambient', ' ambient '] });
    const secondArtist = makeArtist({ id: 'artist-2', name: 'Second Artist', genres: ['Techno'] });

    await repository.saveReleases([
      makeRelease({
        id: 'spotify-1',
        title: 'Old Title',
        artists: [oldArtist],
        primaryArtist: oldArtist,
      }),
    ]);
    await repository.saveReleases([
      makeRelease({
        id: 'spotify-1',
        title: 'New Title',
        artists: [updatedArtist, secondArtist],
        primaryArtist: updatedArtist,
      }),
    ]);

    const result = await repository.findReleases({
      period: '7d',
      type: 'all',
      popularity: 'all',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });
    const counts = await pool.query<{
      releases: number;
      artists: number;
      release_artists: number;
    }>(`
      select
        (select count(*)::integer from releases) as releases,
        (select count(*)::integer from artists) as artists,
        (select count(*)::integer from release_artists) as release_artists
    `);

    expect(result.pagination.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      id: 'spotify-1',
      title: 'New Title',
      primaryArtist: {
        id: 'artist-1',
        name: 'Updated Artist',
      },
      genres: ['ambient', 'techno'],
    });
    expect(result.items[0].artists.map((artist) => artist.id)).toEqual(['artist-1', 'artist-2']);
    expect(counts.rows[0]).toEqual({
      releases: 1,
      artists: 2,
      release_artists: 2,
    });
  });

  it('applies SQL filters, sorting, and pagination before returning releases', async () => {
    const swedishMetalArtist = makeArtist({ id: 'artist-metal', genres: ['Death Metal'], country: 'SE', popularity: 78 });
    const popArtist = makeArtist({ id: 'artist-pop', genres: ['Pop'], country: 'SE', popularity: 82 });

    await repository.saveReleases([
      makeRelease({
        id: 'match-1',
        releaseDate: '2026-06-30',
        country: 'SE',
        type: 'album',
        popularity: 78,
        artists: [swedishMetalArtist],
        primaryArtist: swedishMetalArtist,
      }),
      makeRelease({
        id: 'match-2',
        releaseDate: '2026-06-29',
        country: 'SE',
        type: 'album',
        popularity: 62,
        artists: [swedishMetalArtist],
        primaryArtist: swedishMetalArtist,
      }),
      makeRelease({
        id: 'wrong-genre',
        releaseDate: '2026-06-30',
        country: 'SE',
        type: 'album',
        popularity: 80,
        artists: [popArtist],
        primaryArtist: popArtist,
      }),
      makeRelease({
        id: 'less-known',
        releaseDate: '2026-06-30',
        country: 'SE',
        type: 'album',
        popularity: 40,
        artists: [swedishMetalArtist],
        primaryArtist: swedishMetalArtist,
      }),
      makeRelease({
        id: 'unknown-popularity',
        releaseDate: '2026-06-30',
        country: 'SE',
        type: 'album',
        popularity: null,
        artists: [swedishMetalArtist],
        primaryArtist: swedishMetalArtist,
      }),
    ]);

    const popularResult = await repository.findReleases({
      period: '7d',
      genre: 'death metal',
      country: 'se',
      type: 'album',
      popularity: 'popular',
      page: 1,
      limit: 1,
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });
    const lessKnownResult = await repository.findReleases({
      period: '7d',
      genre: 'Death Metal',
      country: 'SE',
      type: 'album',
      popularity: 'less-known',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });

    expect(popularResult.items.map((release) => release.id)).toEqual(['match-1']);
    expect(popularResult.pagination).toEqual({
      page: 1,
      limit: 1,
      total: 2,
      hasNextPage: true,
    });
    expect(lessKnownResult.items.map((release) => release.id)).toEqual(['less-known']);
  });

  it('deletes old day-precision releases and cascades stale release artist links', async () => {
    const artist = makeArtist();

    await repository.saveReleases([
      makeRelease({
        id: 'old',
        releaseDate: '2026-05-30',
        artists: [artist],
        primaryArtist: artist,
      }),
      makeRelease({
        id: 'fresh',
        releaseDate: '2026-06-15',
        artists: [artist],
        primaryArtist: artist,
      }),
    ]);

    await expect(repository.cleanupOldReleases(new Date('2026-07-01T12:00:00.000Z'), 30)).resolves.toEqual({
      deleted: 1,
    });

    const result = await repository.findReleases({
      period: '1m',
      type: 'all',
      popularity: 'all',
      currentDate: new Date('2026-07-01T12:00:00.000Z'),
    });
    const links = await pool.query<{ total: number }>('select count(*)::integer as total from release_artists');

    expect(result.items.map((release) => release.id)).toEqual(['fresh']);
    expect(links.rows[0].total).toBe(1);
  });
});

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = makeArtist();
  const artists = overrides.artists ?? [artist];

  return {
    id: 'release-1',
    spotifyUrl: 'https://open.spotify.com/album/release-1',
    coverUrl: null,
    title: 'Release One',
    artists,
    primaryArtist: overrides.primaryArtist ?? artists[0] ?? null,
    type: 'single',
    releaseDate: '2026-06-30',
    releaseDatePrecision: 'day',
    genres: ['pop'],
    country: 'unknown',
    popularity: 70,
    ...overrides,
  };
}

function makeArtist(overrides: Partial<ArtistSummary> = {}): ArtistSummary {
  return {
    id: 'artist-1',
    name: 'Artist One',
    genres: ['pop'],
    country: 'unknown',
    popularity: 70,
    ...overrides,
  };
}

function quoteIdentifier(value: string): string {
  return `"${value.split('"').join('""')}"`;
}
