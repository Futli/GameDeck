import type { WidgetRollOutcome, WidgetSkinRarity } from '@gamedeck/shared';

/**
 * Языки бота и виджета «Кубик удачи». Язык берётся из language_code, который Telegram
 * присылает в каждом сообщении и нажатии: это язык приложения Telegram у игрока.
 * Правило то же, что в Mini App (client/src/i18n): ru/uk/be/kk — русский, остальные — английский.
 */
export type BotLang = 'ru' | 'en';

export function botLang(languageCode: string | undefined): BotLang {
  return /^(ru|uk|be|kk)\b/i.test(languageCode ?? 'ru') ? 'ru' : 'en';
}

/**
 * Надписи в HTML виджета. Подставляются вместо @ключ@ в source.ts при сборке.
 * Строки попадают в JavaScript в одинарных кавычках, поэтому апострофов в них нет.
 */
export const WIDGET_UI = {
  ru: {
    roll: 'Бросить',
    findGame: 'Найти игру',
    rolls: 'Попытки',
    balance: 'Баланс',
    invite: 'Позвать друга',
    ad: '+1 за рекламу',
    noRolls: 'Попытки закончились',
    rateLimited: 'Слишком часто',
    timeout: 'Сервер не ответил',
    failed: 'Не получилось',
    hours: ' ч ',
    minutes: ' мин',
    seconds: ' с',
    of3: ' из 3',
    nextIn: 'ещё через ',
    coins: ' монет',
    wins: ' побед · ',
    losses: ' поражений · выиграно ',
    reroll: 'Переброс: ',
    pickDie: 'Выберите кубик',
  },
  en: {
    roll: 'Roll',
    findGame: 'Find a game',
    rolls: 'Rolls',
    balance: 'Balance',
    invite: 'Invite a friend',
    ad: '+1 for an ad',
    noRolls: 'No rolls left',
    rateLimited: 'Too often',
    timeout: 'No answer from the server',
    failed: 'Something went wrong',
    hours: 'h ',
    minutes: 'm',
    seconds: 's',
    of3: ' of 3',
    nextIn: 'next in ',
    coins: ' coins',
    wins: ' wins · ',
    losses: ' losses · won ',
    reroll: 'Re-roll: ',
    pickDie: 'Pick a die',
  },
} satisfies Record<BotLang, Record<string, string>>;

export type WidgetUiKey = keyof (typeof WIDGET_UI)['ru'];

/** Английские названия предметов каталога по id. В базе название хранится по-русски. */
const ITEM_NAMES_EN: Partial<Record<string, string>> = {
  'mat-felt': 'Green felt',
  'mat-wood': 'Oak table',
  'mat-neon': 'Neon',
  'mat-dragon': 'Dragon’s lair',
  'dice-classic': 'Classic',
  'dice-bone': 'Bone',
  'dice-casino': 'Casino',
  'dice-night': 'Night',
  'dice-gold': 'Gold',
  'frame-silver': 'Silver frame',
};

/** Фразы бота и ответов виджета, которые составляет сервер. */
export const BOT_TEXTS = {
  ru: {
    caption: 'Кубик удачи: бросьте кубики и заберите монеты.',
    outcome: { plain: '', pair: 'Пара, ×2! ', straight: 'Стрит! ', triple: 'Тройка, ×5! ' } as Record<
      WidgetRollOutcome,
      string
    >,
    coins: (n: number) => `+${n} монет`,
    rerollWon: 'Выпал переброс',
    prizeUnchanged: 'Приз остался прежним',
    rarity: { common: 'обычный', rare: 'редкий', epic: 'эпический' } as Record<WidgetSkinRarity, string>,
    allSkinsOwned: (rarity: string) => `Все скины редкости «${rarity}» уже ваши`,
    skinWon: (rarity: string, name: string) => `Выпал ${rarity} скин «${name}»`,
    itemName: (_id: string, name: string) => name,
    invite: {
      button: 'Позвать друга',
      title: 'Позвать друга в «Кубик удачи»',
      description: 'Вам обоим по 3 броска после его первого броска',
      message: (link: string) =>
        `🎲 Бросай кубики со мной в <a href="${link}">«Кубике удачи»</a>!\n\n` +
        'Три кубика раз в 3 часа, монеты за каждый бросок, за тройки — скины. ' +
        'Заходи по моей ссылке, и после твоего первого броска мы оба получим по 3 броска.',
      play: '🎲 Бросить кубики',
    },
  },
  en: {
    caption: 'Lucky Dice: roll the dice and collect coins.',
    outcome: { plain: '', pair: 'Pair, ×2! ', straight: 'Straight! ', triple: 'Triple, ×5! ' },
    coins: (n: number) => `+${n} ${n === 1 ? 'coin' : 'coins'}`,
    rerollWon: 'You got a re-roll',
    prizeUnchanged: 'The prize stays the same',
    rarity: { common: 'common', rare: 'rare', epic: 'epic' },
    allSkinsOwned: (rarity: string) => `You already own every ${rarity} skin`,
    skinWon: (rarity: string, name: string) => `You got a ${rarity} skin “${name}”`,
    itemName: (id: string, name: string) => ITEM_NAMES_EN[id] ?? name,
    invite: {
      button: 'Invite a friend',
      title: 'Invite a friend to Lucky Dice',
      description: 'You both get 3 rolls after their first roll',
      message: (link: string) =>
        `🎲 Roll the dice with me in <a href="${link}">Lucky Dice</a>!\n\n` +
        'Three dice every 3 hours, coins for every roll and skins for triples. ' +
        'Join with my link, and after your first roll we both get 3 extra rolls.',
      play: '🎲 Roll the dice',
    },
  },
} satisfies Record<BotLang, unknown>;

/** Фраза под кубиками: событие, монеты и то, что выпало сверх них. */
export function prizeText(lang: BotLang, outcome: WidgetRollOutcome, coins: number, extra: string | null): string {
  const t = BOT_TEXTS[lang];
  return `${t.outcome[outcome]}${t.coins(coins)}${extra ? `. ${extra}` : ''}`;
}
