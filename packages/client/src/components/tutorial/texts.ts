import { useLang, type Lang } from '../../i18n';

/**
 * Все тексты обучения в одном месте. Компоненты не держат строк сами, а берут их отсюда,
 * поэтому перевод — это словарь `en` рядом с `ru`; тип Record<Lang, …> не даст забыть язык.
 */

/** Подсказка по ситуации в игре: показывается один раз, пока игрок не нажмёт «Понятно». */
export type TipId =
  | 'waiting-host'
  | 'waiting-guest'
  | 'dice-high'
  | 'perudo-goal'
  | 'perudo-jokers'
  | 'first-bid'
  | 'raise'
  | 'others-turn'
  | 'reveal'
  | 'palifico'
  | 'eliminated'
  | 'finished';

/** Подпись к кнопке: что произойдёт, если её нажать. Видна, пока обучение включено. */
export type HintId =
  'leave' | 'invite' | 'start' | 'roll' | 'faces' | 'quantity' | 'bid' | 'dudo' | 'calza' | 'tutorial-toggle';

/** Числа, которые подставляются в текст: сколько кубиков на столе, кто ходит и т.п. */
export interface TipParams {
  totalDice: number;
  /** Сколько кубиков нужного номинала в среднем лежит на столе (с единицами-джокерами). */
  expected: number;
  turnName: string;
}

interface Tip {
  title: string;
  body: (p: TipParams) => string;
}

interface Dictionary {
  tips: Record<TipId, Tip>;
  hints: Record<HintId, string>;
  ui: {
    gotIt: string;
    turnOff: string;
    toggle: string;
  };
}

const ru: Dictionary = {
  tips: {
    'waiting-host': {
      title: 'Вы хост комнаты',
      body: () =>
        'Позовите друзей: нажмите на код комнаты вверху, и ссылка-приглашение скопируется. ' +
        'Когда за столом будет хотя бы двое, нажмите «Начать игру». Внизу можно выбрать игру и ставку.',
    },
    'waiting-guest': {
      title: 'Ждём начала',
      body: () =>
        'Игру запускает хост комнаты, когда все соберутся. Правила объясним по ходу партии: ' +
        'подсказка появится здесь в каждой новой ситуации. Нажмите «Понятно», чтобы её убрать, ' +
        'а кнопка «?» вверху включает и выключает обучение.',
    },
    'dice-high': {
      title: 'Кто выше',
      body: () =>
        'Каждый по очереди бросает один кубик. Побеждает самое большое число. ' +
        'Если у лидеров ничья, они перебрасывают между собой, пока не останется один.',
    },
    'perudo-goal': {
      title: 'Как играть в перудо',
      body: ({ totalDice }) =>
        `Цель — остаться последним, у кого есть кубики. У каждого игрока кубики под стаканом: ` +
        `свои вы видите на коврике снизу, чужие видны только как стакан с числом. ` +
        `Сейчас на столе ${totalDice} куб. Ставка — догадка, сколько кубиков одного номинала лежит у всех вместе.`,
    },
    'perudo-jokers': {
      title: 'Единицы — джокеры',
      body: () =>
        'Единица считается любым номиналом. Ставка «3 пятёрки» значит «пятёрок и единиц вместе хотя бы три». ' +
        'Поэтому каждый кубик подходит под ставку с шансом 1 из 3.',
    },
    'first-bid': {
      title: 'Ваша первая ставка',
      body: ({ totalDice, expected }) =>
        `Вы начинаете раунд. Выберите номинал (кубик в ряду) и количество кнопками − и +, затем нажмите «Ставка». ` +
        `Начинать с единиц нельзя. Ориентир: из ${totalDice} куб. под любой номинал в среднем подходит около ${expected}. ` +
        `Посмотрите на свои кубики: чего у вас много, на то и ставьте.`,
    },
    raise: {
      title: 'Перебить или не поверить',
      body: () =>
        'Новая ставка должна быть старше: больше кубиков любого номинала или столько же, но номинал выше. ' +
        'На единицы хватает половины от прошлой ставки (с округлением вверх), а уходя с единиц — вдвое больше плюс один. ' +
        'Если ставка кажется завышенной, жмите «Не верю!». Если думаете, что она ровно верная, — «Точно!».',
    },
    'others-turn': {
      title: 'Ход другого игрока',
      body: ({ turnName }) =>
        `Сейчас ходит ${turnName}. Следите за ставками: если кто-то уверенно ставит на шестёрки, ` +
        `скорее всего, они у него есть. Когда очередь дойдёт до вас, кнопки появятся внизу.`,
    },
    reveal: {
      title: 'Вскрытие',
      body: () =>
        'Стаканы подняты. Подсвечены кубики, которые подошли под ставку. ' +
        'Если их меньше ставки, кубик теряет тот, кто ставил; если хватает — тот, кто сказал «Не верю!». ' +
        'После «Точно!»: угадал ровно — получаешь кубик, не угадал — теряешь. Следующий раунд начинает тот, у кого изменилось число кубиков.',
    },
    palifico: {
      title: 'Особый раунд: палифико',
      body: () =>
        'У одного из игроков остался последний кубик. В этом раунде единицы не джокеры, ' +
        'номинал после первой ставки менять нельзя, только поднимать количество, а «Точно!» не работает.',
    },
    eliminated: {
      title: 'Вы выбыли',
      body: () =>
        'Кубики закончились, но можно досмотреть партию: вскрытия видны всем. В следующей партии вы снова начнёте с пятью.',
    },
    finished: {
      title: 'Партия окончена',
      body: () =>
        'Победитель забирает ставку, а у всех меняется рейтинг: цифры видны рядом с именами. ' +
        'Хост может сразу начать ещё одну партию.',
    },
  },
  hints: {
    leave: 'Выйти из комнаты на главную',
    invite: 'Код комнаты: нажмите, чтобы пригласить друга',
    start: 'Раздать кубики и начать партию (нужно хотя бы двое)',
    roll: 'Бросить свой кубик в этом раунде',
    faces: 'Номинал: на какое число на кубике вы ставите',
    quantity: 'Сколько таких кубиков, по-вашему, лежит на всём столе',
    bid: 'Объявить ставку, ход перейдёт следующему',
    dudo: 'Не верю: вскрыть стаканы, если ставка завышена',
    calza: 'Точно: вскрыть, если кубиков ровно столько',
    'tutorial-toggle': 'Включить или выключить подсказки',
  },
  ui: {
    gotIt: 'Понятно',
    turnOff: 'Выключить обучение',
    toggle: 'Обучение',
  },
};

const en: Dictionary = {
  tips: {
    'waiting-host': {
      title: 'You are the room host',
      body: () =>
        'Invite friends: tap the room code at the top to share an invite link. ' +
        'Once at least two players are at the table, tap “Start game”. Below you can pick the game and the stake.',
    },
    'waiting-guest': {
      title: 'Waiting for the start',
      body: () =>
        'The host starts the game when everyone is here. We will explain the rules as you play: ' +
        'a tip appears here whenever something new happens. Tap “Got it” to hide it, ' +
        'and the “?” button at the top turns the tutorial on and off.',
    },
    'dice-high': {
      title: 'Dice Roll',
      body: () =>
        'Everyone rolls one die in turn. The highest number wins. ' +
        'If the leaders tie, they re-roll among themselves until one is left.',
    },
    'perudo-goal': {
      title: 'How to play Perudo',
      body: ({ totalDice }) =>
        `The goal is to be the last player with dice. Everyone keeps their dice under a cup: ` +
        `you see your own on your mat at the bottom, others show only as a cup with a number. ` +
        `There are ${totalDice} dice on the table now. A bid is a guess of how many dice of one face all players have together.`,
    },
    'perudo-jokers': {
      title: 'Ones are wild',
      body: () =>
        'A one counts as any face. The bid “3 fives” means “fives and ones together, at least three”. ' +
        'So every die matches a bid with a 1 in 3 chance.',
    },
    'first-bid': {
      title: 'Your first bid',
      body: ({ totalDice, expected }) =>
        `You start the round. Pick a face (a die in the row) and a quantity with − and +, then tap “Bid”. ` +
        `You can’t open with ones. Rule of thumb: out of ${totalDice} dice about ${expected} match any face on average. ` +
        `Look at your own dice and bid on what you have most of.`,
    },
    raise: {
      title: 'Raise or call',
      body: () =>
        'A new bid must be higher: more dice of any face, or the same number with a higher face. ' +
        'Switching to ones needs only half of the last bid (rounded up); leaving ones needs double plus one. ' +
        'If the bid looks too high, tap “Liar!”. If you think it is exactly right, tap “Exact!”.',
    },
    'others-turn': {
      title: 'Another player’s turn',
      body: ({ turnName }) =>
        `${turnName} is moving now. Watch the bids: if someone confidently bids on sixes, ` +
        `they probably have some. When it is your turn, the buttons appear below.`,
    },
    reveal: {
      title: 'Reveal',
      body: () =>
        'The cups are up. Dice that match the bid are highlighted. ' +
        'If there are fewer than bid, the bidder loses a die; if there are enough, the player who called “Liar!” loses one. ' +
        'After “Exact!”: guess it exactly and you gain a die, miss and you lose one. The next round starts with the player whose dice count changed.',
    },
    palifico: {
      title: 'Special round: palifico',
      body: () =>
        'A player is down to the last die. This round ones are not wild, ' +
        'the face can’t change after the first bid, only the quantity goes up, and “Exact!” is not allowed.',
    },
    eliminated: {
      title: 'You are out',
      body: () =>
        'You have no dice left, but you can watch the rest of the game: reveals are visible to everyone. Next game you start with five again.',
    },
    finished: {
      title: 'Game over',
      body: () =>
        'The winner takes the stake and everyone’s rating changes: see the numbers next to the names. ' +
        'The host can start another game right away.',
    },
  },
  hints: {
    leave: 'Leave the room for the main screen',
    invite: 'Room code: tap to invite a friend',
    start: 'Deal the dice and start the game (needs at least two)',
    roll: 'Roll your die for this round',
    faces: 'Face: which number on the die you bid on',
    quantity: 'How many such dice you think are on the whole table',
    bid: 'Announce your bid, the turn passes on',
    dudo: 'Liar: open the cups if the bid is too high',
    calza: 'Exact: open the cups if the count is exactly right',
    'tutorial-toggle': 'Turn tips on or off',
  },
  ui: {
    gotIt: 'Got it',
    turnOff: 'Turn off tutorial',
    toggle: 'Tutorial',
  },
};

const dictionaries: Record<Lang, Dictionary> = { ru, en };

/** Тексты обучения на языке интерфейса: переключатель RU / EN перерисует подсказки. */
export const useTutorialTexts = (): Dictionary => dictionaries[useLang()];
