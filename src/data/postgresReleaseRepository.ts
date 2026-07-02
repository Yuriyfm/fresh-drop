import { Pool, type PoolClient } from 'pg';
import type {
  ArtistSummary,
  PopularityFilter,
  Release,
  ReleaseDatePrecision,
  ReleasePeriod,
  ReleaseType,
} from '../domain/release';
import {
  normalizeReleaseLimit,
  normalizeReleasePage,
  type ReleasePage,
  type ReleaseQuery,
  type ReleaseRepository,
} from './releaseRepository';

type PostgresReleaseRepositoryOptions = {
  pool: Pool;
};

type ReleaseRow = {
  spotify_id: string;
  title: string;
  type: ReleaseType;
  release_date: string | Date | null;
  release_date_precision: ReleaseDatePrecision;
  spotify_url: string | null;
  cover_url: string | null;
  popularity: number | null;
  country: string;
  artists: DbArtist[];
};

type DbArtist = {
  spotify_id: string;
  name: string;
  genres: string[];
  country: string;
  popularity: number | null;
  is_primary: boolean;
};

type IdRow = {
  id: string;
};

type CountRow = {
  total: number;
};

type SqlFilter = {
  whereSql: string;
  params: unknown[];
};

export class PostgresReleaseRepository implements ReleaseRepository {
  private readonly pool: Pool;

  constructor(options: PostgresReleaseRepositoryOptions) {
    this.pool = options.pool;
  }

  async saveReleases(releases: Release[]): Promise<{ saved: number }> {
    if (releases.length === 0) {
      return { saved: 0 };
    }

    const client = await this.pool.connect();

    try {
      await client.query('begin');

      for (const release of releases) {
        await this.saveRelease(client, release);
      }

      await client.query('commit');

      return { saved: releases.length };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async findExistingReleaseIds(ids: string[]): Promise<Set<string>> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.trim().length > 0)));

    if (uniqueIds.length === 0) {
      return new Set();
    }

    const result = await this.pool.query<{ spotify_id: string }>(
      'select spotify_id from releases where spotify_id = any($1::text[])',
      [uniqueIds],
    );

    return new Set(result.rows.map((row) => row.spotify_id));
  }

  async findReleases(query: ReleaseQuery): Promise<ReleasePage> {
    const page = normalizeReleasePage(query.page);
    const limit = normalizeReleaseLimit(query.limit);
    const offset = (page - 1) * limit;
    const filter = buildSqlFilter(query);
    const countResult = await this.pool.query<CountRow>(
      `select count(*)::integer as total from releases r ${filter.whereSql}`,
      filter.params,
    );
    const total = countResult.rows[0]?.total ?? 0;
    const itemsResult = await this.pool.query<ReleaseRow>(
      `
        select
          r.spotify_id,
          r.title,
          r.type,
          r.release_date,
          r.release_date_precision,
          r.spotify_url,
          r.cover_url,
          r.popularity,
          r.country,
          coalesce(
            json_agg(
              json_build_object(
                'spotify_id', a.spotify_id,
                'name', a.name,
                'genres', a.genres,
                'country', a.country,
                'popularity', a.popularity,
                'is_primary', ra.is_primary
              )
              order by ra.position
            ) filter (where a.id is not null),
            '[]'::json
          ) as artists
        from releases r
        left join release_artists ra on ra.release_id = r.id
        left join artists a on a.id = ra.artist_id
        ${filter.whereSql}
        group by r.id
        order by r.release_date desc nulls last, r.popularity desc nulls last, r.spotify_id asc
        limit $${filter.params.length + 1}
        offset $${filter.params.length + 2}
      `,
      [...filter.params, limit, offset],
    );

    return {
      items: itemsResult.rows.map(mapReleaseRow),
      pagination: {
        page,
        limit,
        total,
        hasNextPage: offset + itemsResult.rows.length < total,
      },
    };
  }

  async cleanupOldReleases(currentDate: Date, retentionDays: number): Promise<{ deleted: number }> {
    const result = await this.pool.query(
      `
        delete from releases
        where release_date_precision = 'day'
          and release_date is not null
          and release_date < ($1::date - $2::integer)
      `,
      [toDateOnlyString(startOfUtcDay(currentDate)), retentionDays],
    );

    return { deleted: result.rowCount ?? 0 };
  }

  private async saveRelease(client: PoolClient, release: Release): Promise<void> {
    const releaseResult = await client.query<IdRow>(
      `
        insert into releases (
          spotify_id,
          title,
          type,
          release_date,
          release_date_precision,
          spotify_url,
          cover_url,
          popularity,
          country,
          updated_at
        )
        values ($1, $2, $3, $4::date, $5, $6, $7, $8, $9, now())
        on conflict (spotify_id) do update set
          title = excluded.title,
          type = excluded.type,
          release_date = excluded.release_date,
          release_date_precision = excluded.release_date_precision,
          spotify_url = excluded.spotify_url,
          cover_url = excluded.cover_url,
          popularity = excluded.popularity,
          country = excluded.country,
          updated_at = now()
        returning id
      `,
      [
        release.id,
        release.title,
        release.type,
        getDatabaseReleaseDate(release),
        release.releaseDatePrecision,
        release.spotifyUrl,
        release.coverUrl,
        release.popularity,
        release.country,
      ],
    );
    const releaseId = releaseResult.rows[0]?.id;

    if (!releaseId) {
      throw new Error(`Failed to save release ${release.id}.`);
    }

    await client.query('delete from release_artists where release_id = $1', [releaseId]);

    for (const [index, artist] of release.artists.entries()) {
      const artistId = await this.saveArtist(client, artist);

      await client.query(
        `
          insert into release_artists (release_id, artist_id, position, is_primary)
          values ($1, $2, $3, $4)
          on conflict (release_id, artist_id) do update set
            position = excluded.position,
            is_primary = excluded.is_primary
        `,
        [releaseId, artistId, index, index === 0],
      );
    }
  }

  private async saveArtist(client: PoolClient, artist: ArtistSummary): Promise<string> {
    const result = await client.query<IdRow>(
      `
        insert into artists (
          spotify_id,
          name,
          popularity,
          country,
          genres,
          updated_at
        )
        values ($1, $2, $3, $4, $5, now())
        on conflict (spotify_id) do update set
          name = excluded.name,
          popularity = excluded.popularity,
          country = excluded.country,
          genres = excluded.genres,
          updated_at = now()
        returning id
      `,
      [artist.id, artist.name, artist.popularity, artist.country, normalizeGenres(artist.genres)],
    );
    const artistId = result.rows[0]?.id;

    if (!artistId) {
      throw new Error(`Failed to save artist ${artist.id}.`);
    }

    return artistId;
  }
}

function buildSqlFilter(query: ReleaseQuery): SqlFilter {
  const currentDate = startOfUtcDay(query.currentDate ?? new Date());
  const params: unknown[] = [toDateOnlyString(currentDate), getPeriodDays(query.period)];
  const where = [
    "r.release_date_precision = 'day'",
    'r.release_date is not null',
    'r.release_date >= ($1::date - $2::integer)',
    'r.release_date <= $1::date',
  ];
  const genre = normalizeTextFilter(query.genre);
  const country = normalizeTextFilter(query.country);
  const type = query.type ?? 'all';
  const popularity = query.popularity ?? 'all';

  if (genre) {
    params.push(genre);
    where.push(`
      exists (
        select 1
        from release_artists genre_ra
        join artists genre_artist on genre_artist.id = genre_ra.artist_id
        where genre_ra.release_id = r.id
          and genre_artist.genres @> array[$${params.length}]::text[]
      )
    `);
  }

  if (country) {
    params.push(country);
    where.push(`lower(trim(r.country)) = $${params.length}`);
  }

  if (type !== 'all') {
    params.push(type);
    where.push(`r.type = $${params.length}`);
  }

  applyPopularityFilter(where, params, popularity);

  return {
    whereSql: `where ${where.join(' and ')}`,
    params,
  };
}

function applyPopularityFilter(where: string[], params: unknown[], popularity: PopularityFilter): void {
  if (popularity === 'all') {
    return;
  }

  where.push('r.popularity is not null');

  if (popularity === 'popular') {
    where.push('r.popularity >= 60');
    return;
  }

  where.push('r.popularity < 60');
}

function mapReleaseRow(row: ReleaseRow): Release {
  const artists = row.artists.map(mapArtist);

  return {
    id: row.spotify_id,
    spotifyUrl: row.spotify_url,
    coverUrl: row.cover_url,
    title: row.title,
    artists,
    primaryArtist: artists.find((artist, index) => row.artists[index]?.is_primary) ?? artists[0] ?? null,
    type: row.type,
    releaseDate: formatReleaseDate(row.release_date),
    releaseDatePrecision: row.release_date_precision,
    genres: normalizeGenres(artists.flatMap((artist) => artist.genres)),
    country: row.country,
    popularity: row.popularity,
  };
}

function mapArtist(artist: DbArtist): ArtistSummary {
  return {
    id: artist.spotify_id,
    name: artist.name,
    genres: artist.genres,
    country: artist.country,
    popularity: artist.popularity,
  };
}

function getDatabaseReleaseDate(release: Release): string | null {
  return release.releaseDatePrecision === 'day' ? release.releaseDate : null;
}

function getPeriodDays(period: ReleasePeriod): number {
  if (period === '7d') {
    return 7;
  }

  if (period === '14d') {
    return 14;
  }

  return 31;
}

function formatReleaseDate(value: ReleaseRow['release_date']): string {
  if (value === null) {
    return '';
  }

  if (value instanceof Date) {
    return toDateOnlyString(value);
  }

  return value;
}

function normalizeGenres(genres: string[]): string[] {
  return Array.from(new Set(genres.map(normalizeTextFilter).filter(Boolean)));
}

function normalizeTextFilter(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
