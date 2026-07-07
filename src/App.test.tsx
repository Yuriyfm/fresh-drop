import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { InsightsData } from './domain/insights';
import type { Release } from './domain/release';
import { LANGUAGE_STORAGE_KEY } from './i18n';

const RELEASE_SEARCH_STORAGE_KEY = 'fresh-drop-release-search-state';
let intersectionCallback: IntersectionObserverCallback | null = null;

class MockIntersectionObserver implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = '';
  readonly thresholds = [];

  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback;
  }

  disconnect = vi.fn();
  observe = vi.fn();
  takeRecords = vi.fn(() => []);
  unobserve = vi.fn();
}

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState(null, '', '/');
    setViewportWidth(1024);
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 0,
    });
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    intersectionCallback = null;
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
    setViewportWidth(1024);
    window.history.pushState(null, '', '/');
  });

  it('loads releases from /api/releases and renders metadata-backed filters', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ genres: ['indie pop'], country: 'SE' })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByRole('checkbox', { name: /indie pop/i })).toBeInTheDocument();
    expect(screen.getAllByText('Counts reflect the last month of releases.')).toHaveLength(2);
    expect(screen.getAllByLabelText('Country')[0]).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/api\/releases\?period=7d&type=all&sort=newest&page=1&limit=20&randomStartSeed=.+/,
      ),
      expect.any(Object),
    );
  });

  it('shows a compact genre preview in the release list item', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ genres: ['hip hop', 'rap', 'trap'] })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    const releaseRow = await screen.findByRole('button', { name: 'Open Release One' });

    expect(within(releaseRow).getByText('Artist One')).toBeInTheDocument();
    expect(within(releaseRow).getByText('Artist One')).toHaveAttribute('title', 'Artist One');
    expect(within(releaseRow).getByText('hip hop, rap +1')).toBeInTheDocument();
  });

  it('shows an empty state when the database has no matching releases', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByText('No releases found for these filters')).toBeInTheDocument();
    expect(screen.getByText('Try removing one genre or increasing the period.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear genres' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset all filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use Month' })).toBeInTheDocument();
  });

  it('reloads from page one when filters change', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ genres: ['techno'], country: 'DE' })],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            hasNextPage: false,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    render(<App />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /techno/i }));

    expect(screen.getByRole('button', { name: 'Clear genres' })).toBeInTheDocument();

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=7d&type=all&sort=newest&page=1&limit=20&genre=techno',
        expect.any(Object),
      );
    });
    expect(await screen.findByText('No releases found for these filters')).toBeInTheDocument();
  });

  it('sends filters and sorting to the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      makeResponse({
        items: [makeRelease({ genres: ['techno'], country: 'DE', type: 'album', popularity: 80 })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    ));

    render(<App />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /techno/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=7d&type=album&sort=popular&page=1&limit=20&genre=techno',
        expect.any(Object),
      );
    });
  });

  it('sends today period to the API and keeps the compact period control usable', async () => {
    setViewportWidth(390);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        makeResponse({
          items: [makeRelease({ genres: ['techno'], country: 'DE', type: 'album', popularity: 80 })],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            hasNextPage: false,
          },
          error: null,
        }),
      ),
    );

    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Today' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringContaining('/api/releases?period=today&type=all&sort=newest&page=1&limit=20'),
        expect.any(Object),
      );
    });
    expect(window.location.search).toBe('?period=today&type=all&sort=newest');
    expect(container.querySelector('.mobileDiscoveryPeriod .segmentedControl.isPeriodControl')).not.toBeNull();
  });

  it('sends selected countries to the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      makeResponse({
        items: [makeRelease({ genres: ['techno'], country: 'United States' })],
        countries: [{ name: 'United States', releaseCount: 1 }],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    ));

    render(<App />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /United States/i }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringContaining('&country=United+States'),
        expect.any(Object),
      );
    });
  });

  it('uses compact mobile discovery controls and a single filters entry on small screens', async () => {
    setViewportWidth(360);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      makeResponse({
        items: [makeRelease({ genres: ['techno'], country: 'DE', type: 'album', popularity: 80 })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    ));

    const { container } = render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Sorting' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Search genres')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Filters' })).toHaveLength(1);
    expect(container.querySelector('.mobileDiscoveryHeader')).not.toBeNull();
    expect(container.querySelector('.mobileResultsSummary')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search genres')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compilations' })).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(within(screen.getByRole('dialog', { name: 'Filters' })).queryByText('Sorting')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringContaining('type=album&sort=popular'),
        expect.any(Object),
      );
    });
  });

  it('opens language settings from the mobile header instead of showing the switcher inline', async () => {
    setViewportWidth(390);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Русский' })).toBeInTheDocument();
  });

  it('uses desktop sidebar layout with sorting above the results on wide screens', async () => {
    setViewportWidth(1280);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    const { container } = render(<App />);

    expect(await screen.findByRole('checkbox', { name: /indie pop/i })).toBeInTheDocument();
    expect(container.querySelector('.searchLayout.isDesktopSidebar')).not.toBeNull();
    expect(container.querySelector('.searchSidebar .filterPanel')).not.toBeNull();
    expect(container.querySelector('.searchSidebar select')).toBeNull();
    expect(container.querySelector('.resultsToolbar .sortToolbar')).not.toBeNull();
    expect(container.querySelector('.searchSidebar .sidebarResetButton')).toBeNull();
  });

  it('opens how it works as a desktop modal without changing the route', async () => {
    setViewportWidth(1280);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));

    const dialog = screen.getByRole('dialog', { name: 'How it works' });

    expect(window.location.pathname).toBe('/');
    expect(dialog).toHaveClass('dialogPanel', 'helpModal');
    expect(screen.getByText('What the filters use')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'How it works' })).toBeNull();
    });
  });

  it('shows a mobile results summary with count, chips, and reset', async () => {
    setViewportWidth(390);

    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      makeResponse({
        items: [makeRelease({ genres: ['techno'] })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    ));

    const { container } = render(<App />);
    const getMobileSummary = () => within(container.querySelector('.mobileResultsSummary') as HTMLElement);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(getMobileSummary().getByText('1 release')).toBeInTheDocument();
    expect(getMobileSummary().getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Filters' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    expect(container.querySelector('.mobileResultsSummary')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const technoOption = screen.getByRole('checkbox', { name: /techno/i });
    fireEvent.click(technoOption);
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(getMobileSummary().getByText('techno')).toBeInTheDocument();
    });
    expect(getMobileSummary().getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(getMobileSummary().getByText('Albums')).toBeInTheDocument();
    });
    expect((container.querySelector('.sortToolbarValue') as HTMLElement).textContent).toBe('Most popular');
  });

  it('shows an empty state when genre search has no matches', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ genres: ['techno'] })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search genres'), { target: { value: 'ambient' } });

    await waitFor(() => {
      expect(screen.getByText('No genres found')).toBeInTheDocument();
    });
  });

  it('keeps selected mobile genres visible after closing and reopening the filters sheet', async () => {
    setViewportWidth(390);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({ id: 'release-1', genres: ['techno'] }),
          makeRelease({ id: 'release-2', genres: ['dark techno'] }),
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);
    const getMobileSummary = () => within(document.querySelector('.mobileResultsSummary') as HTMLElement);

    expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.change(screen.getByPlaceholderText('Search genres'), { target: { value: 'tech' } });

    await waitFor(() => {
      expect(screen.getByRole('checkbox', { name: /^techno 1$/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('checkbox', { name: /^techno 1$/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(getMobileSummary().getByText('techno')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    expect(screen.getByRole('checkbox', { name: /^techno 1$/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('techno x')).toBeInTheDocument();
  });

  it('shows multiple selected mobile genres as summary chips without collapsing them into one ellipsis', async () => {
    setViewportWidth(390);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({ id: 'release-1', genres: ['techno'] }),
          makeRelease({ id: 'release-2', genres: ['house'] }),
          makeRelease({ id: 'release-3', genres: ['ambient'] }),
          makeRelease({ id: 'release-4', genres: ['jazz'] }),
          makeRelease({ id: 'release-5', genres: ['darkwave'] }),
          makeRelease({ id: 'release-6', genres: ['shoegaze'] }),
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 6,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);
    const getMobileSummary = () => within(document.querySelector('.mobileResultsSummary') as HTMLElement);

    expect(await screen.findByRole('button', { name: 'Filters' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));

    const genreNames = ['techno', 'house', 'ambient', 'jazz', 'darkwave', 'shoegaze'] as const;

    for (const genre of genreNames) {
      fireEvent.click(screen.getByRole('checkbox', { name: new RegExp(genre, 'i') }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(getMobileSummary().getByText('techno')).toBeInTheDocument();
      expect(getMobileSummary().getByText('house')).toBeInTheDocument();
      expect(getMobileSummary().getByText('ambient')).toBeInTheDocument();
      expect(getMobileSummary().getByText('jazz')).toBeInTheDocument();
      expect(getMobileSummary().getByText('darkwave')).toBeInTheDocument();
      expect(getMobileSummary().getByText('shoegaze')).toBeInTheDocument();
    });
    expect(getMobileSummary().queryByText('+1')).toBeNull();
  });

  it('shows a select matches action only for a non-empty genre search and adds all matched genres', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({ id: 'release-1', genres: ['dark ambient'] }),
          makeRelease({ id: 'release-2', genres: ['dark techno'] }),
          makeRelease({ id: 'release-3', genres: ['darkwave'] }),
          makeRelease({ id: 'release-4', genres: ['jazz'] }),
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 4,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByRole('checkbox', { name: /dark ambient/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Select matches' })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search genres'), { target: { value: 'dark' } });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Select matches' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Select matches' }));

    await waitFor(() => {
      expect(screen.getByText('dark ambient x')).toBeInTheDocument();
      expect(screen.getByText('dark techno x')).toBeInTheDocument();
      expect(screen.getByText('darkwave x')).toBeInTheDocument();
    });

    expect(screen.queryByText('jazz x')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('Search genres'), { target: { value: '' } });

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Select matches' })).toBeNull();
    });
  });

  it('loads saved filters and sorting from local storage', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ genres: ['techno'], type: 'album' })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );
    window.localStorage.setItem(
      RELEASE_SEARCH_STORAGE_KEY,
      JSON.stringify({ period: '14d', genre: 'techno', countries: ['Germany'], type: 'album', sort: 'popular' }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/releases?period=14d&type=album&sort=popular&page=1&limit=20&genre=techno&country=Germany',
      expect.any(Object),
    );
  });

  it('uses URL params before local storage preferences', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ genres: ['rap'], type: 'single' })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );
    window.localStorage.setItem(
      RELEASE_SEARCH_STORAGE_KEY,
      JSON.stringify({ period: '7d', genres: ['techno'], type: 'album', sort: 'newest' }),
    );
    window.history.pushState(null, '', '/?period=14d&type=single&sort=popular&genre=rap&lang=ru');

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/releases?period=14d&type=single&sort=popular&page=1&limit=20&genre=rap',
      expect.any(Object),
    );
    expect(screen.getByRole('button', { name: 'Как это работает' })).toBeInTheDocument();
  });

  it('resets saved filters and sorting in local storage', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(
      makeResponse({
        items: [makeRelease({ genres: ['techno'], type: 'album' })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    ));
    window.localStorage.setItem(
      RELEASE_SEARCH_STORAGE_KEY,
      JSON.stringify({ period: '14d', genre: 'techno', type: 'album', sort: 'popular' }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(RELEASE_SEARCH_STORAGE_KEY) ?? '{}')).toEqual({
        period: '7d',
        genres: [],
        countries: [],
        type: 'all',
        sort: 'newest',
      });
    });
    expect(window.location.search).toBe('?period=7d&type=all&sort=newest');
  });

  it('shows a floating back-to-top button after scrolling beyond two screens', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: makeReleases(1, 120),
        pagination: {
          page: 1,
          limit: 20,
          total: 120,
          hasNextPage: false,
        },
        error: null,
      }),
    );
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    render(<App />);

    expect(await screen.findByText('Release 1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back to top' })).toBeNull();

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: window.innerHeight * 2 + 24,
    });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    fireEvent.click(await screen.findByRole('button', { name: 'Back to top' }));

    expect(scrollToSpy).toHaveBeenCalledWith({
      top: 0,
      behavior: 'smooth',
    });
  });

  it('syncs active filters to the URL query params', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ genres: ['techno'], type: 'album' })],
        countries: [{ name: 'Germany', releaseCount: 1 }],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /techno/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Germany/i }));

    expect(window.location.search).toContain('country=Germany');

    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));

    await waitFor(() => {
      expect(window.location.search).toBe('?period=7d&type=album&sort=popular&genre=techno&country=Germany');
    });
  });

  it('shows an error state with retry', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            hasNextPage: false,
          },
          error: {
            code: 'internal_error',
            message: 'Internal server error.',
          },
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease()],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    render(<App />);

    expect(await screen.findByText('Could not load releases')).toBeInTheDocument();
    expect(screen.queryByText('Internal server error.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shows an error state when the database is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<App />);

    expect(await screen.findByText('Could not load releases')).toBeInTheDocument();
    expect(screen.getByText('We could not load releases right now. Your filters are still here.')).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).toBeNull();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('keeps the previous list visible while refetching filters and shows a loading indicator', async () => {
    let resolveSecondRequest: ((value: Response) => void) | undefined;
    const secondRequest = new Promise<Response>((resolve) => {
      resolveSecondRequest = resolve;
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ genres: ['techno'], title: 'Release One' })],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            hasNextPage: false,
          },
          error: null,
        }),
      )
      .mockImplementationOnce(() => secondRequest);

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: /techno/i }));

    expect(screen.getByText('Release One')).toBeInTheDocument();
    expect(screen.getAllByText('Updating').length).toBeGreaterThan(0);

    resolveSecondRequest?.(
      makeResponse({
        items: [makeRelease({ id: 'release-2', title: 'Release Two', genres: ['techno'] })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    expect(await screen.findByText('Release Two')).toBeInTheDocument();
  });

  it('uses empty-state shortcuts to recover from narrow filters', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ genres: ['techno'] })],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            hasNextPage: false,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: [],
          pagination: {
            page: 1,
            limit: 20,
            total: 0,
            hasNextPage: false,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ id: 'release-2', title: 'Release Two' })],
          pagination: {
            page: 1,
            limit: 20,
            total: 1,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    render(<App />);

    fireEvent.click(await screen.findByRole('checkbox', { name: /techno/i }));
    expect(await screen.findByText('No releases found for these filters')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use Month' }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=1m&type=all&sort=newest&page=1&limit=20&genre=techno',
        expect.any(Object),
      );
    });
    expect(await screen.findByText('Release Two')).toBeInTheDocument();
  });

  it('loads the next page when the list bottom enters the viewport', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ id: 'release-1', title: 'Release One' })],
          pagination: {
            page: 1,
            limit: 20,
            total: 2,
            hasNextPage: true,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ id: 'release-2', title: 'Release Two' })],
          pagination: {
            page: 2,
            limit: 20,
            total: 2,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();

    act(() => {
      intersectionCallback?.(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(await screen.findByText('Release Two')).toBeInTheDocument();
    expect(screen.getByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^\/api\/releases\?period=7d&type=all&sort=newest&page=2&limit=20&randomStartSeed=.+/,
      ),
      expect.any(Object),
    );
  });

  it('loads the next page on scroll when the bottom is reached even if the observer does not fire initially', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ id: 'release-1', title: 'Release One' })],
          pagination: {
            page: 1,
            limit: 20,
            total: 2,
            hasNextPage: true,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: [makeRelease({ id: 'release-2', title: 'Release Two' })],
          pagination: {
            page: 2,
            limit: 20,
            total: 2,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1200,
    });
    Object.defineProperty(document.body, 'scrollHeight', {
      configurable: true,
      value: 1200,
    });

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 320,
    });

    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    expect(await screen.findByText('Release Two')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenLastCalledWith(
      expect.stringMatching(
        /^\/api\/releases\?period=7d&type=all&sort=newest&page=2&limit=20&randomStartSeed=.+/,
      ),
      expect.any(Object),
    );
  });

  it('virtualizes loaded releases without dropping old data', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: makeReleases(1, 100),
          pagination: {
            page: 1,
            limit: 20,
            total: 300,
            hasNextPage: true,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: makeReleases(101, 100),
          pagination: {
            page: 2,
            limit: 20,
            total: 300,
            hasNextPage: true,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: makeReleases(201, 100),
          pagination: {
            page: 3,
            limit: 20,
            total: 300,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    render(<App />);

    expect(await screen.findByText('Release 1')).toBeInTheDocument();

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await waitFor(() => {
      expect(screen.getByText('Release 20')).toBeInTheDocument();
    });

    scrollToVirtualRelease(101);
    expect(await screen.findByText('Release 101')).toBeInTheDocument();

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await waitFor(() => {
      expect(screen.getByText('Release 101')).toBeInTheDocument();
    });

    scrollToVirtualRelease(300);
    expect(await screen.findByText('Release 300')).toBeInTheDocument();
    expect(screen.queryByText('Release 1')).not.toBeInTheDocument();

    scrollToVirtualRelease(1);
    expect(await screen.findByText('Release 1')).toBeInTheDocument();
  });

  it('renders the country filter even when the current results have unknown country', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({ id: 'release-1', title: 'Release One', country: 'unknown' }),
          makeRelease({ id: 'release-2', title: 'Release Two', country: 'unknown' }),
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.getByText('Release Two')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Country')[0]).toBeInTheDocument();
  });

  it('shows the missing country option first in the country filter', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({ id: 'release-1', title: 'Release One', country: 'unknown' }),
          makeRelease({ id: 'release-2', title: 'Release Two', country: 'Germany' }),
        ],
        countries: [
          { name: 'unknown', releaseCount: 1 },
          { name: 'Germany', releaseCount: 1 },
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 2,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    const countryOptions = screen.getAllByRole('checkbox', { name: /No country|Germany/ });

    expect(countryOptions[0]).toHaveTextContent('No country');
    expect(countryOptions[1]).toHaveTextContent('Germany');
  });

  it('shows Unknown for null popularity in release details instead of showing 0', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease({ popularity: null })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Release One' }));

    expect(screen.getByText('Popularity')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('opens release details at /releases/:id and returns to the preserved list', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({
            coverUrl: null,
            genres: [],
            country: 'unknown',
            popularity: null,
            type: 'unknown',
          }),
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );
    window.history.pushState(null, '', '/?period=14d&type=all&sort=newest&genre=hip-hop');
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 640,
    });

    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Release One' }));

    expect(window.location.pathname).toBe('/releases/release-1');
    expect(window.location.search).toBe('?period=14d&type=all&sort=newest&genre=hip-hop');
    expect(screen.getByRole('link', { name: 'Open in Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/album/release-1',
    );
    expect(screen.queryByRole('combobox', { name: 'Language' })).not.toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Artist country')).toBeInTheDocument();
    expect(screen.getByText('Popularity')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(container.querySelector('.detailCoverPlaceholder')).not.toBeNull();
    expect(container.querySelector('.releaseTopBarTitle')).toBeNull();
    expect(window.scrollTo).toHaveBeenCalledWith({
      top: 0,
      behavior: 'auto',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(`${window.location.pathname}${window.location.search}`).toBe('/?period=14d&type=all&sort=newest&genre=hip-hop');
    });
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 640,
      behavior: 'auto',
    });
    expect(await screen.findByRole('button', { name: 'Open Release One' })).toBeInTheDocument();
  });

  it('returns from release details without dropping the loaded pages or scroll position', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        makeResponse({
          items: makeReleases(1, 100),
          pagination: {
            page: 1,
            limit: 20,
            total: 200,
            hasNextPage: true,
          },
          error: null,
        }),
      )
      .mockResolvedValueOnce(
        makeResponse({
          items: makeReleases(101, 100),
          pagination: {
            page: 2,
            limit: 20,
            total: 200,
            hasNextPage: false,
          },
          error: null,
        }),
      );

    render(<App />);

    expect(await screen.findByText('Release 1')).toBeInTheDocument();

    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
    });
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        expect.stringMatching(/^\/api\/releases\?period=7d&type=all&sort=newest&page=2&limit=20&randomStartSeed=.+/),
        expect.any(Object),
      );
    });

    scrollToVirtualRelease(120);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Release 120' }));

    expect(window.location.pathname).toBe('/releases/release-120');

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 10948,
      behavior: 'auto',
    });
    expect(await screen.findByRole('button', { name: 'Open Release 120' })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('renders a compact mobile release detail with a sticky spotify action and genre chips', async () => {
    setViewportWidth(390);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [
          makeRelease({
            genres: ['hip hop', 'rap'],
            type: 'album',
          }),
        ],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Release One' }));

    expect(container.querySelector('.releaseTopBar')).not.toBeNull();
    expect(container.querySelector('.releaseTopBarTitle')).toBeNull();
    expect(container.querySelector('.detailBottomBar')).not.toBeNull();
    expect(screen.getByRole('heading', { name: 'Release One' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open in Spotify' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('Genres')).toBeInTheDocument();
    expect(screen.getByText('hip hop')).toHaveClass('genreChip');
    expect(screen.getByText('rap')).toHaveClass('genreChip');
    expect(screen.getAllByText('Album').length).toBe(1);
    expect(container.querySelector('.shownBecause')).toBeNull();

    expect(container.querySelector('.detailMetaCard')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
  });

  it('opens How it works in a desktop modal without changing the search route', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 320,
    });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));

    const dialog = screen.getByRole('dialog', { name: 'How it works' });

    expect(window.location.pathname).toBe('/');
    expect(dialog).toHaveClass('dialogPanel', 'helpModal');
    expect(screen.getByRole('heading', { name: /not recommendations/i })).toBeInTheDocument();
    expect(screen.getByText(/Genres are usually attached to artists/i)).toBeInTheDocument();
    expect(screen.getByText(/Unknown instead of guessing/i)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'How it works' })).toBeNull();
    });
    expect(window.location.pathname).toBe('/');
    expect(window.scrollY).toBe(320);
    expect(await screen.findByText('Fresh Spotify releases, filtered for quick discovery.')).toBeInTheDocument();
  });

  it('opens How it works as a mobile bottom sheet', async () => {
    setViewportWidth(390);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));

    const dialog = screen.getByRole('dialog', { name: 'How it works' });

    expect(window.location.pathname).toBe('/');
    expect(dialog).toHaveClass('bottomSheet', 'helpSheet');
    expect(screen.getByText('What the filters use')).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'How it works' })).toBeNull();
    });
  });

  it('switches UI language to Russian and saves the choice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }),
    );

    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Language' }), { target: { value: 'ru' } });

    expect(screen.getByText('Свежие релизы Spotify с быстрым поиском по фильтрам.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Язык' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Как это работает' })).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
  });

  it('reuses loaded insights when returning to the insights page', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);

      if (url.startsWith('/api/insights')) {
        return Promise.resolve(makeResponse(makeInsightsData()));
      }

      return Promise.resolve(makeResponse({
        items: [makeRelease()],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }));
    });
    window.history.pushState(null, '', '/insights?period=30&type=all');

    render(<App />);

    expect(await screen.findByText('Deep underground drops')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('/api/insights'))).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Releases' }));
    expect(await screen.findByText('Release One')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Insights' }));
    expect(await screen.findByText('Deep underground drops')).toBeInTheDocument();
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('/api/insights'))).toHaveLength(1);
  });

  it('refreshes insights only when the refresh button is clicked', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(makeInsightsData()));
    window.history.pushState(null, '', '/insights?period=30&type=all');

    render(<App />);

    expect(await screen.findByText('Deep underground drops')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => {
      expect(fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('/api/insights'))).toHaveLength(2);
    });
  });

  it('opens a big artist from a small scene on the latest release detail page', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);

      if (url.startsWith('/api/insights')) {
        return Promise.resolve(makeResponse(makeInsightsData()));
      }

      return Promise.resolve(makeResponse({
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          hasNextPage: false,
        },
        error: null,
      }));
    });
    window.history.pushState(null, '', '/insights?period=30&type=all');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Scene Star/i }));

    expect(window.location.pathname).toBe('/releases/small-scene-new');
    expect(window.location.search).toBe('?period=1m&type=all&sort=newest&country=Poland&popularityMin=50');
    expect(await screen.findByRole('heading', { name: 'New Small Scene Release' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/album/small-scene-new',
    );
    expect(screen.queryByText('Release not loaded')).toBeNull();
    expect(fetchSpy.mock.calls.filter(([input]) => String(input).startsWith('/api/releases'))).toHaveLength(0);
  });

  it('opens deep underground insight items as filtered search results instead of unloaded release details', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
      const url = String(input);

      if (url.startsWith('/api/insights')) {
        return Promise.resolve(makeResponse(makeInsightsData()));
      }

      return Promise.resolve(makeResponse({
        items: [makeRelease({ id: 'release-underground', title: 'Basement Signal', popularity: 12 })],
        pagination: {
          page: 1,
          limit: 20,
          total: 1,
          hasNextPage: false,
        },
        error: null,
      }));
    });
    window.history.pushState(null, '', '/insights?period=30&type=all');

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: /Basement Signal/i }));

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?period=1m&type=all&sort=newest&popularityMax=20&from=insights&insightId=deep-underground-drops');

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=1m&type=all&sort=newest&page=1&limit=20&popularityMax=20',
        expect.any(Object),
      );
    });
    expect(await screen.findByText('Basement Signal')).toBeInTheDocument();
    expect(screen.queryByText('Release not loaded')).toBeNull();
  });
});

function makeResponse(body: unknown): Response {
  return new Response(JSON.stringify(withDefaultGenres(body)), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function withDefaultGenres(body: unknown): unknown {
  if (!isReleaseApiBody(body)) {
    return body;
  }

  const counts = new Map<string, number>();
  const countryCounts = new Map<string, number>();

  for (const release of body.items) {
    for (const genre of release.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }

    if (release.country !== 'unknown') {
      countryCounts.set(release.country, (countryCounts.get(release.country) ?? 0) + 1);
    }
  }

  return {
    ...body,
    genres: body.genres ?? Array.from(counts.entries()).map(([name, releaseCount]) => ({ name, releaseCount, kind: 'exact' })),
    countries: body.countries ?? Array.from(countryCounts.entries()).map(([name, releaseCount]) => ({ name, releaseCount })),
  };
}

function isReleaseApiBody(body: unknown): body is { items: Release[]; genres?: unknown; countries?: unknown } {
  return typeof body === 'object' && body !== null && 'items' in body && Array.isArray((body as { items?: unknown }).items);
}

function makeRelease(overrides: Partial<Release> & { artistName?: string } = {}): Release {
  const artist = {
    id: 'artist-1',
    name: overrides.artistName ?? 'Artist One',
    genres: overrides.genres ?? ['indie pop'],
    country: 'unknown' as const,
    popularity: 70,
  };

  return {
    id: 'release-1',
    spotifyUrl: 'https://open.spotify.com/album/release-1',
    coverUrl: null,
    title: 'Release One',
    artists: [artist],
    primaryArtist: artist,
    type: 'single',
    releaseDate: '2026-06-30',
    releaseDatePrecision: 'day',
    genres: ['indie pop'],
    country: 'unknown',
    popularity: 70,
    ...overrides,
  };
}

function makeReleases(startId: number, count: number): Release[] {
  return Array.from({ length: count }, (_, index) => {
    const id = startId + index;

    return makeRelease({
      id: `release-${id}`,
      title: `Release ${id}`,
    });
  });
}

function makeInsightsData(): InsightsData & { error: null } {
  const smallSceneRelease = makeRelease({
    id: 'small-scene-new',
    title: 'New Small Scene Release',
    spotifyUrl: 'https://open.spotify.com/album/small-scene-new',
    country: 'Poland',
    popularity: 80,
    releaseDate: '2026-07-06',
    artistName: 'Scene Star',
  });

  return {
    period: 30,
    type: 'all',
    generatedAt: '2026-07-07T00:00:00.000Z',
    sections: {
      countries: {
        mostActiveCountries: {
          byReleases: [],
          byArtists: [],
        },
        rareCountries: [],
        bigArtistsFromSmallScenes: [
          {
            id: 'Scene Star',
            title: 'Scene Star',
            description: 'Poland',
            metric: 'popularity 80 · latest release: New Small Scene Release',
            query: {
              releaseId: 'small-scene-new',
              country: 'Poland',
              popularityMin: 50,
            },
            release: smallSceneRelease,
          },
        ],
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
        deepUndergroundDrops: [
          {
            id: 'release-underground',
            title: 'Basement Signal',
            description: 'Unknown · lo-fi',
            metric: 'Artist One · popularity 12',
            query: {
              releaseId: 'release-underground',
              popularityMax: 20,
            },
          },
        ],
      },
    },
    error: null,
  };
}

function scrollToVirtualRelease(releaseNumber: number): void {
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    value: Math.max((releaseNumber - 1) * 92, 0),
  });

  act(() => {
    window.dispatchEvent(new Event('scroll'));
  });
}

function setViewportWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: width,
  });
}
