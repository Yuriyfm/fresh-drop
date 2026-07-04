# Crawler Adaptive Sharding Spec

## Назначение

Этот документ фиксирует стратегию adaptive sharding для Spotify Search crawler.

Используй его, если задача касается:

* discovery новых релизов через Spotify Search API;
* стратегии seed queries;
* дробления широких search query;
* отключения неэффективных query;
* очереди search shard-ов и их статистики.

## Проблема

Фиксированный список search query быстро начинает возвращать в основном дубли.

У Spotify Search API есть поле `total`, но deep pagination после примерно `offset >= 1000` ненадёжна. Поэтому широкий query нельзя просто листать глубже; его нужно дробить на более узкие подзапросы.

## Цели MVP

Crawler должен:

* начинать с ограниченного набора seed query;
* собирать статистику по каждому query;
* дробить saturated query на более узкие child query;
* снижать приоритет или откладывать low-yield query;
* сохранять дедупликацию по `Spotify album.id`;
* работать без изменений пользовательского UI.

## Модель search shard

Search shard хранится в persistent storage и представляет один query, который crawler может повторно запускать.

Минимальные поля:

* `query`
* `market`
* `family`
* `token`
* `depth`
* `parent_query_id`
* `status`
* `priority`
* `spotify_total`
* `pages_fetched`
* `items_seen`
* `unique_added`
* `duplicates_seen`
* `empty_pages`
* `last_offset`
* `avg_latency_ms`
* `rate_limited_count`
* `last_error`
* `last_run_at`
* `completed_at`

## Family

Для MVP поддерживаются:

* `plain`
* `album`
* `artist`

Значения `year_album` и `year_artist` допустимы как резерв для будущих итераций, но не обязательны для seed strategy MVP.

## Status

Для MVP shard может быть в одном из состояний:

* `pending`
* `running`
* `completed`
* `exhausted`
* `failed`
* `rate_limited`

Если query был дроблён, можно использовать `completed` вместе с отдельным флагом `was_split = true`.

## Seed queries

Если базовые seed query отсутствуют, crawler должен создать их автоматически.

Минимальный набор seed query:

* `tag:new`
* `tag:new a` ... `tag:new z`
* `tag:new 0` ... `tag:new 9`
* `tag:new album:a` ... `tag:new album:z`
* `tag:new artist:a` ... `tag:new artist:z`

Для MVP используется текущий список markets приложения.

Для multi-market crawling:

* seed query создаются для каждого market из `SPOTIFY_MARKETS`;
* uniqueness задач остаётся по `(source, query, market, offset_value)`;
* все markets делят один общий Spotify rate limiter;
* структура конфига должна позволять позже добавить tiered markets, но для MVP достаточно линейного списка markets.

## Выполнение shard

Worker берёт shard с максимальным `priority`, где `status = pending`.

Параметры запроса:

* `type=album`
* `limit` берётся из `SPOTIFY_SEARCH_LIMIT`
* `offset=0`
* `max_safe_offset` берётся из `SPOTIFY_MAX_SAFE_OFFSET`

После каждой страницы нужно:

* сохранить найденные album id через существующую дедупликацию;
* обновить `spotify_total`, `pages_fetched`, `items_seen`, `unique_added`, `duplicates_seen`, `empty_pages`, `last_offset`;
* посчитать среднюю latency по запросам shard;
* зафиксировать `429` и `Retry-After`, если они произошли.

Чтение shard прекращается, если:

* `offset >= SPOTIFY_MAX_SAFE_OFFSET`;
* `items.length === 0`;
* `offset + limit >= spotify_total`;
* получен `429`;
* произошла повторяющаяся временная ошибка.

## Правило saturated query

Если после выполнения:

* `spotify_total >= SPOTIFY_SPLIT_TOTAL_THRESHOLD`;
* `depth < MAX_DEPTH`

то shard считается saturated и должен быть дроблён на child query.

Для MVP:

* `MAX_DEPTH = 4`;
* алфавит дробления: `abcdefghijklmnopqrstuvwxyz`;
* для `plain` дробление идёт как `tag:new aa`, `tag:new ab`, ...;
* для `album` дробление идёт как `tag:new album:aa`, `tag:new album:ab`, ...;
* для `artist` дробление идёт как `tag:new artist:aa`, `tag:new artist:ab`, ...;
* child query создаётся только если его ещё нет.

После успешного создания child shard-ов родитель помечается как `completed` с флагом `was_split = true`.

## Правило exhausted query

После выполнения shard считаются:

* `unique_yield = unique_added / max(items_seen, 1)`
* `duplicate_rate = duplicates_seen / max(items_seen, 1)`

Если:

* `items_seen >= 300`
* `unique_yield < 0.01`

то shard помечается как `exhausted`.

Если:

* `duplicate_rate > 0.95`
* `items_seen >= 300`

то shard тоже может быть помечен как `exhausted`.

Но если `spotify_total >= SPOTIFY_SPLIT_TOTAL_THRESHOLD`, shard сначала должен быть рассмотрен на дробление.

## Priority

Стартовый приоритет:

* `plain` seed: `100`
* `album` seed: `90`
* `artist` seed: `90`
* child shard: `80 - depth`

После выполнения priority пересчитывается простой формулой:

```text
priority = 50
  + min(unique_added, 100)
  - duplicate_rate * 30
  + saturated_bonus
  - depth * 5
```

Где:

* `saturated_bonus = 20`, если `spotify_total >= SPOTIFY_SPLIT_TOTAL_THRESHOLD`

Формула не обязана быть идеально точной. Цель — держать выше полезные и насыщенные shard-ы и не тратить batch на мёртвые query.

Рекомендуемые env для MVP:

```text
SPOTIFY_SEARCH_LIMIT=10
SPOTIFY_MAX_SAFE_OFFSET=1000
SPOTIFY_SPLIT_TOTAL_THRESHOLD=800
```

Crawler должен начинать дробление раньше безопасного потолка offset, чтобы не терять выдачу на краю лимита Spotify Search API.
