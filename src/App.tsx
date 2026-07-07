import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import './App.css';
import type { CountryOption, GenreOption } from './api/releasesApi';
import type { InsightListItem, InsightsData, InsightsPeriod, InsightsType } from './domain/insights';
import type { Release, ReleasePeriod, ReleaseSort, ReleaseTypeFilter } from './domain/release';
import { NO_GENRE_FILTER } from './domain/topLevelGenres';
import {
  getStoredLanguage,
  LANGUAGE_STORAGE_KEY,
  translations,
  type Language,
  type Translation,
} from './i18n';
import { fetchInsights } from './insightsClient';
import { fetchReleases } from './releasesClient';

const PAGE_LIMIT = 20;
const MOBILE_BREAKPOINT = 768;
const DESKTOP_SIDEBAR_BREAKPOINT = 1024;
const MAX_VISIBLE_SELECTED_GENRES = 5;
const VIRTUAL_RELEASE_ROW_HEIGHT = 92;
const VIRTUAL_RELEASE_OVERSCAN = 8;
const RELEASE_ROUTE_PREFIX = '/releases/';
const RELEASE_SEARCH_STORAGE_KEY = 'fresh-drop-release-search-state';
const DEFAULT_SEARCH_STATE: ReleaseSearchState = {
  period: '7d',
  genres: [],
  countries: [],
  popularityMin: undefined,
  popularityMax: undefined,
  type: 'all',
  sort: 'newest',
};
const DEFAULT_INSIGHTS_FILTERS: InsightsFilters = {
  period: 30,
  type: 'all',
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
      view: 'insights';
    }
  | {
      view: 'release';
      releaseId: string;
    };

type ReleaseSearchState = {
  period: ReleasePeriod;
  genres: string[];
  countries: string[];
  popularityMin?: number;
  popularityMax?: number;
  type: ReleaseTypeFilter;
  sort: ReleaseSort;
};

type InsightsFilters = {
  period: InsightsPeriod;
  type: InsightsType;
};

type InsightsReturnState = {
  period: InsightsPeriod;
  type: InsightsType;
  insightId?: string;
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
  const [initialInsightsFilters] = useState<InsightsFilters>(() => getInitialInsightsFilters(window.location));
  const [initialLanguage] = useState<Language>(() => getInitialLanguage(window.location));
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromPath(window.location.pathname));
  const [language, setLanguage] = useState<Language>(initialLanguage);
  const [period, setPeriod] = useState<ReleasePeriod>(initialSearchState.period);
  const [genres, setGenres] = useState<string[]>(initialSearchState.genres);
  const [countries, setCountries] = useState<string[]>(initialSearchState.countries);
  const [popularityMin, setPopularityMin] = useState<number | undefined>(initialSearchState.popularityMin);
  const [popularityMax, setPopularityMax] = useState<number | undefined>(initialSearchState.popularityMax);
  const [type, setType] = useState<ReleaseTypeFilter>(initialSearchState.type);
  const [sort, setSort] = useState<ReleaseSort>(initialSearchState.sort);
  const [insightsPeriod, setInsightsPeriod] = useState<InsightsPeriod>(initialInsightsFilters.period);
  const [insightsType, setInsightsType] = useState<InsightsType>(initialInsightsFilters.type);
  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [insightsStatus, setInsightsStatus] = useState<RequestStatus>('loading');
  const [insightsRetryCount, setInsightsRetryCount] = useState(0);
  const [insightsReturn, setInsightsReturn] = useState<InsightsReturnState | null>(() => getInsightsReturnState(window.location));
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
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([]);
  const [scrollPosition, setScrollPosition] = useState({ top: 0, height: window.innerHeight });
  const filterPanelRef = useRef<HTMLElement | null>(null);
  const releaseListRef = useRef<HTMLElement | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isNextPageScheduledRef = useRef(false);
  const searchScrollRestoreRef = useRef<number | null>(null);
  const currentSearchStateRef = useRef<ReleaseSearchState>(initialSearchState);
  const currentLanguageRef = useRef<Language>(initialLanguage);
  const lastReleaseRequestKeyRef = useRef<string | null>(null);
  const t = translations[language];
  const isMobile = viewportWidth < MOBILE_BREAKPOINT;
  const isDesktopSidebar = viewportWidth >= DESKTOP_SIDEBAR_BREAKPOINT;
  const isBackToTopVisible = scrollPosition.top > scrollPosition.height * 2;

  useEffect(() => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(RELEASE_SEARCH_STORAGE_KEY, JSON.stringify({ period, genres, countries, popularityMin, popularityMax, type, sort }));
  }, [countries, genres, period, popularityMax, popularityMin, sort, type]);

  useEffect(() => {
    currentSearchStateRef.current = { period, genres, countries, popularityMin, popularityMax, type, sort };
    currentLanguageRef.current = language;
  }, [countries, genres, language, period, popularityMax, popularityMin, sort, type]);

  useEffect(() => {
    if (!('scrollRestoration' in window.history)) {
      return undefined;
    }

    const previousScrollRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';

    return () => {
      window.history.scrollRestoration = previousScrollRestoration;
    };
  }, []);

  useEffect(() => {
    function handlePopState(event: PopStateEvent): void {
      const nextRoute = getRouteFromPath(window.location.pathname);
      const nextSearchState = getInitialReleaseSearchState(window.location);
      const nextInsightsFilters = getInitialInsightsFilters(window.location);
      const nextLanguage = getInitialLanguage(window.location);
      const shouldPreserveLoadedSearch =
        nextRoute.view === 'search' &&
        areSearchStatesEqual(nextSearchState, currentSearchStateRef.current) &&
        nextLanguage === currentLanguageRef.current;

      searchScrollRestoreRef.current = nextRoute.view === 'search' ? getSavedSearchScrollPosition(event.state) : null;

      if (!shouldPreserveLoadedSearch) {
        applySearchState(nextSearchState, nextLanguage);
      }

      setInsightsPeriod(nextInsightsFilters.period);
      setInsightsType(nextInsightsFilters.type);
      setInsightsReturn(getInsightsReturnState(window.location));
      setRoute(nextRoute);
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

    const nextUrl = buildSearchUrl({ period, genres, countries, popularityMin, popularityMax, type, sort }, language, insightsReturn);
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (currentUrl !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [countries, genres, insightsReturn, language, period, popularityMax, popularityMin, route.view, sort, type]);

  useEffect(() => {
    if (route.view !== 'insights') {
      return;
    }

    const nextUrl = buildInsightsUrl({ period: insightsPeriod, type: insightsType }, language);
    const currentUrl = `${window.location.pathname}${window.location.search}`;

    if (currentUrl !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  }, [insightsPeriod, insightsType, language, route.view]);

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
    if (route.view !== 'search') {
      return undefined;
    }

    const requestKey = getReleaseRequestKey({
      period,
      genres,
      countries,
      popularityMin,
      popularityMax,
      type,
      sort,
      page,
      retryCount,
    });

    if (lastReleaseRequestKeyRef.current === requestKey && status === 'success') {
      return undefined;
    }

    lastReleaseRequestKeyRef.current = requestKey;

    const controller = new AbortController();

    setStatus(page === 1 ? 'loading' : 'loadingMore');

    fetchReleases(
      {
        period,
        genres,
        countries,
        popularityMin,
        popularityMax,
        type,
        sort,
        page,
        limit: PAGE_LIMIT,
        randomStartSeed: isDefaultSearch(period, genres, countries, popularityMin, popularityMax, type, sort) ? randomStartSeed : undefined,
      },
      { signal: controller.signal },
    )
      .then((response) => {
        isNextPageScheduledRef.current = false;
        setReleases((current) => (page === 1 ? response.items : mergeReleases(current, response.items)));
        setPagination(response.pagination);
        setGenreOptions(response.genres);
        setCountryOptions(response.countries ?? []);
        setStatus('success');
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        isNextPageScheduledRef.current = false;
        setStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [countries, genres, page, period, popularityMax, popularityMin, randomStartSeed, retryCount, route.view, sort, type]);

  useEffect(() => {
    if (route.view !== 'insights') {
      return undefined;
    }

    const controller = new AbortController();

    setInsightsStatus('loading');

    fetchInsights(
      {
        period: insightsPeriod,
        type: insightsType,
      },
      { signal: controller.signal },
    )
      .then((response) => {
        setInsightsData(response);
        setInsightsStatus('success');
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) {
          return;
        }

        setInsightsStatus('error');
      });

    return () => {
      controller.abort();
    };
  }, [insightsPeriod, insightsRetryCount, insightsType, route.view]);

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
    if (route.view !== 'search' || searchScrollRestoreRef.current === null) {
      return;
    }

    const nextScrollTop = searchScrollRestoreRef.current;

    searchScrollRestoreRef.current = null;
    setScrollPosition({
      top: nextScrollTop,
      height: window.innerHeight,
    });
    window.scrollTo({
      top: nextScrollTop,
      behavior: 'auto',
    });
  }, [releases.length, route.view]);

  useEffect(() => {
    function requestNextPage(): void {
      if (isNextPageScheduledRef.current) {
        return;
      }

      isNextPageScheduledRef.current = true;
      setPage((current) => current + 1);
    }

    const target = loadMoreRef.current;

    if (!target || !pagination.hasNextPage || status !== 'success') {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          requestNextPage();
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

  useEffect(() => {
    if (route.view !== 'search' || status !== 'success' || !pagination.hasNextPage) {
      return;
    }

    const documentHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight,
    );
    const viewportBottom = scrollPosition.top + scrollPosition.height;

    if (
      scrollPosition.top <= 0
      || documentHeight === 0
      || viewportBottom + 360 < documentHeight
      || isNextPageScheduledRef.current
    ) {
      return;
    }

    isNextPageScheduledRef.current = true;
    setPage((current) => current + 1);
  }, [pagination.hasNextPage, route.view, scrollPosition.height, scrollPosition.top, status]);

  const summaryFilters = useMemo(
    () =>
      [
        ...genres.map((selectedGenre) => getGenreLabel(selectedGenre, t)),
        getPeriodLabel(period, t),
        ...getCompactCountrySummary(countries),
        getPopularitySummary(popularityMin, popularityMax),
        type === 'all' ? undefined : getReleaseTypeFilterLabel(type, t),
      ].filter(isPresent),
    [countries, genres, period, popularityMax, popularityMin, t, type],
  );
  const summaryText = t.results.summary(pagination.total, summaryFilters);
  const isInitialLoading = status === 'loading' && releases.length === 0;
  const isRefreshing = status === 'loading' && releases.length > 0;
  const isSummaryUpdating = status === 'loading' || status === 'loadingMore';
  const desktopSummaryText = isInitialLoading ? t.results.loadingSummary(summaryFilters) : summaryText;
  const mobileSummaryChips = useMemo(
    () => getMobileSummaryChips(period, genres, countries, popularityMin, popularityMax, type, t),
    [countries, genres, period, popularityMax, popularityMin, t, type],
  );
  const mobileResultsCountText = isInitialLoading ? t.results.loading : getResultsCountText(pagination.total, t);
  const hasActiveSearchFilters = hasActiveFilters(period, genres, countries, popularityMin, popularityMax, type);
  const hasActiveSheetFilters = genres.length > 0 || countries.length > 0 || type !== 'all';
  const virtualRange = getVirtualReleaseRange(releases.length, scrollPosition, releaseListRef.current);
  const visibleReleases = releases.slice(virtualRange.startIndex, virtualRange.endIndex);

  if (route.view === 'release') {
    const release = releases.find((item) => item.id === route.releaseId);

    return (
      <ReleaseDetail
        isLoading={status === 'loading' || status === 'loadingMore'}
        release={release}
        isMobile={isMobile}
        t={t}
        onBack={goBackToSearch}
      />
    );
  }

  if (route.view === 'insights') {
    return (
      <InsightsPage
        data={insightsData}
        isLoading={insightsStatus === 'loading'}
        isError={insightsStatus === 'error'}
        filters={{ period: insightsPeriod, type: insightsType }}
        language={language}
        isMobile={isMobile}
        t={t}
        onFiltersChange={updateInsightsFilters}
        onRetry={() => setInsightsRetryCount((current) => current + 1)}
        onOpenReleases={openSearch}
        onOpenInsight={openInsightItem}
        onLanguageChange={setLanguage}
      />
    );
  }

  return (
    <main className="appShell">
      <header className={isMobile ? 'appHeader isMobileHeader' : 'appHeader'}>
        <div className="headerBrand">
          {!isMobile && <p className="eyebrow">{t.app.eyebrow}</p>}
          <h1>{t.app.title}</h1>
          {!isMobile && <p>{t.app.description}</p>}
          {!isMobile && <HeaderNav active="releases" t={t} onOpenReleases={openSearch} onOpenInsights={openInsights} />}
        </div>
        <div className={isMobile ? 'headerActions mobileHeaderActions' : 'headerActions'}>
          {isMobile ? (
            <>
              <button
                type="button"
                className="secondaryButton mobileNavButton"
                onClick={openInsights}
              >
                {t.app.navInsights}
              </button>
              <button
                type="button"
                className="iconButton headerIconButton"
                aria-haspopup="dialog"
                aria-expanded={isHowItWorksOpen}
                aria-label={t.app.howItWorks}
                onClick={openAbout}
              >
                ?
              </button>
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
            </>
          ) : (
            <>
              <button type="button" className="navLink headerLink" onClick={openAbout}>
                {t.app.howItWorks}
              </button>
              <LanguageSwitcher language={language} t={t} onChange={setLanguage} />
            </>
          )}
        </div>
      </header>

      {insightsReturn && (
        <section className="insightsReturnPanel">
          <button type="button" className="ghostButton insightsReturnButton" onClick={backToInsights}>
            &larr; {t.insights.backToInsights}
          </button>
        </section>
      )}

      <div className={isDesktopSidebar ? 'searchLayout isDesktopSidebar' : 'searchLayout'}>
        <aside className="searchSidebar">
          {isMobile ? (
            <section className="mobileDiscoveryHeader" aria-label={t.filters.aria} ref={filterPanelRef}>
              <div className="mobileDiscoveryControls">
                <div className="mobileDiscoveryPeriod">
                  <PeriodFilter period={period} t={t} onChange={updatePeriod} />
                </div>
                <div className="mobileDiscoveryActions">
                  <button
                    type="button"
                    className="secondaryButton mobileFiltersButton"
                    aria-haspopup="dialog"
                    aria-expanded={isFiltersOpen}
                    onClick={openFiltersSheet}
                  >
                    {t.filters.filters}
                  </button>
                </div>
              </div>
              <section className="mobileResultsSummary" aria-live="polite">
                <div className="mobileResultsSummaryTop">
                  <p className="mobileResultsCount">
                    {mobileResultsCountText}
                    {!isInitialLoading && isSummaryUpdating && <span className="summaryLoadingIndicator">{t.results.updating}</span>}
                  </p>
                  {hasActiveSearchFilters && (
                    <button type="button" className="stickyResetLink mobileSummaryResetLink" aria-label={t.filters.reset} onClick={resetFilters}>
                      {t.filters.resetShort}
                    </button>
                  )}
                </div>
                <div className="mobileActiveFilters" aria-label={t.filters.activeFilters(mobileSummaryChips.length)}>
                  {mobileSummaryChips.map((chip) => (
                    <span className="genreChip mobileSummaryChip" key={chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </section>
              <SortToolbar sort={sort} t={t} isMobile onChange={updateSort} />
            </section>
          ) : (
            <section className="filterPanel" aria-label={t.filters.aria} ref={filterPanelRef}>
              <div className="filterPanelHeader">
                <p className="filterGroupTitle">{t.filters.filters}</p>
              </div>

              <div className="primaryFilters">
                <PeriodFilter period={period} t={t} onChange={updatePeriod} />
                <GenreFilter
                  isMobile={false}
                  selectedGenres={genres}
                  genreOptions={genreOptions}
                  t={t}
                  onChange={updateGenres}
                />
                <CountryFilter
                  selectedCountries={countries}
                  options={countryOptions}
                  t={t}
                  onChange={updateCountries}
                />
              </div>

              <div className="desktopSecondaryFilters">
                <TypeFilter type={type} t={t} onChange={updateType} />
              </div>

              {hasActiveSearchFilters && (
                <button type="button" className="ghostButton sidebarResetButton" onClick={resetFilters}>
                  {t.filters.reset}
                </button>
              )}
            </section>
          )}
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
                <SortToolbar sort={sort} t={t} onChange={updateSort} />
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
                      <ReleaseRow isMobile={isMobile} release={release} key={release.id} t={t} onSelect={() => openRelease(release)} />
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
          </section>

          {status === 'loadingMore' && <p className="loadingMore">{t.results.loadingMore}</p>}

          {status !== 'loading' && status !== 'error' && pagination.hasNextPage && (
            <div ref={loadMoreRef} className="scrollSentinel" aria-hidden="true" />
          )}

          {status === 'success' && releases.length > 0 && !pagination.hasNextPage && <p className="endState">{t.results.end}</p>}
        </div>
      </div>

      <MobileFiltersSheet
        isOpen={isFiltersOpen}
        genres={genres}
        genreOptions={genreOptions}
        countries={countries}
        countryOptions={countryOptions}
        type={type}
        hasActiveFilters={hasActiveSheetFilters}
        t={t}
        onClose={() => setIsFiltersOpen(false)}
        onGenresChange={updateGenres}
        onCountriesChange={updateCountries}
        onTypeChange={updateType}
        onReset={resetFiltersInSheet}
      />
      <MobileSettingsSheet
        isOpen={isSettingsOpen}
        language={language}
        t={t}
        onClose={() => setIsSettingsOpen(false)}
        onLanguageChange={setLanguage}
      />
      <HowItWorksDialog isMobile={isMobile} isOpen={isHowItWorksOpen} t={t} onClose={() => setIsHowItWorksOpen(false)} />
      {isBackToTopVisible && (
        <button type="button" className="backToTopButton" onClick={scrollToTop}>
          {t.app.backToTop}
        </button>
      )}
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

  function updateCountries(nextCountries: string[]): void {
    setCountries(nextCountries);
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

  function updateInsightsFilters(nextFilters: InsightsFilters): void {
    setInsightsPeriod(nextFilters.period);
    setInsightsType(nextFilters.type);
  }

  function resetFilters(): void {
    setPeriod(DEFAULT_SEARCH_STATE.period);
    setGenres(DEFAULT_SEARCH_STATE.genres);
    setCountries(DEFAULT_SEARCH_STATE.countries);
    setPopularityMin(DEFAULT_SEARCH_STATE.popularityMin);
    setPopularityMax(DEFAULT_SEARCH_STATE.popularityMax);
    setType(DEFAULT_SEARCH_STATE.type);
    setSort(DEFAULT_SEARCH_STATE.sort);
    window.localStorage.setItem(RELEASE_SEARCH_STORAGE_KEY, JSON.stringify(DEFAULT_SEARCH_STATE));
    setIsFiltersOpen(false);
    resetResults();
  }

  function resetFiltersInSheet(): void {
    setGenres(DEFAULT_SEARCH_STATE.genres);
    setCountries(DEFAULT_SEARCH_STATE.countries);
    setType(DEFAULT_SEARCH_STATE.type);
    window.localStorage.setItem(
      RELEASE_SEARCH_STORAGE_KEY,
      JSON.stringify({
        period,
        genres: DEFAULT_SEARCH_STATE.genres,
        countries: DEFAULT_SEARCH_STATE.countries,
        type: DEFAULT_SEARCH_STATE.type,
        sort,
      }),
    );
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

  function openSearch(): void {
    const nextUrl = buildSearchUrl({ period, genres, countries, popularityMin, popularityMax, type, sort }, language, insightsReturn);

    window.history.pushState(null, '', nextUrl);
    setRoute({ view: 'search' });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openInsights(): void {
    const nextUrl = buildInsightsUrl({ period: insightsPeriod, type: insightsType }, language);

    window.history.pushState(null, '', nextUrl);
    setRoute({ view: 'insights' });
    setInsightsReturn(null);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function backToInsights(): void {
    const nextFilters = insightsReturn ? { period: insightsReturn.period, type: insightsReturn.type } : { period: insightsPeriod, type: insightsType };
    const nextUrl = buildInsightsUrl(nextFilters, language);

    setInsightsPeriod(nextFilters.period);
    setInsightsType(nextFilters.type);
    setInsightsReturn(null);
    window.history.pushState(null, '', nextUrl);
    setRoute({ view: 'insights' });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openInsightItem(item: InsightListItem, insightId?: string): void {
    if (item.query.releaseId && !item.query.country && !item.query.genre) {
      const nextPath = getReleasePath(item.query.releaseId, {
        period: getSearchPeriodFromInsightsPeriod(insightsPeriod),
        genres: [],
        countries: [],
        popularityMin: item.query.popularityMin,
        popularityMax: item.query.popularityMax,
        type: getSearchTypeFromInsightsType(insightsType),
        sort: 'newest',
      }, language);

      window.history.pushState(null, '', nextPath);
      setRoute({ view: 'release', releaseId: item.query.releaseId });
      return;
    }

    const nextSearchState: ReleaseSearchState = {
      period: getSearchPeriodFromInsightsPeriod(insightsPeriod),
      genres: item.query.genre ? [item.query.genre] : [],
      countries: item.query.country ? [item.query.country] : [],
      popularityMin: item.query.popularityMin,
      popularityMax: item.query.popularityMax,
      type: getSearchTypeFromInsightsType(insightsType),
      sort: 'newest',
    };
    const nextReturnState: InsightsReturnState = {
      period: insightsPeriod,
      type: insightsType,
      insightId,
    };

    applySearchState(nextSearchState, language);
    setInsightsReturn(nextReturnState);
    window.history.pushState(null, '', buildSearchUrl(nextSearchState, language, nextReturnState));
    setRoute({ view: 'search' });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function openRelease(release: Release): void {
    window.history.replaceState(
      {
        searchScrollY: window.scrollY,
      },
      '',
      buildSearchUrl({ period, genres, countries, popularityMin, popularityMax, type, sort }, language, insightsReturn),
    );

    const nextPath = getReleasePath(release.id, { period, genres, countries, popularityMin, popularityMax, type, sort }, language);

    window.history.pushState(null, '', nextPath);
    setRoute({ view: 'release', releaseId: release.id });
    setScrollPosition({
      top: 0,
      height: window.innerHeight,
    });
    window.scrollTo({
      top: 0,
      behavior: 'auto',
    });
  }

  function goBackToSearch(): void {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    window.history.pushState(null, '', buildSearchUrl({ period, genres, countries, popularityMin, popularityMax, type, sort }, language, insightsReturn));
    setRoute({ view: 'search' });
  }

  function openAbout(): void {
    setIsFiltersOpen(false);
    setIsSettingsOpen(false);
    setIsHowItWorksOpen(true);
  }

  function openFiltersSheet(): void {
    setIsFiltersOpen(true);
  }

  function scrollToTop(): void {
    window.scrollTo({
      top: 0,
      behavior: 'smooth',
    });
  }

  function applySearchState(nextSearchState: ReleaseSearchState, nextLanguage: Language): void {
    setPeriod(nextSearchState.period);
    setGenres(nextSearchState.genres);
    setCountries(nextSearchState.countries);
    setPopularityMin(nextSearchState.popularityMin);
    setPopularityMax(nextSearchState.popularityMax);
    setType(nextSearchState.type);
    setSort(nextSearchState.sort);
    setLanguage(nextLanguage);
    setPage(1);
  }
}

type HeaderNavProps = {
  active: 'releases' | 'insights';
  t: Translation;
  onOpenReleases: () => void;
  onOpenInsights: () => void;
};

function HeaderNav({ active, t, onOpenReleases, onOpenInsights }: HeaderNavProps) {
  return (
    <nav className="headerNav" aria-label="Primary navigation">
      <button type="button" className={active === 'releases' ? 'headerNavLink isActive' : 'headerNavLink'} onClick={onOpenReleases}>
        {t.app.navReleases}
      </button>
      <span aria-hidden="true">|</span>
      <button type="button" className={active === 'insights' ? 'headerNavLink isActive' : 'headerNavLink'} onClick={onOpenInsights}>
        {t.app.navInsights}
      </button>
    </nav>
  );
}

type InsightsPageProps = {
  data: InsightsData | null;
  filters: InsightsFilters;
  isLoading: boolean;
  isError: boolean;
  isMobile: boolean;
  language: Language;
  t: Translation;
  onFiltersChange: (filters: InsightsFilters) => void;
  onRetry: () => void;
  onOpenReleases: () => void;
  onOpenInsight: (item: InsightListItem, insightId?: string) => void;
  onLanguageChange: (language: Language) => void;
};

function InsightsPage({
  data,
  filters,
  isLoading,
  isError,
  isMobile,
  language,
  t,
  onFiltersChange,
  onRetry,
  onOpenReleases,
  onOpenInsight,
  onLanguageChange,
}: InsightsPageProps) {
  const hasItems = data ? getInsightsItemsCount(data) > 0 : false;

  return (
    <main className="appShell insightsShell">
      <header className={isMobile ? 'appHeader isMobileHeader' : 'appHeader'}>
        <div className="headerBrand">
          <h1>{t.insights.title}</h1>
          <p>{t.insights.description}</p>
          {!isMobile && <HeaderNav active="insights" t={t} onOpenReleases={onOpenReleases} onOpenInsights={() => undefined} />}
        </div>
        <div className={isMobile ? 'headerActions mobileHeaderActions' : 'headerActions'}>
          {isMobile ? (
            <button type="button" className="secondaryButton mobileNavButton" onClick={onOpenReleases}>
              {t.app.navReleases}
            </button>
          ) : (
            <LanguageSwitcher language={language} t={t} onChange={onLanguageChange} />
          )}
        </div>
      </header>

      <section className="insightsFilterBar" aria-label={t.insights.filtersAria}>
        <SegmentedControl
          label={t.insights.period}
          value={String(filters.period)}
          options={[
            { value: '7', label: t.insights.periods[7] },
            { value: '14', label: t.insights.periods[14] },
            { value: '30', label: t.insights.periods[30] },
          ]}
          onChange={(value) => onFiltersChange({ ...filters, period: Number(value) as InsightsPeriod })}
        />
        <SegmentedControl
          label={t.insights.type}
          value={filters.type}
          options={[
            { value: 'all', label: t.insights.types.all },
            { value: 'single', label: t.insights.types.single },
            { value: 'album', label: t.insights.types.album },
          ]}
          onChange={(value) => onFiltersChange({ ...filters, type: value })}
        />
      </section>

      {isLoading && <InsightsSkeleton />}

      {isError && (
        <div className="statePanel" role="alert">
          <h2>{t.insights.loadingErrorTitle}</h2>
          <p>{t.insights.loadingErrorDescription}</p>
          <button type="button" onClick={onRetry}>
            {t.insights.retry}
          </button>
        </div>
      )}

      {!isLoading && !isError && data && !hasItems && (
        <div className="statePanel">
          <h2>{t.insights.emptyTitle}</h2>
          <p>{t.insights.emptyDescription}</p>
        </div>
      )}

      {!isLoading && !isError && data && hasItems && (
        <div className="insightsSections">
          <InsightsSection title={t.insights.sections.countries}>
            <InsightCard
              id="most-active-countries"
              title={t.insights.cards.mostActiveCountries.title}
              description={t.insights.cards.mostActiveCountries.description}
              items={data.sections.countries.mostActiveCountries.byReleases}
              alternateItems={data.sections.countries.mostActiveCountries.byArtists}
              alternateLabel={t.insights.cards.mostActiveCountries.byArtists}
              defaultLabel={t.insights.cards.mostActiveCountries.byReleases}
              t={t}
              onOpenInsight={onOpenInsight}
            />
            <InsightCard id="rare-countries" title={t.insights.cards.rareCountries.title} description={t.insights.cards.rareCountries.description} items={data.sections.countries.rareCountries} t={t} onOpenInsight={onOpenInsight} />
            <InsightCard id="big-artists-small-scenes" title={t.insights.cards.bigArtistsSmallScenes.title} description={t.insights.cards.bigArtistsSmallScenes.description} items={data.sections.countries.bigArtistsFromSmallScenes} t={t} onOpenInsight={onOpenInsight} />
            <InsightCard id="most-diverse-countries" title={t.insights.cards.mostDiverseCountries.title} description={t.insights.cards.mostDiverseCountries.description} items={data.sections.countries.mostDiverseCountries} t={t} onOpenInsight={onOpenInsight} />
          </InsightsSection>

          <InsightsSection title={t.insights.sections.genres}>
            <InsightCard id="most-active-genres" title={t.insights.cards.mostActiveGenres.title} description={t.insights.cards.mostActiveGenres.description} items={data.sections.genres.mostActiveGenres} t={t} onOpenInsight={onOpenInsight} />
            <InsightCard id="rare-genre-drops" title={t.insights.cards.rareGenreDrops.title} description={t.insights.cards.rareGenreDrops.description} items={data.sections.genres.rareGenreDrops} t={t} onOpenInsight={onOpenInsight} />
            <InsightCard id="mainstream-genres" title={t.insights.cards.mainstreamGenres.title} description={t.insights.cards.mainstreamGenres.description} items={data.sections.genres.mostMainstreamGenres} t={t} onOpenInsight={onOpenInsight} />
            <InsightCard id="deep-underground-genres" title={t.insights.cards.undergroundGenres.title} description={t.insights.cards.undergroundGenres.description} items={data.sections.genres.deepUndergroundGenres} t={t} onOpenInsight={onOpenInsight} />
          </InsightsSection>

          <InsightsSection title={t.insights.sections.scenes}>
            <InsightCard id="top-scenes" title={t.insights.cards.topScenes.title} description={t.insights.cards.topScenes.description} items={data.sections.scenes.topScenes} t={t} onOpenInsight={onOpenInsight} />
          </InsightsSection>

          <InsightsSection title={t.insights.sections.discovery}>
            <InsightCard id="popular-artists-niche-genres" title={t.insights.cards.popularArtistsNicheGenres.title} description={t.insights.cards.popularArtistsNicheGenres.description} items={data.sections.discovery.popularArtistsInNicheGenres} t={t} onOpenInsight={onOpenInsight} />
            <InsightCard id="deep-underground-drops" title={t.insights.cards.undergroundDrops.title} description={t.insights.cards.undergroundDrops.description} items={data.sections.discovery.deepUndergroundDrops} cta={t.insights.cards.undergroundDrops.cta} t={t} onOpenInsight={onOpenInsight} />
          </InsightsSection>
        </div>
      )}
    </main>
  );
}

function InsightsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="insightsSection">
      <h2>{title}</h2>
      <div className="insightsGrid">{children}</div>
    </section>
  );
}

type InsightCardProps = {
  id: string;
  title: string;
  description: string;
  items: InsightListItem[];
  alternateItems?: InsightListItem[];
  defaultLabel?: string;
  alternateLabel?: string;
  cta?: string;
  t: Translation;
  onOpenInsight: (item: InsightListItem, insightId?: string) => void;
};

function InsightCard({
  id,
  title,
  description,
  items,
  alternateItems,
  defaultLabel = 'Primary',
  alternateLabel = 'Alternate',
  cta,
  t,
  onOpenInsight,
}: InsightCardProps) {
  const [mode, setMode] = useState<'default' | 'alternate'>('default');
  const visibleItems = mode === 'alternate' && alternateItems ? alternateItems : items;
  const ctaItem = visibleItems[0];

  return (
    <article className="insightCard" id={id}>
      <div className="insightCardHeader">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {alternateItems && (
          <div className="insightModeSwitch" role="group" aria-label={title}>
            <button type="button" className={mode === 'default' ? 'isActive' : undefined} onClick={() => setMode('default')}>
              {defaultLabel}
            </button>
            <button type="button" className={mode === 'alternate' ? 'isActive' : undefined} onClick={() => setMode('alternate')}>
              {alternateLabel}
            </button>
          </div>
        )}
      </div>
      {visibleItems.length > 0 ? (
        <div className="insightItemList">
          {visibleItems.map((item) => (
            <button type="button" className="insightItem" key={item.id} onClick={() => onOpenInsight(item, id)}>
              <span>
                <strong>{item.title}</strong>
                {item.description && <small>{localizeInsightText(item.description, t)}</small>}
              </span>
              <span className="insightMetric">{localizeInsightText(item.metric, t)}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="insightEmpty">{t.insights.noCardData}</p>
      )}
      {cta && ctaItem && (
        <button type="button" className="ghostButton insightCta" onClick={() => onOpenInsight({ ...ctaItem, query: { popularityMax: 20 } }, id)}>
          {cta}
        </button>
      )}
    </article>
  );
}

function InsightsSkeleton() {
  return (
    <div className="insightsSections" aria-hidden="true">
      {[0, 1, 2].map((section) => (
        <section className="insightsSection" key={section}>
          <div className="skeletonLine titleLine" />
          <div className="insightsGrid">
            {[0, 1, 2].map((card) => (
              <div className="insightCard skeletonCard" key={card}>
                <div className="skeletonLine titleLine" />
                <div className="skeletonLine" />
                <div className="skeletonLine" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type PeriodFilterProps = {
  period: ReleasePeriod;
  t: Translation;
  onChange: (period: ReleasePeriod) => void;
};

function PeriodFilter({ period, t, onChange }: PeriodFilterProps) {
  return (
    <SegmentedControl
      className="isPeriodControl"
      label={t.filters.period}
      value={period}
      options={[
        { value: 'today', label: t.filters.periodOptions.today },
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
  const visibleOptions = genreOptions.filter((option) => getGenreLabel(option.name, t).toLowerCase().includes(normalizedQuery));
  const visibleSelectedGenres = selectedGenres.slice(0, MAX_VISIBLE_SELECTED_GENRES);
  const hiddenSelectedGenresCount = Math.max(selectedGenres.length - visibleSelectedGenres.length, 0);
  const selectableVisibleOptions = visibleOptions.filter((option) => !selectedGenres.includes(option.name));
  const showOptions = !isMobile || isExpanded;
  const showSelectMatchesButton = normalizedQuery.length > 0 && selectableVisibleOptions.length > 0;

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
            className={showOptions ? 'inlineFilterButton genreToggleButton isActive' : 'inlineFilterButton genreToggleButton'}
            aria-expanded={showOptions}
            onClick={() => setIsExpanded((current) => !current)}
          >
            {showOptions ? t.filters.hideGenres : t.filters.browseGenres}
          </button>
        )}
      </div>
      <div className="genreSearchRow">
        <div className="genreSearchField">
          {selectedGenres.length > 0 && (
            <div className="selectedGenreChips" aria-label={t.filters.selectedGenres}>
              {visibleSelectedGenres.map((genre) => (
                <button type="button" className="genreChip" key={genre} onClick={() => toggleGenre(genre)}>
                  {getGenreLabel(genre, t)} x
                </button>
              ))}
              {hiddenSelectedGenresCount > 0 && <span className="genreChip genreChipOverflow">+{hiddenSelectedGenresCount}</span>}
            </div>
          )}
          <input
            type="search"
            value={query}
            placeholder={t.filters.searchGenres}
            onFocus={() => setIsExpanded(true)}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {(showSelectMatchesButton || selectedGenres.length > 0) && (
          <div className="genreSearchActions">
            {showSelectMatchesButton && (
              <button type="button" className="genreActionButton genreSelectMatchesButton" onClick={selectVisibleGenres}>
                {t.filters.selectMatches}
              </button>
            )}
            {selectedGenres.length > 0 && (
              <button type="button" className="genreActionButton clearGenresButton" onClick={clearGenres}>
                {t.filters.clearGenres}
              </button>
            )}
          </div>
        )}
      </div>
      {showOptions && (
        <>
          <div className="genreOptionList" role="list" aria-label={t.filters.genreResults}>
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => {
                const isSelected = selectedGenres.includes(option.name);

                return (
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={isSelected}
                    className={isSelected ? 'genreOption isSelected' : 'genreOption'}
                    key={`${option.kind}-${option.name}`}
                    onClick={() => toggleGenre(option.name)}
                  >
                    <span className={isSelected ? 'genreCheckbox isChecked' : 'genreCheckbox'} aria-hidden="true">
                      <span className="genreCheckboxMark" />
                    </span>
                    <span className="genreOptionLabel">{getGenreLabel(option.name, t)}</span>
                    <span className="genreCount">{option.releaseCount}</span>
                  </button>
                );
              })
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

  function selectVisibleGenres(): void {
    onChange([...selectedGenres, ...selectableVisibleOptions.map((option) => option.name)]);
  }

  function clearGenres(): void {
    onChange([]);
  }
}

type TypeFilterProps = {
  type: ReleaseTypeFilter;
  t: Translation;
  layout?: 'default' | 'sheet';
  onChange: (type: ReleaseTypeFilter) => void;
};

function TypeFilter({ type, t, layout = 'default', onChange }: TypeFilterProps) {
  return (
    <SegmentedControl
      className={layout === 'sheet' ? 'isSheetTypeControl' : undefined}
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

type CountryFilterProps = {
  selectedCountries: string[];
  options: CountryOption[];
  t: Translation;
  onChange: (countries: string[]) => void;
};

function CountryFilter({ selectedCountries, options, t, onChange }: CountryFilterProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = options.filter((option) => getCountryLabel(option.name, t).toLowerCase().includes(normalizedQuery));
  const visibleSelectedCountries = selectedCountries.slice(0, MAX_VISIBLE_SELECTED_GENRES);
  const hiddenSelectedCountriesCount = Math.max(selectedCountries.length - visibleSelectedCountries.length, 0);

  return (
    <div className="genreSelector filterField">
      <div className="fieldHeader">
        <span className="fieldLabel">{t.filters.country}</span>
      </div>
      <div className="genreSearchRow">
        <div className="genreSearchField">
          {selectedCountries.length > 0 && (
            <div className="selectedGenreChips" aria-label={t.filters.selectedCountries}>
              {visibleSelectedCountries.map((country) => (
                <button type="button" className="genreChip" key={country} onClick={() => toggleCountry(country)}>
                  {getCountryLabel(country, t)} x
                </button>
              ))}
              {hiddenSelectedCountriesCount > 0 && <span className="genreChip genreChipOverflow">+{hiddenSelectedCountriesCount}</span>}
            </div>
          )}
          <input
            type="search"
            aria-label={t.filters.country}
            value={query}
            placeholder={t.filters.searchCountry}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {selectedCountries.length > 0 && (
          <div className="genreSearchActions">
            <button type="button" className="genreActionButton clearGenresButton" onClick={() => onChange([])}>
              {t.filters.clearCountries}
            </button>
          </div>
        )}
      </div>
      <div className="genreOptionList" role="list" aria-label={t.filters.countryResults}>
        {visibleOptions.length > 0 ? (
          visibleOptions.map((option) => {
            const isSelected = selectedCountries.includes(option.name);

            return (
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                className={isSelected ? 'genreOption isSelected' : 'genreOption'}
                key={option.name}
                onClick={() => toggleCountry(option.name)}
              >
                <span className={isSelected ? 'genreCheckbox isChecked' : 'genreCheckbox'} aria-hidden="true">
                  <span className="genreCheckboxMark" />
                </span>
                <span className="genreOptionLabel">{getCountryLabel(option.name, t)}</span>
                <span className="genreCount">{option.releaseCount}</span>
              </button>
            );
          })
        ) : (
          <div className="genreEmptyState">{t.filters.noCountriesFound}</div>
        )}
      </div>
      <p className="genreHelperText">{t.filters.countsHelp}</p>
    </div>
  );

  function toggleCountry(nextCountry: string): void {
    if (selectedCountries.includes(nextCountry)) {
      onChange(selectedCountries.filter((country) => country !== nextCountry));
      return;
    }

    onChange([...selectedCountries, nextCountry]);
  }
}

type SortToolbarProps = {
  sort: ReleaseSort;
  isMobile?: boolean;
  t: Translation;
  onChange: (sort: ReleaseSort) => void;
};

function SortToolbar({ sort, isMobile = false, t, onChange }: SortToolbarProps) {
  const activeSortLabel = getReleaseSortLabel(sort, t);
  const options: { value: ReleaseSort; label: string }[] = [
    { value: 'newest', label: t.sorts.newest },
    { value: 'oldest', label: t.sorts.oldest },
    { value: 'popular', label: t.sorts.popular },
    { value: 'less-popular', label: t.sorts.lessPopular },
  ];

  return (
    <section className={isMobile ? 'sortToolbar sortToolbarMobile' : 'sortToolbar'} aria-label={t.filters.sorting}>
      <div className="sortToolbarHeader">
        <span className="sortToolbarLabel">{t.filters.sorting}</span>
        <span className="sortToolbarValue">{activeSortLabel}</span>
      </div>
      <div className="sortIconRail" role="group" aria-label={t.filters.sorting}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            className={sort === option.value ? 'sortIconButton isActive' : 'sortIconButton'}
            aria-label={option.label}
            aria-pressed={sort === option.value}
            title={option.label}
            onClick={() => onChange(option.value)}
          >
            <SortGlyph sort={option.value} />
            <span className="srOnly">{option.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

type MobileFiltersSheetProps = {
  isOpen: boolean;
  genres: string[];
  genreOptions: GenreOption[];
  countries: string[];
  countryOptions: CountryOption[];
  type: ReleaseTypeFilter;
  t: Translation;
  hasActiveFilters: boolean;
  onClose: () => void;
  onGenresChange: (genres: string[]) => void;
  onCountriesChange: (countries: string[]) => void;
  onTypeChange: (type: ReleaseTypeFilter) => void;
  onReset: () => void;
};

function MobileFiltersSheet({
  isOpen,
  genres,
  genreOptions,
  countries,
  countryOptions,
  type,
  hasActiveFilters,
  t,
  onClose,
  onGenresChange,
  onCountriesChange,
  onTypeChange,
  onReset,
}: MobileFiltersSheetProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="sheetLayer">
      <button type="button" className="sheetBackdrop" aria-label={t.filters.close} onClick={onClose} />
      <section className="bottomSheet filtersSheet" role="dialog" aria-modal="true" aria-label={t.filters.filters}>
        <div className="sheetHeader">
          <h2>{t.filters.filters}</h2>
          <SheetCloseButton label={t.filters.close} onClick={onClose} />
        </div>
        <div className="sheetBody">
          <div className="sheetFilters">
            <GenreFilter isMobile={false} selectedGenres={genres} genreOptions={genreOptions} t={t} onChange={onGenresChange} />
            <CountryFilter selectedCountries={countries} options={countryOptions} t={t} onChange={onCountriesChange} />
            <TypeFilter type={type} t={t} layout="sheet" onChange={onTypeChange} />
          </div>
        </div>
        <div className="sheetFooter">
          <button type="button" className="ghostButton sheetFooterButton" disabled={!hasActiveFilters} onClick={onReset}>
            {t.filters.resetShort}
          </button>
          <button type="button" className="sheetFooterButton" onClick={onClose}>
            {t.filters.done}
          </button>
        </div>
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
          <SheetCloseButton label={t.filters.close} onClick={onClose} />
        </div>
        <LanguageSettingsField language={language} t={t} onChange={onLanguageChange} />
      </section>
    </div>
  );
}

type SegmentedControlOption<TValue extends string> = {
  value: TValue;
  label: string;
};

type SegmentedControlProps<TValue extends string> = {
  className?: string;
  label: string;
  value: TValue;
  options: SegmentedControlOption<TValue>[];
  onChange: (value: TValue) => void;
};

function SegmentedControl<TValue extends string>({
  className,
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<TValue>) {
  return (
    <div className="filterField">
      <span className="fieldLabel">{label}</span>
      <div className={className ? `segmentedControl ${className}` : 'segmentedControl'} role="group" aria-label={label}>
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

function SortGlyph({ sort }: { sort: ReleaseSort }) {
  return (
    <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
      {sort === 'newest' && (
        <>
          <path d="M8 3v10" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          <path d="M5.5 10.5 8 13l2.5-2.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          <path d="M4 4h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </>
      )}
      {sort === 'oldest' && (
        <>
          <path d="M8 13V3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          <path d="M5.5 5.5 8 3l2.5 2.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          <path d="M4 12h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" />
        </>
      )}
      {sort === 'popular' && (
        <>
          <path d="M3 10.5 6.2 7.3l2.1 2.1L13 4.7" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          <path d="M10.5 4.7H13v2.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </>
      )}
      {sort === 'less-popular' && (
        <>
          <path d="M3 5.5 6.2 8.7l2.1-2.1L13 11.3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
          <path d="M10.5 11.3H13V8.8" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
        </>
      )}
    </svg>
  );
}

type ReleaseRowProps = {
  isMobile: boolean;
  release: Release;
  t: Translation;
  onSelect: () => void;
};

function ReleaseRow({ isMobile, release, t, onSelect }: ReleaseRowProps) {
  return (
    <article className="releaseItem">
      <button type="button" className="releaseRow" onClick={onSelect} aria-label={t.release.openLabel(release.title)}>
        <ReleaseCover coverUrl={release.coverUrl} title={release.title} isMobile={isMobile} t={t} />
        <span className="releaseInfo">
          <span className="releaseTitle">{release.title}</span>
          <span className="releaseSubtitle">
            <span className="releaseArtist">{formatArtists(release, t)}</span>
            <span className="releaseSubtitleDivider" aria-hidden="true">
              &middot;
            </span>
            <span className="releaseGenresPreview">{getCompactReleaseGenreSummary(release, t)}</span>
          </span>
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
  isMobile: boolean;
  title: string;
  t: Translation;
};

function ReleaseCover({ coverUrl, isMobile, title, t }: ReleaseCoverProps) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setIsLoaded(false);
    setHasError(false);
  }, [coverUrl]);

  useEffect(() => {
    if (!coverUrl) {
      return;
    }

    const image = imageRef.current;

    if (image?.complete && image.naturalWidth > 0) {
      setIsLoaded(true);
    }
  }, [coverUrl]);

  if (!coverUrl || hasError) {
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
        ref={imageRef}
        className={isLoaded ? 'coverImage isLoaded' : 'coverImage'}
        src={coverUrl}
        alt={t.release.coverAlt(title)}
        loading={isMobile ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setIsLoaded(true)}
        onError={() => setHasError(true)}
      />
    </span>
  );
}

type ReleaseDetailProps = {
  isLoading: boolean;
  release: Release | undefined;
  isMobile: boolean;
  t: Translation;
  onBack: () => void;
};

type DetailMetaItem = {
  label: string;
  value: ReactNode;
};

function ReleaseDetail({ isLoading, release, isMobile, t, onBack }: ReleaseDetailProps) {
  if (!release) {
    return (
      <main className="detailPage">
        <ReleaseDetailTopBar t={t} onBack={onBack} />
        <div className="appShell detailShell detailShellState">
          <section className="statePanel" role="status">
            <h1>{isLoading ? t.release.loadingTitle : t.release.notLoadedTitle}</h1>
            <p>{isLoading ? t.release.loadingDescription : t.release.notLoadedDescription}</p>
          </section>
        </div>
      </main>
    );
  }

  const detailMetaItems: DetailMetaItem[] = [
    {
      label: t.release.releaseDate,
      value: <dd>{hasMeaningfulText(release.releaseDate) ? release.releaseDate : t.release.unknown}</dd>,
    },
    {
      label: t.release.country,
      value: <dd>{hasMeaningfulText(release.country) ? release.country : t.release.unknown}</dd>,
    },
    {
      label: t.release.popularity,
      value: <dd>{release.popularity === null ? t.release.unknown : String(release.popularity)}</dd>,
    },
    {
      label: t.release.type,
      value:
        release.type === 'unknown' ? (
          <dd>{t.release.unknown}</dd>
        ) : (
          <dd>
            <span className="releaseTypeBadge detailMetaBadge">{getReleaseTypeLabel(release.type, t)}</span>
          </dd>
        ),
    },
  ];
  const knownGenres = getKnownReleaseGenres(release);

  return (
    <main className="detailPage">
      <ReleaseDetailTopBar t={t} onBack={onBack} />
      <div className="appShell detailShell">
        <section className="releaseDetail" aria-label={t.release.detailsAria}>
          <div className="detailHero">
            {release.coverUrl ? (
              <img className="detailCover" src={release.coverUrl} alt="" />
            ) : (
              <div className="detailCover detailCoverPlaceholder coverPlaceholder" aria-label={t.release.noCover} role="img" />
            )}
          </div>
          <div className="detailContent">
            <h1 className="detailTitle">{release.title}</h1>
            <p className="detailArtist">{formatArtists(release, t)}</p>
            {!isMobile && (
              <div className="detailActions">
                {release.spotifyUrl && (
                  <a className="spotifyLink detailPrimaryAction" href={release.spotifyUrl} target="_blank" rel="noreferrer">
                    {t.release.openSpotify}
                  </a>
                )}
              </div>
            )}
            {detailMetaItems.length > 0 && (
              <dl className="detailMetaCard">
                {detailMetaItems.map((item) => (
                  <div className="detailMetaItem" key={item.label}>
                    <dt>{item.label}</dt>
                    {item.value}
                  </div>
                ))}
              </dl>
            )}
            {knownGenres.length > 0 && (
              <div className="detailGenresSection">
                <p className="detailSectionLabel">{t.release.genres}</p>
                <div className="selectedGenreChips detailGenreChips">
                  {knownGenres.map((genre) => (
                    <span className="genreChip detailGenreChip" key={genre}>
                      {genre}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {isMobile && release.spotifyUrl && (
        <div className="detailBottomBar">
          <div className="appShell detailBottomBarInner">
            <a className="spotifyLink detailPrimaryAction detailBottomAction" href={release.spotifyUrl} target="_blank" rel="noreferrer">
              {t.release.openSpotify}
            </a>
          </div>
        </div>
      )}
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
          <SheetCloseButton label={t.about.close} onClick={onClose} />
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
    <label className="languageSwitcher">
      <span className="srOnly">{t.language.label}</span>
      <select aria-label={t.language.label} value={language} onChange={(event) => onChange(event.target.value as Language)}>
        <option value="en">{t.language.en}</option>
        <option value="ru">{t.language.ru}</option>
      </select>
    </label>
  );
}

function LanguageSettingsField({ language, t, onChange }: LanguageSwitcherProps) {
  return (
    <div className="settingsField">
      <span className="fieldLabel settingsFieldLabel">{t.language.label}</span>
      <div className="languageOptionList" role="group" aria-label={t.language.label}>
        {[
          { value: 'en' as const, label: t.language.en },
          { value: 'ru' as const, label: t.language.ru },
        ].map((option) => (
          <button
            key={option.value}
            type="button"
            className={language === option.value ? 'languageOption isActive' : 'languageOption'}
            aria-pressed={language === option.value}
            onClick={() => onChange(option.value)}
          >
            <span>{option.label}</span>
            {language === option.value && <span aria-hidden="true">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

function SheetCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="sheetCloseButton" aria-label={label} onClick={onClick}>
      <span aria-hidden="true">×</span>
    </button>
  );
}

type ReleaseDetailTopBarProps = {
  t: Translation;
  onBack: () => void;
};

function ReleaseDetailTopBar({ t, onBack }: ReleaseDetailTopBarProps) {
  return (
    <div className="pageTopBar releaseTopBar">
      <button type="button" className="backButton iconBackButton" aria-label={t.release.back} onClick={onBack}>
        <span className="backButtonIcon" aria-hidden="true">
          <svg viewBox="0 0 16 16" focusable="false">
            <path
              d="M9.75 3.5 5.25 8l4.5 4.5"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </span>
      </button>
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
  countries: string[],
  popularityMin: number | undefined,
  popularityMax: number | undefined,
  type: ReleaseTypeFilter,
): boolean {
  return period !== '7d' || genres.length > 0 || countries.length > 0 || popularityMin !== undefined || popularityMax !== undefined || type !== 'all';
}

function isDefaultSearch(
  period: ReleasePeriod,
  genres: string[],
  countries: string[],
  popularityMin: number | undefined,
  popularityMax: number | undefined,
  type: ReleaseTypeFilter,
  sort: ReleaseSort,
): boolean {
  return period === '7d'
    && genres.length === 0
    && countries.length === 0
    && popularityMin === undefined
    && popularityMax === undefined
    && type === 'all'
    && sort === 'newest';
}

function areSearchStatesEqual(left: ReleaseSearchState, right: ReleaseSearchState): boolean {
  return (
    left.period === right.period &&
    left.type === right.type &&
    left.sort === right.sort &&
    left.popularityMin === right.popularityMin &&
    left.popularityMax === right.popularityMax &&
    areStringArraysEqual(left.genres, right.genres) &&
    areStringArraysEqual(left.countries, right.countries)
  );
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function getReleaseRequestKey(searchState: ReleaseSearchState & { page: number; retryCount: number }): string {
  return JSON.stringify({
    period: searchState.period,
    genres: searchState.genres,
    countries: searchState.countries,
    popularityMin: searchState.popularityMin,
    popularityMax: searchState.popularityMax,
    type: searchState.type,
    sort: searchState.sort,
    page: searchState.page,
    retryCount: searchState.retryCount,
  });
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

function getPopularitySummary(popularityMin?: number, popularityMax?: number): string | undefined {
  if (popularityMin !== undefined && popularityMax !== undefined) {
    return `Popularity ${popularityMin}-${popularityMax}`;
  }

  if (popularityMin !== undefined) {
    return `Popularity ${popularityMin}+`;
  }

  if (popularityMax !== undefined) {
    return `Popularity <= ${popularityMax}`;
  }

  return undefined;
}

function localizeInsightText(value: string, t: Translation): string {
  return value
    .replace(/\b(\d+) releases\b/g, (_match, count: string) => t.insights.metrics.releases(Number(count)))
    .replace(/\b(\d+) artists\b/g, (_match, count: string) => t.insights.metrics.artists(Number(count)))
    .replace(/\b(\d+) genres\b/g, (_match, count: string) => t.insights.metrics.genres(Number(count)))
    .replace(/\bmedian popularity (\d+)\b/g, (_match, popularity: string) => t.insights.metrics.medianPopularity(popularity))
    .replace(/\bpopularity (unknown|\d+)\b/g, (_match, popularity: string) => t.insights.metrics.popularity(popularity))
    .replace(/\blatest release: ([^·]+)$/g, (_match, title: string) => t.insights.metrics.latestRelease(title.trim()));
}

function getResultsCountText(count: number, t: Translation): string {
  const formattedCount = new Intl.NumberFormat().format(count);

  return `${formattedCount} ${t.results.releasesShort(count)}`;
}

function getMobileSummaryChips(
  period: ReleasePeriod,
  genres: string[],
  countries: string[],
  popularityMin: number | undefined,
  popularityMax: number | undefined,
  type: ReleaseTypeFilter,
  t: Translation,
): string[] {
  return [
    getPeriodLabel(period, t),
    ...genres.map((genre) => getGenreLabel(genre, t)),
    ...countries,
    getPopularitySummary(popularityMin, popularityMax),
    type === 'all' ? undefined : getReleaseTypeFilterLabel(type, t),
  ].filter(isPresent);
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
      countries: getStoredCountries(parsedValue),
      popularityMin: normalizePopularityQueryValue(parsedValue.popularityMin),
      popularityMax: normalizePopularityQueryValue(parsedValue.popularityMax),
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

function getStoredCountries(value: Partial<ReleaseSearchState> & { country?: unknown }): string[] {
  if (Array.isArray(value.countries)) {
    return value.countries.filter((country): country is string => typeof country === 'string' && country.trim().length > 0);
  }

  return typeof value.country === 'string' && value.country.trim().length > 0 ? [value.country.trim()] : [];
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
    countries: getUrlCountries(searchParams) ?? storedState.countries,
    popularityMin: normalizePopularityQueryValue(searchParams.get('popularityMin')) ?? storedState.popularityMin,
    popularityMax: normalizePopularityQueryValue(searchParams.get('popularityMax')) ?? storedState.popularityMax,
    type: isReleaseTypeFilter(rawType) ? rawType : storedState.type,
    sort: isReleaseSort(rawSort) ? rawSort : storedState.sort,
  };
}

function getInitialInsightsFilters(location: Location): InsightsFilters {
  const searchParams = new URLSearchParams(location.search);

  return {
    period: normalizeInsightsPeriod(searchParams.get('period')) ?? DEFAULT_INSIGHTS_FILTERS.period,
    type: normalizeInsightsType(searchParams.get('type')) ?? DEFAULT_INSIGHTS_FILTERS.type,
  };
}

function getInsightsReturnState(location: Location): InsightsReturnState | null {
  const searchParams = new URLSearchParams(location.search);

  if (searchParams.get('from') !== 'insights') {
    return null;
  }

  return {
    period: getInsightsPeriodFromSearchPeriod(searchParams.get('period')) ?? DEFAULT_INSIGHTS_FILTERS.period,
    type: getInsightsTypeFromSearchType(searchParams.get('type')) ?? DEFAULT_INSIGHTS_FILTERS.type,
    insightId: searchParams.get('insightId') ?? undefined,
  };
}

function getInitialLanguage(location: Location, storage: Storage = window.localStorage): Language {
  const searchParams = new URLSearchParams(location.search);
  const rawLanguage = searchParams.get('lang');

  return rawLanguage === 'en' || rawLanguage === 'ru' ? rawLanguage : getStoredLanguage(storage);
}

function getSavedSearchScrollPosition(state: unknown): number | null {
  if (
    typeof state === 'object'
    && state !== null
    && 'searchScrollY' in state
    && typeof state.searchScrollY === 'number'
    && Number.isFinite(state.searchScrollY)
    && state.searchScrollY >= 0
  ) {
    return state.searchScrollY;
  }

  return null;
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

function getUrlCountries(searchParams: URLSearchParams): string[] | undefined {
  const rawCountries = searchParams.getAll('country').map((country) => country.trim()).filter(Boolean);

  if (rawCountries.length > 0) {
    return Array.from(new Set(rawCountries));
  }

  const rawCountry = searchParams.get('country');

  return rawCountry ? [rawCountry.trim()].filter(Boolean) : undefined;
}

function isReleasePeriod(value: unknown): value is ReleasePeriod {
  return value === 'today' || value === '7d' || value === '14d' || value === '1m';
}

function isReleaseTypeFilter(value: unknown): value is ReleaseTypeFilter {
  return value === 'all' || value === 'single' || value === 'album' || value === 'compilation';
}

function isReleaseSort(value: unknown): value is ReleaseSort {
  return value === 'newest' || value === 'oldest' || value === 'popular' || value === 'less-popular';
}

function normalizeInsightsPeriod(value: unknown): InsightsPeriod | undefined {
  const normalized = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  return normalized === 7 || normalized === 14 || normalized === 30 ? normalized : undefined;
}

function normalizeInsightsType(value: unknown): InsightsType | undefined {
  return value === 'all' || value === 'single' || value === 'album' ? value : undefined;
}

function normalizePopularityQueryValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const normalized = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;

  if (!Number.isFinite(normalized)) {
    return undefined;
  }

  return Math.min(Math.max(Math.trunc(normalized), 0), 100);
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

function getReleaseGenres(release: Release, t: Translation): string[] {
  const normalized = release.genres.map((genre) => genre.trim()).filter(Boolean);

  return normalized.length > 0 ? normalized : [t.release.unknown];
}

function getKnownReleaseGenres(release: Release): string[] {
  return release.genres.map((genre) => genre.trim()).filter(Boolean);
}

function getCompactReleaseGenreSummary(release: Release, t: Translation): string {
  const genres = getReleaseGenres(release, t);

  if (genres.length <= 2) {
    return genres.join(', ');
  }

  return `${genres.slice(0, 2).join(', ')} +${genres.length - 2}`;
}

function formatUnknown(value: string, t: Translation): string {
  const normalized = value.trim();

  return normalized === '' || normalized === 'unknown' ? t.release.unknown : normalized;
}

function hasMeaningfulText(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  return normalized !== '' && normalized !== 'unknown';
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function getGenreLabel(genre: string, t: Translation): string {
  return genre === NO_GENRE_FILTER ? t.filters.noGenre : genre;
}

function getCountryLabel(country: string, t: Translation): string {
  return country.trim().toLowerCase() === 'unknown' ? t.filters.noCountry : country;
}

function getReleasePath(
  releaseId: string,
  searchState: ReleaseSearchState,
  language: Language,
): string {
  return `${RELEASE_ROUTE_PREFIX}${encodeURIComponent(releaseId)}${buildSearchQuery(searchState, language)}`;
}

function buildSearchUrl(searchState: ReleaseSearchState, language: Language, insightsReturnState: InsightsReturnState | null = null): string {
  return `/${buildSearchQuery(searchState, language, insightsReturnState)}`;
}

function buildSearchQuery(searchState: ReleaseSearchState, language: Language, insightsReturnState: InsightsReturnState | null = null): string {
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

  searchState.countries.forEach((country) => {
    const normalizedCountry = country.trim();

    if (normalizedCountry) {
      params.append('country', normalizedCountry);
    }
  });

  if (searchState.popularityMin !== undefined) {
    params.set('popularityMin', String(searchState.popularityMin));
  }

  if (searchState.popularityMax !== undefined) {
    params.set('popularityMax', String(searchState.popularityMax));
  }

  if (insightsReturnState) {
    params.set('from', 'insights');
    if (insightsReturnState.insightId) {
      params.set('insightId', insightsReturnState.insightId);
    }
  }

  if (language !== 'en') {
    params.set('lang', language);
  }

  const query = params.toString();

  return query ? `?${query}` : '';
}

function buildInsightsUrl(filters: InsightsFilters, language: Language): string {
  const params = new URLSearchParams({
    period: String(filters.period),
    type: filters.type,
  });

  if (language !== 'en') {
    params.set('lang', language);
  }

  return `/insights?${params}`;
}

function getSearchPeriodFromInsightsPeriod(period: InsightsPeriod): ReleasePeriod {
  if (period === 7) {
    return '7d';
  }

  if (period === 14) {
    return '14d';
  }

  return '1m';
}

function getInsightsPeriodFromSearchPeriod(period: string | null): InsightsPeriod | undefined {
  if (period === '7d') {
    return 7;
  }

  if (period === '14d') {
    return 14;
  }

  if (period === '1m') {
    return 30;
  }

  return undefined;
}

function getSearchTypeFromInsightsType(type: InsightsType): ReleaseTypeFilter {
  return type;
}

function getInsightsTypeFromSearchType(type: string | null): InsightsType | undefined {
  return type === 'all' || type === 'single' || type === 'album' ? type : undefined;
}

function getInsightsItemsCount(data: InsightsData): number {
  return [
    data.sections.countries.mostActiveCountries.byReleases,
    data.sections.countries.mostActiveCountries.byArtists,
    data.sections.countries.rareCountries,
    data.sections.countries.bigArtistsFromSmallScenes,
    data.sections.countries.mostDiverseCountries,
    data.sections.genres.mostActiveGenres,
    data.sections.genres.rareGenreDrops,
    data.sections.genres.mostMainstreamGenres,
    data.sections.genres.deepUndergroundGenres,
    data.sections.scenes.topScenes,
    data.sections.discovery.popularArtistsInNicheGenres,
    data.sections.discovery.deepUndergroundDrops,
  ].reduce((total, items) => total + items.length, 0);
}

function getCompactCountrySummary(countries: string[]): string[] {
  if (countries.length <= 2) {
    return countries;
  }

  return [...countries.slice(0, 2), `+${countries.length - 2}`];
}

function getRouteFromPath(pathname: string): AppRoute {
  if (pathname === '/insights') {
    return { view: 'insights' };
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
