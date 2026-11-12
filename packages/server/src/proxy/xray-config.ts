/**
 * Конфиг клиента Xray из ссылки vless://, которую выдаёт панель x-ui («Копировать ссылку»).
 *
 * Зачем: сервер в России не достучится до api.telegram.org напрямую. Рядом с приложением
 * ставится контейнер xray. Он принимает обычные HTTP-прокси-запросы от приложения
 * и уносит их по VLESS на сервер с x-ui, а тот уже идёт в Telegram.
 *
 *   app ──HTTP-прокси──▶ xray (тот же сервер) ══VLESS══▶ x-ui (за границей) ──▶ api.telegram.org
 */

/** Порт HTTP-прокси внутри сети compose. Наружу не публикуется. */
export const XRAY_HTTP_PORT = 8118;

/** Куда прокси разрешено ходить. Всё остальное он отбрасывает: это прокси для бота, а не для всего подряд. */
const ALLOWED_DOMAINS = ['domain:api.telegram.org'];

function required(params: URLSearchParams, name: string): string {
  const value = params.get(name);
  if (!value) throw new Error(`В ссылке нет параметра ${name}`);
  return value;
}

/** Настройки транспорта и шифрования: поля называются так же, как в конфиге Xray. */
function streamSettings(params: URLSearchParams, host: string): Record<string, unknown> {
  const network = params.get('type') ?? 'tcp';
  const security = params.get('security') ?? 'none';
  const settings: Record<string, unknown> = { network, security };

  if (security === 'reality') {
    settings.realitySettings = {
      serverName: required(params, 'sni'),
      fingerprint: params.get('fp') ?? 'chrome',
      publicKey: required(params, 'pbk'),
      shortId: params.get('sid') ?? '',
      spiderX: params.get('spx') ?? '',
    };
  } else if (security === 'tls') {
    const alpn = params.get('alpn');
    settings.tlsSettings = {
      serverName: params.get('sni') ?? host,
      fingerprint: params.get('fp') ?? 'chrome',
      ...(alpn ? { alpn: alpn.split(',') } : {}),
    };
  } else if (security !== 'none') {
    throw new Error(`Неизвестный security=${security}: поддерживаются reality, tls и none`);
  }

  const path = params.get('path') ?? '/';
  const hostHeader = params.get('host');
  if (network === 'ws') {
    settings.wsSettings = { path, ...(hostHeader ? { host: hostHeader } : {}) };
  } else if (network === 'grpc') {
    settings.grpcSettings = { serviceName: params.get('serviceName') ?? '' };
  } else if (network === 'xhttp') {
    settings.xhttpSettings = { path, ...(hostHeader ? { host: hostHeader } : {}), mode: params.get('mode') ?? 'auto' };
  } else if (network !== 'tcp' && network !== 'raw') {
    throw new Error(`Неизвестный type=${network}: поддерживаются tcp, ws, grpc и xhttp`);
  }
  return settings;
}

/** Разобрать ссылку vless:// и собрать конфиг Xray. Непонятная ссылка отклоняется, а не угадывается. */
export function vlessToXrayConfig(link: string): Record<string, unknown> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error('Это не ссылка: ожидается vless://…');
  }
  if (url.protocol !== 'vless:') throw new Error('Поддерживаются только ссылки vless://');
  const id = decodeURIComponent(url.username);
  const port = Number(url.port);
  if (!id || !url.hostname || !Number.isInteger(port) || port < 1) {
    throw new Error('В ссылке должны быть id, адрес и порт: vless://id@адрес:порт?…');
  }
  const flow = url.searchParams.get('flow');
  // IPv6 в URL стоит в квадратных скобках, Xray ждёт адрес без них.
  const address = url.hostname.replace(/^\[|\]$/g, '');

  return {
    log: { loglevel: 'warning' },
    inbounds: [{ tag: 'http-in', listen: '0.0.0.0', port: XRAY_HTTP_PORT, protocol: 'http' }],
    outbounds: [
      {
        tag: 'vless-out',
        protocol: 'vless',
        settings: {
          vnext: [{ address, port, users: [{ id, encryption: 'none', ...(flow ? { flow } : {}) }] }],
        },
        streamSettings: streamSettings(url.searchParams, address),
      },
      { tag: 'block', protocol: 'blackhole' },
    ],
    routing: {
      rules: [
        { type: 'field', domain: ALLOWED_DOMAINS, outboundTag: 'vless-out' },
        { type: 'field', network: 'tcp,udp', outboundTag: 'block' },
      ],
    },
  };
}
