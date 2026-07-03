# Data Architecture

## Назначение

Этот документ описывает хранение свежих релизов, синхронизацию со Spotify API и базовую схему БД для MVP.

Используй этот файл, если задача касается:

* базы данных;
* схемы таблиц;
* синхронизации Spotify;
* хранения релизов;
* удаления старых данных;
* backend API для поиска релизов;
* индексов и фильтрации.

## Главный принцип

Приложение использует собственную БД как временный индекс свежих релизов Spotify.

Spotify API используется как источник данных для синхронизации.

Пользовательский поиск работает по нашей БД, а не напрямую по Spotify API.

## Data flow

Основной поток данных:

```text
Spotify API
  -> sync job
  -> PostgreSQL
  -> backend API
  -> frontend
```

## Почему нужна БД

БД нужна, чтобы:

* быстро фильтровать релизы по дате, жанру, стране, типу и популярности;
* не делать запросы к Spotify API на каждый пользовательский фильтр;
* контролировать дедупликацию релизов;
* хранить только актуальные данные за последний месяц;
* иметь стабильную пагинацию;
* тестировать бизнес-логику без реального Spotify API;
* подготовить основу для будущего поиска и аналитики.

## Database choice

Для MVP используется PostgreSQL.

Причины:

* хорошо подходит для фильтрации по датам и типам;
* поддерживает индексы;
* можно хранить массивы жанров;
* можно постепенно усложнять схему;
* не требует отдельного search engine на старте.

Не добавлять Elasticsearch, Meilisearch или другой search engine в MVP без отдельного решения.

## Retention policy

MVP не хранит большую историческую базу.

Базовое правило:

* хранить релизы за последние 30 дней;
* данные старше 30 дней удалять или исключать из пользовательского поиска;
* при необходимости хранить `sync_runs` дольше для отладки.

Если период хранения меняется, нужно обновить этот документ и тесты.

## Core tables

### releases

Хранит нормализованные релизы Spotify.

Минимальные поля:

```text
id
spotify_id
title
type
release_date
release_date_precision
spotify_url
cover_url
popularity
country
created_at
updated_at
```

Правила:

* `spotify_id` должен быть уникальным;
* `type` должен быть `single`, `album`, `compilation` или `unknown`;
* `country` может быть `unknown`;
* `popularity` может быть `null`;
* `release_date_precision` может быть `year`, `month`, `day` или `unknown`.

### artists

Хранит нормализованных артистов Spotify.

Минимальные поля:

```text
id
spotify_id
name
popularity
country
genres
created_at
updated_at
```

Правила:

* `spotify_id` должен быть уникальным;
* `genres` можно хранить массивом строк для MVP;
* `country` может быть `unknown`;
* `popularity` может быть `null`.

### release_artists

Связывает релизы и артистов.

Минимальные поля:

```text
release_id
artist_id
position
is_primary
```

Правила:

* первый артист релиза обычно считается primary artist;
* порядок артистов должен сохраняться;
* один релиз может иметь несколько артистов.

### sync_runs

Хранит историю запусков синхронизации.

Минимальные поля:

```text
id
started_at
finished_at
status
source
items_found
items_saved
error_message
created_at
```

Правила:

* `status` может быть `running`, `success` или `failed`;
* `error_message` должен быть `null`, если синк успешен;
* таблица нужна для отладки и контроля стабильности синка.

## Derived release genres

Жанры релиза в MVP материализуются в отдельной таблице для стабильного списка фильтров.

Базовый подход:

* жанры хранятся у артистов;
* жанры релиза вычисляются как объединение жанров всех артистов релиза;
* дубли удаляются;
* значения нормализуются в lowercase.
* результат сохраняется в `release_genres`;
* агрегированный счетчик активных релизов по жанрам хранится в `genre_counts`.

Правила счетчиков:

* при добавлении релиза увеличивать счетчик каждого жанра этого релиза;
* при обновлении релиза сначала уменьшать счетчики старых жанров релиза, затем увеличивать счетчики новых жанров;
* при удалении релизов по retention policy уменьшать счетчики жанров удаляемых релизов;
* в API фильтров отдавать только жанры с `release_count > 0`.

## Country

Spotify API может не давать прямую страну артиста.

Если страну нельзя определить надёжно, сохранять `unknown`.

Нельзя придумывать страну артиста на основе косвенных признаков без отдельного решения.

## Popularity

Для MVP popularity может быть взята из наиболее стабильного доступного поля Spotify API.

Предпочтительный порядок:

1. popularity релиза, если доступна стабильно;
2. popularity главного артиста;
3. средняя popularity артистов;
4. `null`.

Выбранная логика должна быть зафиксирована в mapper-коде и тестах.

## Sync job

Sync job отвечает за загрузку свежих релизов из Spotify API.

Базовые обязанности:

* искать новые релизы через Spotify API;
* получать детали релизов;
* получать данные артистов;
* нормализовать данные;
* сохранять релизы в БД;
* обновлять уже существующие релизы;
* сохранять информацию о запуске в `sync_runs`;
* корректно обрабатывать ошибки и rate limit.

Правила поведения crawler при `429`, временных `5xx` и retry описаны в `docs/specs/crawler-rate-limit.spec.md`.

## Spotify sync smoke output

После ручного запуска sync job должен выводить короткую smoke-сводку:

* количество найденных релизов;
* количество уникальных артистов;
* количество релизов и артистов с `country = unknown`;
* количество релизов и артистов с `popularity = null`.

Эта сводка нужна для быстрой проверки качества данных после синка. В `sync_runs` остаются базовые поля `items_found`, `items_saved` и понятная ошибка при неуспешном запуске.

## Spotify sync pagination

По умолчанию sync делает один запрос Spotify Search API с `limit = 50`.

Один запрос может быть недостаточен для проверки полноты свежих релизов, поэтому MVP поддерживает явный параметр `SPOTIFY_SYNC_PAGES`.

Правила:

* `SPOTIFY_SYNC_LIMIT` задаёт размер страницы, максимум `50`;
* `SPOTIFY_SYNC_PAGES` задаёт количество страниц, по умолчанию `1`, максимум `10`;
* каждая следующая страница запрашивается через `offset`;
* при rate limit sync не делает бесконечные повторы и сохраняет понятную ошибку в `sync_runs`;
* country не усложняется: если Spotify не даёт надежный источник страны, сохраняется `unknown`.

Минимальный запуск sync для MVP:

```text
TMPDIR=/tmp yarn sync:releases
```

Для регулярного запуска используется та же команда через scheduler:

```text
yarn sync:scheduled
```

В MVP достаточно cron-like расписания раз в 6 или 12 часов. Базовый production-вариант — GitHub Actions workflow `.github/workflows/sync-releases.yml`, который запускается каждые 6 часов и вручную через `workflow_dispatch`.

Альтернативы без изменения кода:

* system cron на сервере приложения;
* scheduler на хостинге;
* отдельный worker process, если хостинг требует постоянно запущенный процесс.

Все варианты должны использовать одну и ту же sync-команду и production `DATABASE_URL`. Sync job после успешного сохранения релизов выполняет cleanup day-precision релизов старше 30 дней. Пользовательский `GET /api/releases` остаётся read-only API поверх БД и не ходит в Spotify напрямую.

### VPS cron

Если приложение запускается на своём VPS, базовый вариант для MVP — обычный user crontab от пользователя, под которым установлен проект.

Перед добавлением cron нужно:

* собрать приложение и применить схему БД отдельно от cron;
* создать production env-файл, например `/home/fresh-drop/app/.env`;
* убедиться, что `yarn sync:scheduled` вручную успешно выполняется из директории проекта;
* создать директорию для логов, например `/home/fresh-drop/logs`.

Пример запуска каждые 6 часов:

```text
0 */6 * * * cd /home/fresh-drop/app && set -a && . ./.env && set +a && TMPDIR=/tmp yarn sync:scheduled >> /home/fresh-drop/logs/sync-releases.log 2>&1
```

Пример запуска каждые 12 часов:

```text
0 */12 * * * cd /home/fresh-drop/app && set -a && . ./.env && set +a && TMPDIR=/tmp yarn sync:scheduled >> /home/fresh-drop/logs/sync-releases.log 2>&1
```

Правила:

* в crontab указывать абсолютные пути;
* cron должен запускать sync от обычного deploy-пользователя, не от `root`, если root-доступ не требуется;
* env-файл не должен попадать в git;
* лог sync нужно периодически ротировать средствами сервера, например `logrotate`;
* не ставить интервал меньше 6 часов для MVP без отдельного решения по rate limit;
* не запускать параллельно второй scheduler, если уже включён GitHub Actions или scheduler хостинга.

Runtime-конфиг задаётся через env:

```text
DATABASE_URL
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_MARKET
SPOTIFY_SYNC_LIMIT
SPOTIFY_SYNC_PAGES
```

Назначение переменных:

* `DATABASE_URL` — строка подключения к PostgreSQL;
* `SPOTIFY_CLIENT_ID` — client id Spotify Web API;
* `SPOTIFY_CLIENT_SECRET` — client secret Spotify Web API;
* `SPOTIFY_MARKET` — market для Spotify-запросов, например `US`;
* `SPOTIFY_SYNC_LIMIT` — количество релизов для загрузки за один sync-запрос;
* `SPOTIFY_SYNC_PAGES` — количество страниц Spotify Search API для одного sync-запуска.

Правила:

* `DATABASE_URL` обязателен для backend API, sync job и применения схемы;
* `SPOTIFY_CLIENT_ID` и `SPOTIFY_CLIENT_SECRET` обязательны;
* `SPOTIFY_MARKET` по умолчанию `US`;
* `SPOTIFY_SYNC_LIMIT` по умолчанию `50` и не может превышать лимит Spotify Search API для одного запроса;
* ошибки Spotify API, включая rate limit, должны завершать текущий `sync_runs` со статусом `failed`;
* пользовательский `GET /api/releases` не должен вызывать Spotify API и не должен зависеть от успешности последнего sync-запуска.

## Local PostgreSQL runtime

Для локальной разработки используется PostgreSQL из `docker-compose.yml`.

Подготовка env:

```text
cp .env.example .env
```

Затем заполнить `SPOTIFY_CLIENT_ID` и `SPOTIFY_CLIENT_SECRET` в `.env`.

Запуск БД:

```text
docker compose up -d db
```

Применение схемы через локальный `psql`:

```text
set -a; source .env; set +a
TMPDIR=/tmp yarn db:schema
```

Если `psql` не установлен в WSL, применить схему можно через контейнер:

```text
TMPDIR=/tmp yarn db:schema:docker
```

Полный сброс dev-БД и повторное создание схемы:

```text
set -a; source .env; set +a
ALLOW_DB_RESET=true TMPDIR=/tmp yarn db:reset
```

`db:reset` предназначен только для локальной dev-БД. Скрипт откажется работать без `ALLOW_DB_RESET=true`, с не-local host или с именем базы без `fresh_drop`.

После применения схемы можно запустить синхронизацию:

```text
set -a; source .env; set +a
TMPDIR=/tmp yarn sync:releases
```

Успешный sync сохраняет новые релизы и затем удаляет day-precision релизы старше 30 дней.

## Deduplication

Основной ключ дедупликации релиза — `spotify_id`.

Если релиз с таким `spotify_id` уже есть в БД:

* обновить изменяемые поля;
* не создавать дубль;
* сохранить связи с артистами.

Основной ключ дедупликации артиста — `spotify_id`.

## Backend API

Frontend должен получать релизы через backend API приложения.

Минимальный endpoint MVP:

```text
GET /api/releases
```

Поддерживаемые query-параметры:

```text
period=7d | 14d | 1m
genre=string
type=all | single | album | compilation
sort=newest | oldest | popular | less-popular
randomStartSeed=string
page=number
limit=number
```

Backend должен возвращать уже нормализованные данные, пригодные для UI.

## Pagination

Backend API должен поддерживать пагинацию.

Базовые правила:

* `page` начинается с 1;
* `limit` должен иметь безопасное значение по умолчанию;
* максимальный `limit` должен быть ограничен;
* ответ должен содержать список релизов и metadata пагинации.

Пример metadata:

```text
page
limit
total
hasNextPage
```

## Filtering

Фильтрация должна выполняться на backend-стороне по данным БД.

Минимальные фильтры MVP:

* period;
* genre;
* country;
* type;
* popularity.

Frontend может хранить состояние фильтров, но не должен сам выполнять основную фильтрацию большого списка.

## Indexes

Минимальные индексы для MVP:

```text
releases.spotify_id unique
artists.spotify_id unique
releases.release_date
releases.type
releases.country
releases.popularity
release_artists.release_id
release_artists.artist_id
```

Если фильтрация по жанрам станет важной и медленной, добавить отдельное решение для genre index.

## Cleanup

Нужна регулярная очистка старых релизов.

Базовое правило:

```text
delete releases where release_date < current_date - 30 days
```

При удалении релизов нужно корректно обрабатывать связи в `release_artists`.

Артистов можно не удалять сразу, если они связаны с актуальными релизами или могут использоваться повторно.

## Testing requirements

Тестами должны быть покрыты:

* mapper Spotify DTO -> DB/domain model;
* дедупликация релизов по `spotify_id`;
* дедупликация артистов по `spotify_id`;
* фильтрация по period;
* фильтрация по genre;
* фильтрация по country;
* фильтрация по type;
* фильтрация по popularity;
* пагинация;
* cleanup старых релизов;
* обработка пустого результата;
* обработка ошибки Spotify API;
* обработка rate limit.

## MVP limitations

В MVP не требуется:

* хранить релизы за годы;
* строить сложную аналитику;
* использовать отдельный search engine;
* реализовывать персональные рекомендации;
* хранить пользовательские библиотеки Spotify;
* делать real-time sync;
* обновлять данные каждую минуту.

## Правило изменения data architecture

Если задача требует изменить схему БД, нужно:

1. Обновить этот документ.
2. Обновить миграции.
3. Обновить тесты.
4. Проверить, что backend API и frontend не используют устаревшую модель.

Не менять схему БД “заодно” без явной задачи.
