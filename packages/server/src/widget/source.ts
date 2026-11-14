/**
 * Исходник виджета: HTML, CSS и JavaScript одним документом, как его требует Telegram.
 *
 * Виджет исполняется внутри сообщения в урезанной среде: сети нет, внешних
 * скриптов и картинок нет, весь документ после сжатия zlib обязан уложиться
 * в 4096 байт. Поэтому здесь нет React и сборщика, имена короткие, а коврик,
 * кубики и стакан рисуются на canvas прямоугольниками из данных скина.
 *
 * Правила, которые диктует среда (https://core.telegram.org/bots/widgets):
 * - сервер подставляет скины и ссылки вместо __CFG__, а надписи на языке игрока вместо @ключ@
 *   (см. build.ts и texts.ts);
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
#w{position:relative;padding:8px 10px 10px;font:13px/1.3 system-ui,sans-serif;color:#f1f3ef;text-align:center;background:radial-gradient(#1b9a5c,#0a4a2e);border:8px solid #6b3a1a;border-radius:24px;box-shadow:inset 0 0 0 3px #3d1f0c}
b{display:block;color:#ffe08a}
#t{position:relative;margin:6px 0;box-shadow:0 4px 0 #0009}
canvas{display:block;width:100%}
#D,#c{position:absolute;top:35%;left:9%;width:54%}
#c{top:31%;left:76%;width:15%}
.s #D{visibility:hidden}
.s #c{animation:k .35s 2}
@keyframes k{50%{transform:translate(-300%,-12%) rotate(-9deg)}}
i{position:absolute;top:0;height:100%;width:30.4%}
.b{box-shadow:0 0 0 2px #ffe08a80}
.a{box-shadow:0 0 0 3px #ffe08a,0 0 12px #ffe08a}
.h{font-size:12px;opacity:.8}
#o{min-height:18px}
#f{display:flex;gap:8px;margin-top:8px}
button{font:inherit;font-weight:700;border:0;border-radius:10px;padding:9px 12px;background:#f2b33d;box-shadow:0 3px 0 #9a6a14}
button:disabled{opacity:.45}
.y{margin-top:6px;padding:8px;border-radius:10px;background:#0006;box-shadow:inset 0 0 0 2px #f2c94c;color:#ffe08a}
#g{flex:1}
#z{display:none;position:absolute;top:0;left:0;right:0;bottom:0;padding:12px;align-items:center;border-radius:16px;background:#000b}
#z .y{background:#12764a;color:#f1f3ef}
#z button{margin:10px 3px 0}
</style>
<div id=w>
<b id=e></b>
<div id=t>
<canvas id=m width=384 height=288></canvas>
<div id=D><canvas id=d width=276 height=84></canvas><i></i><i></i><i></i></div>
<canvas id=c width=64 height=72></canvas>
</div>
<div class=h id=r></div>
<b id=o></b>
<div class=y id=s></div>
<div id=f><button class=y id=k></button><button id=g></button></div>
<div id=z><div class=y><b id=n></b><div id=v></div><button class=y id=x>@close@</button><button id=j>@more@</button></div></div>
</div>
<script>
// G — скины от сервера, S — состояние из chatData, B — идёт ли бросок,
// P — игрок нажал «Переброс» и выбирает кубик, I — выбранный кубик (-1 — ещё не выбран), Z — ссылка «Подробнее».
var W=window.TelegramWidget,G=__CFG__,S={},B=0,P=0,I=-1,Z,
$=function(i){return document.getElementById(i)},
T=$('w'),K=[].slice.call(document.querySelectorAll('i')),
// Точки на грани: для каждого значения — номера ячеек сетки 3×3 (ряд*3+колонка).
L=['','4','08','048','0268','02468','036258'];
// Рисовалка «пикселей»: один пиксель скина — k×k пикселей canvas.
function px(i,k){var g=$(i).getContext('2d');return function(f,x,y,w,h){g.fillStyle=f;g.fillRect(x*k,y*k,w*k,h*k)}}
// Картинка скина (коврик G.m, стакан G.k): строка «символ — номер цвета в палитре», w пикселей в строке.
// По одному прямоугольнику на отрезок одинаковых пикселей. Прозрачный цвет палитры — #0000. X, Y — сдвиг на холсте.
function img(i,k,w,h,d,X,Y){var r=px(i,k),x,y,j,o;for(y=0;y<h;y++)for(x=0;x<w;x=j){o=y*w;for(j=x+1;j<w&&d.s[o+j]==d.s[o+x];j++);r(d.p[parseInt(d.s[o+x],16)],(X|0)+x,(Y|0)+y,j-x,1)}}
// Три кубика на сетке 21×21, как в Die.tsx клиента: G.d — пустая грань скина, G.e — точка 5×5 (см. widget/dice.ts).
function dice(a){a.forEach(function(v,i){var o=i*24;img('d',4,21,21,G.d,o);
L[v].split('').forEach(function(c){img('d',4,5,5,G.e,o+3+5*(c%3),3+5*(c/3|0))})})}
// Время до следующего броска: 1:05:09 или 4:09.
function tm(s){s=Math.max(0,s|0);var h=s/3600|0,m=s%3600/60|0,z=function(v){return(v<10?':0':':')+v};return(h?h+z(m):m)+z(s%60)}
function say(t){$('o').textContent=t}
function load(){try{S=JSON.parse(W.chatData)||{}}catch(e){S={}}if(S.d)dice(S.d)}
// Показать состояние. Таймер досчитывается на месте, но решает всё равно сервер при броске.
function show(){var n=Date.now()/1e3,k=$('k'),g=$('g'),s=$('s');
while(S.r<3&&S.n&&S.n<=n){S.r++;S.n=S.r<3?S.n+S.t:0}
// Запас — три фишки: ● есть, ○ копится. Бонусные броски (S.a) идут сверх трёх по таймеру.
$('r').textContent='@rolls@'+'●●●○○○'.substr(3-(S.r|0),3)+(S.a?' +'+S.a:'')+(S.r<3&&S.n?' · @nextIn@'+tm(S.n-n):'');
$('e').textContent='🪙 '+(S.b|0);
// В режиме переброса главная кнопка подтверждает его и нажимается, только когда кубик выбран.
g.textContent=P?'@rerollGo@':'@roll@';
g.disabled=B||(P?I<0:!(S.r>0||S.a>0));
// Переброс виден, только когда он есть. Объяснение (S.h) пишет сервер: что делает модификатор и почему он сейчас недоступен.
k.style.display=S.m>0?'':'none';k.textContent=P?'@cancel@':'@reroll@'+S.m;k.disabled=B;
s.style.display=P?'':'none';s.textContent=S.h||'';
// Кубики, которые можно выбрать, мерцают; выбранный подсвечен.
K.forEach(function(e,i){e.className=P&&S.u?i==I?'a':'b':''});
T.className=B?'s':''}
// Окно приза: заголовок и описание присылает сервер, «Подробнее» ведёт в Mini App.
function pop(z,l){z=z.split('\n');$('n').textContent=z[0];$('v').textContent=z[1]||'';Z=l;$('j').style.display=l?'':'none';$('z').style.display='flex'}
// Ответ на бросок пришёл (или не пришёл): открыть кубики и сказать, что выпало.
// Фразу про приз (o.x) и текст окна приза (o.z) целиком составляет сервер: текст в виджете стоит байтов лимита.
function done(o){B=0;
// Отказ сервера (нет бросков) приходит с готовой фразой в o.x, ошибки Telegram — общим текстом.
if(o.e)say(o.x||'@failed@');
else{dice(o.d);'rnbamu'.split('').forEach(function(k){S[k]=o[k]});say(o.x);if(o.z)pop(o.z,o.l);W.HapticFeedback.notificationOccurred('success')}
show()}
// Запрос боту: «r» — бросок, «m0»–«m2» — переброс кубика. Стакан трясётся не меньше 0,7 с,
// даже если сервер ответил быстрее. request() можно звать только из обработчика нажатия.
function go(q){if(B)return;B=1;P=0;I=-1;say('');show();var t=Date.now();
W.request(q).then(function(a){var o;try{o=JSON.parse(a.result)}catch(e){o={e:'FAILED'}}
setTimeout(function(){done(o)},Math.max(0,700-(Date.now()-t)))},function(e){done({e:e.code})})}
// Бросить можно и кнопкой, и нажатием на стакан. Переброс в три шага: «Переброс», кубик, «Перебросить».
$('g').onclick=function(){go(P?'m'+I:'r')};
$('c').onclick=function(){P||go('r')};
$('k').onclick=function(){P=!P;I=-1;show()};
K.forEach(function(e,i){e.style.left=i*34.8+'%';e.onclick=function(){if(P&&S.u){I=i;show()}}});
$('x').onclick=function(){$('z').style.display='none'};
$('j').onclick=function(){W.openTelegramLink(Z)};
W.onEvent('chatDataChanged',function(){load();show()});
setInterval(show,1e3);
img('m',3,128,96,G.m);img('c',4,16,18,G.k);dice([1,2,3]);load();show();W.ready();
</script>`;
