export const ru = {
  language: {
    label: 'Язык',
    en: 'English',
    ru: 'Русский',
    shortEn: 'EN',
    shortRu: 'RU',
  },
  app: {
    eyebrow: 'Поиск релизов Spotify',
    title: 'Fresh Drop',
    description: 'Свежие релизы Spotify с быстрым поиском по фильтрам.',
    shortDescription: 'Свежие релизы Spotify без лишнего шума.',
    howItWorks: 'Как это работает',
    settings: 'Настройки',
    backToTop: 'Наверх',
    navReleases: 'Релизы',
    navInsights: 'Инсайты',
  },
  filters: {
    aria: 'Фильтры релизов',
    period: 'Период',
    genre: 'Жанр',
    country: 'Страна',
    type: 'Тип',
    sorting: 'Сортировка',
    allGenres: 'Все жанры',
    noGenre: 'Без жанра',
    noCountry: 'Без страны',
    searchGenres: 'Поиск жанров',
    searchCountry: 'Поиск страны',
    selectedCountries: 'Выбранные страны',
    countryResults: 'Результаты стран',
    browseGenres: 'Показать жанры',
    hideGenres: 'Скрыть жанры',
    excludeGenres: 'Исключить жанры',
    manageExcludedGenres: 'Настроить',
    hideExcludedGenres: 'Скрыть',
    selectedGenres: 'Выбранные жанры',
    selectedExcludedGenres: 'Исключённые жанры',
    genreResults: 'Результаты жанров',
    excludedGenreResults: 'Результаты исключаемых жанров',
    selectMatches: 'Выбрать найденные',
    clearGenres: 'Очистить жанры',
    clearExcludedGenres: 'Очистить исключения',
    excludeGenreSummary: (genre: string) => `без ${genre}`,
    clearCountry: 'Очистить страну',
    clearCountries: 'Очистить страны',
    noGenresFound: 'Жанры не найдены',
    noCountriesFound: 'Страны не найдены',
    releasesCount: 'релизов',
    countsHelp: 'Счётчики показаны за последний месяц.',
    allTypes: 'Все',
    filters: 'Фильтры',
    moreFilters: 'Ещё фильтры',
    done: 'Готово',
    reset: 'Сбросить фильтры',
    resetAll: 'Сбросить все фильтры',
    resetShort: 'Сброс',
    close: 'Закрыть фильтры',
    additional: 'Дополнительные фильтры',
    activeFilters: (count: number) => formatRuFiltersCount(count),
    periodOptions: {
      today: 'Сегодня',
      '7d': '7 дней',
      '14d': '14 дней',
      '1m': 'Месяц',
    },
    typeOptions: {
      all: 'Все',
      single: 'Синглы',
      album: 'Альбомы',
      compilation: 'Сборники',
    },
  },
  sorts: {
    newest: 'Сначала новые',
    oldest: 'Сначала старые',
    popular: 'Сначала популярные',
    lessPopular: 'Сначала менее популярные',
  },
  periods: {
    today: 'Сегодня',
    '7d': 'Последние 7 дней',
    '14d': 'Последние 14 дней',
    '1m': 'Месяц',
  },
  releaseTypes: {
    all: 'Все',
    single: 'Сингл',
    album: 'Альбом',
    compilation: 'Сборник',
    unknown: 'Неизвестно',
  },
  results: {
    loading: 'Загружаем релизы...',
    loadingSummary: (filters: string[]) => ['Загружаем релизы', ...filters].join(' · '),
    updating: 'Обновляем',
    summary: (count: number, filters: string[]) => [summaryCount(count), ...filters].join(' \u00b7 '),
    releasesShort: (count: number) => formatRuReleasesShort(count),
    noTitle: 'По этим фильтрам релизы не найдены',
    noDescription: 'Попробуйте убрать один жанр или увеличить период.',
    useMonth: 'Выбрать месяц',
    errorTitle: 'Не удалось загрузить релизы',
    errorDescription: 'Сейчас не получилось загрузить релизы. Ваши фильтры сохранены.',
    retry: 'Попробовать снова',
    loadingMore: 'Загружаем ещё релизы...',
    end: 'Конец списка',
  },
  release: {
    openLabel: (title: string) => `Открыть ${title}`,
    coverAlt: (title: string) => `Обложка ${title}`,
    unknownArtist: 'Неизвестный артист',
    back: 'Назад',
    backToResults: 'К результатам',
    openShort: 'Открыть',
    detailsAria: 'Данные релиза',
    loadingTitle: 'Загружаем релиз...',
    loadingDescription: 'Ищем этот релиз в текущей выдаче.',
    notLoadedTitle: 'Релиз не загружен',
    notLoadedDescription: 'Вернитесь к результатам поиска и откройте релиз из списка.',
    noCover: 'Обложка недоступна',
    openSpotify: 'Открыть в Spotify',
    copySpotifyLink: 'Скопировать ссылку Spotify',
    copiedSpotifyLink: 'Ссылка Spotify скопирована',
    releaseDate: 'Дата релиза',
    country: 'Страна артиста',
    type: 'Тип',
    genres: 'Жанры',
    popularity: 'Популярность',
    unknown: 'Неизвестно',
    shownBecause: 'Показано, потому что релиз подходит под выбранный период свежести и активные фильтры.',
  },
  insights: {
    title: 'Инсайты',
    description: 'Исследуйте свежую музыку через страны, жанры и сцены.',
    filtersAria: 'Фильтры инсайтов',
    period: 'Период',
    type: 'Тип',
    periods: {
      7: 'Последние 7 дней',
      14: 'Последние 14 дней',
      30: 'Последние 30 дней',
    },
    types: {
      all: 'Все',
      single: 'Синглы',
      album: 'Альбомы',
    },
    loadingErrorTitle: 'Не удалось загрузить инсайты',
    loadingErrorDescription: 'Попробуйте ещё раз, не меняя фильтры релизов.',
    retry: 'Попробовать снова',
    refresh: 'Обновить',
    refreshing: 'Обновляем',
    emptyTitle: 'Пока недостаточно данных для инсайтов',
    emptyDescription: 'Попробуйте увеличить период или запустить свежую синхронизацию релизов.',
    noCardData: 'Недостаточно подходящих данных.',
    backToInsights: 'Назад к инсайтам',
    sections: {
      countries: 'Страны',
      genres: 'Жанры',
      scenes: 'Сцены',
      discovery: 'Открытия',
    },
    cards: {
      mostActiveCountries: {
        title: 'Самые активные страны',
        description: 'Страны с наибольшим числом свежих релизов за выбранный период.',
        byReleases: 'По релизам',
        byArtists: 'По артистам',
      },
      rareCountries: {
        title: 'Редкие страны в новых релизах',
        description: 'Свежие релизы из стран, которые редко встречаются в каталоге.',
      },
      bigArtistsSmallScenes: {
        title: 'Крупные артисты из небольших сцен',
        description: 'Популярные артисты, выпускающие релизы из стран с меньшим числом свежих релизов.',
      },
      mostDiverseCountries: {
        title: 'Самые разнообразные страны',
        description: 'Страны с самым широким жанровым разнообразием за выбранный период.',
      },
      mostActiveGenres: {
        title: 'Самые активные жанры',
        description: 'Жанры с наибольшим числом свежих релизов за выбранный период.',
      },
      rareGenreDrops: {
        title: 'Редкие жанровые релизы',
        description: 'Свежие релизы в жанрах, которые редко встречаются в каталоге.',
      },
      mainstreamGenres: {
        title: 'Самые мейнстримные жанры',
        description: 'Жанры, где свежие релизы чаще выходят у артистов с высокой популярностью.',
      },
      undergroundGenres: {
        title: 'Глубокие underground-жанры',
        description: 'Жанры, где свежие релизы чаще выходят у артистов с низкой популярностью.',
      },
      topScenes: {
        title: 'Главные сцены месяца',
        description: 'Самые активные сочетания страны и жанра.',
      },
      undergroundDrops: {
        title: 'Deep underground-релизы',
        description: 'Свежие релизы от артистов с очень низкой популярностью в Spotify.',
        cta: 'Исследовать underground-релизы',
      },
    },
    metrics: {
      releases: (count: number) => formatRuReleasesMetric(count),
      artists: (count: number) => formatRuArtistsMetric(count),
      genres: (count: number) => formatRuGenresMetric(count),
      popularity: (value: string | number) => `популярность ${value}`,
      medianPopularity: (value: string | number) => `медианная популярность ${value}`,
      latestRelease: (title: string) => `последний релиз: ${title}`,
    },
  },
  about: {
    aria: 'Как это работает',
    eyebrow: 'Как это работает',
    close: 'Закрыть',
    title: 'Fresh Drop — фильтрованный каталог, а не рекомендации.',
    intro:
      'Он помогает просматривать свежие релизы Spotify по периоду, жанру, типу релиза и сортировке. Результаты зависят от выбранных фильтров, а не от личного вкуса, истории прослушиваний или алгоритмического профиля.',
    filtersTitle: 'Что используют фильтры',
    filtersDescription:
      'Дата релиза, тип релиза, жанры артистов и популярность могут приходить из разных полей Spotify metadata. Если поле отсутствует или ненадёжно, Fresh Drop показывает «Неизвестно», а не угадывает.',
    limitsTitle: 'Ограничения Spotify metadata',
    limits: [
      'Жанры обычно привязаны к артистам, а не напрямую к релизам.',
      'Spotify не даёт надёжную страну артиста или релиза, поэтому значение «Неизвестно» встречается часто.',
      'Дата релиза может быть точной до дня, месяца или года; фильтрам свежести по дням нужна точность до дня.',
      'Популярность в MVP основана на наиболее стабильном доступном поле Spotify.',
      'Поиск tag:new может находить свежие синглы, альбомы и сборники, но не гарантирует полный каталог.',
    ],
  },
} as const;

function formatRuReleasesMetric(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} релиз`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} релиза`;
  }

  return `${count} релизов`;
}

function formatRuArtistsMetric(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} артист`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} артиста`;
  }

  return `${count} артистов`;
}

function formatRuGenresMetric(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} жанр`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} жанра`;
  }

  return `${count} жанров`;
}

function summaryCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} релиз найден`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} релиза найдено`;
  }

  return `${count} релизов найдено`;
}

function formatRuFiltersCount(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return `${count} фильтр`;
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `${count} фильтра`;
  }

  return `${count} фильтров`;
}

function formatRuReleasesShort(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) {
    return 'релиз';
  }

  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return 'релиза';
  }

  return 'релизов';
}
