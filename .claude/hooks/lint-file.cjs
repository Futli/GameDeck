// PostToolUse-хук: после правки .ts/.tsx/.js/.cjs файла прогоняет по нему `eslint --fix`.
// Оставшиеся ошибки возвращает Claude (exit 2), чтобы он их сразу исправил.
// На Node, чтобы одинаково работало в облаке (Linux) и на TRASHCAN (Windows).
const { spawnSync } = require('node:child_process');
const path = require('node:path');

let input = '';
process.stdin.on('data', (c) => (input += c));
process.stdin.on('end', () => {
  let file;
  try {
    file = JSON.parse(input).tool_input?.file_path;
  } catch {
    process.exit(0);
  }
  if (!file || !/\.(c|m)?[jt]sx?$/.test(file)) process.exit(0);
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = path.relative(root, file);
  if (rel.startsWith('..') || path.isAbsolute(rel) || /(^|[\\/])(node_modules|dist)[\\/]/.test(rel)) process.exit(0);

  const eslint = path.join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  const r = spawnSync(process.execPath, [eslint, '--fix', '--no-warn-ignored', rel], { cwd: root, encoding: 'utf8' });
  if (r.status === 1) {
    process.stderr.write(`ESLint нашёл ошибки в ${rel}:\n${r.stdout}`);
    process.exit(2);
  }
  process.exit(0);
});
