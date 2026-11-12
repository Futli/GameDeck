---
name: run-gamedeck
description: Запустить GameDeck (сервер + клиент) локально, проверить API и снять скриншот клиента в эмуляции телефона. Использовать, чтобы увидеть изменение в работающем приложении, а не только в тестах.
---

# Запуск GameDeck и скриншот

1. Зависимости: `pnpm install --frozen-lockfile` (в облачной сессии это уже сделал хук SessionStart).

2. Запустить dev-режим в фоне с базой в памяти (ничего не пишется на диск):

   ```bash
   DATABASE_URL=memory:// pnpm dev > /tmp/gamedeck-dev.log 2>&1 &
   ```

   Сервер слушает :3000, Vite — :5173 и проксирует `/api` и `/socket.io` на сервер.

3. Дождаться готовности (обычно 1–2 с):

   ```bash
   until curl -sf localhost:3000/api/health && curl -sf -o /dev/null localhost:5173; do sleep 0.5; done
   ```

   `GET /api/health` отвечает `{"ok":true,"rooms":N}`.

4. Скриншот в размере iPhone 13 (Mini App в Telegram открывается на телефоне):

   ```bash
   node .claude/skills/run-gamedeck/screenshot.cjs http://localhost:5173 /путь/к/shot.png
   ```

   Скрипт печатает ошибки страницы (pageerror и console.error), если они были.
   Посмотреть картинку — инструментом Read.

5. Сценарий с несколькими игроками (создать комнату, войти, сыграть) проще всего
   прогнать сквозным тестом по образцу `packages/server/test/socket.test.ts`:
   там N клиентов `socket.io-client` и детерминированный `rng`.

6. Остановить: `pkill -f "pnpm dev"; pkill -f vite; pkill -f "tsx watch"`.

Заметки:

- Прод-режим: `pnpm build && pnpm start` — один порт :3000, сервер отдаёт собранный клиент.
- Если сервер пишет `client build not found, serving API only` в dev — это нормально, клиент отдаёт Vite.
- Вход через Telegram (`initData`) в браузере вне Telegram недоступен; смотреть, как клиент ведёт себя без него.
