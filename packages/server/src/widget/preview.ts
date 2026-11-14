/**
 * Превью виджета в обычном браузере, без Telegram и без бота. Страница — тот же
 * HTML, что уйдёт в Telegram, плюс подмена window.TelegramWidget: запрос броска
 * идёт на этот же локальный сервер, а он отвечает тем же WidgetService, что и бот,
 * только с базой в памяти и одним игроком.
 *
 * Превью показывает вёрстку и логику, но не среду Telegram (QuickJS, лимиты,
 * тему клиента) — её проверяет только настоящий клиент.
 */
import { createServer } from 'node:http';
import {
  DEFAULT_DICE_STYLE,
  PLAYER_COLOR_HEX,
  SKIN_RARITIES,
  WIDGET_ROLL_INTERVAL_SEC,
  generateSkin,
  type SkinKind,
  type SkinRarity,
  type SkinSeed,
} from '@gamedeck/shared';
import { cryptoRng } from '../app.js';
import { config } from '../config.js';
import { openDatabase } from '../db/client.js';
import { widgetPlayers } from '../db/schema.js';
import { PlayerService } from '../players/player-service.js';
import { ShopService } from '../shop/shop-service.js';
import { SkinService } from '../skins/skin-service.js';
import { buildWidgetHtml, encodeWidgetState } from './build.js';
import { diceFromSkin, diceFromStyle } from './dice.js';
import { cupFromSkin, defaultCup, feltMat, matFromSkin } from './mat.js';
import { WidgetService } from './widget-service.js';

const port = Number(process.env.WIDGET_PREVIEW_PORT ?? 5180);
const intervalSec = Number(process.env.WIDGET_ROLL_INTERVAL_SEC ?? WIDGET_ROLL_INTERVAL_SEC);
const now = () => Math.floor(Date.now() / 1000);

/**
 * Сгенерированные скины вместо стандартных: WIDGET_PREVIEW_MAT=epic:12345 (редкость:seed),
 * так же WIDGET_PREVIEW_DICE_SKIN и WIDGET_PREVIEW_CUP. Так можно посмотреть любой скин
 * в виджете, не выдавая его игроку.
 */
function previewSkin(kind: SkinKind, env: string | undefined): SkinSeed | null {
  const [rarity, seed] = (env ?? '').split(':');
  if (!SKIN_RARITIES.includes(rarity as SkinRarity) || !seed) return null;
  return { kind, seed: Number(seed), rarity: rarity as SkinRarity };
}
const red = PLAYER_COLOR_HEX.red;
const mat = previewSkin('mat', process.env.WIDGET_PREVIEW_MAT);
const dice = previewSkin('dice', process.env.WIDGET_PREVIEW_DICE_SKIN);
const cup = previewSkin('cup', process.env.WIDGET_PREVIEW_CUP);

// Настоящий сервис бросков на базе в памяти: превью не расходится с ботом в правилах.
const { db } = await openDatabase('memory://');
await new ShopService(db).syncCatalog();
const players = new PlayerService(db, config.startingCoins);
// WIDGET_PREVIEW_DICE=4,4,4,6 — первые значения генератора: так можно сразу увидеть тройку и окно приза.
// Значение — кубик 1–6; после тройки следующее значение выбирает вид скина (1–2 коврик, 3–4 кубики, 5–6 стакан).
const scripted = (process.env.WIDGET_PREVIEW_DICE ?? '').split(',').filter(Boolean).map(Number);
const rng = () => {
  const next = scripted.shift();
  return next === undefined ? cryptoRng() : (next - 0.5) / 6;
};
const widget = new WidgetService(db, players, new SkinService(db), rng, intervalSec);
const { playerId } = await players.register();
// WIDGET_PREVIEW_MODIFIERS=3 — выдать перебросы, чтобы не ждать стрита.
const modifiers = Number(process.env.WIDGET_PREVIEW_MODIFIERS ?? 0);
if (modifiers > 0) await db.insert(widgetPlayers).values({ playerId, rolls: 3, modifiers });

const html = buildWidgetHtml({
  mat: mat ? matFromSkin(generateSkin(mat).render(), red.main) : feltMat(),
  dice: dice ? diceFromSkin(dice) : diceFromStyle(DEFAULT_DICE_STYLE),
  cup: cup ? cupFromSkin(generateSkin(cup).render(), red.main) : defaultCup(red),
});
// «Подробнее» в окне приза: в превью ссылка никуда не ведёт, но кнопку видно.
const appUrl = 'https://t.me/example_bot/play';

/** Подмена TelegramWidget: те же методы, что использует виджет, поверх fetch к этому серверу. */
const STUB = String.raw`<script>
(function(){var h={};
window.TelegramWidget={chatData:__STATE__,
request:function(d){return fetch('/query?d='+encodeURIComponent(d)).then(function(r){return r.json()}).then(function(a){
setTimeout(function(){window.TelegramWidget.chatData=a.chatData;(h.chatDataChanged||[]).forEach(function(f){f()})},0);
return {result:a.result}})},
onEvent:function(n,f){(h[n]=h[n]||[]).push(f)},
openTelegramLink:function(u){console.log('openTelegramLink',u)},
HapticFeedback:{notificationOccurred:function(){}},
ready:function(){}}})();
</script>`;

async function page(): Promise<string> {
  const state = JSON.stringify(encodeWidgetState(await widget.state(playerId, now())));
  // Пузырь сообщения на телефоне шириной около 340 px — в нём и показываем.
  return (
    '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' +
    '<body style="margin:12px;background:#8fa3b3"><div style="max-width:340px;border-radius:14px;overflow:hidden;background:none">' +
    STUB.replace('__STATE__', () => state) +
    html +
    '</div>'
  );
}

createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname === '/query') {
      const data = url.searchParams.get('d') ?? '';
      const reroll = /^m([0-2])$/.exec(data);
      const { details, ...answer } = reroll
        ? { ...(await widget.reroll(playerId, Number(reroll[1]), now())), details: undefined }
        : await widget.roll(playerId, now());
      if (details) Object.assign(answer, { l: `${appUrl}?startapp=${details}` });
      response.setHeader('content-type', 'application/json');
      response.end(
        JSON.stringify({
          result: JSON.stringify(answer),
          chatData: encodeWidgetState(await widget.state(playerId, now())),
        }),
      );
      return;
    }
    response.setHeader('content-type', 'text/html; charset=utf-8');
    response.end(await page());
  })();
}).listen(port, '127.0.0.1', () => console.log(`Превью виджета: http://localhost:${port}`));
