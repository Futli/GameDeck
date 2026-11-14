import { useEffect, useRef, useState } from 'react';
import { useLang, useT } from '../i18n';
import { http, loadProfile } from '../lib/socket';
import { useClientState } from '../lib/store';
import { haptic } from '../lib/telegram';

/**
 * Мост вместо Telegram. Виджет написан для window.TelegramWidget: request() шлёт запрос боту,
 * chatData — состояние, onEvent('chatDataChanged') — его обновление. Здесь те же методы, но
 * запрос уходит родительскому окну (Mini App) через postMessage, а оно спрашивает сервер.
 * Так HTML виджета остаётся ровно тем, что бот присылает в чат: ни строчки копии.
 *
 * Фрейм в песочнице без доступа к странице и её токену; размер он сообщает сам (ResizeObserver).
 */
const BRIDGE = String.raw`<script>
(function(){var n=0,P={},h={},p=parent,W;
W=window.TelegramWidget={chatData:__STATE__,
request:function(d){return new Promise(function(ok,no){P[++n]=[ok,no];p.postMessage({gw:'q',id:n,d:d},'*')})},
onEvent:function(k,f){(h[k]=h[k]||[]).push(f)},
openTelegramLink:function(u){p.postMessage({gw:'link',u:u},'*')},
HapticFeedback:{notificationOccurred:function(t){p.postMessage({gw:'haptic',t:t},'*')}},
ready:function(){}};
addEventListener('message',function(e){var m=e.data,c;if(e.source!==p||!m)return;
if(m.gw==='s'){W.chatData=m.chatData;(h.chatDataChanged||[]).forEach(function(f){f()});return}
if(m.gw!=='a'||!P[m.id])return;c=P[m.id];delete P[m.id];
if(m.e)return c[1]({code:m.e});c[0]({result:m.result});
setTimeout(function(){W.chatData=m.chatData;(h.chatDataChanged||[]).forEach(function(f){f()})},0)});
addEventListener('load',function(){new ResizeObserver(function(){p.postMessage({gw:'h',h:document.documentElement.scrollHeight},'*')}).observe(document.body)})
})();
</script>`;

type WidgetPage = { html: string; chatData: string };

/**
 * Последний виджет и высота его фрейма — на всё время жизни приложения. Вернулись на главную —
 * виджет сразу на месте и нужного размера, а не пустой блок, который потом схлопывается и
 * раздвигается обратно (раньше от этого прыгало всё, что ниже: монеты и карточки игр).
 */
let cached: { lang: string; page: WidgetPage } | null = null;
let lastHeight = 0;

/** Сообщения от фрейма; поле gw отличает их от чужих postMessage. */
type FrameMessage =
  | { gw: 'q'; id: number; d: string }
  | { gw: 'h'; h: number }
  | { gw: 'link'; u: string }
  | { gw: 'haptic'; t: 'error' | 'success' | 'warning' };

/**
 * «Кубик удачи» на главной: тот же виджет, что бот присылает в чат (стол, окно приза, переброс),
 * с тем же сервером бросков. «Подробнее» в окне приза открывает страницу «Кубик удачи» внутри
 * приложения: onDetails получает id выпавшего скина или null.
 */
export function LuckWidget({ onDetails }: { onDetails: (skinId: string | null) => void }) {
  const lang = useLang();
  const t = useT();
  const ready = useClientState((s) => s.profile !== null);
  const [page, setPage] = useState<WidgetPage | null>(cached?.lang === lang ? cached.page : null);
  const [height, setHeight] = useState(lastHeight);
  // Фрейм прислал высоту — документ внутри уже нарисован, можно показывать (до этого он прозрачный).
  const [shown, setShown] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  // Фрейм загрузился и слушает сообщения. Свежее состояние, пришедшее раньше, ждёт в pendingState.
  const frameReady = useRef(false);
  const pendingState = useRef<string | null>(null);

  // Язык виджета — язык приложения: надписи в HTML и фразы сервера. Сменили язык — новый HTML.
  // Если HTML тот же, а поменялось только состояние (монеты, броски), фрейм не перезагружаем:
  // состояние уходит в него сообщением, как после броска.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    http<WidgetPage>(`/api/me/widget?lang=${lang}`)
      .then((next) => {
        if (!alive) return;
        const current = cached?.lang === lang ? cached.page : null;
        cached = { lang, page: next };
        if (current?.html === next.html) {
          if (current.chatData === next.chatData) return;
          const target = frame.current?.contentWindow;
          if (frameReady.current && target) target.postMessage({ gw: 's', chatData: next.chatData }, '*');
          else pendingState.current = next.chatData;
          return;
        }
        frameReady.current = false;
        pendingState.current = null;
        setShown(false);
        setPage(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ready, lang]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<FrameMessage>) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target || typeof event.data?.gw !== 'string') return;
      const message = event.data;
      if (message.gw === 'h') {
        frameReady.current = true;
        lastHeight = message.h;
        setHeight(message.h);
        setShown(true);
        if (pendingState.current) {
          target.postMessage({ gw: 's', chatData: pendingState.current }, '*');
          pendingState.current = null;
        }
      } else if (message.gw === 'haptic') haptic(message.t);
      else if (message.gw === 'link') {
        // В чате «Подробнее» — ссылка на Mini App со startapp=luck[-<id скина>]; здесь сервер присылает сам параметр.
        const match = /^luck(?:-([0-9a-f-]{36}))?$/.exec(message.u);
        if (match) onDetails(match[1] ?? null);
      } else if (message.gw === 'q') {
        http<{ result: string; chatData: string }>('/api/me/widget/query', { d: message.d, lang })
          .then(({ result, chatData }) => {
            if (cached?.lang === lang) cached = { lang, page: { ...cached.page, chatData } };
            target.postMessage({ gw: 'a', id: message.id, result, chatData }, '*');
            // Монеты на главной — тот же баланс, что в виджете.
            loadProfile();
          })
          .catch(() => target.postMessage({ gw: 'a', id: message.id, e: 'FAILED' }, '*'));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [lang, onDetails]);

  // Место под виджет занято с самого начала: пока высота неизвестна — заготовка примерно его размера,
  // потом ровно его высота. Сам фрейм проявляется, когда внутри всё нарисовано.
  return (
    <div
      className={height ? 'luck-widget' : 'luck-widget luck-widget--loading'}
      style={height ? { height } : undefined}
    >
      {page && (
        <iframe
          ref={frame}
          className={shown ? 'luck-widget__frame luck-widget__frame--shown' : 'luck-widget__frame'}
          title={t.luck.title}
          sandbox="allow-scripts"
          srcDoc={widgetDocument(page)}
          style={height ? { height } : undefined}
        />
      )}
    </div>
  );
}

/** Документ фрейма: мост вместо Telegram, потом HTML виджета ровно таким, каким его получает чат. */
function widgetDocument(page: WidgetPage) {
  // «</» внутри строки в <script> закрыло бы тег — экранируем, как это делает сборка виджета на сервере.
  const state = JSON.stringify(page.chatData).replaceAll('</', '<\\/');
  return (
    '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent}</style>' +
    BRIDGE.replace('__STATE__', () => state) +
    page.html
  );
}
