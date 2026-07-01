# UX Spec: Fresh Releases Search App

## 1. Product UX Goal

Приложение — это mobile-first веб-сервис для быстрого поиска свежих музыкальных релизов Spotify по дате выхода, жанру, стране/market и дополнительным фильтрам.

Главная пользовательская задача:

> Find fresh Spotify releases by genre, country, and release period.

Приложение не является рекомендательной системой. Оно не пытается угадать вкус пользователя. Оно помогает быстро отфильтровать свежие релизы и перейти к прослушиванию в Spotify.

Основной сценарий:

1. Пользователь открывает приложение.
2. Видит общую статистику свежих релизов за выбранный период.
3. Выбирает жанр, страну, тип релиза и другие фильтры.
4. Получает компактный список релизов.
5. Открывает страницу релиза.
6. Переходит в Spotify.
7. Возвращается через неделю, чтобы проверить новые релизы.

## 2. UX Principles

### 2.1 Mobile-first

Приоритет — удобство мобильных пользователей.

Десктопная версия должна использовать больше пространства, но не должна диктовать структуру интерфейса. Сначала проектируется удобный мобильный сценарий, затем он расширяется для десктопа.

### 2.2 Search-first, not feed-first

Приложение должно ощущаться как поисковик/каталог свежих релизов, а не как бесконечная рекомендательная лента.

Главный экран должен сразу помогать ответить на вопрос:

> What fresh releases match my filters?

### 2.3 Fast path to Spotify

Главная цель сессии — не удерживать пользователя внутри приложения, а помочь ему быстро найти релиз и открыть его в Spotify.

### 2.4 Compact information

В списке релизов показывается только минимально нужная информация. Детали выносятся на отдельную страницу релиза.

### 2.5 Spotify-inspired visual style

Визуальный стиль должен быть близок к Spotify:

* dark theme by default
* крупные обложки там, где это уместно
* зелёный акцент для основного действия
* тёмные поверхности
* компактные списки
* музыкальная, но не перегруженная атмосфера

## 3. Main Screens

MVP содержит три основных экрана:

1. Home / Search page
2. Release details page
3. About / How it works page

## 4. Home Page

### 4.1 Purpose

Главная страница должна одновременно показывать:

* общую картину свежих релизов за период
* фильтры
* список найденных релизов

Главный сценарий:

> User opens app → selects filters → scans release list → opens release details.

### 4.2 Default State

Период по умолчанию: `Last 7 days`.

При первом открытии пользователь видит:

* header
* intro-блок
* основные фильтры
* overview-статистику
* список релизов

Данные загружаются постепенно. Интерфейс фильтров должен быть доступен сразу, пока статистика и список показывают skeleton loaders.

### 4.3 Header

На мобильном header должен быть sticky.

Содержимое header:

* название приложения / логотип
* theme switcher
* language switcher
* ссылка или иконка About

При скролле header остаётся компактным. Intro-блок и overview могут уезжать вверх.

### 4.4 Intro Block

Короткий текст, объясняющий назначение приложения.

Пример на английском:

> Fresh Spotify releases
> Find new albums and singles by genre, country, and release date.

На русском:

> Свежие релизы Spotify
> Находите новые альбомы и синглы по жанру, стране и дате выхода.

### 4.5 Overview Block

На старте, до активной фильтрации или вместе с ней, показывается общая информация по выбранному периоду.

Рекомендуемые карточки overview:

* total releases
* top genres
* top countries / markets
* popular artists with new releases
* popular fresh releases
* release type split: albums / singles / compilations

Для MVP обязательные:

* total releases
* top genres
* top countries
* popular artists with new releases

Остальные можно добавить позже.

### 4.6 Filters

Фильтры MVP:

* period: `7 days / 14 days / Month`
* genre
* country / market
* release type: `album / single / compilation`
* popularity
* sorting

### 4.7 Mobile Filter Layout

На мобильном:

* самые важные фильтры показываются сверху
* дополнительные фильтры открываются в bottom sheet

Видимые сверху фильтры:

* period
* genre
* кнопка `More filters`

В bottom sheet:

* country / market
* release type
* popularity
* sorting
* reset filters

Фильтры применяются сразу после выбора, без кнопки Apply.

Важно: при изменении фильтров нужно избегать лишних запросов. Для поиска жанра и страны нужен debounce.

### 4.8 Genre Selection

Жанр выбирается через:

* чипсы популярных жанров
* поиск по жанрам с подсказками по части ввода

Ограничение MVP:

* пользователь может выбрать только один жанр

Если жанр не найден, показывается понятная ошибка.

Пример:

> No genre found. Try another spelling.

На русском:

> Жанр не найден. Попробуйте другой вариант написания.

### 4.9 Country / Market Selection

Пользователь может выбрать только одну страну/market.

Выбор страны находится в bottom sheet.

### 4.10 Popularity Filter

Для MVP используется простой вариант:

* `Any`
* `Popular only`

Не нужно делать slider или сложные уровни популярности в MVP.

### 4.11 Sorting

Сортировка по умолчанию:

* `Newest first`

Дополнительные варианты:

* `Most popular`
* `Release type`

Алфавитная сортировка и сложная сортировка по artist popularity не нужны в MVP.

### 4.12 Results Summary

Над списком релизов показывается summary активной выдачи.

Пример:

> 128 releases found · Death Metal · Sweden · Last 7 days

Если фильтр не выбран, он не отображается в summary.

### 4.13 Release List

Результаты показываются списком, а не сеткой.

Причины:

* список лучше подходит для мобильной версии
* список компактнее
* пользователь приходит с конкретной целью
* данные важнее визуального “альбомного браузинга”

Каждая строка релиза содержит:

* cover
* release title
* artist
* release date
* release type
* chevron / visual affordance для перехода

В списке нет кнопки Spotify. Переход в Spotify доступен только со страницы релиза.

Вся строка релиза кликабельна и ведёт на страницу релиза.

### 4.14 Infinite Scroll

Для списка используется infinite scroll.

Обязательные состояния:

* initial skeleton loader
* bottom loader при догрузке
* end state, когда релизы закончились

Пример end state:

> You’ve reached the end of the list.

На русском:

> Вы дошли до конца списка.

## 5. Empty, Loading and Error States

### 5.1 Loading States

Обязательные loading states:

* skeleton для overview-блока
* skeleton для списка релизов
* skeleton для страницы релиза
* loader внизу списка при infinite scroll

Не нужно блокировать весь экран, если можно показать интерфейс фильтров сразу.

### 5.2 Empty Results

Если фильтры не дали результатов, показывается дружелюбная заглушка.

Пример:

> No releases found
> Try a wider period or remove the genre/country filter.

На русском:

> Релизы не найдены
> Попробуйте расширить период или убрать фильтр по жанру/стране.

Если выбран период `7 days`, можно предложить действие:

* `Expand to 14 days`
* `Expand to Month`

Если выбран самый широкий период, предлагаем:

* `Reset filters`

### 5.3 Error State

Если не удалось загрузить релизы:

* фильтры остаются доступными
* показывается понятный текст ошибки
* есть кнопка Retry

Пример:

> Couldn’t load releases
> Check your connection and try again.

Кнопка:

> Retry

На русском:

> Не удалось загрузить релизы
> Проверьте соединение и попробуйте ещё раз.

Кнопка:

> Повторить

Не нужно показывать большой технический error screen без возможности продолжить работу.

## 6. Release Details Page

### 6.1 Purpose

Страница релиза — это экран подтверждения перед переходом в Spotify.

Главный вопрос страницы:

> Is this the release I want to open in Spotify?

### 6.2 Layout

На десктопе используется Spotify-like hero-блок:

* большая обложка
* название релиза
* артист
* основная кнопка `Open in Spotify`
* дата выхода
* тип релиза

Ниже:

* metadata
* explanation block
* collapsible tracklist
* similar releases, если есть место и данные

На мобильном порядок:

1. `← Back`
2. cover
3. release title
4. artist / artists
5. `Open in Spotify`
6. metadata
7. explanation block
8. collapsed tracklist
9. similar releases, если блок не перегружает экран

### 6.3 Back Navigation

Сверху слева должна быть кнопка:

> ← Back

При возврате на главную страницу желательно сохранить:

* выбранные фильтры
* позицию скролла
* текущую загруженную выдачу

Это важно, чтобы пользователь не терял контекст после просмотра релиза.

### 6.4 Release Metadata

В MVP показываем:

* cover
* release title
* main artist
* all artists
* release type
* release date
* country / market
* genres of main artist
* popularity
* label, если есть
* total tracks
* Spotify link

Не показываем:

* genres of all artists
* copyright
* technical Spotify IDs
* raw API data

### 6.5 Missing Data

Если данных нет, не показываем сухой `Unknown`.

Используем мягкие тексты:

* `Not enough data`
* `No genre data available`
* `Country data is not available`

На русском:

* `Недостаточно данных`
* `Жанр не определён`
* `Страна не указана`

### 6.6 Tracklist

Если треклист доступен, он показывается в сворачиваемом блоке.

По умолчанию треклист закрыт.

Заголовок:

> Tracklist · 12 tracks

После раскрытия показываем:

* track number
* track title
* duration, если есть
* explicit mark, если есть

Preview/audio player не входит в MVP.

### 6.7 Explanation Block

На странице релиза показывается компактный блок, объясняющий, почему релиз появился в выдаче.

Пример:

> This release is shown because it was released 3 days ago, matches Death Metal, is associated with Sweden, and fits the Album filter.

На русском:

> Релиз показан, потому что вышел 3 дня назад, относится к жанру Death Metal, связан со страной Sweden и подходит под фильтр Album.

На странице релиза это должен быть явный блок, а не tooltip. Tooltip можно использовать в списке или для отдельных иконок, но на мобильных tooltip менее удобен.

### 6.8 Similar Releases

Можно добавить второстепенный блок:

> More fresh releases like this

Логика MVP:

* тот же жанр
* тот же период
* та же страна, если выбрана
* исключить текущий релиз

На мобильном показывать максимум 3–5 компактных строк. Если данных мало или экран перегружен, блок можно скрыть.

### 6.9 Spotify Opening

Кнопка `Open in Spotify`:

* на десктопе открывает Spotify в новой вкладке
* на мобильном пытается открыть Spotify app
* если приложение не установлено, открывает Spotify web

## 7. About / How It Works Page

Страница объясняет:

* что делает приложение
* откуда берутся релизы
* что значат период, жанр, страна/market и популярность
* что приложение не является рекомендательной системой
* почему некоторые данные могут отсутствовать

Пример текста:

> This app helps you find fresh Spotify releases by release date, genre, country, and popularity. It is not a recommendation engine. Results are based on selected filters and available Spotify metadata.

На русском:

> Это приложение помогает находить свежие релизы Spotify по дате выхода, жанру, стране и популярности. Это не рекомендательная система. Результаты основаны на выбранных фильтрах и доступных данных Spotify.

## 8. Theme

### 8.1 Default Theme

Тема по умолчанию:

* Dark

Причина: визуальный ориентир — Spotify, а музыкальный каталог в тёмной теме выглядит естественнее.

### 8.2 Theme Switcher

Переключатель темы находится в header.

MVP-варианты:

* Dark
* Light

Если легко реализовать, можно сразу добавить:

* System

Выбранная тема сохраняется локально.

### 8.3 Theme Requirements

Обе темы должны поддерживать:

* нормальную контрастность текста
* видимые focus states
* читаемые disabled states
* понятные hover/active states
* стабильный вид skeleton loaders

## 9. Internationalization

### 9.1 Languages

MVP должен быть сразу подготовлен под два языка:

* English
* Russian

Язык по умолчанию:

* English

### 9.2 Language Switcher

Переключатель языка находится в header.

Требования:

* переключение работает на лету
* страница не перезагружается
* выбранный язык сохраняется локально
* все UI-строки должны быть вынесены в i18n-словари

### 9.3 No Hardcoded UI Text

Нельзя хардкодить строки в компонентах.

В i18n должны быть вынесены в том числе:

* кнопки
* empty states
* error states
* loading texts
* filter labels
* sorting labels
* release metadata labels
* About page texts
* tooltip texts
* validation messages

## 10. Accessibility

Accessibility входит в MVP как базовый стандарт качества.

Обязательные требования:

* нормальная keyboard navigation
* visible focus states
* aria-label для иконок и кнопок без текста
* корректные alt для обложек
* достаточный контраст в dark и light theme
* bottom sheet должен закрываться по Esc на десктопе
* bottom sheet должен быть доступен с клавиатуры
* интерактивные строки релизов должны быть понятны screen reader
* язык страницы должен соответствовать выбранной локали

## 11. Analytics

В MVP желательно заложить базовые события аналитики, даже если UI ещё простой.

События:

* filter changed
* genre selected
* country selected
* release type selected
* popularity filter changed
* sorting changed
* release opened
* Spotify clicked
* empty results shown
* language changed
* theme changed

Главные метрики:

* сколько пользователей доходит до страницы релиза
* сколько пользователей нажимает `Open in Spotify`
* какие фильтры чаще всего приводят к пустой выдаче
* какие жанры и страны чаще всего выбирают

## 12. MVP Non-goals

В MVP не входят:

* авторизация Spotify
* персональные рекомендации
* избранное
* отметка “прослушано”
* скрытие релизов
* шаринг
* PWA
* отдельное мобильное приложение
* аудио preview/player
* сложная иерархия жанров
* выбор нескольких жанров
* выбор нескольких стран
* сохранение фильтров между сессиями

Допускается сохранить последние варианты поиска жанра/страны локально, но выбранные фильтры не должны автоматически применяться при следующем открытии приложения.

## 13. MVP Acceptance Criteria

### Home Page

* Пользователь видит интерфейс фильтров сразу после открытия страницы.
* По умолчанию выбран период `7 days`.
* Overview и список релизов показывают skeleton во время загрузки.
* Пользователь может выбрать жанр, страну, тип релиза, популярность и сортировку.
* На мобильном дополнительные фильтры открываются в bottom sheet.
* После изменения фильтра список обновляется.
* Над списком показывается summary выдачи.
* Релизы отображаются компактным списком.
* Тап по строке открывает страницу релиза.
* В списке нет кнопки Spotify.
* Infinite scroll догружает следующие релизы.
* Пустая выдача предлагает расширить период или сбросить фильтры.
* Ошибка загрузки показывает Retry.

### Release Page

* Страница релиза содержит cover и title как главный визуальный акцент.
* Есть кнопка `← Back`.
* Есть кнопка `Open in Spotify`.
* На десктопе Spotify открывается в новой вкладке.
* На мобильном выполняется попытка открыть Spotify app.
* Метаданные релиза отображаются без технических raw-данных.
* Треклист, если доступен, свернут по умолчанию.
* Есть объяснение, почему релиз попал в выдачу.
* При возврате назад сохраняется контекст списка.

### Theme and Language

* Dark theme включена по умолчанию.
* Переключатель темы доступен в header.
* English выбран по умолчанию.
* Переключатель языка доступен в header.
* Язык меняется без перезагрузки страницы.
* Все UI-строки вынесены в i18n.

## 14. Recommended Implementation Notes

* Делать интерфейс mobile-first.
* Не перегружать первый экран фильтрами.
* Не добавлять Spotify-кнопку в список релизов.
* Не превращать приложение в рекомендательную ленту.
* Не добавлять избранное и личные функции до проверки основной ценности.
* Следить, чтобы infinite scroll имел явные loading и end states.
* Сохранять позицию списка при возврате со страницы релиза.
* Сразу проектировать компоненты с i18n и theme support.
