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
addEventListener('message',function(e){var m=e.data,c;if(e.source!==p||!m||m.gw!=='a'||!P[m.id])return;c=P[m.id];delete P[m.id];
if(m.e)return c[1]({code:m.e});c[0]({result:m.result});
setTimeout(function(){W.chatData=m.chatData;(h.chatDataChanged||[]).forEach(function(f){f()})},0)});
addEventListener('load',function(){new ResizeObserver(function(){p.postMessage({gw:'h',h:document.documentElement.scrollHeight},'*')}).observe(document.body)})
})();
</script>`;

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
  const [page, setPage] = useState<{ html: string; chatData: string } | null>(null);
  const [height, setHeight] = useState(0);
  const frame = useRef<HTMLIFrameElement>(null);

  // Язык виджета — язык приложения: надписи в HTML и фразы сервера. Сменили язык — новый HTML.
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    http<{ html: string; chatData: string }>(`/api/me/widget?lang=${lang}`)
      .then((next) => alive && setPage(next))
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
      if (message.gw === 'h') setHeight(message.h);
      else if (message.gw === 'haptic') haptic(message.t);
      else if (message.gw === 'link') {
        // В чате «Подробнее» — ссылка на Mini App со startapp=luck[-<id скина>]; здесь сервер присылает сам параметр.
        const match = /^luck(?:-([0-9a-f-]{36}))?$/.exec(message.u);
        if (match) onDetails(match[1] ?? null);
      } else if (message.gw === 'q') {
        http<{ result: string; chatData: string }>('/api/me/widget/query', { d: message.d, lang })
          .then(({ result, chatData }) => {
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

  if (!page) return <div className="luck-widget luck-widget--loading" />;

  // «</» внутри строки в <script> закрыло бы тег — экранируем, как это делает сборка виджета на сервере.
  const state = JSON.stringify(page.chatData).replaceAll('</', '<\\/');
  const doc =
    '<!doctype html><meta charset=utf-8><style>html,body{margin:0;background:transparent}</style>' +
    BRIDGE.replace('__STATE__', () => state) +
    page.html;

  return (
    <iframe
      ref={frame}
      className="luck-widget"
      title={t.luck.title}
      sandbox="allow-scripts"
      srcDoc={doc}
      style={height ? { height } : undefined}
    />
  );
}
