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
const MOBILE_BREAKPOINT = 768;
const DESKTOP_SIDEBAR_BREAKPOINT = 1024;
const GENRE_SEARCH_DEBOUNCE_MS = 180;
const COMPACT_HEADER_SCROLL_THRESHOLD = 56;
const VIRTUAL_RELEASE_ROW_HEIGHT = 92;
const VIRTUAL_RELEASE_OVERSCAN = 8;
const RELEASE_ROUTE_PREFIX = '/releases/';
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
  const [initialSearchState] = useState<ReleaseSearchState>(() => getInitialReleaseSearchState(window.location));
  const [initialLanguage] = useState<Language>(() => getInitialLanguage(window.location));
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname));
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [period, setPeriod] = useState<ReleasePeriod>(initialSearchState.period);
  const [genres, setGenres] = useState<string[]>(initialSearchState.genres);
  const [type, setType] = useState<ReleaseTypeFilter>(initialSearchState.type);
  const [sort, setSort] = useState<ReleaseSort>(initialSearchState.sort);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [randomStartSeed] = useState(() => createRandomStartSeed());
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [releases, setReleases] = useState<Release[]>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    hasNextPage: false,
  });
  const [status, setStatus] = useState<RequestStatus>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const [genreOptions, setGenreOptions] = useState<GenreOption[]>([]);
  const [scrollPosition, setScrollPosition] = useState({ top: 0, height: window.innerHeight });
  const filterPanelRef = useRef<HTMLElement | null>(null);
  const releaseListRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const t = translations[language];
  const isMobile = viewportWidth < MOBILE_BREAKPOINT;
  const isDesktopSidebar = viewportWidth >= DESKTOP_SIDEBAR_BREAKPOINT;
  const isCompactHeaderVisible = scrollPosition.top > COMPACT_HEADER_SCROLL_THRESHOLD;

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(RELEASE_SEARCH_STORAGE_KEY, JSON.stringify({ period, genres, type, sort }));
  }, [genres, period, sort, type]);

  useEffect(() => {
    function handlePopState(): void {
      applyLocationState(window.location);
      setRoute(getRouteFromPath(window.location.pathname));
    }

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  useEffect(() => {
    if (route.view !== 'search') {
      return;
    }

    const nextUrl = buildSearchUrl({ period, genres, type, sort }, language);
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (currentUrl !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [genres, language, period, route.view, sort, type]);

  useEffect(() => {
    function updateViewport(): void {
      setViewportWidth(window.innerWidth);
    }

    updateViewport();
    window.addEventListener('resize', updateViewport);

    return () => {
      window.removeEventListener('resize', updateViewport);
    };
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsFiltersOpen(false);
      setIsSettingsOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!isFiltersOpen && !isSettingsOpen && !isHowItWorksOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFiltersOpen, isSettingsOpen, isHowItWorksOpen]);

  useEffect(() => {
    const controller = new AbortController();

    setStatus(page === 1 ? 'loading' : 'loadingMore');

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
        type === 'all' ? undefined : getReleaseTypeFilterLabel(type, t),
        sort === 'newest' ? undefined : getReleaseSortLabel(sort, t),
      ].filter(isPresent),
    [genres, period, sort, t, type],
  );
  const summaryText = t.results.summary(pagination.total, summaryFilters);
  const isInitialLoading = status === 'loading' && releases.length === 0;
  const isRefreshing = status === 'loading' && releases.length > 0;
  const isSummaryUpdating = status === 'loading' || status === 'loadingMore';
  const desktopSummaryText = isInitialLoading ? t.results.loadingSummary(summaryFilters) : summaryText;
  const mobileSummaryText = isInitialLoading
    ? t.results.loadingSummary(getMobileSummaryContext(period, genres, t))
    : getMobileSummaryText(pagination.total, period, genres, t);
  const mobileActiveFilterCount = getMobileActiveFilterCount(period, genres, type, sort);
  const virtualRange = getVirtualReleaseRange(releases.length, scrollPosition, releaseListRef.current);
  const visibleReleases = releases.slice(virtualRange.startIndex, virtualRange.endIndex);

  if (route.view === 'release') {
    const release = releases.find((item) => item.id === route.releaseId);

    return (
      <ReleaseDetail
        isLoading={status === 'loading' || status === 'loadingMore'}
        release={release}
        language={language}
        isMobile={isMobile}
        t={t}
        onBack={goBackToSearch}
        onLanguageChange={setLanguage}
      />
    );
  }

  return (
    <main className={isCompactHeaderVisible ? 'appShell hasCompactHeader' : 'appShell'}>
      {isCompactHeaderVisible && (
        <section className="compactTopBar" aria-label={t.app.title}>
          <span className="compactTopBarTitle">{t.app.title}</span>
          <button type="button" className="secondaryButton compactTopBarButton" onClick={openFilterControls}>
            {t.filters.filters}
          </button>
        </section>
      )}

      <header className="appHeader">
        <div className="headerBrand">
          {!isMobile && <p className="eyebrow">{t.app.eyebrow}</p>}
          <h1>{t.app.title}</h1>
          <p>{isMobile ? t.app.shortDescription : t.app.description}</p>
        </div>
        <div className={isMobile ? 'headerActions mobileHeaderActions' : 'headerActions'}>
          <button type="button" className="navLink headerLink" onClick={openAbout}>
            {t.app.howItWorks}
          </button>
          {isMobile ? (
            <button
              type="button"
              className="iconButton headerIconButton"
              aria-haspopup="dialog"
              aria-expanded={isSettingsOpen}
              aria-label={t.app.settings}
              onClick={() => setIsSettingsOpen(true)}
            >
              &#9881;
            </button>
          ) : (
            <LanguageSwitcher language={language} t={t} onChange={setLanguage} />
          )}
        </div>
      </header>

      <div className={isDesktopSidebar ? 'searchLayout isDesktopSidebar' : 'searchLayout'}>
        <aside className="searchSidebar">
          <section className="filterPanel" aria-label={t.filters.aria} ref={filterPanelRef}>
            <div className="filterPanelHeader">
              <p className="filterGroupTitle">{t.filters.filters}</p>
              {isMobile && (
                <button
                  type="button"
                  className="secondaryButton compactFilterButton"
                  aria-haspopup="dialog"
                  aria-expanded={isFiltersOpen}
                  onClick={() => setIsFiltersOpen(true)}
                >
                  <span>{t.filters.moreFilters}</span>
                  <span className="compactFilterValue">{getMobileFilterSummary(type, sort, t)}</span>
                </button>
              )}
            </div>

            <div className="primaryFilters">
              <PeriodFilter period={period} t={t} onChange={updatePeriod} />
              <GenreFilter
                isMobile={isMobile}
                selectedGenres={genres}
                genreOptions={genreOptions}
                t={t}
                onChange={updateGenres}
              />
            </div>

            {!isMobile && (
              <div className="desktopSecondaryFilters">
                <TypeFilter type={type} t={t} onChange={updateType} />
                {!isDesktopSidebar && <SortFilter sort={sort} t={t} onChange={updateSort} />}
              </div>
            )}
          </section>
        </aside>

        <div className="searchContent">
          {!isMobile && (
            <section className="resultsHeader" aria-live="polite">
              <div className="resultsSummaryBlock">
                <p>
                  {desktopSummaryText}
                  {isSummaryUpdating && <span className="summaryLoadingIndicator">{t.results.updating}</span>}
                </p>
              </div>
              <div className="resultsToolbar">
                {isDesktopSidebar && <SortFilter sort={sort} t={t} onChange={updateSort} />}
                {hasActiveFilters(period, genres, type, sort) && (
                  <button type="button" className="ghostButton resultsResetButton" onClick={resetFilters}>
                    {t.filters.reset}
                  </button>
                )}
              </div>
            </section>
          )}

          {isMobile && (
            <section className="stickySummaryBar" aria-live="polite">
              <div className="stickySummaryContent">
                <p className="stickySummaryText">{mobileSummaryText}</p>
                {isSummaryUpdating && <span className="summaryLoadingIndicator">{t.results.updating}</span>}
                {mobileActiveFilterCount > 0 && (
                  <span className="stickySummaryIndicator">{t.filters.activeFilters(mobileActiveFilterCount)}</span>
                )}
              </div>
              <div className="stickySummaryActions">
                <button
                  type="button"
                  className="secondaryButton stickySummaryButton"
                  aria-haspopup="dialog"
                  aria-expanded={isFiltersOpen}
                  onClick={() => setIsFiltersOpen(true)}
                >
                  {t.filters.filters}
                </button>
                {hasActiveFilters(period, genres, type, sort) && (
                  <button type="button" className="ghostButton stickyResetButton" onClick={resetFilters}>
                    {t.filters.resetShort}
                  </button>
                )}
              </div>
            </section>
          )}

          <section className="releaseList" aria-label={t.filters.aria} ref={releaseListRef}>
        {isInitialLoading && <ReleaseSkeleton />}

        {status === 'error' && releases.length === 0 && (
          <div className="statePanel" role="alert">
            <h2>{t.results.errorTitle}</h2>
            <p>{t.results.errorDescription}</p>
            <button type="button" onClick={retry}>
              {t.results.retry}
            </button>
          </div>
        )}

        {status === 'success' && releases.length === 0 && (
          <div className="statePanel">
            <h2>{t.results.noTitle}</h2>
            <p>{t.results.noDescription}</p>
            <div className="stateActions">
              <button type="button" className="secondaryButton" disabled={genres.length === 0} onClick={clearSelectedGenres}>
                {t.filters.clearGenres}
              </button>
              <button type="button" className="ghostButton" onClick={resetFilters}>
                {t.filters.resetAll}
              </button>
              <button type="button" onClick={useMonth}>
                {t.results.useMonth}
              </button>
            </div>
          </div>
        )}

        {releases.length > 0 && (
          <>
            <div className={isRefreshing ? 'virtualReleaseList isRefreshing' : 'virtualReleaseList'} style={{ height: virtualRange.totalHeight }}>
              <div
                className="virtualReleaseItems"
                style={{ transform: `translateY(${virtualRange.offsetTop}px)` }}
              >
                {visibleReleases.map((release) => (
                  <ReleaseRow release={release} key={release.id} t={t} onSelect={() => openRelease(release)} />
                ))}
              </div>
            </div>
            {isRefreshing && (
              <div className="refreshSkeletonStack" aria-hidden="true">
                <ReleaseSkeleton count={2} />
              </div>
            )}
          </>
        )}

        {status === 'error' && releases.length > 0 && (
          <div className="inlineError" role="alert">
            <span>{t.results.errorDescription}</span>
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
        </div>
      </div>

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
      <MobileSettingsSheet
        isOpen={isSettingsOpen}
        language={language}
        t={t}
        onClose={() => setIsSettingsOpen(false)}
        onLanguageChange={setLanguage}
      />
      <HowItWorksDialog isMobile={isMobile} isOpen={isHowItWorksOpen} t={t} onClose={() => setIsHowItWorksOpen(false)} />
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
    resetResults();
  }

  function updateSort(nextSort: ReleaseSort): void {
    setSort(nextSort);
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
  }

  function retry(): void {
    setRetryCount((current) => current + 1);
  }

  function clearSelectedGenres(): void {
    if (genres.length === 0) {
      return;
    }

    setGenres([]);
    resetResults();
  }

  function useMonth(): void {
    if (period === '1m') {
      return;
    }

    setPeriod('1m');
    resetResults();
  }

  function openRelease(release: Release): void {
    const nextPath = getReleasePath(release.id, { period, genres, type, sort }, language);

    window.history.pushState(null, '', nextPath);
    setRoute({ view: 'release', releaseId: release.id });
  }

  function goBackToSearch(): void {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.history.pushState(null, '', buildSearchUrl({ period, genres, type, sort }, language));
    setRoute({ view: 'search' });
  }

  function openAbout(): void {
    setIsFiltersOpen(false);
    setIsSettingsOpen(false);
    setIsHowItWorksOpen(true);
  }

  function openFilterControls(): void {
    if (isMobile) {
      setIsFiltersOpen(true);
      return;
    }

    filterPanelRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }

  function applyLocationState(location: Location): void {
    const nextSearchState = getInitialReleaseSearchState(location);
    const nextLanguage = getInitialLanguage(location);

    setPeriod(nextSearchState.period);
    setGenres(nextSearchState.genres);
    setType(nextSearchState.type);
    setSort(nextSearchState.sort);
    setLanguage(nextLanguage);
    setPage(1);
  }
}

type PeriodFilterProps = {
  period: ReleasePeriod;
  t: Translation;
  onChange: (period: ReleasePeriod) => void;
};

function PeriodFilter({ period, t, onChange }: PeriodFilterProps) {
  return (
    <SegmentedControl
      label={t.filters.period}
      value={period}
      options={[
        { value: '7d', label: t.filters.periodOptions['7d'] },
        { value: '14d', label: t.filters.periodOptions['14d'] },
        { value: '1m', label: t.filters.periodOptions['1m'] },
      ]}
      onChange={onChange}
    />
  );
}

type GenreFilterProps = {
  isMobile: boolean;
  selectedGenres: string[];
  genreOptions: GenreOption[];
  t: Translation;
  onChange: (genres: string[]) => void;
};

function GenreFilter({ isMobile, selectedGenres, genreOptions, t, onChange }: GenreFilterProps) {
  const [query, setQuery] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const debouncedQuery = useDebouncedValue(normalizedQuery, GENRE_SEARCH_DEBOUNCE_MS);
  const visibleOptions = genreOptions.filter((option) => getGenreLabel(option.name, t).toLowerCase().includes(debouncedQuery));
  const showOptions = !isMobile || isExpanded || normalizedQuery.length > 0;

  useEffect(() => {
    if (!isMobile) {
      setIsExpanded(true);
      return;
    }

    setIsExpanded(false);
  }, [isMobile]);

  return (
    <div className="genreSelector filterField">
      <div className="fieldHeader">
        <span className="fieldLabel">{t.filters.genre}</span>
        {isMobile && (
          <button
            type="button"
            className="inlineFilterButton"
            aria-expanded={showOptions}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {showOptions ? t.filters.hideGenres : t.filters.browseGenres}
          </button>
        )}
      </div>
      <div className="genreSearchField">
        <input
          type="search"
          value={query}
          placeholder={t.filters.searchGenres}
          onFocus={() => setIsExpanded(true)}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {selectedGenres.length > 0 && (
        <div className="selectedGenreBar">
          <div className="selectedGenreChips" aria-label={t.filters.selectedGenres}>
            {selectedGenres.map((genre) => (
              <button type="button" className="genreChip" key={genre} onClick={() => toggleGenre(genre)}>
                {getGenreLabel(genre, t)} x
              </button>
            ))}
          </div>
          <button type="button" className="clearGenresButton" onClick={clearGenres}>
            {t.filters.clearGenres}
          </button>
        </div>
      )}
      {showOptions && (
        <>
          <div className="genreOptionList" role="list" aria-label={t.filters.genreResults}>
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => (
                <label className="genreOption" key={`${option.kind}-${option.name}`}>
                  <input
                    type="checkbox"
                    checked={selectedGenres.includes(option.name)}
                    onChange={() => toggleGenre(option.name)}
                  />
                  <span className="genreOptionLabel">{getGenreLabel(option.name, t)}</span>
                  <span className="genreCount">
                    <span className="genreCountValue">{option.releaseCount}</span>
                    <span>{t.filters.releasesCount}</span>
                  </span>
                </label>
              ))
            ) : (
              <div className="genreEmptyState">{t.filters.noGenresFound}</div>
            )}
          </div>
          <p className="genreHelperText">{t.filters.countsHelp}</p>
        </>
      )}
    </div>
  );

  function toggleGenre(nextGenre: string): void {
    if (selectedGenres.includes(nextGenre)) {
      onChange(selectedGenres.filter((genre) => genre !== nextGenre));
      return;
    }

    onChange([...selectedGenres, nextGenre]);
  }

  function clearGenres(): void {
    onChange([]);
  }
}

type TypeFilterProps = {
  type: ReleaseTypeFilter;
  t: Translation;
  onChange: (type: ReleaseTypeFilter) => void;
};

function TypeFilter({ type, t, onChange }: TypeFilterProps) {
  return (
    <SegmentedControl
      label={t.filters.type}
      value={type}
      options={[
        { value: 'all', label: t.filters.typeOptions.all },
        { value: 'single', label: t.filters.typeOptions.single },
        { value: 'album', label: t.filters.typeOptions.album },
        { value: 'compilation', label: t.filters.typeOptions.compilation },
      ]}
      onChange={onChange}
    />
  );
}

type SortFilterProps = {
  sort: ReleaseSort;
  t: Translation;
  onChange: (sort: ReleaseSort) => void;
};

function SortFilter({ sort, t, onChange }: SortFilterProps) {
  return (
    <label className="filterField">
      <span className="fieldLabel">{t.filters.sorting}</span>
      <select value={sort} onChange={(event) => onChange(event.target.value as ReleaseSort)}>
        <option value="newest">{t.sorts.newest}</option>
        <option value="oldest">{t.sorts.oldest}</option>
        <option value="popular">{t.sorts.popular}</option>
        <option value="less-popular">{t.sorts.lessPopular}</option>
      </select>
    </label>
  );
}

type MobileFiltersSheetProps = {
  isOpen: boolean;
  type: ReleaseTypeFilter;
  t: Translation;
  sort: ReleaseSort;
  onClose: () => void;
  onTypeChange: (type: ReleaseTypeFilter) => void;
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
      <section className="bottomSheet" role="dialog" aria-modal="true" aria-label={t.filters.moreFilters}>
        <div className="sheetHeader">
          <h2>{t.filters.moreFilters}</h2>
          <button type="button" className="iconButton" aria-label={t.filters.close} onClick={onClose}>
            x
          </button>
        </div>
        <div className="sheetFilters">
          <TypeFilter type={type} t={t} onChange={onTypeChange} />
          <SortOptions sort={sort} t={t} onChange={onSortChange} />
        </div>
        <button type="button" className="ghostButton fullWidthButton" onClick={onReset}>
          {t.filters.reset}
        </button>
      </section>
    </div>
  );
}

type MobileSettingsSheetProps = {
  isOpen: boolean;
  language: Language;
  t: Translation;
  onClose: () => void;
  onLanguageChange: (language: Language) => void;
};

function MobileSettingsSheet({
  isOpen,
  language,
  t,
  onClose,
  onLanguageChange,
}: MobileSettingsSheetProps) {
  return (
    <div className="sheetLayer" hidden={!isOpen}>
      <button type="button" className="sheetBackdrop" aria-label={t.filters.close} onClick={onClose} />
      <section className="bottomSheet settingsSheet" role="dialog" aria-modal="true" aria-label={t.app.settings}>
        <div className="sheetHeader">
          <h2>{t.app.settings}</h2>
          <button type="button" className="iconButton" aria-label={t.filters.close} onClick={onClose}>
            x
          </button>
        </div>
        <LanguageSwitcher language={language} t={t} onChange={onLanguageChange} />
      </section>
    </div>
  );
}

type SegmentedControlOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type SegmentedControlProps<TValue extends string> = {
  label: string;
  value: TValue;
  options: SegmentedControlOption<TValue>[];
  onChange: (value: TValue) => void;
};

function SegmentedControl<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<TValue>) {
  return (
    <div className="filterField">
      <span className="fieldLabel">{label}</span>
      <div className="segmentedControl" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={value === option.value ? 'segmentButton isActive' : 'segmentButton'}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function SortOptions({ sort, t, onChange }: SortFilterProps) {
  return (
    <div className="filterField">
      <span className="fieldLabel">{t.filters.sorting}</span>
      <div className="sheetOptionList" role="group" aria-label={t.filters.sorting}>
        {[
          { value: 'newest', label: t.sorts.newest },
          { value: 'oldest', label: t.sorts.oldest },
          { value: 'popular', label: t.sorts.popular },
          { value: 'less-popular', label: t.sorts.lessPopular },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={sort === option.value ? 'sheetOption isActive' : 'sheetOption'}
            aria-pressed={sort === option.value}
            onClick={() => onChange(option.value as ReleaseSort)}
          >
            <span>{option.label}</span>
            {sort === option.value && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
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
        <ReleaseCover coverUrl={release.coverUrl} title={release.title} t={t} />
        <span className="releaseInfo">
          <span className="releaseTitle">{release.title}</span>
          <span className="releaseArtist">{formatArtists(release, t)}</span>
          <span className="releaseMeta">
            <span className="releaseDateMeta">{formatUnknown(release.releaseDate, t)}</span>
            <span className="releaseTypeBadge">{getReleaseTypeLabel(release.type, t)}</span>
          </span>
        </span>
        <span className="chevron" aria-hidden="true">
          &rsaquo;
        </span>
      </button>
    </article>
  );
}

type ReleaseCoverProps = {
  coverUrl: string | null;
  title: string;
  t: Translation;
};

function ReleaseCover({ coverUrl, title, t }: ReleaseCoverProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
  }, [coverUrl]);

  if (!coverUrl) {
    return (
      <span className="coverFrame" aria-hidden="true">
        <span className="coverPlaceholder" />
      </span>
    );
  }

  return (
    <span className="coverFrame">
      <span className={isLoaded ? 'coverPlaceholder isHidden' : 'coverPlaceholder'} aria-hidden="true" />
      <img
        className={isLoaded ? 'coverImage isLoaded' : 'coverImage'}
        src={coverUrl}
        alt={t.release.coverAlt(title)}
        loading="lazy"
        onLoad={() => setIsLoaded(true)}
      />
    </span>
  );
}

type ReleaseDetailProps = {
  isLoading: boolean;
  release: Release | undefined;
  language: Language;
  isMobile: boolean;
  t: Translation;
  onBack: () => void;
  onLanguageChange: (language: Language) => void;
};

function ReleaseDetail({ isLoading, release, language, isMobile, t, onBack, onLanguageChange }: ReleaseDetailProps) {
  if (!release) {
    return (
      <main className="appShell detailShell">
        <ReleaseDetailTopBar
          releaseTitle={isLoading ? t.release.loadingTitle : t.release.notLoadedTitle}
          spotifyUrl={undefined}
          t={t}
          onBack={onBack}
        />
        <section className="statePanel" role="status">
          <h1>{isLoading ? t.release.loadingTitle : t.release.notLoadedTitle}</h1>
          <p>{isLoading ? t.release.loadingDescription : t.release.notLoadedDescription}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell detailShell">
      <ReleaseDetailTopBar releaseTitle={release.title} spotifyUrl={release.spotifyUrl} t={t} onBack={onBack} />
      <section className="releaseDetail" aria-label={t.release.detailsAria}>
        <div className="detailHero">
          {release.coverUrl ? (
            <img className="detailCover" src={release.coverUrl} alt="" />
          ) : (
            <div className="detailCover coverPlaceholder" aria-label={t.release.noCover} role="img" />
          )}
        </div>
        <div className="detailContent">
          <div className="detailHeading">
            <span className="releaseTypeBadge detailTypeBadge">{getReleaseTypeLabel(release.type, t)}</span>
            {!isMobile && (
              <LanguageSwitcher language={language} t={t} onChange={onLanguageChange} />
            )}
          </div>
          <h1>{release.title}</h1>
          <p className="detailArtist">{formatArtists(release, t)}</p>
          <div className="detailActions">
            {release.spotifyUrl && (
              <a className="spotifyLink detailPrimaryAction" href={release.spotifyUrl} target="_blank" rel="noreferrer">
                {t.release.openSpotify}
              </a>
            )}
            <button type="button" className="ghostButton detailSecondaryAction" onClick={onBack}>
              {t.release.backToResults}
            </button>
          </div>
          <dl className="detailMetaCard">
            <div className="detailMetaItem">
              <dt>{t.release.releaseDate}</dt>
              <dd>{formatUnknown(release.releaseDate, t)}</dd>
            </div>
            <div className="detailMetaItem">
              <dt>{t.release.country}</dt>
              <dd>{formatUnknown(release.country, t)}</dd>
            </div>
            <div className="detailMetaItem">
              <dt>{t.release.popularity}</dt>
              <dd>{formatNullableNumber(release.popularity, t)}</dd>
            </div>
            <div className="detailMetaItem">
              <dt>{t.release.type}</dt>
              <dd>
                <span className="releaseTypeBadge detailMetaBadge">{getReleaseTypeLabel(release.type, t)}</span>
              </dd>
            </div>
          </dl>
          <div className="detailGenresSection">
            <p className="detailSectionLabel">{t.release.genres}</p>
            <div className="selectedGenreChips detailGenreChips">
              {getReleaseGenres(release, t).map((genre) => (
                <span className="genreChip detailGenreChip" key={genre}>
                  {genre}
                </span>
              ))}
            </div>
          </div>
          <p className="shownBecause">{t.release.shownBecause}</p>
        </div>
      </section>
    </main>
  );
}

type HowItWorksDialogProps = {
  isMobile: boolean;
  isOpen: boolean;
  t: Translation;
  onClose: () => void;
};

function HowItWorksDialog({ isMobile, isOpen, t, onClose }: HowItWorksDialogProps) {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div className="sheetLayer" hidden={!isOpen}>
      <button type="button" className="sheetBackdrop" aria-label={t.about.close} onClick={onClose} />
      <section
        className={isMobile ? 'bottomSheet helpSheet' : 'dialogPanel helpModal'}
        role="dialog"
        aria-modal="true"
        aria-label={t.about.aria}
      >
        <div className="sheetHeader">
          <h2>{t.about.eyebrow}</h2>
          <button type="button" className="iconButton" aria-label={t.about.close} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="aboutPage">
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
        </div>
      </section>
    </div>
  );
}

type LanguageSwitcherProps = {
  language: Language;
  t: Translation;
  onChange: (language: Language) => void;
};

function LanguageSwitcher({ language, t, onChange }: LanguageSwitcherProps) {
  return (
    <div className="languageSwitcher">
      <span className="srOnly">{t.language.label}</span>
      <div className="segmentedControl segmentedControlCompact" role="group" aria-label={t.language.label}>
        <button
          type="button"
          className={language === 'en' ? 'segmentButton isActive' : 'segmentButton'}
          aria-label={t.language.en}
          aria-pressed={language === 'en'}
          onClick={() => onChange('en')}
        >
          {t.language.shortEn}
        </button>
        <button
          type="button"
          className={language === 'ru' ? 'segmentButton isActive' : 'segmentButton'}
          aria-label={t.language.ru}
          aria-pressed={language === 'ru'}
          onClick={() => onChange('ru')}
        >
          {t.language.shortRu}
        </button>
      </div>
    </div>
  );
}

type ReleaseDetailTopBarProps = {
  releaseTitle: string;
  spotifyUrl: string | null | undefined;
  t: Translation;
  onBack: () => void;
};

function ReleaseDetailTopBar({ releaseTitle, spotifyUrl, t, onBack }: ReleaseDetailTopBarProps) {
  return (
    <div className="pageTopBar releaseTopBar">
      <button type="button" className="backButton" onClick={onBack}>
        &larr; {t.release.back}
      </button>
      <span className="releaseTopBarTitle">{releaseTitle}</span>
      {spotifyUrl ? (
        <a className="secondaryButton releaseTopBarAction" href={spotifyUrl} target="_blank" rel="noreferrer">
          {t.release.openShort}
        </a>
      ) : (
        <span className="releaseTopBarSpacer" aria-hidden="true" />
      )}
    </div>
  );
}

function ReleaseSkeleton({ count = 3 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, item) => item).map((item) => (
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

function getReleaseTypeFilterLabel(type: ReleaseTypeFilter, t: Translation): string {
  return t.filters.typeOptions[type];
}

function getReleaseSortLabel(sort: ReleaseSort, t: Translation): string {
  return t.sorts[sort === 'less-popular' ? 'lessPopular' : sort];
}

function getMobileFilterSummary(type: ReleaseTypeFilter, sort: ReleaseSort, t: Translation): string {
  return [getReleaseTypeFilterLabel(type, t), getReleaseSortLabel(sort, t)].join(' · ');
}

function getMobileSummaryText(
  count: number,
  period: ReleasePeriod,
  genres: string[],
  t: Translation,
): string {
  const formattedCount = new Intl.NumberFormat().format(count);
  const context = getMobileSummaryContext(period, genres, t);

  return [`${formattedCount} ${t.results.releasesShort(count)}`, ...context].join(' · ');
}

function getMobileSummaryContext(period: ReleasePeriod, genres: string[], t: Translation): string[] {
  const genreLabels = genres.slice(0, 2).map((genre) => getGenreLabel(genre, t));

  return genreLabels.length > 0 ? genreLabels : [getPeriodLabel(period, t)];
}

function getMobileActiveFilterCount(
  period: ReleasePeriod,
  genres: string[],
  type: ReleaseTypeFilter,
  sort: ReleaseSort,
): number {
  return (period !== '7d' ? 1 : 0) + genres.length + (type !== 'all' ? 1 : 0) + (sort !== 'newest' ? 1 : 0);
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

function getInitialReleaseSearchState(location: Location, storage: Storage = window.localStorage): ReleaseSearchState {
  const storedState = getStoredReleaseSearchState(storage);
  const searchParams = new URLSearchParams(location.search);
  const rawPeriod = searchParams.get('period');
  const rawType = searchParams.get('type');
  const rawSort = searchParams.get('sort');
  const genres = getUrlGenres(searchParams);

  return {
    period: isReleasePeriod(rawPeriod) ? rawPeriod : storedState.period,
    genres: genres ?? storedState.genres,
    type: isReleaseTypeFilter(rawType) ? rawType : storedState.type,
    sort: isReleaseSort(rawSort) ? rawSort : storedState.sort,
  };
}

function getInitialLanguage(location: Location, storage: Storage = window.localStorage): Language {
  const searchParams = new URLSearchParams(location.search);
  const rawLanguage = searchParams.get('lang');

  return rawLanguage === 'en' || rawLanguage === 'ru' ? rawLanguage : getStoredLanguage(storage);
}

function getUrlGenres(searchParams: URLSearchParams): string[] | undefined {
  const rawGenres = searchParams.getAll('genre').map((genre) => genre.trim()).filter(Boolean);

  if (rawGenres.length > 0) {
    return rawGenres;
  }

  const rawGenresParam = searchParams.get('genres');

  if (!rawGenresParam) {
    return undefined;
  }

  const parsedGenres = rawGenresParam
    .split(',')
    .map((genre) => genre.trim())
    .filter(Boolean);

  return parsedGenres.length > 0 ? parsedGenres : [];
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

function useDebouncedValue<TValue>(value: TValue, delayMs: number): TValue {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [delayMs, value]);

  return debouncedValue;
}

function formatArtists(release: Release, t: Translation): string {
  return release.artists.map((artist) => artist.name).join(', ') || t.release.unknownArtist;
}

function formatList(values: string[], t: Translation): string {
  const normalized = values.map((value) => value.trim()).filter(Boolean);

  return normalized.length > 0 ? normalized.join(', ') : t.release.unknown;
}

function getReleaseGenres(release: Release, t: Translation): string[] {
  const normalized = release.genres.map((genre) => genre.trim()).filter(Boolean);

  return normalized.length > 0 ? normalized : [t.release.unknown];
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

function getReleasePath(
  releaseId: string,
  searchState: ReleaseSearchState,
  language: Language,
): string {
  return `${RELEASE_ROUTE_PREFIX}${encodeURIComponent(releaseId)}${buildSearchQuery(searchState, language)}`;
}

function buildSearchUrl(searchState: ReleaseSearchState, language: Language): string {
  return `/${buildSearchQuery(searchState, language)}`;
}

function buildSearchQuery(searchState: ReleaseSearchState, language: Language): string {
  const params = new URLSearchParams({
    period: searchState.period,
    type: searchState.type,
    sort: searchState.sort,
  });

  searchState.genres.forEach((genre) => {
    const normalizedGenre = genre.trim();

    if (normalizedGenre) {
      params.append('genre', normalizedGenre);
    }
  });

  if (language !== 'en') {
    params.set('lang', language);
  }

  const query = params.toString();

  return query ? `?${query}` : '';
}

function getRouteFromPath(pathname: string): AppRoute {
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
