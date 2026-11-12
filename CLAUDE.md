# GameDeck — заметки для Claude

Онлайн-комнаты для игр на костях, целевая платформа — Telegram Mini App.
Монорепо pnpm: `packages/shared` (контракт и правила игр), `packages/server`
(Fastify + Socket.IO + Drizzle), `packages/client` (Vite + React, чистый CSS).
Подробные гайды для человека: `docs/server-guide.md`, `docs/database-guide.md`,
`docs/client-guide.md`, `docs/deploy-guide.md`.

## Команды

| Что | Команда | Время |
| --- | --- | --- |
| Зависимости | `pnpm install --frozen-lockfile` | ~2 с |
| Типы во всех пакетах | `pnpm typecheck` | ~6 с |
| Все тесты (Vitest, PGlite в памяти) | `pnpm test` | ~5 с |
| Один файл тестов | `pnpm exec vitest run packages/server/test/socket.test.ts` | |
| Dev: сервер :3000 + клиент :5173 | `DATABASE_URL=memory:// pnpm dev` | |
| Сборка | `pnpm build` | |
| Миграция после правки `schema.ts` | `pnpm db:generate` | |

Перед коммитом: `pnpm typecheck && pnpm test` — то же самое гоняет CI
(`.github/workflows/deploy.yml`). Линтера и форматтера в проекте пока нет.

Чтобы запустить приложение и посмотреть на него глазами — skill `run-gamedeck`
(`.claude/skills/run-gamedeck/SKILL.md`).

## Как устроено

- **Авторитетный сервер.** Клиент шлёт намерение, сервер проверяет ход, бросает
  кубики (rng на сервере) и рассылает каждому свой `room:state`.
- **Протокол** — в `packages/shared/src/protocol.ts`: события с ack
  `{ ok: true, data } | { ok: false, error: { code } }`. Входящие данные
  валидируются zod-схемами из `shared/src/schemas.ts`.
- **Игры — модули** `GameModule` (`shared/src/games/types.ts`): чистые функции без
  I/O. Новая игра = файл в `shared/src/games/` + строка в реестре
  `shared/src/games/index.ts` + тест в `shared/test/`. Скрытая информация
  (кубики под стаканом) режется в `viewFor` — чужие секреты не должны уходить по сети.
- **Комнаты** живут в памяти (`server/src/rooms`), игроки/рейтинг/монеты/предметы —
  в PostgreSQL. Без `DATABASE_URL` используется PGlite (`./data/pglite`),
  `memory://` — база в памяти.
- **Монеты** меняются только через `changeCoins` с записью в журнал
  (`server/src/db/wallet.ts`). Монеты виртуальные, без вывода.
- `@gamedeck/shared` подключается из исходников через условие `source`
  (vitest, vite, `tsx --conditions=source`), пересобирать shared не нужно.

## Тесты

- Правила игр тестируются как чистые функции с детерминированным `rng`.
- Сквозные тесты сокетов (`server/test/socket.test.ts`) поднимают настоящий
  сервер через `buildApp({ db, rng, disconnectGraceMs })` на порту 0 и
  подключают нескольких клиентов `socket.io-client`. Это и есть способ
  проверить комнату с N игроками: используй этот шаблон для новых сценариев.
- Одна PGlite-база на файл (`server/test/helpers.ts`), каждый тест создаёт своих игроков.

## Соглашения

- Язык: комментарии, документация, тексты UI, названия и описания PR — по-русски.
  Сообщения коммитов — по-английски, в повелительном наклонении.
- TypeScript strict, ESM (`.js` в путях импортов на сервере).
- Пользователь изучает проект по шагам: новые подсистемы сопровождать
  понятным объяснением в `docs/*-guide.md`.
- Параллельно работают несколько веток/PR. Перед пушем: `git fetch origin main`
  и слить main в свою ветку, конфликты решать, не теряя чужие изменения.

## Деплой (не трогать без явной просьбы)

- Прод: LXC-контейнер на Proxmox друга в РФ, домен game.lyokha.ru. Установщик —
  `deploy/proxmox/gamedeck-lxc.sh`, конфиг на сервере — `/opt/gamedeck/deploy/.env`.
- TLS делает внешний Caddy на хосте; внутренний Caddy в контейнере работает
  только по http. 80/443 на контейнер не пробрасывать.
- Docker Hub из РФ недоступен: базовые образы брать с `mirror.gcr.io`.
- Файлы `.env` не читать и не коммитить, секреты (BOT_TOKEN и т.п.) — только в `.env` на сервере.
