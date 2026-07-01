# Sync Debugging

Короткая инструкция для проверки, что данные Spotify обновились.

## Что не делаем в MVP

Не добавляем админку, страницу управления sync job или ручные действия из UI.

Debug-инструменты read-only, кроме самой команды запуска синка.

## Как запустить sync вручную

```text
TMPDIR=/tmp yarn sync:releases
```

Команда пишет в консоль:

* параметры запуска: `market`, `limit`, `pages`;
* итоговый статус;
* `found`, `saved`, `deleted`;
* smoke-сводку по `unknown` country и `null` popularity.

Успешный запуск должен завершиться строкой вида:

```text
Release sync success: found=50 saved=50 deleted=0 ...
```

Если запуск завершился ошибкой, команда выставляет ненулевой exit code и пишет `error="..."`.

## Как посмотреть последний sync run

Dev-команда:

```text
TMPDIR=/tmp yarn sync:last
```

Она читает таблицу `sync_runs` и печатает последнюю запись:

```text
Latest sync run: status=success startedAt=... finishedAt=... source=spotify found=50 saved=50
```

Если записей нет:

```text
No sync runs found.
```

Read-only API endpoint:

```text
GET /api/sync-runs/latest
```

Успешный ответ содержит `item` с последним запуском или `item: null`, если sync ещё не запускался.

## Как понять, что данные обновились

1. Запустить `TMPDIR=/tmp yarn sync:releases`.
2. Проверить, что итоговый лог содержит `Release sync success`.
3. Проверить `TMPDIR=/tmp yarn sync:last`.
4. Убедиться, что `status=success`, `finishedAt` свежий, а `found` и `saved` выглядят ожидаемо.
5. Открыть приложение или `/api/releases` и проверить, что список релизов не пустой для периода `Last 7 days` или выбранного market.

Нормальные особенности Spotify metadata:

* `country=unknown` может встречаться у большинства релизов;
* `popularity=null` допустима и не должна отображаться как `0`;
* `found=0` может означать пустой ответ Spotify для выбранных параметров, но если это повторяется, нужно проверить Spotify credentials, market и лимиты.
