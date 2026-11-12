/**
 * Печатает конфиг Xray для ссылки vless://. Ссылка читается из stdin, а не из аргумента:
 * в ней секрет, а аргументы команд остаются в истории оболочки и видны в списке процессов.
 *
 *   docker compose run --rm --no-deps -T app node dist/proxy/xray-config-cli.js < ссылка.txt > xray/config.json
 */
import { text } from 'node:stream/consumers';
import { vlessToXrayConfig } from './xray-config.js';

try {
  console.log(JSON.stringify(vlessToXrayConfig(await text(process.stdin)), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
