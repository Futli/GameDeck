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
    rolls: 'Броски ',
    reroll: 'Переброс ×',
    rerollGo: 'Перебросить',
    cancel: 'Отмена',
    close: 'Закрыть',
    more: 'Подробнее',
    noRolls: 'Броски закончились',
    rateLimited: 'Слишком часто',
    timeout: 'Сервер не ответил',
    failed: 'Не получилось',
    hours: ' ч ',
    minutes: ' мин',
    seconds: ' с',
    nextIn: 'ещё через ',
  },
  en: {
    roll: 'Roll',
    rolls: 'Rolls ',
    reroll: 'Re-roll ×',
    rerollGo: 'Re-roll',
    cancel: 'Cancel',
    close: 'Close',
    more: 'Details',
    noRolls: 'No rolls left',
    rateLimited: 'Too often',
    timeout: 'No answer from the server',
    failed: 'Something went wrong',
    hours: 'h ',
    minutes: 'm',
    seconds: 's',
    nextIn: 'next in ',
  },
} satisfies Record<BotLang, Record<string, string>>;

export type WidgetUiKey = keyof (typeof WIDGET_UI)['ru'];

/** Фразы бота и ответов виджета, которые составляет сервер. */
export const BOT_TEXTS = {
  ru: {
    caption: 'Кубик удачи: бросьте кубики и заберите монеты. Пропал виджет? Команда /dice пришлёт новый.',
    /** Команда в меню бота: присылает виджет заново, если игрок удалил сообщение с ним. */
    diceCommand: 'Кубик удачи: прислать виджет',
    findGame: '🎲 Найти игру',
    outcome: { plain: '', pair: 'Пара, ×2! ', straight: 'Стрит! ', triple: 'Тройка, ×5! ' } as Record<
      WidgetRollOutcome,
      string
    >,
    coins: (n: number) => `+${n} монет`,
    noRolls: 'Броски закончились, следующий придёт по таймеру',
    rerollWon: 'Выпал переброс',
    prizeUnchanged: 'Приз остался прежним',
    rarity: { common: 'обычный', rare: 'редкий', epic: 'эпический' } as Record<WidgetSkinRarity, string>,
    skinWon: (rarity: string, name: string) => `Выпал ${rarity} скин «${name}»`,
    /** Окно приза в виджете: заголовок и описание через перевод строки. */
    skinPopup: (rarity: string, name: string, serial: number) =>
      `Новый ${rarity} скин!\n«${name}» № ${serial} уже в инвентаре. Посмотреть и надеть его можно в приложении.`,
    rerollPopup:
      'Выпал переброс!\nОн меняет один кубик последнего броска. Нажмите «Переброс» на столе, ' +
      'выберите кубик и подтвердите. Если приз вырастет, получите разницу в монетах.',
    /** Подсказка при нажатии «Переброс»: как им пользоваться или почему сейчас нельзя. */
    rerollHint: {
      ready:
        'Нажмите на кубик, который хотите перебросить, и подтвердите. Вырастет приз — получите разницу, не вырастет — монеты останутся.',
      noRoll: 'Переброс меняет один кубик последнего броска. Сначала бросьте кубики.',
      used: 'К этому броску переброс уже применён: на один бросок — один переброс. Бросьте снова.',
    },
    invite: {
      button: '👋 Позвать друга',
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
    caption: 'Lucky Dice: roll the dice and collect coins. Widget gone? Send /dice to get a new one.',
    diceCommand: 'Lucky Dice: send the widget',
    findGame: '🎲 Find a game',
    outcome: { plain: '', pair: 'Pair, ×2! ', straight: 'Straight! ', triple: 'Triple, ×5! ' },
    coins: (n: number) => `+${n} ${n === 1 ? 'coin' : 'coins'}`,
    noRolls: 'No rolls left, the next one comes with the timer',
    rerollWon: 'You got a re-roll',
    prizeUnchanged: 'The prize stays the same',
    rarity: { common: 'common', rare: 'rare', epic: 'epic' },
    skinWon: (rarity: string, name: string) => `You got a ${rarity} skin “${name}”`,
    skinPopup: (rarity: string, name: string, serial: number) =>
      `New ${rarity} skin!\n“${name}” #${serial} is in your inventory. See it and put it on in the app.`,
    rerollPopup:
      'You got a re-roll!\nIt changes one die of your last roll. Tap “Re-roll” on the table, ' +
      'pick a die and confirm. If the prize grows, you get the difference in coins.',
    rerollHint: {
      ready:
        'Tap the die you want to re-roll and confirm. A bigger prize pays the difference, a smaller one keeps your coins.',
      noRoll: 'A re-roll changes one die of your last roll. Roll the dice first.',
      used: 'This roll was already re-rolled: one re-roll per roll. Roll again.',
    },
    invite: {
      button: '👋 Invite a friend',
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
