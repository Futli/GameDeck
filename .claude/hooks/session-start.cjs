// SessionStart-хук. Что печатает в stdout, Claude видит в начале сессии.
// 1. В облачной сессии (свежий клон) ставит зависимости.
// 2. Рассказывает, в каком состоянии git: параллельно работают несколько веток и сессий,
//    и важно сразу знать, отстала ли ветка от main и есть ли чужие незакоммиченные правки.
const { spawnSync } = require('node:child_process');

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const sh = (cmd, args, timeout = 10_000) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout, shell: process.platform === 'win32' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};
const git = (...args) => sh('git', args);
const lines = [];

if (process.env.CLAUDE_CODE_REMOTE === 'true') {
  const install = sh('pnpm', ['install', '--frozen-lockfile', '--reporter=silent'], 300_000);
  lines.push(install.ok ? 'Зависимости установлены.' : `pnpm install упал:\n${install.err}`);
}

const branch = git('branch', '--show-current').out || 'detached HEAD';
const dirty = git('status', '--porcelain').out.split('\n').filter(Boolean).length;
lines.push(`Ветка: ${branch}${dirty ? `, незакоммиченных файлов: ${dirty}` : ', рабочее дерево чистое'}.`);

if (git('fetch', '--quiet', 'origin', 'main').ok) {
  const [ahead, behind] = git('rev-list', '--left-right', '--count', 'HEAD...origin/main').out.split(/\s+/).map(Number);
  if (behind > 0) lines.push(`Отстаёт от origin/main на ${behind} коммит(ов): слей main перед работой.`);
  else lines.push('main уже влит в ветку.');
  if (branch !== 'main' && ahead > 0) lines.push(`Своих коммитов поверх main: ${ahead}.`);
} else {
  lines.push('origin недоступен: не знаю, свежий ли main.');
}

if (branch === 'main') lines.push('Ты на main: перед первой правкой создай ветку.');
lines.push(
  'В этой папке могут работать другие сессии: не переключай ветку и не трогай чужие незакоммиченные файлы, не спросив.',
);
console.log(lines.join('\n'));
