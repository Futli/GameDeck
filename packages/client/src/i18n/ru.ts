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
    kickedTimeout: 'Время на ответ вышло — вы вышли из комнаты',
  },

  /** Названия и описания игр по id из реестра shared. Нет перевода — берётся title из реестра. */
  games: {
    'dice-high': { title: 'Бросок кубика', hint: 'Каждый бросает кубик, у кого больше — тот выиграл' },
    perudo: { title: 'Перудо', hint: 'Кубики под стаканом, ставки на весь стол и «Не верю!»' },
  } as Record<string, { title: string; hint: string } | undefined>,

  lobby: {
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
    passwordNeeded: 'Комната с паролем: введите его, чтобы войти',
    join: 'Войти',
    mySkins: 'Мои скины',
    stats: 'Статистика',
    settings: 'Настройки',
    luckRules: 'Призы и правила «Кубика удачи»',
    rating: 'рейтинг',
    noRating: 'ещё не играли',
  },

  profile: {
    coins: 'монет',
  },

  settingsPage: {
    title: 'Настройки',
    back: '← Назад',
    nameHint: 'Под этим именем вас видят за столом.',
  },

  gamePage: {
    back: '← Назад',
  },

  luck: {
    title: 'Кубик удачи',
    back: '← Назад',
    prize: 'Ваш приз',
    prizeFrom:
      'Выпал за тройку в «Кубике удачи». Это уникальная вещь с номером выпуска: её можно надеть, подарить или продать.',
    equip: 'Надеть',
    equipped: 'Надет ✓',
    notYours: 'Этот скин уже у другого игрока',
    toSkins: 'Все мои скины',
    openChat: 'Открыть виджет в чате с ботом',
    lostWidget: 'Удалили виджет? Нажмите кнопку выше или отправьте боту /dice — придёт новый.',
    howTitle: 'Как играть',
    how: [
      'Бросайте три кубика прямо на главной приложения.',
      'Бросок приходит раз в 3 часа, копится до трёх. За друга, который сделал первый бросок, вы оба получаете ещё по 3.',
      'Монеты общие с приложением: ими можно платить ставки за столом и покупать скины.',
    ],
    prizesTitle: 'Что выпадает',
    prizes: [
      ['Все разные', 'сумма кубиков в монетах'],
      ['Пара', 'сумма ×2'],
      ['Стрит: три числа подряд', 'сумма и переброс'],
      ['Тройка 2-2-2, 3-3-3, 4-4-4', 'сумма ×5 и обычный скин'],
      ['Тройка 1-1-1, 5-5-5', 'сумма ×5 и редкий скин'],
      ['Три шестёрки', 'сумма ×5 и эпический скин'],
    ] as Array<[string, string]>,
    modifiersTitle: 'Модификаторы',
    rerollName: 'Переброс',
    rerollWhat: 'Меняет один кубик последнего броска. Выпадает за стрит.',
    rerollHow: [
      'Нажмите на столе «Переброс ×N».',
      'Нажмите на кубик, который хотите перебросить: он подсветится.',
      'Нажмите «Перебросить».',
    ],
    rerollRules:
      'Приз может только вырасти: если новая комбинация дороже, вы получите разницу, если дешевле — монеты останутся. ' +
      'На один бросок — один переброс. Скин и новый переброс даёт только первый бросок, поэтому тройка после переброса приносит монеты, но не скин.',
  },

  skins: {
    title: 'Мои скины',
    back: '← Назад',
    kinds: { mat: 'Коврик', dice: 'Кубики', cup: 'Стакан' },
    rarities: { common: 'Обычный', rare: 'Редкий', epic: 'Эпический' },
    serial: (n: number) => `#${n}`,
    loading: 'Загружаем…',
    standard: 'Стандартный',
    playerColor: 'Цвет игрока',
    equipped: '✓ Надет',
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
    rating: (after: number, delta: string) => `рейтинг ${after} (${delta})`,
    ratings: 'Рейтинг',
    ratingInfo: (peak: number, games: number) => `рекорд ${peak} · игр: ${games}`,
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
    hostWillStart: 'Хост начнёт игру, когда все соберутся',
    yourTurn: 'Ваш ход',
    turnOf: (name: string) => `Ходит ${name}`,
  },

  /** Всплывающие окна потока партии: комната ожидания, итог, общий бросок. */
  flow: {
    startTitle: 'Партия начинается',
    endTitle: 'Партия окончена',
    win: 'Победа!',
    winner: (name: string) => `Победил ${name}`,
    someone: 'другой игрок',
    noStake: 'без ставки',
    stake: (n: number) => `ставка ${n} мон.`,
    stakeLabel: 'Ставка',
    changeStake: 'Сменить',
    playing: '✓ играет',
    thinking: 'думает…',
    answerOrLeave: 'Кто не ответит — выйдет',
    hostDecides: 'Кто-то вышел. Хост может подождать нового игрока или начать без него.',
    notEnough: 'Игроков не хватает — ждём, пока кто-нибудь войдёт по коду.',
    play: 'Играю',
    playAgain: 'Играть ещё',
    startWithout: 'Начать без ушедших',
    waitOthers: 'Ждём остальных…',
    leaveRoom: 'Выйти из комнаты',
    maputoNote: 'Мапуто: единицы не джокеры, номинал после первой ставки не меняется',
    rollDice: 'Бросить кубики',
    rollOrOut: 'Не бросил — выбыл',
    waitRolls: 'Ждём, пока бросят остальные…',
    seconds: (n: number) => `${n} с`,
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
    maputo: 'мапуто',
    diceOnTable: (n: number) => `На столе ${n} куб.`,
    allRolling: 'Все бросают кубики',
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
    noCalzaInMaputo: 'В мапуто нельзя',
    maputoRules: (faceLocked: boolean) => `Мапуто: единицы не джокеры${faceLocked ? ', номинал менять нельзя' : ''}`,
    waitTurn: 'Ждём ход другого игрока',
    /** «4 пятёрки», «1 единица». */
    bidText: (quantity: number, face: number) => `${quantity} ${pluralRu(quantity, ...FACES[face]!)}`,
  },
};

export type Messages = typeof ru;
