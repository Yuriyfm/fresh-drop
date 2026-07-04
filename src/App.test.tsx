import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
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

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /indie pop/i })).toBeInTheDocument();
    expect(screen.getByText('Counts reflect the last month of releases.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Country / market')).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\/api\/releases\?period=7d&type=all&sort=newest&page=1&limit=20&randomStartSeed=.+/,
      ),
      expect.any(Object),
    );
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
    fireEvent.change(screen.getAllByLabelText('Sorting')[0], { target: { value: 'popular' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=7d&type=album&sort=popular&page=1&limit=20&genre=techno',
        expect.any(Object),
      );
    });
  });

  it('uses mobile-friendly controls for period, type, and sorting on small screens', async () => {
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

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '7 days' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Sorting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /More filters/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('dialog', { name: 'More filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compilations' })).toBeInTheDocument();

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

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Language' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Language')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'English' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Russian' })).toBeInTheDocument();
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

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(container.querySelector('.searchLayout.isDesktopSidebar')).not.toBeNull();
    expect(container.querySelector('.searchSidebar .filterPanel')).not.toBeNull();
    expect(container.querySelector('.searchSidebar select')).toBeNull();
    expect(container.querySelector('.resultsToolbar select')).not.toBeNull();
    expect(container.querySelector('.searchSidebar .sidebarResetButton')).toBeNull();
  });

  it('shows a sticky mobile summary bar with filter actions', async () => {
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

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(screen.getByText('1 release · Last 7 days')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    expect(container.querySelector('.stickySummaryButton')).toBeNull();

    const genreToggle = screen.getByRole('button', { name: 'Show genres' });
    expect(genreToggle).not.toHaveClass('isActive');

    fireEvent.click(genreToggle);
    expect(screen.getByRole('button', { name: 'Hide genres' })).toHaveClass('isActive');
    const technoOption = screen.getByRole('checkbox', { name: /techno/i });
    expect(technoOption.tagName).toBe('BUTTON');
    fireEvent.click(technoOption);

    await waitFor(() => {
      expect(screen.getByText('1 release · techno')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }));
    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    fireEvent.click(screen.getByRole('button', { name: 'Most popular' }));

    await waitFor(() => {
      expect(screen.getByText('1 release · techno · Albums · Most popular')).toBeInTheDocument();
    });

    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: Math.ceil(window.innerHeight * 0.7),
    });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });

    await waitFor(() => {
      expect(container.querySelector('.stickySummaryButton')).not.toBeNull();
    });

    fireEvent.click(container.querySelector('.stickySummaryButton') as HTMLButtonElement);
    expect(screen.getByRole('dialog', { name: 'More filters' })).toBeInTheDocument();
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
      JSON.stringify({ period: '14d', genre: 'techno', type: 'album', sort: 'popular' }),
    );

    render(<App />);

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/releases?period=14d&type=album&sort=popular&page=1&limit=20&genre=techno',
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
    fireEvent.click(screen.getByRole('button', { name: 'Albums' }));
    fireEvent.change(screen.getAllByLabelText('Sorting')[0], { target: { value: 'popular' } });

    await waitFor(() => {
      expect(window.location.search).toBe('?period=7d&type=album&sort=popular&genre=techno');
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

  it('does not render the country filter', async () => {
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
    expect(screen.queryByLabelText('Country / market')).not.toBeInTheDocument();
  });

  it('shows null popularity as Unknown instead of 0 in release details', async () => {
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

    expect(screen.getByText('Popularity').nextElementSibling).toHaveTextContent('Unknown');
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

    const { container } = render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Release One' }));

    expect(window.location.pathname).toBe('/releases/release-1');
    expect(window.location.search).toBe('?period=14d&type=all&sort=newest&genre=hip-hop');
    expect(screen.getByRole('link', { name: 'Open in Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/album/release-1',
    );
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.detailCoverPlaceholder')).not.toBeNull();
    expect(container.querySelector('.releaseTopBarTitle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() => {
      expect(`${window.location.pathname}${window.location.search}`).toBe('/?period=14d&type=all&sort=newest&genre=hip-hop');
    });
    expect(await screen.findByRole('button', { name: 'Open Release One' })).toBeInTheDocument();
  });

  it('renders a mobile-first release detail layout with sticky actions and genre chips', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Russian' }));

    expect(screen.getByText('Свежие релизы Spotify с быстрым поиском по фильтрам.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Язык' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Как это работает' })).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
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
  if (!isReleaseApiBody(body) || body.genres) {
    return body;
  }

  const counts = new Map<string, number>();

  for (const release of body.items) {
    for (const genre of release.genres) {
      counts.set(genre, (counts.get(genre) ?? 0) + 1);
    }
  }

  return {
    ...body,
    genres: Array.from(counts.entries()).map(([name, releaseCount]) => ({ name, releaseCount, kind: 'exact' })),
  };
}

function isReleaseApiBody(body: unknown): body is { items: Release[]; genres?: unknown } {
  return typeof body === 'object' && body !== null && 'items' in body && Array.isArray((body as { items?: unknown }).items);
}

function makeRelease(overrides: Partial<Release> = {}): Release {
  const artist = {
    id: 'artist-1',
    name: 'Artist One',
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
