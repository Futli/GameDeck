/**
 * Русские тексты интерфейса — образец для остальных языков. Новый текст добавляется сюда,
 * и TypeScript сразу потребует его перевод в en.ts. Тексты с числами и именами — функции:
 * склонения и порядок слов в языках разные, поэтому фразу целиком собирает словарь.
 */

/** Русское склонение: 1 кубик, 2 кубика, 5 кубиков. */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** Названия номиналов для ставки: «4 пятёрки». */
const FACES: Record<number, [string, string, string]> = {
  1: ['единица', 'единицы', 'единиц'],
  2: ['двойка', 'двойки', 'двоек'],
  3: ['тройка', 'тройки', 'троек'],
  4: ['четвёрка', 'четвёрки', 'четвёрок'],
  5: ['пятёрка', 'пятёрки', 'пятёрок'],
  6: ['шестёрка', 'шестёрки', 'шестёрок'],
};

export const ru = {
  language: { ru: 'Русский', en: 'English', label: 'Язык' },

  app: {
    connecting: 'Подключаемся к серверу…',
    telegramAuthFailed: 'Не удалось проверить вход через Telegram. Закройте и откройте игру заново.',
    kicked: 'Хост исключил вас из комнаты',
  },

  /** Названия и описания игр по id из реестра shared. Нет перевода — берётся title из реестра. */
  games: {
    'dice-high': { title: 'Бросок кубика', hint: 'Каждый бросает кубик, у кого больше — тот выиграл' },
    perudo: { title: 'Перудо', hint: 'Кубики под стаканом, ставки на весь стол и «Не верю!»' },
  } as Record<string, { title: string; hint: string } | undefined>,

  lobby: {
    tagline: 'Кости с друзьями в реальном времени',
    yourName: 'Ваше имя',
    namePlaceholder: 'Например, Лёха',
    whatToPlay: 'Во что играем',
    gameAria: 'Игра',
    playersRange: (min: number, max: number) => `${min}–${max} игроков`,
    roomPassword: 'Пароль комнаты (необязательно)',
    roomPasswordPlaceholder: 'Без пароля — комната открыта всем',
    create: 'Создать комнату',
    joinByCode: 'или войти по коду',
    codeAria: 'Код комнаты',
    password: 'Пароль',
    join: 'Войти',
    mySkins: 'Мои скины',
    stats: 'Статистика',
  },

  profile: {
    coins: 'монет',
    games: 'игр',
    wins: 'побед',
    stakeCoins: 'монет на ставках',
    wonLost: (won: number, lost: number) => `Выиграно ${won}, проиграно ${lost}`,
    firstGame: 'Сыграйте первую партию — здесь появится статистика',
  },

  skins: {
    title: 'Мои скины',
    back: '← Назад',
    kinds: { mat: 'Коврик', dice: 'Кубики', cup: 'Стакан' },
    rarities: { common: 'Обычный', rare: 'Редкий', epic: 'Эпический' },
    serial: (n: number) => `№ ${n}`,
    loading: 'Загружаем…',
    standard: 'Стандартный',
    playerColor: 'Цвет игрока',
    equipped: 'Надет',
    empty: (kind: 'mat' | 'dice' | 'cup') =>
      `Скинов на ${{ mat: 'коврик', dice: 'кубики', cup: 'стакан' }[kind]} пока нет. Они выпадают в «Кубике удачи» у бота.`,
  },

  stats: {
    title: 'Статистика',
    back: '← Назад',
    games: 'игр',
    winsLosses: (rate: number) => `побед / поражений · ${rate}%`,
    wonLostCoins: 'выиграно / проиграно монет',
    net: 'итого на ставках',
    history: 'История партий',
    loading: 'Загружаем…',
    empty: 'Сыграйте первую партию — она появится здесь',
    win: 'Победа',
    place: (place: number, of: number) => `${place} место из ${of}`,
    stake: (stake: number) => (stake > 0 ? `ставка ${stake}` : 'без ставки'),
    rating: (delta: string) => `рейтинг ${delta}`,
    more: 'Показать ещё',
    locale: 'ru-RU',
  },

  rooms: {
    aria: 'Комнаты',
    title: 'Комнаты',
    empty: 'Пока никого нет — создайте первую комнату',
    enterName: 'Введите имя, чтобы войти в комнату',
    withPassword: '🔒 С паролем',
    stake: (stake: number) => `ставка ${stake}`,
    full: 'мест нет',
    status: { lobby: 'ждут игроков', playing: 'идёт игра', finished: 'партия окончена' },
    passwordPlaceholder: 'Пароль комнаты',
    join: 'Войти',
  },

  room: {
    leave: '← Выйти',
    invite: 'Пригласить в комнату',
    copyLink: 'Скопируйте ссылку',
    shareText: (code: string) => `Заходи в GameDeck, комната ${code}`,
    roll: 'Бросить кубик',
    start: 'Начать игру',
    again: 'Ещё партию',
    hostWillStart: 'Хост начнёт игру, когда все соберутся',
  },

  settings: {
    title: 'Настройки комнаты',
    game: 'Игра',
    maxPlayers: 'Игроков максимум',
    stake: 'Ставка (монеты)',
    password: (set: boolean) => `Пароль ${set ? '(установлен)' : '(нет)'}`,
    newPassword: 'новый',
    setPassword: 'Задать',
    removePassword: 'Снять',
  },

  table: {
    host: 'Хост',
    you: '(вы)',
    coins: (n: number) => `${n} мон.`,
    kick: 'Исключить',
    waiting: (n: number, max: number) => `Ждём игроков: ${n}/${max}`,
    notReady: 'Интерфейс этой игры ещё в работе',
    reroll: (round: number) => `Переброс, раунд ${round}`,
    turn: 'Ходит:',
    stake: (stake: number) => `Ставка: ${stake}`,
    rolled: (value: number) => `Выпало ${value}`,
  },

  perudo: {
    round: (n: number) => `Раунд ${n}`,
    palifico: 'палифико',
    diceOnTable: (n: number) => `На столе ${n} куб.`,
    dudo: '«Не верю!»',
    calza: '«Точно!»',
    revealed: (bid: string, actual: number) => `Ставка ${bid}, нашлось ${actual}`,
    loses: 'Кубик теряет',
    gains: 'Кубик получает',
    nobodyLoses: 'Никто не теряет кубик',
    out: 'выбыл',
    yourNewDice: 'Ваши кубики в новом раунде:',
    youAreOut: 'Вы выбыли — смотрим, кто победит',
    faceAria: 'Номинал',
    bid: (bid: string) => `Ставка: ${bid}`,
    dudoButton: 'Не верю!',
    calzaButton: 'Точно!',
    noCalzaInPalifico: 'В палифико нельзя',
    palificoRules: (faceLocked: boolean) =>
      `Палифико: единицы не джокеры${faceLocked ? ', номинал менять нельзя' : ''}`,
    waitTurn: 'Ждём ход другого игрока',
    /** «4 пятёрки», «1 единица». */
    bidText: (quantity: number, face: number) => `${quantity} ${pluralRu(quantity, ...FACES[face]!)}`,
  },
};

export type Messages = typeof ru;
