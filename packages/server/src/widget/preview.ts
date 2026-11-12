/**
 * Превью виджета в обычном браузере, без Telegram и без бота. Страница — тот же
 * HTML, что уйдёт в Telegram, плюс подмена window.TelegramWidget: запрос броска
 * идёт на этот же локальный сервер, а он отвечает теми же правилами, что и бот.
 *
 * Превью показывает вёрстку и логику, но не среду Telegram (QuickJS, лимиты,
 * тему клиента) — её проверяет только настоящий клиент через dev-bot.ts.
 */
import { createServer } from 'node:http';
import { DEFAULT_DICE_STYLE, WIDGET_ROLL_INTERVAL_SEC } from '@gamedeck/shared';
import { cryptoRng } from '../app.js';
import { config } from '../config.js';
import { buildWidgetHtml, encodeWidgetState } from './build.js';
import { createDemoPlayer, demoState, playDemoRoll } from './demo.js';
import { feltMat } from './mat.js';

const port = Number(process.env.WIDGET_PREVIEW_PORT ?? 5180);
const intervalSec = Number(process.env.WIDGET_ROLL_INTERVAL_SEC ?? WIDGET_ROLL_INTERVAL_SEC);
const now = () => Math.floor(Date.now() / 1000);

let player = createDemoPlayer(config.startingCoins);
const html = buildWidgetHtml(
  { mat: feltMat(), dice: DEFAULT_DICE_STYLE, cup: 'red' },
  {
    invite: 'https://t.me/share/url?url=https%3A%2F%2Ft.me%2Fexample_bot',
    ad: 'https://t.me/example_bot/play',
    findGame: 'https://t.me/example_bot/play',
  },
);

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

function page(): string {
  const state = JSON.stringify(encodeWidgetState(demoState(player, now(), intervalSec)));
  // Пузырь сообщения на телефоне шириной около 340 px — в нём и показываем.
  return (
    '<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">' +
    '<body style="margin:12px;background:#8fa3b3"><div style="max-width:340px;border-radius:14px;overflow:hidden;background:#fff">' +
    STUB.replace('__STATE__', () => state) +
    html +
    '</div>'
  );
}

createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/query') {
    const result = playDemoRoll(player, now(), cryptoRng, intervalSec);
    player = result.player;
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        result: JSON.stringify(result.answer),
        chatData: encodeWidgetState(demoState(player, now(), intervalSec)),
      }),
    );
    return;
  }
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.end(page());
}).listen(port, '127.0.0.1', () => console.log(`Превью виджета: http://localhost:${port}`));
