// Проверка заголовка PR: `type(scope): описание`. Типы и scope — закрытые списки из .github/pr-title.json.
// Запуск локально: node .github/scripts/pr-title.mjs "feat(perudo): ставка «точно»"
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../pr-title.json', import.meta.url), 'utf8'));
const title = process.argv[2] ?? process.env.PR_TITLE ?? '';
const list = (o) =>
  Object.entries(o)
    .map(([k, v]) => `  ${k} — ${v}`)
    .join('\n');

const fail = (why) => {
  console.error(`Заголовок PR «${title}» не подходит: ${why}`);
  console.error(`Формат: type(scope): описание, не длиннее ${config.maxLength} символов.`);
  console.error(`Типы:\n${list(config.types)}\nScope:\n${list(config.scopes)}`);
  console.error('Новый scope добавь в .github/pr-title.json в этом же PR.');
  process.exit(1);
};

const match = /^([a-z]+)\(([a-z-]+)\): (\S.*)$/u.exec(title);
if (!match) fail('нет префикса type(scope):');
const [, type, scope] = match;
if (!(type in config.types)) fail(`неизвестный тип «${type}»`);
if (!(scope in config.scopes)) fail(`неизвестный scope «${scope}»`);
if ([...title].length > config.maxLength) fail(`длина ${[...title].length}`);
console.log(`ok: ${title}`);
