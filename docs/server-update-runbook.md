# Server Update Runbook

Инструкция для Codex-агента, который обновляет production-приложение на сервере.

Использовать только для текущего Docker Compose production-контура из `docker-compose.prod.yml`.

## Цель

Обновить код приложения на сервере, применить схему БД, пересобрать контейнеры и проверить, что сервис снова отвечает.

## Предпосылки

- проект уже развернут на сервере;
- на сервере есть git, Docker и Docker Compose;
- рядом с проектом есть production env-файл с рабочими переменными;
- агент работает из директории проекта на сервере.

## Обязательные правила

- не редактировать production `.env`, если это не отдельная задача;
- не выполнять destructive git-команды вроде `git reset --hard`;
- перед обновлением проверить текущую ветку и статус worktree;
- если worktree не чистый и изменения не относятся к деплою, остановиться и запросить решение пользователя;
- если в коммите меняется `db/schema.sql`, обязательно прогнать миграцию;
- после обновления проверить контейнеры и HTTP-ответ приложения.

## Базовая последовательность

### 1. Проверить состояние репозитория

```bash
git status --short --branch
git branch --show-current
```

Ожидаемо:

- ветка `main`;
- worktree чистый.

### 2. Подтянуть свежий код

```bash
git fetch origin main
git pull --ff-only origin main
```

Если `git pull --ff-only` не проходит из-за локальных изменений или дивергенции, остановиться и не пытаться чинить историю автоматически.

### 3. Проверить production env

Убедиться, что доступен env-файл, который использует production-запуск.

Минимально важны:

- `DATABASE_URL`
- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `MUSICBRAINZ_ENABLED`
- `MUSICBRAINZ_USER_AGENT`

Если env-файл не загружен автоматически оболочкой, использовать явный `--env-file`.

### 4. Пересобрать и применить схему БД

```bash
docker compose -f docker-compose.prod.yml --env-file .env build app migrate scheduler
docker compose -f docker-compose.prod.yml --env-file .env run --rm migrate
```

Если миграция завершилась ошибкой, остановиться. `app` и `scheduler` после неудачной миграции не перезапускать.

### 5. Обновить runtime-контейнеры

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d app scheduler proxy
```

Если БД не поднята, использовать:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d db app scheduler proxy
```

### 6. Проверить состояние контейнеров

```bash
docker compose -f docker-compose.prod.yml --env-file .env ps
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=100 app
docker compose -f docker-compose.prod.yml --env-file .env logs --tail=100 scheduler
```

Проверить:

- `db` healthy;
- `app` running;
- `scheduler` running;
- нет свежих ошибок старта или migration errors.

### 7. Проверить HTTP

Если сервер слушает локально через Caddy:

```bash
curl -I http://127.0.0.1
```

Если известен production-домен, дополнительно:

```bash
curl -I https://<production-domain>
```

Ожидаемо: HTTP `200`, `301` или `302`. Ошибки `5xx` требуют проверки логов и остановки rollout.

## Минимальная post-deploy проверка

- главная страница открывается;
- `/api/releases` отвечает;
- если в релизе были изменения схемы или enrichment, нет ошибок в логах `app` и `scheduler`;
- если менялся MusicBrainz enrichment, проверить наличие `MUSICBRAINZ_*` переменных.

## Команда для отчёта пользователю

После обновления агент должен коротко сообщить:

- какой коммит задеплоен;
- выполнены ли миграции;
- какие контейнеры были перезапущены;
- прошла ли HTTP-проверка;
- есть ли warnings или остаточные риски.
