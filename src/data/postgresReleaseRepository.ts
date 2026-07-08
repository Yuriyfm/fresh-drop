import { Pool, type PoolClient } from 'pg';
import type {
  ArtistSummary,
  Release,
  ReleaseDatePrecision,
  ReleasePeriod,
  ReleaseSort,
  ReleaseType,
} from '../domain/release';
import {
  isNoGenreFilter,
  NO_GENRE_FILTER,
  normalizeGenreText,
  TOP_LEVEL_GENRES,
  type GenreOptionKind,
} from '../domain/topLevelGenres';
import {
  getReleaseOffset,
  type CountryCount,
  normalizeReleaseLimit,
  normalizeReleasePage,
  type GenreCount,
  type ReleasePage,
  type ReleaseQuery,
  type ReleaseRepository,
  type SaveReleasesOptions,
} from './releaseRepository';
import { extractUniqueSpotifyArtistsFromReleases } from '../enrichment/artistEnrichment';
import { upsertArtistEnrichmentQueue } from './postgresArtistEnrichmentRepository';
import { decrementGenreCountsForReleaseIds, rebuildReleaseGenresForReleaseIds } from './releaseGenreMaterializer';
import { getCountryFilterVariants, normalizeCountryName } from '../domain/countryNames';

type PostgresReleaseRepositoryOptions = {
  pool: Pool;
  artistEnrichmentEnabled?: boolean;
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
  genres: string[];
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

type ArtistRow = {
  spotify_id: string;
  name: string;
  genres: string[];
  country: string;
  popularity: number | null;
};

type IdRow = {
  id: string;
};

type CountRow = {
  total: number;
};

type GenreCountRow = {
  genre: string;
  release_count: number;
  kind?: GenreOptionKind;
};

type CountryCountRow = {
  musicbrainz_country: string | null;
  release_country: string | null;
  release_count: number;
};

type SqlFilter = {
  whereSql: string;
  params: unknown[];
};

const PRIMARY_ARTIST_COUNTRY_SQL = `
  (
    select nullif(trim(ae_primary.musicbrainz_artist_country), '')
    from release_artists ra_primary
    join artists a_primary on a_primary.id = ra_primary.artist_id
    left join artist_enrichment ae_primary
      on ae_primary.spotify_artist_id = a_primary.spotify_id
     and ae_primary.match_status = 'matched'
    where ra_primary.release_id = r.id
      and ra_primary.is_primary = true
    order by ra_primary.position asc
    limit 1
  )
`;

export class PostgresReleaseRepository implements ReleaseRepository {
  private readonly pool: Pool;
  private readonly artistEnrichmentEnabled: boolean;

  constructor(options: PostgresReleaseRepositoryOptions) {
    this.pool = options.pool;
    this.artistEnrichmentEnabled = options.artistEnrichmentEnabled ?? true;
  }

  async saveReleases(releases: Release[], options: SaveReleasesOptions = {}): Promise<{ saved: number }> {
    if (releases.length === 0) {
      return { saved: 0 };
    }

    const client = await this.pool.connect();

    try {
      await client.query('begin');

      for (const release of releases) {
        const releaseId = await this.saveRelease(client, release);

        if (options.discoveredMarket) {
          await upsertReleaseMarket(client, releaseId, options.discoveredMarket, options.discoveredAt ?? new Date());
        }
      }

      await upsertArtistEnrichmentQueue(
        client,
        extractUniqueSpotifyArtistsFromReleases(releases),
        { enabled: this.artistEnrichmentEnabled },
      );

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

  async findCachedArtists(ids: string[], options: { maxAgeDays: number; now?: Date }): Promise<Map<string, ArtistSummary>> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.trim().length > 0)));

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const cutoff = new Date((options.now ?? new Date()).getTime() - options.maxAgeDays * 24 * 60 * 60 * 1000);
    const result = await this.pool.query<ArtistRow>(
      `
        select spotify_id, name, genres, country, popularity
        from artists
        where spotify_id = any($1::text[])
          and updated_at >= $2
      `,
      [uniqueIds, cutoff],
    );

    return new Map(result.rows.map((row) => [row.spotify_id, mapArtistRow(row)]));
  }

  async saveReleaseMarkets(ids: string[], market: string, seenAt = new Date()): Promise<void> {
    const uniqueIds = Array.from(new Set(ids.filter((id) => id.trim().length > 0)));

    if (uniqueIds.length === 0) {
      return;
    }

    await this.pool.query(
      `
        insert into release_markets (release_id, market, first_seen_at, last_seen_at)
        select id, $2, $3, $3
        from releases
        where spotify_id = any($1::text[])
        on conflict (release_id, market) do update set
          last_seen_at = excluded.last_seen_at
      `,
      [uniqueIds, market, seenAt],
    );
  }

  async findReleases(query: ReleaseQuery): Promise<ReleasePage> {
    const page = normalizeReleasePage(query.page);
    const limit = normalizeReleaseLimit(query.limit);
    const filter = buildSqlFilter(query);
    const countResult = await this.pool.query<CountRow>(
      `select count(*)::integer as total from releases r ${filter.whereSql}`,
      filter.params,
    );
    const total = countResult.rows[0]?.total ?? 0;
    const offset = getReleaseOffset({
      page,
      limit,
      total,
      randomStartSeed: query.randomStartSeed,
    });
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
          coalesce(${PRIMARY_ARTIST_COUNTRY_SQL}, r.country) as country,
          (
            select coalesce(array_agg(rg.genre order by rg.genre), '{}'::text[])
            from release_genres rg
            where rg.release_id = r.id
          ) as genres,
          coalesce(
            json_agg(
              json_build_object(
                'spotify_id', a.spotify_id,
                'name', a.name,
                'genres',
                (
                  select coalesce(array_agg(distinct lower(trim(merged_artist_genre.genre)) order by lower(trim(merged_artist_genre.genre))), '{}'::text[])
                  from (
                    select unnest(a.genres) as genre
                    union all
                    select genre_item->>'name' as genre
                    from jsonb_array_elements(coalesce(ae.genres, '[]'::jsonb)) as genre_item
                  ) as merged_artist_genre
                  where length(trim(merged_artist_genre.genre)) > 0
                ),
                'country', coalesce(nullif(trim(ae.musicbrainz_artist_country), ''), a.country),
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
        left join artist_enrichment ae
          on ae.spotify_artist_id = a.spotify_id
         and ae.match_status = 'matched'
        ${filter.whereSql}
        group by r.id
        ${getOrderBySql(query.sort ?? 'newest')}
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

  async listInsightsReleases(query: ReleaseQuery): Promise<Release[]> {
    const filter = buildSqlFilter(query);
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
          coalesce(${PRIMARY_ARTIST_COUNTRY_SQL}, r.country) as country,
          (
            select coalesce(array_agg(rg.genre order by rg.genre), '{}'::text[])
            from release_genres rg
            where rg.release_id = r.id
          ) as genres,
          coalesce(
            json_agg(
              json_build_object(
                'spotify_id', a.spotify_id,
                'name', a.name,
                'genres',
                (
                  select coalesce(array_agg(distinct lower(trim(merged_artist_genre.genre)) order by lower(trim(merged_artist_genre.genre))), '{}'::text[])
                  from (
                    select unnest(a.genres) as genre
                    union all
                    select genre_item->>'name' as genre
                    from jsonb_array_elements(coalesce(ae.genres, '[]'::jsonb)) as genre_item
                  ) as merged_artist_genre
                  where length(trim(merged_artist_genre.genre)) > 0
                ),
                'country', coalesce(nullif(trim(ae.musicbrainz_artist_country), ''), a.country),
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
        left join artist_enrichment ae
          on ae.spotify_artist_id = a.spotify_id
         and ae.match_status = 'matched'
        ${filter.whereSql}
        group by r.id
        ${getOrderBySql(query.sort ?? 'newest')}
      `,
      filter.params,
    );

    return itemsResult.rows.map(mapReleaseRow);
  }

  async listActiveGenres(): Promise<GenreCount[]> {
    const exactResult = await this.pool.query<GenreCountRow>(
      `
        select genre, release_count
        from genre_counts
        where release_count > 0
        order by genre asc
      `,
    );
    const exactGenres = exactResult.rows.map((row) => ({
      genre: row.genre,
      releaseCount: row.release_count,
      kind: 'exact' as const,
    }));
    const generalResult = await this.pool.query<GenreCountRow>(
      `
        select selected.genre, count(distinct rg.release_id)::integer as release_count
        from unnest($1::text[]) with ordinality as selected(genre, position)
        join release_genres rg on rg.genre like '%' || selected.genre || '%'
        group by selected.genre, selected.position
        having count(distinct rg.release_id) > 0
        order by selected.position asc
      `,
      [TOP_LEVEL_GENRES],
    );
    const generalGenres = generalResult.rows.map((row) => ({
      genre: row.genre,
      releaseCount: row.release_count,
      kind: 'general' as const,
    }));
    const missingResult = await this.pool.query<{ release_count: number }>(
      `
        select count(*)::integer as release_count
        from releases r
        where not exists (
          select 1
          from release_genres rg
          where rg.release_id = r.id
        )
      `,
    );
    const missingGenreCount = missingResult.rows[0]?.release_count ?? 0;
    const missingGenre = missingGenreCount > 0
      ? [{ genre: NO_GENRE_FILTER, releaseCount: missingGenreCount, kind: 'missing' as const }]
      : [];

    return [
      ...missingGenre,
      ...generalGenres,
      ...exactGenres.filter((option) => !generalGenres.some((general) => general.genre === option.genre)),
    ];
  }

  async listActiveCountries(): Promise<CountryCount[]> {
    const result = await this.pool.query<CountryCountRow>(
      `
        select
          country_source.musicbrainz_country,
          country_source.release_country,
          count(*)::integer as release_count
        from (
          select
            ${PRIMARY_ARTIST_COUNTRY_SQL} as musicbrainz_country,
            r.country as release_country
          from releases r
        ) country_source
        group by country_source.musicbrainz_country, country_source.release_country
        order by country_source.musicbrainz_country asc nulls last, country_source.release_country asc nulls last
      `,
    );

    const counts = new Map<string, number>();
    let missingCountryCount = 0;

    for (const row of result.rows) {
      const country = normalizeCountryName(row.musicbrainz_country) ?? normalizeCountryName(row.release_country);

      if (!country) {
        missingCountryCount += row.release_count;
        continue;
      }

      counts.set(country, (counts.get(country) ?? 0) + row.release_count);
    }

    const missingCountry = missingCountryCount > 0
      ? [{ country: 'unknown', releaseCount: missingCountryCount }]
      : [];
    const knownCountries = Array.from(counts.entries())
      .map(([country, releaseCount]) => ({ country, releaseCount }))
      .sort((left, right) => left.country.localeCompare(right.country));

    return [...missingCountry, ...knownCountries];
  }

  async cleanupOldReleases(currentDate: Date, retentionDays: number): Promise<{ deleted: number }> {
    const client = await this.pool.connect();

    try {
      await client.query('begin');

      const releaseIdsResult = await client.query<IdRow>(
        `
          select id
          from releases
          where release_date_precision = 'day'
            and release_date is not null
            and release_date < ($1::date - $2::integer)
        `,
        [toDateOnlyString(startOfUtcDay(currentDate)), retentionDays],
      );
      const releaseIds = releaseIdsResult.rows.map((row) => row.id);

      if (releaseIds.length === 0) {
        await client.query('commit');
        return { deleted: 0 };
      }

      await decrementGenreCountsForReleaseIds(client, releaseIds);

      const result = await client.query('delete from releases where id = any($1::bigint[])', [releaseIds]);

      await client.query('commit');

      return { deleted: result.rowCount ?? 0 };
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  private async saveRelease(client: PoolClient, release: Release): Promise<string> {
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

    await rebuildReleaseGenresForReleaseIds(client, [releaseId]);

    return releaseId;
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
  const genres = normalizeGenreFilters(query.genres ?? (query.genre ? [query.genre] : []));
  const excludedGenres = normalizeGenreFilters(query.excludedGenres ?? []);
  const countries = normalizeTextFilters(query.countries ?? (query.country ? [query.country] : []));
  const type = query.type ?? 'all';

  if (genres.length > 0) {
    const selectedGenres = genres.filter((genre) => !isNoGenreFilter(genre));
    const hasNoGenreFilter = genres.some(isNoGenreFilter);
    const genreClauses: string[] = [];

    if (selectedGenres.length > 0) {
      params.push(selectedGenres);
      genreClauses.push(`
        exists (
          select 1
          from release_genres rg
          where rg.release_id = r.id
            and exists (
              select 1
              from unnest($${params.length}::text[]) as selected(genre)
              where rg.genre = selected.genre
                 or (
                   selected.genre = any($${params.length + 1}::text[])
                   and rg.genre like '%' || selected.genre || '%'
                 )
            )
        )
      `);
      params.push(TOP_LEVEL_GENRES);
    }

    if (hasNoGenreFilter) {
      genreClauses.push(`
        not exists (
          select 1
          from release_genres rg
          where rg.release_id = r.id
        )
      `);
    }

    where.push(`(${genreClauses.join(' or ')})`);
  }

  if (excludedGenres.length > 0) {
    const selectedExcludedGenres = excludedGenres.filter((genre) => !isNoGenreFilter(genre));
    const hasNoGenreFilter = excludedGenres.some(isNoGenreFilter);
    const excludedGenreClauses: string[] = [];

    if (selectedExcludedGenres.length > 0) {
      params.push(selectedExcludedGenres);
      excludedGenreClauses.push(`
        not exists (
          select 1
          from release_genres rg
          where rg.release_id = r.id
            and exists (
              select 1
              from unnest($${params.length}::text[]) as selected(genre)
              where rg.genre = selected.genre
                 or (
                   selected.genre = any($${params.length + 1}::text[])
                   and rg.genre like '%' || selected.genre || '%'
                 )
            )
        )
      `);
      params.push(TOP_LEVEL_GENRES);
    }

    if (hasNoGenreFilter) {
      excludedGenreClauses.push(`
        exists (
          select 1
          from release_genres rg
          where rg.release_id = r.id
        )
      `);
    }

    where.push(`(${excludedGenreClauses.join(' and ')})`);
  }

  if (countries.length > 0) {
    const hasUnknownCountryFilter = countries.some(isUnknownCountryFilter);
    const countryFilterValues = Array.from(new Set(countries.filter((country) => !isUnknownCountryFilter(country)).flatMap(getCountryFilterVariants)));
    const countryClauses: string[] = [];

    if (countryFilterValues.length > 0) {
      params.push(countryFilterValues);
      countryClauses.push(`lower(trim(coalesce(${PRIMARY_ARTIST_COUNTRY_SQL}, r.country))) = any($${params.length}::text[])`);
    }

    if (hasUnknownCountryFilter) {
      countryClauses.push(`
        (
          coalesce(${PRIMARY_ARTIST_COUNTRY_SQL}, r.country) is null
          or trim(coalesce(${PRIMARY_ARTIST_COUNTRY_SQL}, r.country)) = ''
          or lower(trim(coalesce(${PRIMARY_ARTIST_COUNTRY_SQL}, r.country))) = 'unknown'
        )
      `);
    }

    if (countryClauses.length > 0) {
      where.push(`(${countryClauses.join(' or ')})`);
    }
  }

  if (type !== 'all') {
    params.push(type);
    where.push(`r.type = $${params.length}`);
  }

  if (query.popularityMin !== undefined) {
    params.push(query.popularityMin);
    where.push(`r.popularity is not null and r.popularity >= $${params.length}`);
  }

  if (query.popularityMax !== undefined) {
    params.push(query.popularityMax);
    where.push(`r.popularity is not null and r.popularity <= $${params.length}`);
  }

  return {
    whereSql: `where ${where.join(' and ')}`,
    params,
  };
}

function getOrderBySql(sort: ReleaseSort): string {
  if (sort === 'oldest') {
    return 'order by r.release_date asc nulls last, r.spotify_id asc';
  }

  if (sort === 'popular') {
    return 'order by r.popularity desc nulls last, r.spotify_id asc';
  }

  if (sort === 'less-popular') {
    return 'order by r.popularity asc nulls last, r.spotify_id asc';
  }

  return 'order by r.release_date desc nulls last, r.spotify_id asc';
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
    genres: normalizeGenres(row.genres),
    country: normalizeCountryName(row.country) ?? row.country,
    popularity: row.popularity,
  };
}

function mapArtist(artist: DbArtist): ArtistSummary {
  return {
    id: artist.spotify_id,
    name: artist.name,
    genres: artist.genres,
    country: normalizeCountryName(artist.country) ?? artist.country,
    popularity: artist.popularity,
  };
}

function mapArtistRow(row: ArtistRow): ArtistSummary {
  return {
    id: row.spotify_id,
    name: row.name,
    genres: row.genres,
    country: row.country,
    popularity: row.popularity,
  };
}

async function upsertReleaseMarket(client: PoolClient, releaseId: string, market: string, seenAt: Date): Promise<void> {
  await client.query(
    `
      insert into release_markets (release_id, market, first_seen_at, last_seen_at)
      values ($1::bigint, $2, $3, $3)
      on conflict (release_id, market) do update set
        last_seen_at = excluded.last_seen_at
    `,
    [releaseId, market, seenAt],
  );
}

function getDatabaseReleaseDate(release: Release): string | null {
  return release.releaseDatePrecision === 'day' ? release.releaseDate : null;
}

function getPeriodDays(period: ReleasePeriod): number {
  if (period === 'today') {
    return 0;
  }

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

function normalizeTextFilters(values?: string[]): string[] {
  return Array.from(new Set((values ?? []).map(normalizeTextFilter).filter(Boolean)));
}

function isUnknownCountryFilter(country: string): boolean {
  return normalizeTextFilter(country) === 'unknown';
}

function normalizeGenreFilters(genres: string[]): string[] {
  return Array.from(new Set(genres.map(normalizeGenreText).filter(Boolean)));
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDateOnlyString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
