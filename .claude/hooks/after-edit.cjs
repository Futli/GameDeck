// PostToolUse-хук: после правки файла приводит его к стилю репозитория.
// Prettier форматирует всё, что умеет; ESLint с --fix проверяет код.
// Оставшиеся ошибки ESLint возвращаются Claude (exit 2), чтобы он их сразу исправил.
// На Node, чтобы одинаково работало в облаке (Linux) и на TRASHCAN (Windows).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const run = (root, bin, args) =>
  spawnSync(process.execPath, [path.join(root, 'node_modules', ...bin), ...args], { cwd: root, encoding: 'utf8' });

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let file;
  try {
    file = JSON.parse(input).tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!file) process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || /(^|[\\/])(node_modules|dist)[\\/]/.test(rel)) process.exit(0);

  run(root, ['prettier', 'bin', 'prettier.cjs'], ['--write', '--ignore-unknown', '--log-level', 'silent', rel]);

  if (!/\.(c|m)?[jt]sx?$/.test(rel)) process.exit(0);
  const r = run(root, ['eslint', 'bin', 'eslint.js'], ['--fix', '--no-warn-ignored', rel]);
  if (r.status === 1) {
    process.stderr.write(`ESLint нашёл ошибки в ${rel}:\n${r.stdout}`);
    process.exit(2);
  }
  process.exit(0);
});
