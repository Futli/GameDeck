import { describe, expect, it } from 'vitest';
import { vlessToXrayConfig } from '../src/proxy/xray-config.js';

const REALITY =
  'vless://11111111-2222-3333-4444-555555555555@vpn.example.com:443?type=tcp&security=reality&pbk=PUBLICKEY&fp=firefox&sni=www.example.org&sid=ab12&spx=%2F&flow=xtls-rprx-vision#my-server';

describe('конфиг Xray из ссылки vless://', () => {
  it('разбирает ссылку Reality из x-ui', () => {
    expect(vlessToXrayConfig(REALITY + '\n')).toMatchObject({
      inbounds: [{ protocol: 'http', port: 8118 }],
      outbounds: [
        {
          protocol: 'vless',
          settings: {
            vnext: [
              {
                address: 'vpn.example.com',
                port: 443,
                users: [{ id: '11111111-2222-3333-4444-555555555555', encryption: 'none', flow: 'xtls-rprx-vision' }],
              },
            ],
          },
          streamSettings: {
            network: 'tcp',
            security: 'reality',
            realitySettings: {
              serverName: 'www.example.org',
              fingerprint: 'firefox',
              publicKey: 'PUBLICKEY',
              shortId: 'ab12',
              spiderX: '/',
            },
          },
        },
        { protocol: 'blackhole' },
      ],
    });
  });

  it('пускает через прокси только Telegram', () => {
    const { routing } = vlessToXrayConfig(REALITY) as { routing: { rules: Array<Record<string, unknown>> } };
    expect(routing.rules).toEqual([
      { type: 'field', domain: ['domain:api.telegram.org'], outboundTag: 'vless-out' },
      { type: 'field', network: 'tcp,udp', outboundTag: 'block' },
    ]);
  });

  it('разбирает WebSocket поверх TLS', () => {
    const config = vlessToXrayConfig('vless://id@1.2.3.4:8443?type=ws&security=tls&path=%2Fws&host=cdn.example.com');
    expect(config).toMatchObject({
      outbounds: [
        {
          streamSettings: {
            network: 'ws',
            security: 'tls',
            tlsSettings: { serverName: '1.2.3.4' },
            wsSettings: { path: '/ws', host: 'cdn.example.com' },
          },
        },
        {},
      ],
    });
  });

  it('отклоняет чужой протокол, ссылку без порта и Reality без ключа', () => {
    expect(() => vlessToXrayConfig('trojan://secret@vpn.example.com:443')).toThrow(/vless/);
    expect(() => vlessToXrayConfig('vless://id@vpn.example.com')).toThrow(/порт/);
    expect(() => vlessToXrayConfig('vless://id@vpn.example.com:443?security=reality&sni=a.b')).toThrow(/pbk/);
    expect(() => vlessToXrayConfig('не ссылка')).toThrow(/vless/);
  });
});
