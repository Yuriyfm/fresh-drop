import process from 'node:process';
import { Pool } from 'pg';

type CliArgs = {
  limit: number;
  batchSize: number;
  scope: 'musicbrainz-missing' | 'all';
};

type ArtistSampleRow = {
  spotify_artist_id: string;
  spotify_artist_name: string | null;
  musicbrainz_status: string | null;
  musicbrainz_artist_country: string | null;
  musicbrainz_genre_count: number;
  spotify_genre_count: number;
};

type WikidataBinding = {
  spotifyId?: { value: string };
  item?: { value: string };
  itemLabel?: { value: string };
  countries?: { value: string };
  genres?: { value: string };
};

type WikidataResponse = {
  results?: {
    bindings?: WikidataBinding[];
  };
};

type WikidataArtistMatch = {
  spotifyArtistId: string;
  items: Map<string, { label?: string; countries: Set<string>; genres: Set<string> }>;
};

const WIKIDATA_QUERY_ENDPOINT = 'https://query.wikidata.org/sparql';
const USER_AGENT = 'FreshDropWikidataProbe/0.1 (https://github.com/Yuriyfm/fresh-drop)';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const pool = new Pool(getDatabasePoolConfig());

  try {
    const artists = await loadArtistSample(pool, args);

    if (artists.length === 0) {
      console.info(`Wikidata Spotify artist check found no artists for scope=${args.scope}.`);
      return;
    }

    console.info(
      `Wikidata Spotify artist check started:` +
        ` scope=${args.scope}` +
        ` limit=${args.limit}` +
        ` batchSize=${args.batchSize}` +
        ` sampledArtists=${artists.length}`,
    );

    const wikidataMatches = await lookupWikidataArtists(
      artists.map((artist) => artist.spotify_artist_id),
      args.batchSize,
    );

    printSummary(artists, wikidataMatches, args);
  } finally {
    await pool.end();
  }
}

async function loadArtistSample(pool: Pool, args: CliArgs): Promise<ArtistSampleRow[]> {
  const scopeWhere =
    args.scope === 'musicbrainz-missing'
      ? "where coalesce(ae.match_status, 'missing') <> 'matched'"
      : '';

  const result = await pool.query<ArtistSampleRow>(
    `
      select
        a.spotify_id as spotify_artist_id,
        a.name as spotify_artist_name,
        ae.match_status as musicbrainz_status,
        ae.musicbrainz_artist_country,
        coalesce(jsonb_array_length(ae.genres), 0)::integer as musicbrainz_genre_count,
        cardinality(a.genres)::integer as spotify_genre_count
      from artists a
      left join artist_enrichment ae
        on ae.spotify_artist_id = a.spotify_id
      ${scopeWhere}
      order by
        case coalesce(ae.match_status, 'missing')
          when 'not_found' then 0
          when 'ambiguous' then 1
          when 'failed' then 2
          when 'pending' then 3
          when 'missing' then 4
          when 'disabled' then 5
          when 'matched' then 6
          else 7
        end,
        a.updated_at desc,
        a.spotify_id asc
      limit $1
    `,
    [args.limit],
  );

  return result.rows;
}

async function lookupWikidataArtists(spotifyArtistIds: string[], batchSize: number): Promise<Map<string, WikidataArtistMatch>> {
  const matches = new Map<string, WikidataArtistMatch>();

  for (let offset = 0; offset < spotifyArtistIds.length; offset += batchSize) {
    const batch = spotifyArtistIds.slice(offset, offset + batchSize);
    const response = await fetchWikidataBatch(batch);

    for (const binding of response.results?.bindings ?? []) {
      const spotifyArtistId = binding.spotifyId?.value;
      const item = binding.item?.value;

      if (!spotifyArtistId || !item) {
        continue;
      }

      const artistMatch = matches.get(spotifyArtistId) ?? {
        spotifyArtistId,
        items: new Map(),
      };
      const itemMatch = artistMatch.items.get(item) ?? {
        label: binding.itemLabel?.value,
        countries: new Set<string>(),
        genres: new Set<string>(),
      };

      for (const country of splitGroupedValue(binding.countries?.value)) {
        itemMatch.countries.add(country);
      }

      for (const genre of splitGroupedValue(binding.genres?.value)) {
        itemMatch.genres.add(genre);
      }

      artistMatch.items.set(item, itemMatch);
      matches.set(spotifyArtistId, artistMatch);
    }

    console.info(
      `Wikidata Spotify artist check batch:` +
        ` processed=${Math.min(offset + batch.length, spotifyArtistIds.length)}/${spotifyArtistIds.length}` +
        ` matchedSoFar=${matches.size}`,
    );
  }

  return matches;
}

async function fetchWikidataBatch(spotifyArtistIds: string[]): Promise<WikidataResponse> {
  const query = buildWikidataQuery(spotifyArtistIds);
  const response = await fetch(WIKIDATA_QUERY_ENDPOINT, {
    method: 'POST',
    headers: {
      Accept: 'application/sparql-results+json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': USER_AGENT,
    },
    body: new URLSearchParams({ query }),
  });

  if (!response.ok) {
    throw new Error(`Wikidata query failed: status=${response.status} body=${await response.text()}`);
  }

  return (await response.json()) as WikidataResponse;
}

function buildWikidataQuery(spotifyArtistIds: string[]): string {
  const values = spotifyArtistIds.map((id) => `"${escapeSparqlString(id)}"`).join(' ');

  return `
    SELECT
      ?spotifyId
      ?item
      ?itemLabel
      (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries)
      (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
    WHERE {
      VALUES ?spotifyId { ${values} }
      ?item wdt:P1902 ?spotifyId.
      OPTIONAL { ?item wdt:P27|wdt:P495 ?country. }
      OPTIONAL { ?item wdt:P136 ?genre. }
      SERVICE wikibase:label {
        bd:serviceParam wikibase:language "en".
        ?item rdfs:label ?itemLabel.
        ?country rdfs:label ?countryLabel.
        ?genre rdfs:label ?genreLabel.
      }
    }
    GROUP BY ?spotifyId ?item ?itemLabel
  `;
}

function printSummary(
  artists: ArtistSampleRow[],
  wikidataMatches: Map<string, WikidataArtistMatch>,
  args: CliArgs,
): void {
  const sampledArtists = artists.length;
  const musicBrainzMatched = artists.filter((artist) => artist.musicbrainz_status === 'matched').length;
  const musicBrainzMissing = sampledArtists - musicBrainzMatched;
  const wikidataMatched = artists.filter((artist) => wikidataMatches.has(artist.spotify_artist_id)).length;
  const wikidataSingleItemMatched = artists.filter((artist) => wikidataMatches.get(artist.spotify_artist_id)?.items.size === 1).length;
  const wikidataAmbiguous = artists.filter((artist) => {
    const match = wikidataMatches.get(artist.spotify_artist_id);
    return match !== undefined && match.items.size > 1;
  }).length;
  const additionalArtistMatches = artists.filter(
    (artist) => artist.musicbrainz_status !== 'matched' && wikidataMatches.has(artist.spotify_artist_id),
  ).length;
  const additionalSingleItemMatches = artists.filter(
    (artist) => artist.musicbrainz_status !== 'matched' && wikidataMatches.get(artist.spotify_artist_id)?.items.size === 1,
  ).length;
  const additionalCountryCandidates = artists.filter((artist) => {
    const match = wikidataMatches.get(artist.spotify_artist_id);

    return (
      artist.musicbrainz_status !== 'matched' &&
      isMissingText(artist.musicbrainz_artist_country) &&
      match !== undefined &&
      getCountries(match).size > 0
    );
  }).length;
  const additionalGenreCandidates = artists.filter((artist) => {
    const match = wikidataMatches.get(artist.spotify_artist_id);

    return (
      artist.musicbrainz_status !== 'matched' &&
      artist.musicbrainz_genre_count === 0 &&
      match !== undefined &&
      getGenres(match).size > 0
    );
  }).length;

  console.info('Wikidata Spotify artist check finished.');
  console.info(`sampledArtists=${sampledArtists} scope=${args.scope}`);
  console.info(
    `musicBrainzMatched=${formatCount(musicBrainzMatched, sampledArtists)}` +
      ` musicBrainzMissing=${formatCount(musicBrainzMissing, sampledArtists)}`,
  );
  console.info(
    `wikidataMatched=${formatCount(wikidataMatched, sampledArtists)}` +
      ` wikidataSingleItemMatched=${formatCount(wikidataSingleItemMatched, sampledArtists)}` +
      ` wikidataAmbiguous=${formatCount(wikidataAmbiguous, sampledArtists)}`,
  );
  console.info(
    `additionalOverMusicBrainz=${formatCount(additionalArtistMatches, musicBrainzMissing)}` +
      ` additionalSingleItemOverMusicBrainz=${formatCount(additionalSingleItemMatches, musicBrainzMissing)}`,
  );
  console.info(
    `additionalCountryCandidates=${formatCount(additionalCountryCandidates, musicBrainzMissing)}` +
      ` additionalGenreCandidates=${formatCount(additionalGenreCandidates, musicBrainzMissing)}`,
  );
}

function parseArgs(args: string[]): CliArgs {
  let limit = 1000;
  let batchSize = 100;
  let scope: CliArgs['scope'] = 'musicbrainz-missing';

  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (arg.startsWith('--batch-size=')) {
      batchSize = parsePositiveInteger(arg.slice('--batch-size='.length), '--batch-size');
      continue;
    }

    if (arg.startsWith('--scope=')) {
      const parsedScope = arg.slice('--scope='.length);

      if (parsedScope !== 'musicbrainz-missing' && parsedScope !== 'all') {
        throw new Error('--scope must be either musicbrainz-missing or all.');
      }

      scope = parsedScope;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { limit, batchSize, scope };
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }

  return parsed;
}

function splitGroupedValue(value: string | undefined): string[] {
  return (value ?? '')
    .split('|')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function getCountries(match: WikidataArtistMatch): Set<string> {
  return new Set(Array.from(match.items.values()).flatMap((item) => Array.from(item.countries)));
}

function getGenres(match: WikidataArtistMatch): Set<string> {
  return new Set(Array.from(match.items.values()).flatMap((item) => Array.from(item.genres)));
}

function isMissingText(value: string | null): boolean {
  return value === null || value.trim().length === 0 || value.trim().toLowerCase() === 'unknown';
}

function formatCount(count: number, total: number): string {
  const percent = total === 0 ? '0.00' : ((count / total) * 100).toFixed(2);

  return `${count}/${total} (${percent}%)`;
}

function escapeSparqlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function getDatabasePoolConfig(): { connectionString: string } | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Wikidata Spotify artist check failed.');
  process.exitCode = 1;
});
