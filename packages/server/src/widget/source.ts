/**
 * Исходник виджета: HTML, CSS и JavaScript одним документом, как его требует Telegram.
 *
 * Виджет исполняется внутри сообщения в урезанной среде: сети нет, внешних
 * скриптов и картинок нет, весь документ после сжатия zlib обязан уложиться
 * в 4096 байт. Поэтому здесь нет React и сборщика, имена короткие, а коврик,
 * кубики и стакан рисуются на canvas прямоугольниками из данных скина.
 *
 * Правила, которые диктует среда (https://core.telegram.org/bots/widgets):
 * - сервер подставляет скины и ссылки вместо __CFG__ (см. build.ts);
 * - состояние (попытки, баланс) приходит строкой TelegramWidget.chatData,
 *   её меняет только бот через editMessageWidgetData;
 * - запрос к боту — TelegramWidget.request(), строго внутри обработчика нажатия;
 * - подписка на события — TelegramWidget.onEvent(), а не addEventListener.
 *
 * Строки, начинающиеся с «//», и отступы вырезаются при сборке и в лимит не входят.
 * Обратные кавычки и «${» в коде виджета использовать нельзя: это шаблон String.raw.
 */
export const WIDGET_SOURCE = String.raw`<style>
*{box-sizing:border-box;margin:0}
#w{display:flex;flex-wrap:wrap;gap:8px;padding:8px;font:13px/1.3 system-ui,sans-serif;color:var(--tg-theme-text-color,#222)}
#l{width:176px;display:flex;flex-direction:column;gap:5px}
#t{position:relative;height:135px;padding:8px;border-radius:10px;background:#14523a}
canvas{display:block}
#m{width:160px;height:80px}
#d{position:absolute;left:22px;top:35px;width:81px}
#c{position:absolute;left:128px;top:32px;width:28px}
.s #d{visibility:hidden}
.s #c{animation:k .7s}
@keyframes k{15%,85%{transform:translate(-72px,-2px)}30%,60%{transform:translate(-80px,-7px) rotate(-8deg)}45%,75%{transform:translate(-64px,-7px) rotate(8deg)}}
#g{position:absolute;left:8px;right:8px;bottom:8px}
#p{flex:1;min-width:110px;display:flex;flex-direction:column;gap:5px}
b{font-size:15px}
.h{font-size:11px;color:var(--tg-theme-hint-color,#888)}
button{font:inherit;font-weight:600;border:0;border-radius:var(--tg-button-radius,8px);padding:7px 6px;background:var(--tg-theme-button-color,#2481cc);color:var(--tg-theme-button-text-color,#fff)}
button:disabled{opacity:.5}
.q{background:var(--tg-theme-secondary-bg-color,#e8e8e8);color:var(--tg-theme-text-color,#222)}
#o{flex-basis:100%;min-height:17px;font-weight:600}
#z{flex-basis:100%}
</style>
<div id=w>
<div id=l>
<div id=t>
<canvas id=m width=384 height=192></canvas>
<canvas id=d width=276 height=84></canvas>
<canvas id=c width=64 height=72></canvas>
<button id=g>Бросить</button>
</div>
<button id=f>Найти игру</button>
</div>
<div id=p>
<div><span class=h>Попытки</span><br><b id=r></b> <span class=h id=n></span></div>
<div><span class=h>Баланс</span><br><b id=b></b></div>
<div class=h id=s></div>
<button class=q id=i>Позвать друга</button>
<button class=q id=a>+1 за рекламу</button>
</div>
<div id=o></div>
<div class=h id=z></div>
</div>
<script>
// G — скины и ссылки от сервера, S — состояние из chatData, B — идёт ли бросок.
var W=window.TelegramWidget,G=__CFG__,S={},B=0,
$=function(i){return document.getElementById(i)},
T=$('t'),
// Тексты для ошибок: коды Telegram и наш NO_ROLLS.
E={NO_ROLLS:'Попытки закончились',RATE_LIMITED:'Слишком часто, подожди пару секунд',TIMEOUT:'Сервер не ответил, попробуй ещё раз'},
M={plain:'',pair:'Пара, ×2! ',straight:'Стрит! ',triple:'Тройка, ×5! '},
// Точки на грани: для каждого значения — номера ячеек сетки 3×3 (ряд*3+колонка).
L=['','4','08','048','0268','02468','036258'];
// Рисовалка «пикселей»: один пиксель скина — k×k пикселей canvas.
function px(i,k){var g=$(i).getContext('2d');return function(f,x,y,w,h){g.fillStyle=f;g.fillRect(x*k,y*k,w*k,h*k)}}
// Коврик: по одному прямоугольнику на отрезок одинаковых пикселей в строке.
function mat(){var r=px('m',3),x,y,j,o;for(y=0;y<64;y++)for(x=0;x<128;x=j){o=y*128;for(j=x+1;j<128&&G.m[o+j]==G.m[o+x];j++);r(G.p[parseInt(G.m[o+x],16)],x,y,j-x,1)}}
// Три кубика на сетке 21×21, как в Die.tsx клиента. G.d: обводка, грань, блик, тень, точки, блик точки.
function dice(a){var r=px('d',4),D=G.d;a.forEach(function(v,i){var o=i*24;
r(D[0],o+1,0,19,21);r(D[0],o,1,21,19);r(D[1],o+2,1,17,19);r(D[1],o+1,2,19,17);
r(D[2],o+2,1,16,1);r(D[2],o+1,2,1,16);r(D[3],o+3,19,16,1);r(D[3],o+19,3,1,16);
L[v].split('').forEach(function(c){var x=o+4+5*(c%3),y=4+5*(c/3|0);r(D[4],x,y,3,3);r(D[5],x,y,1,1)})})}
// Стакан 16×18, как в Cup.tsx. G.c: блик, тело, тень, обводка; в строке — цвет и прямоугольник.
function cup(){var r=px('c',4);[[3,4,0,8,1],[3,3,1,10,4],[3,2,5,12,8],[3,1,13,14,5],[1,4,1,8,4],[1,3,5,10,8],[1,2,13,12,4],[0,4,1,2,4],[0,3,5,2,8],[0,2,13,2,3],[2,11,2,1,3],[2,12,5,1,8],[2,13,13,1,4],[2,2,15,12,1]].forEach(function(q){r(G.c[q[0]],q[1],q[2],q[3],q[4])})}
function tm(s){s=Math.max(0,s|0);var h=s/3600|0,m=s%3600/60|0;return h?h+' ч '+m+' мин':m?m+' мин':s+' с'}
function say(t){$('o').textContent=t}
function load(){try{S=JSON.parse(W.chatData)||{}}catch(e){S={}}if(S.d)dice(S.d)}
// Показать состояние. Таймер досчитывается на месте, но решает всё равно сервер при броске.
function show(){var n=Date.now()/1e3;
while(S.r<3&&S.n&&S.n<=n){S.r++;S.n=S.r<3?S.n+S.t:0}
$('r').textContent=(S.r|0)+' из 3';
$('n').textContent=S.r<3&&S.n?'ещё через '+tm(S.n-n):'';
$('b').textContent=(S.b|0)+' монет';
$('s').textContent=(S.w|0)+' побед · '+(S.l|0)+' поражений · выиграно '+(S.c|0);
$('g').disabled=B||!(S.r>0);
$('z').textContent=S.p||''}
// Ответ на бросок пришёл (или не пришёл): открыть кубики и сказать, что выпало.
function done(o){B=0;T.className='';
if(o.e)say(E[o.e]||'Не получилось, попробуй ещё раз');
else{dice(o.d);S.r=o.r;S.n=o.n;S.b=o.b;say(M[o.o]+'+'+o.c+' монет'+(o.x?'. '+o.x:''));W.HapticFeedback.notificationOccurred('success')}
show()}
// Бросок: стакан трясётся не меньше 0,7 с, даже если сервер ответил быстрее.
$('g').onclick=function(){if(B)return;B=1;T.className='s';say('');show();var t=Date.now();
W.request('r').then(function(a){var o;try{o=JSON.parse(a.result)}catch(e){o={e:'FAILED'}}
setTimeout(function(){done(o)},Math.max(0,700-(Date.now()-t)))},function(e){done({e:e.code})})};
// Кнопки-ссылки. Если ссылки нет, кнопка не показывается.
[['i',G.u.i],['a',G.u.a],['f',G.u.f]].forEach(function(q){var e=$(q[0]);if(q[1])e.onclick=function(){W.openTelegramLink(q[1])};else e.style.display='none'});
W.onEvent('chatDataChanged',function(){load();show()});
setInterval(show,1e3);
mat();cup();dice([1,2,3]);load();show();W.ready();
</script>`;
