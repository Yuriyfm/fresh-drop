import { useMemo, useState } from 'react';
import './App.css';
import type { PopularityFilter, Release, ReleasePeriod, ReleaseTypeFilter } from './domain/release';
import { filterReleases } from './domain/releaseFilters';

const sampleReleases: Release[] = [
  {
    id: 'demo-1',
    spotifyUrl: null,
    coverUrl: null,
    title: 'Fresh Signal',
    artists: [
      {
        id: 'artist-1',
        name: 'Northline',
        genres: ['indie pop'],
        country: 'unknown',
        popularity: 62,
      },
    ],
    primaryArtist: {
      id: 'artist-1',
      name: 'Northline',
      genres: ['indie pop'],
      country: 'unknown',
      popularity: 62,
    },
    type: 'single',
    releaseDate: new Date().toISOString().slice(0, 10),
    releaseDatePrecision: 'day',
    genres: ['indie pop'],
    country: 'unknown',
    popularity: 62,
  },
];

function App() {
  const [period, setPeriod] = useState<ReleasePeriod>('7d');
  const [type, setType] = useState<ReleaseTypeFilter>('all');
  const [popularity, setPopularity] = useState<PopularityFilter>('all');

  const releases = useMemo(
    () =>
      filterReleases(sampleReleases, {
        period,
        type,
        popularity,
        currentDate: new Date(),
      }),
    [period, popularity, type],
  );

  return (
    <main className="appShell">
      <section className="toolbar" aria-label="Фильтры релизов">
        <div>
          <h1>Fresh Drop</h1>
          <p>Свежие релизы Spotify с фильтрами для MVP.</p>
        </div>

        <label>
          Период
          <select value={period} onChange={(event) => setPeriod(event.target.value as ReleasePeriod)}>
            <option value="7d">7 дней</option>
            <option value="14d">14 дней</option>
            <option value="1m">1 месяц</option>
          </select>
        </label>

        <label>
          Тип
          <select value={type} onChange={(event) => setType(event.target.value as ReleaseTypeFilter)}>
            <option value="all">Все</option>
            <option value="single">Single</option>
            <option value="album">Album</option>
            <option value="compilation">Compilation</option>
          </select>
        </label>

        <label>
          Популярность
          <select value={popularity} onChange={(event) => setPopularity(event.target.value as PopularityFilter)}>
            <option value="all">Все</option>
            <option value="popular">Popular</option>
            <option value="less-known">Less-known</option>
          </select>
        </label>
      </section>

      <section className="releaseList" aria-label="Релизы">
        {releases.map((release) => (
          <article className="releaseCard" key={release.id}>
            <div className="coverPlaceholder" aria-hidden="true" />
            <div>
              <h2>{release.title}</h2>
              <p>{release.artists.map((artist) => artist.name).join(', ') || 'Unknown artist'}</p>
              <dl>
                <div>
                  <dt>Тип</dt>
                  <dd>{release.type}</dd>
                </div>
                <div>
                  <dt>Дата</dt>
                  <dd>{release.releaseDate}</dd>
                </div>
                <div>
                  <dt>Жанры</dt>
                  <dd>{release.genres.join(', ') || 'unknown'}</dd>
                </div>
              </dl>
            </div>
          </article>
        ))}

        {releases.length === 0 && <p className="emptyState">Релизы не найдены.</p>}
      </section>
    </main>
  );
}

export default App;
