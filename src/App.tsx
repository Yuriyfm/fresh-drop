import { useEffect, useMemo, useState } from 'react';
import './App.css';
import type { PopularityFilter, Release, ReleasePeriod, ReleaseTypeFilter } from './domain/release';
import {
  getStoredLanguage,
  LANGUAGE_STORAGE_KEY,
  translations,
  type Language,
  type Translation,
} from './i18n';
import { fetchReleases } from './releasesClient';

const PAGE_LIMIT = 20;
const RELEASE_ROUTE_PREFIX = '/releases/';
const ABOUT_ROUTE = '/about';

type PaginationState = {
  page: number;
  limit: number;
  total: number;
  hasNextPage: boolean;
};

type RequestStatus = 'loading' | 'loadingMore' | 'success' | 'error';

type AppRoute =
  | {
      view: 'search';
    }
  | {
      view: 'about';
    }
  | {
      view: 'release';
      releaseId: string;
    };

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname));
  const [language, setLanguage] = useState<Language>(() => getStoredLanguage());
  const [period, setPeriod] = useState<ReleasePeriod>('7d');
  const [genre, setGenre] = useState('');
  const [country, setCountry] = useState('');
  const [type, setType] = useState<ReleaseTypeFilter>('all');
  const [popularity, setPopularity] = useState<PopularityFilter>('all');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [releases, setReleases] = useState<Release[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    hasNextPage: false,
  });
  const [status, setStatus] = useState<RequestStatus>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [retryCount, setRetryCount] = useState(0);
  const [genreOptions, setGenreOptions] = useState<string[]>([]);
  const [countryOptions, setCountryOptions] = useState<string[]>([]);
  const t = translations[language];

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    function handlePopState(): void {
      setRoute(getRouteFromPath(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    setStatus(page === 1 ? 'loading' : 'loadingMore');
    setErrorMessage('');

    fetchReleases(
      {
        period,
        genre,
        country,
        type,
        popularity,
        page,
        limit: PAGE_LIMIT,
      },
      { signal: controller.signal },
    )
      .then((response) => {
        setReleases((current) => (page === 1 ? response.items : mergeReleases(current, response.items)));
        setPagination(response.pagination);
        setGenreOptions((current) => mergeOptions(current, collectGenres(response.items)));
        setCountryOptions((current) => mergeOptions(current, collectCountries(response.items)));
        setStatus('success');
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : '');
      });

    return () => {
      controller.abort();
    };
  }, [country, genre, page, period, popularity, retryCount, type]);

  const summaryFilters = useMemo(
    () =>
      [
        genre || undefined,
        country || undefined,
        getPeriodLabel(period, t),
        type === 'all' ? undefined : getReleaseTypeLabel(type, t),
        popularity === 'all' ? undefined : t.filters.popularOnly,
      ].filter(isPresent),
    [country, genre, period, popularity, t, type],
  );
  const summaryText = t.results.summary(pagination.total, summaryFilters);

  if (route.view === 'release') {
    const release = releases.find((item) => item.id === route.releaseId);

    return (
      <ReleaseDetail
        isLoading={status === 'loading' || status === 'loadingMore'}
        release={release}
        language={language}
        t={t}
        onBack={goBackToSearch}
        onLanguageChange={setLanguage}
      />
    );
  }

  if (route.view === 'about') {
    return <AboutPage language={language} t={t} onBack={goBackToSearch} onLanguageChange={setLanguage} />;
  }

  return (
    <main className="appShell">
      <header className="appHeader">
        <div>
          <p className="eyebrow">{t.app.eyebrow}</p>
          <h1>{t.app.title}</h1>
          <p>{t.app.description}</p>
        </div>
        <div className="headerActions">
          <LanguageSwitcher language={language} t={t} onChange={setLanguage} />
          <button type="button" className="navLink" onClick={openAbout}>
            {t.app.howItWorks}
          </button>
        </div>
      </header>

      <section className="filterPanel" aria-label={t.filters.aria}>
        <div className="primaryFilters">
          <PeriodFilter period={period} t={t} onChange={updatePeriod} />
          <GenreFilter genre={genre} genreOptions={genreOptions} t={t} onChange={updateGenre} />
          <button type="button" className="secondaryButton mobileFilterButton" onClick={() => setIsFiltersOpen(true)}>
            {t.filters.filters}
          </button>
        </div>

        <div className="desktopFilters">
          <AdditionalFilters
            country={country}
            countryOptions={countryOptions}
            type={type}
            popularity={popularity}
            t={t}
            onCountryChange={updateCountry}
            onTypeChange={updateType}
            onPopularityChange={updatePopularity}
          />
        </div>
      </section>

      <section className="resultsHeader" aria-live="polite">
        <p>{status === 'loading' ? t.results.loading : summaryText}</p>
        {hasActiveFilters(period, genre, country, type, popularity) && (
          <button type="button" className="ghostButton" onClick={resetFilters}>
            {t.filters.reset}
          </button>
        )}
      </section>

      <section className="releaseList" aria-label={t.filters.aria}>
        {status === 'loading' && <ReleaseSkeleton />}

        {status === 'error' && releases.length === 0 && (
          <div className="statePanel" role="alert">
            <h2>{t.results.errorTitle}</h2>
            <p>{errorMessage || t.results.errorDescription}</p>
            <button type="button" onClick={retry}>
              {t.results.retry}
            </button>
          </div>
        )}

        {status !== 'loading' && status !== 'error' && releases.length === 0 && (
          <div className="statePanel">
            <h2>{t.results.noTitle}</h2>
            <p>{t.results.noDescription}</p>
          </div>
        )}

        {releases.map((release) => (
          <ReleaseRow release={release} key={release.id} t={t} onSelect={() => openRelease(release)} />
        ))}

        {status === 'error' && releases.length > 0 && (
          <div className="inlineError" role="alert">
            <span>{errorMessage || t.results.errorDescription}</span>
            <button type="button" onClick={retry}>
              {t.results.retry}
            </button>
          </div>
        )}

        {status === 'loadingMore' && <p className="loadingMore">{t.results.loadingMore}</p>}

        {status !== 'loading' && status !== 'error' && pagination.hasNextPage && (
          <button type="button" className="loadMoreButton" onClick={() => setPage((current) => current + 1)}>
            {t.results.loadMore}
          </button>
        )}

        {status === 'success' && releases.length > 0 && !pagination.hasNextPage && <p className="endState">{t.results.end}</p>}
      </section>

      <MobileFiltersSheet
        isOpen={isFiltersOpen}
        country={country}
        countryOptions={countryOptions}
        type={type}
        popularity={popularity}
        t={t}
        onClose={() => setIsFiltersOpen(false)}
        onCountryChange={updateCountry}
        onTypeChange={updateType}
        onPopularityChange={updatePopularity}
        onReset={resetFilters}
      />
    </main>
  );

  function updatePeriod(nextPeriod: ReleasePeriod): void {
    setPeriod(nextPeriod);
    resetResults();
  }

  function updateGenre(nextGenre: string): void {
    setGenre(nextGenre);
    resetResults();
  }

  function updateCountry(nextCountry: string): void {
    setCountry(nextCountry);
    setIsFiltersOpen(false);
    resetResults();
  }

  function updateType(nextType: ReleaseTypeFilter): void {
    setType(nextType);
    setIsFiltersOpen(false);
    resetResults();
  }

  function updatePopularity(nextPopularity: PopularityFilter): void {
    setPopularity(nextPopularity);
    setIsFiltersOpen(false);
    resetResults();
  }

  function resetFilters(): void {
    setPeriod('7d');
    setGenre('');
    setCountry('');
    setType('all');
    setPopularity('all');
    setIsFiltersOpen(false);
    resetResults();
  }

  function resetResults(): void {
    setPage(1);
    setReleases([]);
    setPagination({
      page: 1,
      limit: PAGE_LIMIT,
      total: 0,
      hasNextPage: false,
    });
  }

  function retry(): void {
    setRetryCount((current) => current + 1);
  }

  function openRelease(release: Release): void {
    const nextPath = getReleasePath(release.id);

    window.history.pushState(null, '', nextPath);
    setRoute({ view: 'release', releaseId: release.id });
  }

  function goBackToSearch(): void {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.history.pushState(null, '', '/');
    setRoute({ view: 'search' });
  }

  function openAbout(): void {
    window.history.pushState(null, '', ABOUT_ROUTE);
    setRoute({ view: 'about' });
  }
}

type PeriodFilterProps = {
  period: ReleasePeriod;
  t: Translation;
  onChange: (period: ReleasePeriod) => void;
};

function PeriodFilter({ period, t, onChange }: PeriodFilterProps) {
  return (
    <label>
      {t.filters.period}
      <select value={period} onChange={(event) => onChange(event.target.value as ReleasePeriod)}>
        <option value="7d">{t.periods['7d']}</option>
        <option value="14d">{t.periods['14d']}</option>
        <option value="1m">{t.periods['1m']}</option>
      </select>
    </label>
  );
}

type GenreFilterProps = {
  genre: string;
  genreOptions: string[];
  t: Translation;
  onChange: (genre: string) => void;
};

function GenreFilter({ genre, genreOptions, t, onChange }: GenreFilterProps) {
  return (
    <label>
      {t.filters.genre}
      <select value={genre} onChange={(event) => onChange(event.target.value)}>
        <option value="">{t.filters.allGenres}</option>
        {genreOptions.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

type AdditionalFiltersProps = {
  country: string;
  countryOptions: string[];
  type: ReleaseTypeFilter;
  popularity: PopularityFilter;
  t: Translation;
  onCountryChange: (country: string) => void;
  onTypeChange: (type: ReleaseTypeFilter) => void;
  onPopularityChange: (popularity: PopularityFilter) => void;
};

function AdditionalFilters({
  country,
  countryOptions,
  type,
  popularity,
  t,
  onCountryChange,
  onTypeChange,
  onPopularityChange,
}: AdditionalFiltersProps) {
  return (
    <>
      <label>
        {t.filters.country}
        <select value={country} onChange={(event) => onCountryChange(event.target.value)}>
          <option value="">{t.filters.allCountries}</option>
          {countryOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <label>
        {t.filters.type}
        <select value={type} onChange={(event) => onTypeChange(event.target.value as ReleaseTypeFilter)}>
          <option value="all">{t.releaseTypes.all}</option>
          <option value="single">{t.releaseTypes.single}</option>
          <option value="album">{t.releaseTypes.album}</option>
          <option value="compilation">{t.releaseTypes.compilation}</option>
        </select>
      </label>

      <label>
        {t.filters.popularity}
        <select value={popularity} onChange={(event) => onPopularityChange(event.target.value as PopularityFilter)}>
          <option value="all">{t.filters.any}</option>
          <option value="popular">{t.filters.popularOnly}</option>
        </select>
      </label>

      <label>
        {t.filters.sorting}
        <select value="newest" disabled>
          <option value="newest">{t.filters.newestFirst}</option>
        </select>
      </label>
    </>
  );
}

type MobileFiltersSheetProps = AdditionalFiltersProps & {
  isOpen: boolean;
  onClose: () => void;
  onReset: () => void;
};

function MobileFiltersSheet({
  isOpen,
  country,
  countryOptions,
  type,
  popularity,
  t,
  onClose,
  onCountryChange,
  onTypeChange,
  onPopularityChange,
  onReset,
}: MobileFiltersSheetProps) {
  return (
    <div className="sheetLayer" hidden={!isOpen}>
      <button type="button" className="sheetBackdrop" aria-label={t.filters.close} onClick={onClose} />
      <section className="bottomSheet" role="dialog" aria-modal="true" aria-label={t.filters.additional}>
        <div className="sheetHeader">
          <h2>{t.filters.filters}</h2>
          <button type="button" className="iconButton" aria-label={t.filters.close} onClick={onClose}>
            x
          </button>
        </div>
        <div className="sheetFilters">
          <AdditionalFilters
            country={country}
            countryOptions={countryOptions}
            type={type}
            popularity={popularity}
            t={t}
            onCountryChange={onCountryChange}
            onTypeChange={onTypeChange}
            onPopularityChange={onPopularityChange}
          />
        </div>
        <button type="button" className="ghostButton fullWidthButton" onClick={onReset}>
          {t.filters.reset}
        </button>
      </section>
    </div>
  );
}

type ReleaseRowProps = {
  release: Release;
  t: Translation;
  onSelect: () => void;
};

function ReleaseRow({ release, t, onSelect }: ReleaseRowProps) {
  return (
    <article className="releaseItem">
      <button type="button" className="releaseRow" onClick={onSelect} aria-label={t.release.openLabel(release.title)}>
        {release.coverUrl ? (
          <img className="coverImage" src={release.coverUrl} alt="" loading="lazy" />
        ) : (
          <span className="coverPlaceholder" aria-hidden="true" />
        )}
        <span className="releaseInfo">
          <span className="releaseTitle">{release.title}</span>
          <span className="releaseArtist">{formatArtists(release, t)}</span>
          <span className="releaseMeta">
            <span>{formatUnknown(release.releaseDate, t)}</span>
            <span>{getReleaseTypeLabel(release.type, t)}</span>
          </span>
        </span>
        <span className="chevron" aria-hidden="true">
          &rsaquo;
        </span>
      </button>
    </article>
  );
}

type ReleaseDetailProps = {
  isLoading: boolean;
  release: Release | undefined;
  language: Language;
  t: Translation;
  onBack: () => void;
  onLanguageChange: (language: Language) => void;
};

function ReleaseDetail({ isLoading, release, language, t, onBack, onLanguageChange }: ReleaseDetailProps) {
  if (!release) {
    return (
      <main className="appShell detailShell">
        <PageTopBar language={language} t={t} onBack={onBack} onLanguageChange={onLanguageChange} />
        <section className="statePanel" role="status">
          <h1>{isLoading ? t.release.loadingTitle : t.release.notLoadedTitle}</h1>
          <p>{isLoading ? t.release.loadingDescription : t.release.notLoadedDescription}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell detailShell">
      <PageTopBar language={language} t={t} onBack={onBack} onLanguageChange={onLanguageChange} />
      <section className="releaseDetail" aria-label={t.release.detailsAria}>
        {release.coverUrl ? (
          <img className="detailCover" src={release.coverUrl} alt="" />
        ) : (
          <div className="detailCover coverPlaceholder" aria-label={t.release.noCover} role="img" />
        )}
        <div className="detailContent">
          <p className="eyebrow">{getReleaseTypeLabel(release.type, t)}</p>
          <h1>{release.title}</h1>
          <p className="detailArtist">{formatArtists(release, t)}</p>
          {release.spotifyUrl && (
            <a className="spotifyLink" href={release.spotifyUrl} target="_blank" rel="noreferrer">
              {t.release.openSpotify}
            </a>
          )}
          <dl className="detailMeta">
            <div>
              <dt>{t.release.releaseDate}</dt>
              <dd>{formatUnknown(release.releaseDate, t)}</dd>
            </div>
            <div>
              <dt>{t.release.country}</dt>
              <dd>{formatUnknown(release.country, t)}</dd>
            </div>
            <div>
              <dt>{t.release.genres}</dt>
              <dd>{formatList(release.genres, t)}</dd>
            </div>
            <div>
              <dt>{t.release.popularity}</dt>
              <dd>{formatNullableNumber(release.popularity, t)}</dd>
            </div>
          </dl>
          <p className="shownBecause">{t.release.shownBecause}</p>
        </div>
      </section>
    </main>
  );
}

type AboutPageProps = {
  language: Language;
  t: Translation;
  onBack: () => void;
  onLanguageChange: (language: Language) => void;
};

function AboutPage({ language, t, onBack, onLanguageChange }: AboutPageProps) {
  return (
    <main className="appShell detailShell">
      <PageTopBar language={language} t={t} onBack={onBack} onLanguageChange={onLanguageChange} />
      <section className="aboutPage" aria-label={t.about.aria}>
        <p className="eyebrow">{t.about.eyebrow}</p>
        <h1>{t.about.title}</h1>
        <p>{t.about.intro}</p>

        <div className="aboutSection">
          <h2>{t.about.filtersTitle}</h2>
          <p>{t.about.filtersDescription}</p>
        </div>

        <div className="aboutSection">
          <h2>{t.about.limitsTitle}</h2>
          <ul>
            {t.about.limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}

type LanguageSwitcherProps = {
  language: Language;
  t: Translation;
  onChange: (language: Language) => void;
};

function LanguageSwitcher({ language, t, onChange }: LanguageSwitcherProps) {
  return (
    <label className="languageSwitcher">
      {t.language.label}
      <select value={language} onChange={(event) => onChange(event.target.value as Language)}>
        <option value="en">{t.language.en}</option>
        <option value="ru">{t.language.ru}</option>
      </select>
    </label>
  );
}

type PageTopBarProps = {
  language: Language;
  t: Translation;
  onBack: () => void;
  onLanguageChange: (language: Language) => void;
};

function PageTopBar({ language, t, onBack, onLanguageChange }: PageTopBarProps) {
  return (
    <div className="pageTopBar">
      <button type="button" className="backButton" onClick={onBack}>
        &larr; {t.release.back}
      </button>
      <LanguageSwitcher language={language} t={t} onChange={onLanguageChange} />
    </div>
  );
}

function ReleaseSkeleton() {
  return (
    <>
      {[0, 1, 2].map((item) => (
        <div className="releaseItem skeletonCard" key={item}>
          <div className="coverPlaceholder" />
          <div>
            <div className="skeletonLine titleLine" />
            <div className="skeletonLine" />
            <div className="skeletonMeta">
              <div className="skeletonLine shortLine" />
              <div className="skeletonLine shortLine" />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function collectGenres(releases: Release[]): string[] {
  return releases.flatMap((release) => release.genres).filter((genre) => genre.trim() !== '');
}

function collectCountries(releases: Release[]): string[] {
  return releases
    .map((release) => release.country)
    .filter((country) => country.trim() !== '' && country !== 'unknown');
}

function mergeOptions(current: string[], next: string[]): string[] {
  return Array.from(new Set([...current, ...next])).sort((left, right) => left.localeCompare(right));
}

function mergeReleases(current: Release[], next: Release[]): Release[] {
  const releasesById = new Map(current.map((release) => [release.id, release]));

  next.forEach((release) => {
    releasesById.set(release.id, release);
  });

  return Array.from(releasesById.values());
}

function hasActiveFilters(
  period: ReleasePeriod,
  genre: string,
  country: string,
  type: ReleaseTypeFilter,
  popularity: PopularityFilter,
): boolean {
  return period !== '7d' || genre !== '' || country !== '' || type !== 'all' || popularity !== 'all';
}

function getPeriodLabel(period: ReleasePeriod, t: Translation): string {
  return t.periods[period];
}

function getReleaseTypeLabel(type: ReleaseTypeFilter | Release['type'], t: Translation): string {
  return t.releaseTypes[type] ?? t.releaseTypes.unknown;
}

function formatArtists(release: Release, t: Translation): string {
  return release.artists.map((artist) => artist.name).join(', ') || t.release.unknownArtist;
}

function formatList(values: string[], t: Translation): string {
  const normalized = values.map((value) => value.trim()).filter(Boolean);

  return normalized.length > 0 ? normalized.join(', ') : t.release.unknown;
}

function formatNullableNumber(value: number | null, t: Translation): string {
  return value === null ? t.release.unknown : String(value);
}

function formatUnknown(value: string, t: Translation): string {
  const normalized = value.trim();

  return normalized === '' || normalized === 'unknown' ? t.release.unknown : normalized;
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function getReleasePath(releaseId: string): string {
  return `${RELEASE_ROUTE_PREFIX}${encodeURIComponent(releaseId)}`;
}

function getRouteFromPath(pathname: string): AppRoute {
  if (pathname === ABOUT_ROUTE) {
    return { view: 'about' };
  }

  if (!pathname.startsWith(RELEASE_ROUTE_PREFIX)) {
    return { view: 'search' };
  }

  const releaseId = decodeURIComponent(pathname.slice(RELEASE_ROUTE_PREFIX.length));

  return releaseId ? { view: 'release', releaseId } : { view: 'search' };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export default App;
