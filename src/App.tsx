import { useEffect, useMemo, useRef, useState } from 'react';
import './App.css';
import type { GenreOption } from './api/releasesApi';
import type { Release, ReleasePeriod, ReleaseSort, ReleaseTypeFilter } from './domain/release';
import { NO_GENRE_FILTER } from './domain/topLevelGenres';
import {
  getStoredLanguage,
  LANGUAGE_STORAGE_KEY,
  translations,
  type Language,
  type Translation,
} from './i18n';
import { fetchReleases } from './releasesClient';

const PAGE_LIMIT = 20;
const VIRTUAL_RELEASE_ROW_HEIGHT = 92;
const VIRTUAL_RELEASE_OVERSCAN = 8;
const RELEASE_ROUTE_PREFIX = '/releases/';
const ABOUT_ROUTE = '/about';
const RELEASE_SEARCH_STORAGE_KEY = 'fresh-drop-release-search-state';
const DEFAULT_SEARCH_STATE: ReleaseSearchState = {
  period: '7d',
  genres: [],
  type: 'all',
  sort: 'newest',
};

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

type ReleaseSearchState = {
  period: ReleasePeriod;
  genres: string[];
  type: ReleaseTypeFilter;
  sort: ReleaseSort;
};

type ScrollPosition = {
  top: number;
  height: number;
};

type VirtualReleaseRange = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
};

function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname));
  const [language, setLanguage] = useState<Language>(() => getStoredLanguage());
  const [storedSearchState] = useState<ReleaseSearchState>(() => getStoredReleaseSearchState());
  const [period, setPeriod] = useState<ReleasePeriod>(storedSearchState.period);
  const [genres, setGenres] = useState<string[]>(storedSearchState.genres);
  const [type, setType] = useState<ReleaseTypeFilter>(storedSearchState.type);
  const [sort, setSort] = useState<ReleaseSort>(storedSearchState.sort);
  const [randomStartSeed] = useState(() => createRandomStartSeed());
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
  const [genreOptions, setGenreOptions] = useState<GenreOption[]>([]);
  const [scrollPosition, setScrollPosition] = useState({ top: 0, height: window.innerHeight });
  const releaseListRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const t = translations[language];

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(RELEASE_SEARCH_STORAGE_KEY, JSON.stringify({ period, genres, type, sort }));
  }, [genres, period, sort, type]);

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
        genres,
        type,
        sort,
        page,
        limit: PAGE_LIMIT,
        randomStartSeed: isDefaultSearch(period, genres, type, sort) ? randomStartSeed : undefined,
      },
      { signal: controller.signal },
    )
      .then((response) => {
        setReleases((current) => (page === 1 ? response.items : mergeReleases(current, response.items)));
        setPagination(response.pagination);
        setGenreOptions(response.genres);
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
  }, [genres, page, period, randomStartSeed, retryCount, sort, type]);

  useEffect(() => {
    function updateScrollPosition(): void {
      setScrollPosition({
        top: window.scrollY,
        height: window.innerHeight,
      });
    }

    updateScrollPosition();
    window.addEventListener('scroll', updateScrollPosition, { passive: true });
    window.addEventListener('resize', updateScrollPosition);

    return () => {
      window.removeEventListener('scroll', updateScrollPosition);
      window.removeEventListener('resize', updateScrollPosition);
    };
  }, []);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || !pagination.hasNextPage || status !== 'success') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPage((current) => current + 1);
        }
      },
      {
        rootMargin: '360px 0px',
      },
    );

    observer.observe(target);

    return () => {
      observer.disconnect();
    };
  }, [pagination.hasNextPage, status]);

  const summaryFilters = useMemo(
    () =>
      [
        ...genres.map((selectedGenre) => getGenreLabel(selectedGenre, t)),
        getPeriodLabel(period, t),
        type === 'all' ? undefined : getReleaseTypeLabel(type, t),
        sort === 'newest' ? undefined : getReleaseSortLabel(sort, t),
      ].filter(isPresent),
    [genres, period, sort, t, type],
  );
  const summaryText = t.results.summary(pagination.total, summaryFilters);
  const virtualRange = getVirtualReleaseRange(releases.length, scrollPosition, releaseListRef.current);
  const visibleReleases = releases.slice(virtualRange.startIndex, virtualRange.endIndex);

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
        <div className="filterGroup">
          <p className="filterGroupTitle">{t.filters.filters}</p>
          <div className="primaryFilters">
            <PeriodFilter period={period} t={t} onChange={updatePeriod} />
            <GenreFilter selectedGenres={genres} genreOptions={genreOptions} t={t} onChange={updateGenres} />
            <button type="button" className="secondaryButton mobileFilterButton" onClick={() => setIsFiltersOpen(true)}>
              {t.filters.filters}
            </button>
          </div>

          <div className="desktopFilters">
            <AdditionalFilters
              type={type}
              t={t}
              onTypeChange={updateType}
            />
          </div>
        </div>

        <div className="filterGroup desktopSortGroup">
          <p className="filterGroupTitle">{t.filters.sorting}</p>
          <SortFilter sort={sort} t={t} onChange={updateSort} />
        </div>
      </section>

      <section className="resultsHeader" aria-live="polite">
        <p>{status === 'loading' ? t.results.loading : summaryText}</p>
        {hasActiveFilters(period, genres, type, sort) && (
          <button type="button" className="ghostButton" onClick={resetFilters}>
            {t.filters.reset}
          </button>
        )}
      </section>

      <section className="releaseList" aria-label={t.filters.aria} ref={releaseListRef}>
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

        {releases.length > 0 && (
          <div className="virtualReleaseList" style={{ height: virtualRange.totalHeight }}>
            <div
              className="virtualReleaseItems"
              style={{ transform: `translateY(${virtualRange.offsetTop}px)` }}
            >
              {visibleReleases.map((release) => (
                <ReleaseRow release={release} key={release.id} t={t} onSelect={() => openRelease(release)} />
              ))}
            </div>
          </div>
        )}

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
          <div ref={loadMoreRef} className="scrollSentinel" aria-hidden="true" />
        )}

        {status === 'success' && releases.length > 0 && !pagination.hasNextPage && <p className="endState">{t.results.end}</p>}
      </section>

      <MobileFiltersSheet
        isOpen={isFiltersOpen}
        type={type}
        sort={sort}
        t={t}
        onClose={() => setIsFiltersOpen(false)}
        onTypeChange={updateType}
        onSortChange={updateSort}
        onReset={resetFilters}
      />
    </main>
  );

  function updatePeriod(nextPeriod: ReleasePeriod): void {
    setPeriod(nextPeriod);
    resetResults();
  }

  function updateGenres(nextGenres: string[]): void {
    setGenres(nextGenres);
    resetResults();
  }

  function updateType(nextType: ReleaseTypeFilter): void {
    setType(nextType);
    setIsFiltersOpen(false);
    resetResults();
  }

  function updateSort(nextSort: ReleaseSort): void {
    setSort(nextSort);
    setIsFiltersOpen(false);
    resetResults();
  }

  function resetFilters(): void {
    setPeriod(DEFAULT_SEARCH_STATE.period);
    setGenres(DEFAULT_SEARCH_STATE.genres);
    setType(DEFAULT_SEARCH_STATE.type);
    setSort(DEFAULT_SEARCH_STATE.sort);
    window.localStorage.setItem(RELEASE_SEARCH_STORAGE_KEY, JSON.stringify(DEFAULT_SEARCH_STATE));
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
  selectedGenres: string[];
  genreOptions: GenreOption[];
  t: Translation;
  onChange: (genres: string[]) => void;
};

function GenreFilter({ selectedGenres, genreOptions, t, onChange }: GenreFilterProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = genreOptions.filter((option) => getGenreLabel(option.name, t).toLowerCase().includes(normalizedQuery));

  return (
    <div className="genreSelector">
      <label>
        {t.filters.genre}
        <input
          type="search"
          value={query}
          placeholder={t.filters.searchGenres}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="selectedGenreChips" aria-label={t.filters.selectedGenres}>
        {selectedGenres.length === 0 ? (
          <span className="emptyGenreChip">{t.filters.allGenres}</span>
        ) : (
          selectedGenres.map((genre) => (
            <button type="button" className="genreChip" key={genre} onClick={() => toggleGenre(genre)}>
              {getGenreLabel(genre, t)} x
            </button>
          ))
        )}
      </div>
      <div className="genreOptionList">
        {visibleOptions.map((option) => (
          <label className="genreOption" key={`${option.kind}-${option.name}`}>
            <input
              type="checkbox"
              checked={selectedGenres.includes(option.name)}
              onChange={() => toggleGenre(option.name)}
            />
            <span>{getGenreLabel(option.name, t)}</span>
            <span className="genreCount">{option.releaseCount}</span>
          </label>
        ))}
      </div>
    </div>
  );

  function toggleGenre(nextGenre: string): void {
    if (selectedGenres.includes(nextGenre)) {
      onChange(selectedGenres.filter((genre) => genre !== nextGenre));
      return;
    }

    onChange([...selectedGenres, nextGenre]);
  }
}

type AdditionalFiltersProps = {
  type: ReleaseTypeFilter;
  t: Translation;
  onTypeChange: (type: ReleaseTypeFilter) => void;
};

function AdditionalFilters({
  type,
  t,
  onTypeChange,
}: AdditionalFiltersProps) {
  return (
    <label>
      {t.filters.type}
      <select value={type} onChange={(event) => onTypeChange(event.target.value as ReleaseTypeFilter)}>
        <option value="all">{t.releaseTypes.all}</option>
        <option value="single">{t.releaseTypes.single}</option>
        <option value="album">{t.releaseTypes.album}</option>
        <option value="compilation">{t.releaseTypes.compilation}</option>
      </select>
    </label>
  );
}

type SortFilterProps = {
  sort: ReleaseSort;
  t: Translation;
  onChange: (sort: ReleaseSort) => void;
};

function SortFilter({ sort, t, onChange }: SortFilterProps) {
  return (
    <label>
      {t.filters.sorting}
      <select value={sort} onChange={(event) => onChange(event.target.value as ReleaseSort)}>
        <option value="newest">{t.sorts.newest}</option>
        <option value="oldest">{t.sorts.oldest}</option>
        <option value="popular">{t.sorts.popular}</option>
        <option value="less-popular">{t.sorts.lessPopular}</option>
      </select>
    </label>
  );
}

type MobileFiltersSheetProps = AdditionalFiltersProps & {
  isOpen: boolean;
  sort: ReleaseSort;
  onClose: () => void;
  onSortChange: (sort: ReleaseSort) => void;
  onReset: () => void;
};

function MobileFiltersSheet({
  isOpen,
  type,
  sort,
  t,
  onClose,
  onTypeChange,
  onSortChange,
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
          <div className="filterGroup">
            <p className="filterGroupTitle">{t.filters.filters}</p>
            <AdditionalFilters
              type={type}
              t={t}
              onTypeChange={onTypeChange}
            />
          </div>
          <div className="filterGroup">
            <p className="filterGroupTitle">{t.filters.sorting}</p>
            <SortFilter sort={sort} t={t} onChange={onSortChange} />
          </div>
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

function mergeReleases(current: Release[], next: Release[]): Release[] {
  const releasesById = new Map(current.map((release) => [release.id, release]));

  next.forEach((release) => {
    releasesById.set(release.id, release);
  });

  return Array.from(releasesById.values());
}

function getVirtualReleaseRange(
  releaseCount: number,
  scrollPosition: ScrollPosition,
  listElement: HTMLElement | null,
): VirtualReleaseRange {
  if (releaseCount === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      totalHeight: 0,
    };
  }

  const listTop = listElement ? listElement.offsetTop : 0;
  const viewportTop = Math.max(scrollPosition.top - listTop, 0);
  const rawStartIndex = Math.floor(viewportTop / VIRTUAL_RELEASE_ROW_HEIGHT) - VIRTUAL_RELEASE_OVERSCAN;
  const visibleCount = Math.ceil(scrollPosition.height / VIRTUAL_RELEASE_ROW_HEIGHT) + VIRTUAL_RELEASE_OVERSCAN * 2;
  const startIndex = Math.max(rawStartIndex, 0);
  const endIndex = Math.min(startIndex + visibleCount, releaseCount);

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * VIRTUAL_RELEASE_ROW_HEIGHT,
    totalHeight: releaseCount * VIRTUAL_RELEASE_ROW_HEIGHT,
  };
}

function hasActiveFilters(
  period: ReleasePeriod,
  genres: string[],
  type: ReleaseTypeFilter,
  sort: ReleaseSort,
): boolean {
  return period !== '7d' || genres.length > 0 || type !== 'all' || sort !== 'newest';
}

function isDefaultSearch(
  period: ReleasePeriod,
  genres: string[],
  type: ReleaseTypeFilter,
  sort: ReleaseSort,
): boolean {
  return period === '7d' && genres.length === 0 && type === 'all' && sort === 'newest';
}

function getPeriodLabel(period: ReleasePeriod, t: Translation): string {
  return t.periods[period];
}

function getReleaseTypeLabel(type: ReleaseTypeFilter | Release['type'], t: Translation): string {
  return t.releaseTypes[type] ?? t.releaseTypes.unknown;
}

function getReleaseSortLabel(sort: ReleaseSort, t: Translation): string {
  return t.sorts[sort === 'less-popular' ? 'lessPopular' : sort];
}

function getStoredReleaseSearchState(storage: Storage = window.localStorage): ReleaseSearchState {
  const rawValue = storage.getItem(RELEASE_SEARCH_STORAGE_KEY);

  if (!rawValue) {
    return DEFAULT_SEARCH_STATE;
  }

  try {
    const parsedValue = JSON.parse(rawValue) as Partial<ReleaseSearchState>;

    return {
      period: isReleasePeriod(parsedValue.period) ? parsedValue.period : DEFAULT_SEARCH_STATE.period,
      genres: getStoredGenres(parsedValue),
      type: isReleaseTypeFilter(parsedValue.type) ? parsedValue.type : DEFAULT_SEARCH_STATE.type,
      sort: isReleaseSort(parsedValue.sort) ? parsedValue.sort : DEFAULT_SEARCH_STATE.sort,
    };
  } catch {
    return DEFAULT_SEARCH_STATE;
  }
}

function getStoredGenres(value: Partial<ReleaseSearchState> & { genre?: unknown }): string[] {
  if (Array.isArray(value.genres)) {
    return value.genres.filter((genre): genre is string => typeof genre === 'string' && genre.trim().length > 0);
  }

  return typeof value.genre === 'string' && value.genre.trim().length > 0 ? [value.genre] : DEFAULT_SEARCH_STATE.genres;
}

function isReleasePeriod(value: unknown): value is ReleasePeriod {
  return value === '7d' || value === '14d' || value === '1m';
}

function isReleaseTypeFilter(value: unknown): value is ReleaseTypeFilter {
  return value === 'all' || value === 'single' || value === 'album' || value === 'compilation';
}

function isReleaseSort(value: unknown): value is ReleaseSort {
  return value === 'newest' || value === 'oldest' || value === 'popular' || value === 'less-popular';
}

function createRandomStartSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

function getGenreLabel(genre: string, t: Translation): string {
  return genre === NO_GENRE_FILTER ? t.filters.noGenre : genre;
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
