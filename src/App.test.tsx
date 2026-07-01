import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import type { Release } from './domain/release';
import { LANGUAGE_STORAGE_KEY } from './i18n';

describe('App', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.pushState(null, '', '/');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
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
    expect(screen.getByRole('option', { name: 'indie pop' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'SE' })).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/releases?period=7d&type=all&popularity=all&page=1&limit=20',
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

    expect(await screen.findByText('No releases found')).toBeInTheDocument();
    expect(screen.getByText('Try a wider period or fewer filters.')).toBeInTheDocument();
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

    await screen.findByRole('option', { name: 'techno' });
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'techno' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=7d&type=all&popularity=all&page=1&limit=20&genre=techno',
        expect.any(Object),
      );
    });
    expect(await screen.findByText('No releases found')).toBeInTheDocument();
  });

  it('sends genre, country, type, and popularity filters to the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
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
    );

    render(<App />);

    await screen.findByRole('option', { name: 'techno' });
    fireEvent.change(screen.getByLabelText('Genre'), { target: { value: 'techno' } });
    fireEvent.change(screen.getAllByLabelText('Country / market')[0], { target: { value: 'DE' } });
    fireEvent.change(screen.getAllByLabelText('Type')[0], { target: { value: 'album' } });
    fireEvent.change(screen.getAllByLabelText('Popularity')[0], { target: { value: 'popular' } });

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenLastCalledWith(
        '/api/releases?period=7d&type=album&popularity=popular&page=1&limit=20&genre=techno&country=DE',
        expect.any(Object),
      );
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
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('shows an error state when the database is unreachable', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<App />);

    expect(await screen.findByText('Could not load releases')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('loads the next page with Load more and appends releases', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));

    expect(await screen.findByText('Release Two')).toBeInTheDocument();
    expect(screen.getByText('Release One')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenLastCalledWith(
      '/api/releases?period=7d&type=all&popularity=all&page=2&limit=20',
      expect.any(Object),
    );
  });

  it('does not offer unknown as a country filter when most releases have unknown country', async () => {
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
    expect(screen.queryByRole('option', { name: 'unknown' })).not.toBeInTheDocument();
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

    render(<App />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open Release One' }));

    expect(window.location.pathname).toBe('/releases/release-1');
    expect(screen.getByRole('link', { name: 'Open in Spotify' })).toHaveAttribute(
      'href',
      'https://open.spotify.com/album/release-1',
    );
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(3);

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(await screen.findByRole('button', { name: 'Open Release One' })).toBeInTheDocument();
  });

  it('opens About / How it works and explains metadata limits', async () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));

    expect(window.location.pathname).toBe('/about');
    expect(screen.getByRole('heading', { name: /not recommendations/i })).toBeInTheDocument();
    expect(screen.getByText(/Genres are usually attached to artists/i)).toBeInTheDocument();
    expect(screen.getByText(/Unknown instead of guessing/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /back/i }));

    await waitFor(() => {
      expect(window.location.pathname).toBe('/');
    });
    expect(await screen.findByText('Fresh Spotify releases, filtered for quick discovery.')).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ru' } });

    expect(screen.getByText('Свежие релизы Spotify с быстрым поиском по фильтрам.')).toBeInTheDocument();
    expect(screen.getByLabelText('Язык')).toHaveValue('ru');
    expect(screen.getByRole('button', { name: 'Как это работает' })).toBeInTheDocument();
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('ru');
  });
});

function makeResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
    },
  });
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
