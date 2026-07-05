# MusicBrainz Artist Genre Enrichment

## Goal

Дополнить жанры артистов, которые пришли из Spotify, отдельным асинхронным enrichment через MusicBrainz.

Цепочка первого этапа:

```text
Spotify artist id
-> Spotify artist URL
-> MusicBrainz /url lookup
-> MusicBrainz artist MBID
-> MusicBrainz artist genres
```

## Scope

На этом этапе добавляются только:

- очередь артистов на enrichment;
- lookup MusicBrainz artist по Spotify artist URL;
- lookup MusicBrainz genres по artist MBID;
- хранение MusicBrainz genres в локальной БД;
- объединение Spotify genres и MusicBrainz genres в release API.

Не добавляются:

- fallback search по имени артиста;
- MusicBrainz tags;
- enrichment country / area;
- enrichment release, release-group, label, rating, annotation;
- Cover Art Archive.

## Data Flow

Обязательный поток:

```text
Spotify releases fetched
-> releases saved
-> unique Spotify artists extracted
-> artist_enrichment upserted
-> MusicBrainz worker processes artists in background
```

Spotify sync и crawler не должны ждать MusicBrainz и не должны падать из-за MusicBrainz.

## Config

Поддерживаются env-переменные:

```env
MUSICBRAINZ_ENABLED=true
MUSICBRAINZ_BASE_URL=https://musicbrainz.org/ws/2
MUSICBRAINZ_USER_AGENT=FreshDrop/0.1.0 (your-email@example.com)
MUSICBRAINZ_RATE_LIMIT_MS=1100
MUSICBRAINZ_URL_LOOKUP_BATCH_SIZE=100
```

Правила:

- `MUSICBRAINZ_USER_AGENT` обязателен, если `MUSICBRAINZ_ENABLED=true`;
- все MusicBrainz запросы отправляются с `User-Agent` и `Accept: application/json`;
- rate limit общий для всех MusicBrainz запросов;
- `MUSICBRAINZ_RATE_LIMIT_MS` по умолчанию `1100`.

## artist_enrichment

В БД хранится таблица `artist_enrichment`.

Минимальные поля:

```text
spotify_artist_id
spotify_artist_name
spotify_artist_url
musicbrainz_artist_mbid
musicbrainz_artist_name
genres
match_status
match_method
error_message
fetched_at
next_retry_at
retry_count
created_at
updated_at
```

`genres` хранится в `jsonb` как массив объектов:

```ts
type NormalizedMusicBrainzGenre = {
  id?: string;
  name: string;
  count?: number;
  source: 'musicbrainz';
};
```

Допустимые `match_status`:

- `pending`
- `matched`
- `not_found`
- `ambiguous`
- `failed`
- `disabled`

На первом этапе `match_method` может быть только `spotify_url_lookup`.

## Queue Upsert

При сохранении релизов приложение извлекает уникальных артистов по `spotify_artist_id` и upsert'ит их в `artist_enrichment`.

Правила:

- dedupe идёт только по `spotify_artist_id`;
- Spotify artist URL строится как `https://open.spotify.com/artist/<spotify_artist_id>`;
- новый артист получает статус `pending`, если MusicBrainz enrichment включён;
- новый артист получает статус `disabled`, если MusicBrainz enrichment выключен;
- повторный sync не должен сбрасывать существующие статусы `matched`, `not_found`, `ambiguous`, `failed`, `disabled`;
- разрешено обновлять `spotify_artist_name` и `spotify_artist_url`.

## MusicBrainz URL Lookup

Для поиска MusicBrainz artist используется endpoint:

```text
GET /url?resource=<spotify_artist_url>&inc=artist-rels&fmt=json
```

Для batch lookup допускается до `100` значений `resource` в одном запросе.

Правила parsing:

- `matched`: найден ровно один relation с `target-type=artist` и корректным `artist.id`;
- `not_found`: entity для URL не найдена или у entity нет relations;
- `ambiguous`: найдено больше одного artist relation, relation без `artist.id`, либо response не позволяет уверенно выбрать одного артиста.

## MusicBrainz Artist Genres

Жанры читаются через:

```text
GET /artist/<mbid>?inc=genres&fmt=json
```

Используется только поле `genres`.

Нормализация:

- удалить пустые значения;
- `trim()` для `name`;
- дедупликация по lowercased `name`;
- при дублях сохранять жанр с наибольшим `count`;
- сортировка: `count desc`, затем `name asc`;
- `source` всегда `musicbrainz`.

## Worker

CLI-воркер обрабатывает артистов из `artist_enrichment`.

Команда:

```text
yarn enrich:musicbrainz:artists -- --limit=100 [--dry-run] [--force]
```

Правила:

- `--limit` ограничивает число артистов за запуск;
- без `--force` берутся только `pending` и `failed` c `next_retry_at <= now()`;
- c `--force` можно заново обработать `matched`, `not_found` и `ambiguous`;
- `--dry-run` не пишет изменения в БД;
- один failing artist не должен валить весь воркер.

## Retry

Временные ошибки MusicBrainz сохраняются как `failed`.

Backoff:

- `retry_count = 1` -> `next_retry_at = now + 15m`
- `retry_count = 2` -> `next_retry_at = now + 1h`
- `retry_count = 3` -> `next_retry_at = now + 6h`
- `retry_count >= 4` -> `next_retry_at = now + 24h`

К временным ошибкам относятся:

- `429`
- `503`
- timeout
- network error
- invalid JSON
- invalid response shape

## Release Genres

Release API должен объединять жанры из двух источников:

```text
release genres =
  Spotify artist genres
  + MusicBrainz genres артистов со status=matched
```

Правила:

- Spotify genres не удаляются и не заменяются;
- дедупликация идёт по lowercased genre name;
- если MusicBrainz данных нет, приложение работает как раньше.

## Acceptance

Готовность первого этапа:

- sync/crawler продолжают работать без ожидания MusicBrainz;
- уникальные артисты попадают в `artist_enrichment`;
- worker умеет обрабатывать `pending` артистов;
- MusicBrainz запросы идут через один глобальный limiter `1 request / ~1100ms`;
- `matched`, `not_found`, `ambiguous`, `failed` корректно сохраняются;
- release API отдаёт объединённые Spotify + MusicBrainz genres;
- есть unit/integration tests на parser, normalization, limiter, worker flow и DB merge.
