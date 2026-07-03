export const ru = {
  language: {
    label: 'Язык',
    en: 'Английский',
    ru: 'Русский',
  },
  app: {
    eyebrow: 'Поиск релизов Spotify',
    title: 'Fresh Drop',
    description: 'Свежие релизы Spotify с быстрым поиском по фильтрам.',
    howItWorks: 'Как это работает',
  },
  filters: {
    aria: 'Фильтры релизов',
    period: 'Период',
    genre: 'Жанр',
    type: 'Тип',
    sorting: 'Сортировка',
    allGenres: 'Все жанры',
    allTypes: 'Все',
    filters: 'Фильтры',
    reset: 'Сбросить фильтры',
    close: 'Закрыть фильтры',
    additional: 'Дополнительные фильтры',
  },
  sorts: {
    newest: 'Сначала новые',
    oldest: 'Сначала старые',
    popular: 'Сначала популярные',
    lessPopular: 'Сначала менее популярные',
  },
  periods: {
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
    summary: (count: number, filters: string[]) => [summaryCount(count), ...filters].join(' \u00b7 '),
    noTitle: 'Релизы не найдены',
    noDescription: 'Попробуйте выбрать более длинный период или убрать часть фильтров.',
    errorTitle: 'Не удалось загрузить релизы',
    errorDescription: 'Не удалось загрузить релизы.',
    retry: 'Повторить',
    loadingMore: 'Загружаем ещё релизы...',
    end: 'Конец списка',
  },
  release: {
    openLabel: (title: string) => `Открыть ${title}`,
    unknownArtist: 'Неизвестный артист',
    back: 'Назад',
    detailsAria: 'Данные релиза',
    loadingTitle: 'Загружаем релиз...',
    loadingDescription: 'Ищем этот релиз в текущей выдаче.',
    notLoadedTitle: 'Релиз не загружен',
    notLoadedDescription: 'Вернитесь к результатам поиска и откройте релиз из списка.',
    noCover: 'Обложка недоступна',
    openSpotify: 'Открыть в Spotify',
    releaseDate: 'Дата релиза',
    country: 'Страна / market',
    genres: 'Жанры',
    popularity: 'Популярность',
    unknown: 'Неизвестно',
    shownBecause: 'Показано, потому что релиз подходит под выбранный период свежести и активные фильтры.',
  },
  about: {
    aria: 'Как это работает',
    eyebrow: 'Как это работает',
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
