import type { Release, ReleasePeriod, ReleaseTypeFilter } from './release';
import { normalizeCountryName } from './countryNames';
import { normalizeGenreText } from './topLevelGenres';

export type InsightsPeriod = 7 | 14 | 30;
export type InsightsType = 'all' | 'single' | 'album';

export type InsightLinkQuery = {
  country?: string;
  genre?: string;
  popularityMin?: number;
  popularityMax?: number;
  releaseId?: string;
};

export type InsightListItem = {
  id: string;
  title: string;
  description: string;
  metric: string;
  query: InsightLinkQuery;
  release?: Release;
};

export type InsightsData = {
  period: InsightsPeriod;
  type: InsightsType;
  generatedAt: string;
  sections: {
    countries: {
      mostActiveCountries: {
        byReleases: InsightListItem[];
        byArtists: InsightListItem[];
      };
      rareCountries: InsightListItem[];
      bigArtistsFromSmallScenes: InsightListItem[];
      mostDiverseCountries: InsightListItem[];
    };
    genres: {
      mostActiveGenres: InsightListItem[];
      rareGenreDrops: InsightListItem[];
      mostMainstreamGenres: InsightListItem[];
      deepUndergroundGenres: InsightListItem[];
    };
    scenes: {
      topScenes: InsightListItem[];
    };
    discovery: {
      deepUndergroundDrops: InsightListItem[];
    };
  };
};

type CountStat = {
  name: string;
  releaseCount: number;
  artistCount: number;
  maxPopularity: number;
  medianPopularity: number | null;
};

type SceneStat = {
  country: string;
  genre: string;
  releaseCount: number;
};

const ITEM_LIMIT = 8;
const ACTIVE_TOP_SIZE = 10;

export function getReleasePeriodFromInsightsPeriod(period: InsightsPeriod): ReleasePeriod {
  if (period === 7) {
    return '7d';
  }

  if (period === 14) {
    return '14d';
  }

  return '1m';
}

export function createInsightsData(options: {
  releases: Release[];
  period: InsightsPeriod;
  type: InsightsType;
  generatedAt?: Date;
}): InsightsData {
  const releases = options.releases;
  const countryStats = getCountryStats(releases);
  const genreStats = getGenreStats(releases);
  const topActiveCountries = new Set(
    [...countryStats].sort((left, right) => right.releaseCount - left.releaseCount).slice(0, ACTIVE_TOP_SIZE).map((stat) => stat.name),
  );

  return {
    period: options.period,
    type: options.type,
    generatedAt: (options.generatedAt ?? new Date()).toISOString(),
    sections: {
      countries: {
        mostActiveCountries: {
          byReleases: getMostActiveCountriesByReleases(countryStats),
          byArtists: getMostActiveCountriesByArtists(countryStats),
        },
        rareCountries: getRareCountries(countryStats),
        bigArtistsFromSmallScenes: getBigArtistsFromSmallScenes(releases, topActiveCountries),
        mostDiverseCountries: getMostDiverseCountries(releases, countryStats),
      },
      genres: {
        mostActiveGenres: getMostActiveGenres(genreStats),
        rareGenreDrops: getRareGenreDrops(genreStats),
        mostMainstreamGenres: getMostMainstreamGenres(genreStats),
        deepUndergroundGenres: getDeepUndergroundGenres(genreStats),
      },
      scenes: {
        topScenes: getTopScenes(releases),
      },
      discovery: {
        deepUndergroundDrops: getDeepUndergroundDrops(releases),
      },
    },
  };
}

function getMostActiveCountriesByReleases(stats: CountStat[]): InsightListItem[] {
  return [...stats]
    .sort((left, right) => right.releaseCount - left.releaseCount || left.name.localeCompare(right.name))
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `${stat.releaseCount} releases`, `${stat.artistCount} artists`, { country: stat.name }));
}

function getMostActiveCountriesByArtists(stats: CountStat[]): InsightListItem[] {
  return [...stats]
    .sort((left, right) => right.artistCount - left.artistCount || right.releaseCount - left.releaseCount || left.name.localeCompare(right.name))
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `${stat.artistCount} artists`, `${stat.releaseCount} releases`, { country: stat.name }));
}

function getRareCountries(stats: CountStat[]): InsightListItem[] {
  return stats
    .filter((stat) => stat.releaseCount >= 1 && stat.releaseCount <= 10)
    .sort((left, right) => left.releaseCount - right.releaseCount || right.maxPopularity - left.maxPopularity || left.name.localeCompare(right.name))
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `${stat.releaseCount} releases`, '', { country: stat.name }));
}

function getBigArtistsFromSmallScenes(releases: Release[], topActiveCountries: Set<string>): InsightListItem[] {
  const countryCounts = countBy(releases.map((release) => getKnownCountry(release)).filter(isPresent));
  const latestReleaseByArtist = new Map<string, Release>();

  for (const release of releases) {
    const country = getKnownCountry(release);

    if (!country || topActiveCountries.has(country) || (countryCounts.get(country) ?? 0) > 20 || (release.popularity ?? -1) < 50) {
      continue;
    }

    const artistId = release.primaryArtist?.id ?? release.artists[0]?.id ?? release.id;
    const current = latestReleaseByArtist.get(artistId);

    if (!current || release.releaseDate.localeCompare(current.releaseDate) > 0) {
      latestReleaseByArtist.set(artistId, release);
    }
  }

  return Array.from(latestReleaseByArtist.values())
    .sort((left, right) => (right.popularity ?? -1) - (left.popularity ?? -1) || right.releaseDate.localeCompare(left.releaseDate))
    .slice(0, ITEM_LIMIT)
    .map((release) => ({
      ...makeItem(
        release.primaryArtist?.name ?? release.artists[0]?.name ?? 'Unknown artist',
        `popularity ${release.popularity} · latest release: ${release.title}`,
        getKnownCountry(release) ?? '',
        { releaseId: release.id, country: getKnownCountry(release), popularityMin: 50 },
      ),
      release,
    }));
}

function getMostDiverseCountries(releases: Release[], stats: CountStat[]): InsightListItem[] {
  const genresByCountry = new Map<string, Set<string>>();

  for (const release of releases) {
    const country = getKnownCountry(release);

    if (!country) {
      continue;
    }

    const genres = genresByCountry.get(country) ?? new Set<string>();
    getKnownGenres(release).forEach((genre) => genres.add(genre));
    genresByCountry.set(country, genres);
  }

  return stats
    .map((stat) => ({ ...stat, genreCount: genresByCountry.get(stat.name)?.size ?? 0 }))
    .filter((stat) => stat.releaseCount >= 20 && stat.genreCount >= 3)
    .sort((left, right) => right.genreCount - left.genreCount || right.releaseCount - left.releaseCount)
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `${stat.genreCount} genres · ${stat.releaseCount} releases`, '', { country: stat.name }));
}

function getMostActiveGenres(stats: CountStat[]): InsightListItem[] {
  return [...stats]
    .sort((left, right) => right.releaseCount - left.releaseCount || left.name.localeCompare(right.name))
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `${stat.releaseCount} releases`, '', { genre: stat.name }));
}

function getRareGenreDrops(stats: CountStat[]): InsightListItem[] {
  return stats
    .filter((stat) => stat.releaseCount >= 1 && stat.releaseCount <= 10)
    .sort((left, right) => left.releaseCount - right.releaseCount || right.maxPopularity - left.maxPopularity || left.name.localeCompare(right.name))
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `${stat.releaseCount} releases`, '', { genre: stat.name }));
}

function getMostMainstreamGenres(stats: CountStat[]): InsightListItem[] {
  return stats
    .filter((stat) => stat.releaseCount >= 10 && stat.medianPopularity !== null)
    .sort((left, right) => (right.medianPopularity ?? -1) - (left.medianPopularity ?? -1) || right.releaseCount - left.releaseCount)
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `median popularity ${stat.medianPopularity} · ${stat.releaseCount} releases`, '', {
      genre: stat.name,
      popularityMin: 60,
    }));
}

function getDeepUndergroundGenres(stats: CountStat[]): InsightListItem[] {
  return stats
    .filter((stat) => stat.releaseCount >= 10 && stat.medianPopularity !== null && stat.medianPopularity <= 20)
    .sort((left, right) => (left.medianPopularity ?? 101) - (right.medianPopularity ?? 101) || right.releaseCount - left.releaseCount)
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(stat.name, `median popularity ${stat.medianPopularity} · ${stat.releaseCount} releases`, '', {
      genre: stat.name,
      popularityMax: 20,
    }));
}

function getTopScenes(releases: Release[]): InsightListItem[] {
  const counts = new Map<string, SceneStat>();

  for (const release of releases) {
    const country = getKnownCountry(release);

    if (!country) {
      continue;
    }

    for (const genre of getKnownGenres(release)) {
      const key = `${country}\u0000${genre}`;
      const current = counts.get(key) ?? { country, genre, releaseCount: 0 };

      current.releaseCount += 1;
      counts.set(key, current);
    }
  }

  return Array.from(counts.values())
    .filter((stat) => stat.releaseCount >= 5)
    .sort((left, right) => right.releaseCount - left.releaseCount || left.country.localeCompare(right.country) || left.genre.localeCompare(right.genre))
    .slice(0, ITEM_LIMIT)
    .map((stat) => makeItem(`${stat.country} · ${stat.genre}`, `${stat.releaseCount} releases`, '', {
      country: stat.country,
      genre: stat.genre,
    }));
}

function getDeepUndergroundDrops(releases: Release[]): InsightListItem[] {
  return releases
    .filter((release) => (release.popularity ?? 101) <= 20)
    .sort((left, right) => {
      const knownComparison = Number(Boolean(getKnownCountry(right) || getKnownGenres(right).length > 0))
        - Number(Boolean(getKnownCountry(left) || getKnownGenres(left).length > 0));

      return knownComparison || right.releaseDate.localeCompare(left.releaseDate) || (left.popularity ?? 101) - (right.popularity ?? 101);
    })
    .slice(0, ITEM_LIMIT)
    .map((release) => makeItem(
      release.title,
      `${release.primaryArtist?.name ?? release.artists[0]?.name ?? 'Unknown artist'} · popularity ${release.popularity ?? 'unknown'}`,
      [getKnownCountry(release), getKnownGenres(release)[0]].filter(isPresent).join(' · '),
      { releaseId: release.id, popularityMax: 20 },
    ));
}

function getCountryStats(releases: Release[]): CountStat[] {
  return getStats(releases, (release) => {
    const country = getKnownCountry(release);

    return country ? [country] : [];
  });
}

function getGenreStats(releases: Release[]): CountStat[] {
  return getStats(releases, getKnownGenres);
}

function getStats(releases: Release[], getNames: (release: Release) => string[]): CountStat[] {
  const releasesByName = new Map<string, Set<string>>();
  const artistsByName = new Map<string, Set<string>>();
  const popularitiesByName = new Map<string, number[]>();

  for (const release of releases) {
    for (const name of getNames(release)) {
      const releaseIds = releasesByName.get(name) ?? new Set<string>();
      const artistIds = artistsByName.get(name) ?? new Set<string>();
      const popularities = popularitiesByName.get(name) ?? [];

      releaseIds.add(release.id);
      if (release.primaryArtist?.id) {
        artistIds.add(release.primaryArtist.id);
      }
      if (release.popularity !== null) {
        popularities.push(release.popularity);
      }

      releasesByName.set(name, releaseIds);
      artistsByName.set(name, artistIds);
      popularitiesByName.set(name, popularities);
    }
  }

  return Array.from(releasesByName.entries()).map(([name, releaseIds]) => {
    const popularities = popularitiesByName.get(name) ?? [];

    return {
      name,
      releaseCount: releaseIds.size,
      artistCount: artistsByName.get(name)?.size ?? 0,
      maxPopularity: popularities.length > 0 ? Math.max(...popularities) : -1,
      medianPopularity: getMedian(popularities),
    };
  });
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function getKnownCountry(release: Release): string | undefined {
  const country = release.country.trim();

  if (!country || country.toLowerCase() === 'unknown') {
    return undefined;
  }

  return normalizeCountryName(country) ?? country;
}

function getKnownGenres(release: Release): string[] {
  return Array.from(new Set(release.genres.map(normalizeGenreText).filter((genre) => genre && genre !== 'unknown')));
}

function countBy(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  return counts;
}

function makeItem(title: string, metric: string, description: string, query: InsightLinkQuery): InsightListItem {
  return {
    id: `${title}-${metric}`,
    title,
    description,
    metric,
    query,
  };
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}
