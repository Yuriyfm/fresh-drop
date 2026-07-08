export type ReleaseType = 'single' | 'album' | 'compilation' | 'unknown';

export type ReleaseDatePrecision = 'year' | 'month' | 'day' | 'unknown';

export type ReleasePeriod = 'today' | '7d' | '14d' | '1m';

export type ReleaseTypeFilter = 'all' | 'single' | 'album' | 'compilation';

export type ReleaseSort = 'newest' | 'oldest' | 'popular' | 'less-popular';

export type ArtistSummary = {
  id: string;
  name: string;
  genres: string[];
  country: string | 'unknown';
  popularity: number | null;
};

export type Release = {
  id: string;
  spotifyUrl: string | null;
  coverUrl: string | null;
  title: string;
  artists: ArtistSummary[];
  primaryArtist: ArtistSummary | null;
  type: ReleaseType;
  releaseDate: string;
  releaseDatePrecision: ReleaseDatePrecision;
  genres: string[];
  country: string | 'unknown';
  popularity: number | null;
};

export type ReleaseFilters = {
  period: ReleasePeriod;
  genre?: string;
  genres?: string[];
  excludedGenres?: string[];
  country?: string;
  countries?: string[];
  popularityMin?: number;
  popularityMax?: number;
  type: ReleaseTypeFilter;
  sort: ReleaseSort;
  currentDate: Date;
};
