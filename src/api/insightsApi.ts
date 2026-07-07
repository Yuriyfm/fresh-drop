import type { ReleaseQuery } from '../data/releaseRepository';
import type { Release } from '../domain/release';
import {
  createInsightsData,
  getReleasePeriodFromInsightsPeriod,
  type InsightsData,
  type InsightsPeriod,
  type InsightsType,
} from '../domain/insights';

export type InsightsApiQuery = Record<string, string | string[] | number | undefined>;

export type InsightsApiResponse = InsightsData & {
  error: null;
};

export type InsightsApiErrorResponse = {
  period: InsightsPeriod;
  type: InsightsType;
  generatedAt: string;
  sections: InsightsData['sections'];
  error: {
    code: 'invalid_query' | 'internal_error';
    message: string;
  };
};

export type InsightsApiResult = InsightsApiResponse | InsightsApiErrorResponse;

export type InsightsApiHandlerOptions = {
  currentDate?: Date;
};

export type InsightsReleaseRepository = {
  listInsightsReleases(query: ReleaseQuery): Promise<Release[]>;
};

const DEFAULT_INSIGHTS_PERIOD: InsightsPeriod = 30;
const DEFAULT_INSIGHTS_TYPE: InsightsType = 'all';
const EMPTY_SECTIONS: InsightsData['sections'] = {
  countries: {
    mostActiveCountries: {
      byReleases: [],
      byArtists: [],
    },
    rareCountries: [],
    bigArtistsFromSmallScenes: [],
    mostDiverseCountries: [],
  },
  genres: {
    mostActiveGenres: [],
    rareGenreDrops: [],
    mostMainstreamGenres: [],
    deepUndergroundGenres: [],
  },
  scenes: {
    topScenes: [],
  },
  discovery: {
    deepUndergroundDrops: [],
  },
};

export async function getInsightsApiResponse(
  repository: InsightsReleaseRepository,
  query: InsightsApiQuery = {},
  options: InsightsApiHandlerOptions = {},
): Promise<InsightsApiResult> {
  const normalized = normalizeInsightsQuery(query);
  const generatedAt = options.currentDate ?? new Date();

  if (!normalized.ok) {
    return createErrorResponse(DEFAULT_INSIGHTS_PERIOD, DEFAULT_INSIGHTS_TYPE, generatedAt, 'invalid_query', normalized.message);
  }

  try {
    const releases = await repository.listInsightsReleases({
      period: getReleasePeriodFromInsightsPeriod(normalized.period),
      type: normalized.type,
      sort: 'newest',
      currentDate: options.currentDate,
    } satisfies ReleaseQuery);
    const data = createInsightsData({
      releases,
      period: normalized.period,
      type: normalized.type,
      generatedAt,
    });

    return {
      ...data,
      error: null,
    };
  } catch {
    return createErrorResponse(normalized.period, normalized.type, generatedAt, 'internal_error', 'Internal server error.');
  }
}

type NormalizedInsightsQueryResult =
  | {
      ok: true;
      period: InsightsPeriod;
      type: InsightsType;
    }
  | {
      ok: false;
      message: string;
    };

function normalizeInsightsQuery(query: InsightsApiQuery): NormalizedInsightsQueryResult {
  const period = getSingleQueryValue(query.period) ?? DEFAULT_INSIGHTS_PERIOD;
  const type = getSingleQueryValue(query.type) ?? DEFAULT_INSIGHTS_TYPE;
  const normalizedPeriod = normalizePeriod(period);

  if (!normalizedPeriod) {
    return { ok: false, message: 'Invalid period query parameter.' };
  }

  if (type !== 'all' && type !== 'single' && type !== 'album') {
    return { ok: false, message: 'Invalid type query parameter.' };
  }

  return {
    ok: true,
    period: normalizedPeriod,
    type,
  };
}

function normalizePeriod(value: string | number): InsightsPeriod | null {
  const normalized = typeof value === 'number' ? value : Number(value);

  if (normalized === 7 || normalized === 14 || normalized === 30) {
    return normalized;
  }

  return null;
}

function getSingleQueryValue(value: string | string[] | number | undefined): string | number | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function createErrorResponse(
  period: InsightsPeriod,
  type: InsightsType,
  generatedAt: Date,
  code: InsightsApiErrorResponse['error']['code'],
  message: string,
): InsightsApiErrorResponse {
  return {
    period,
    type,
    generatedAt: generatedAt.toISOString(),
    sections: EMPTY_SECTIONS,
    error: {
      code,
      message,
    },
  };
}
