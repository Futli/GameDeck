# GameDeck

Онлайн-комнаты для игр на костях, целевая платформа — Telegram Mini App. Этот файл — карта:
правила и объяснения лежат на страницах, на которые он ссылается. Всё, что может проверить
программа, проверяет программа (хуки, ESLint, Prettier, knip, CI), а не этот текст.

## Карта

- `packages/shared` — контракт клиент ↔ сервер (`protocol.ts`, `schemas.ts`) и правила игр (`games/`).
- `packages/server` — Fastify + Socket.IO: комнаты в памяти, игроки, рейтинг, монеты и магазин в Postgres (Drizzle).
- `packages/client` — Vite + React, чистый CSS.
- `deploy/` — Docker, Caddy, установщик для Proxmox.

| Прочитай                                                                                                                                     | Перед тем как                        |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| [docs/principles.md](docs/principles.md)                                                                                                     | менять поведение продукта            |
| [docs/practices/working-with-owner.md](docs/practices/working-with-owner.md)                                                                 | браться за любую просьбу             |
| [docs/practices/code.md](docs/practices/code.md)                                                                                             | писать код или тесты, добавлять игру |
| [docs/practices/git.md](docs/practices/git.md)                                                                                               | ветку, коммит, пуш или PR            |
| [docs/server-guide.md](docs/server-guide.md), [docs/database-guide.md](docs/database-guide.md), [docs/client-guide.md](docs/client-guide.md) | работу в соответствующем пакете      |
| [docs/deploy-guide.md](docs/deploy-guide.md)                                                                                                 | что-либо про сервер и деплой         |

## Машины

- **TRASHCAN** — Windows, локальная разработка и локальный Claude Code. Хуки в `.claude/hooks` на Node,
  чтобы работать и там, и в облаке.
- **Ubuntu-сервер** — боевая сборка для Telegram Mini App (game.lyokha.ru). Не трогать без прямой просьбы,
  `.env` не читать и не коммитить. TLS делает внешний Caddy, 80/443 на контейнер не пробрасывать,
  базовые образы — с `mirror.gcr.io` (Docker Hub из РФ закрыт).

## Команды

- `DATABASE_URL=memory:// pnpm dev` — сервер :3000 и клиент :5173, база в памяти. Посмотреть глазами — skill `run-gamedeck`.
- `pnpm fix:format`, `pnpm fix:lint` — привести код к стилю (хук после правки делает это сам по файлу).
- `pnpm test` или `pnpm exec vitest run <файл>` — тесты; `pnpm db:generate` — миграция после правки `schema.ts`.

## Перед завершением

`pnpm check` — то же, что CI: `check:format`, `check:lint`, `check:ts`, `check:unused` (knip), `test`.
Полный список шагов — skill `finish`.
