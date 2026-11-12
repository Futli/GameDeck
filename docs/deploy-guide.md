# Деплой GameDeck на VPS: разбор по шагам

Цель: GameDeck доступен из интернета по `https://ваш-домен`, чтобы его можно было открыть как Telegram Mini App. Пример ниже для VPS в Нидерландах, но подойдёт любой сервер с Linux и публичным IP.

## Шаг 0. Что получится

```
Telegram / браузер ──HTTPS──▶ Caddy :443 ──HTTP──▶ app :3000 ──▶ postgres :5432
                              (сертификат)        (Node: страница, /api, /socket.io)
```

Три контейнера в `deploy/compose.yml`:

- **caddy** принимает HTTPS, сам получает и продлевает сертификат Let's Encrypt и пересылает всё в Node, включая WebSocket. Единственный, у кого открыты порты наружу (80 и 443).
- **app** — образ из `Dockerfile`: собранный сервер и клиент, один процесс на порту 3000. Миграции базы применяются при старте.
- **postgres** — база с рейтингом, монетами и магазином. Данные в томе `pgdata`, переживают пересборку и перезапуск.

Почему так:

- **Telegram требует HTTPS** с настоящим сертификатом, по голому IP или `http://` Mini App не откроется. Caddy делает это без единой строчки настроек сертификатов.
- **Порт 3000 и база наружу не открыты.** Из интернета видно только Caddy.
- **Один образ для всего.** Сервер уже умеет отдавать собранный клиент, так что отдельный nginx для статики не нужен.

## Шаг 1. Сервер

Хватит самого маленького тарифа: 1 vCPU, 1–2 ГБ RAM, 10–20 ГБ диска, Ubuntu 24.04 или Debian 12. Игры на костях почти не нагружают процессор, больше всего памяти съедает Postgres.

Нидерланды (Амстердам) удобны: низкий пинг и из России, и из Европы, Telegram оттуда доступен без ограничений. Варианты, где есть локация в Амстердаме:

- **Timeweb Cloud, Aeza** и другие провайдеры с оплатой российской картой.
- **DigitalOcean, Vultr, Linode** — нужна зарубежная карта.

Что проверить при выборе: публичный IPv4, открытые входящие порты 80 и 443, возможность поставить Docker (обычный KVM-сервер, не «хостинг сайтов»).

### Сервер в России или дома

Тоже подходит, и для игроков из России пинг даже лучше. Отличия:

- **Docker Hub из РФ недоступен.** Поэтому базовые образы в `Dockerfile` и `compose.yml` берутся с зеркала `mirror.gcr.io`, а образ приложения с `ghcr.io`. Оба открываются из РФ.
- **Нужен белый IP.** Если сервер за домашним роутером, пробросьте на него порты 80 и 443 (TCP, для HTTP/3 ещё 443/UDP), а для автодеплоя ещё и SSH.
- **Блокировка Telegram игре не мешает.** Mini App грузится с телефона игрока напрямую с нашего сервера. Доступ к `api.telegram.org` нужен только боту (виджет, позже платежи Stars), и из РФ он идёт через прокси, см. шаг 8.

### За внешним reverse proxy

Если 80/443 на роутере уже ведут на другой Caddy или nginx, который обслуживает несколько сайтов, то HTTPS делает он. Порты на контейнер GameDeck пробрасывать нельзя, иначе остальные сайты перестанут открываться. Тогда в `deploy/.env`:

```bash
DOMAIN=game.example.com
SITE_ADDRESS=:80     # внутренний Caddy слушает только http
```

Внешний прокси направляет домен на `http://<IP контейнера>:80`, для Caddy это `game.example.com { reverse_proxy 192.168.1.100:80 }`. WebSocket он проксирует сам. Без `SITE_ADDRESS=:80` внутренний Caddy начнёт перенаправлять на https и получать сертификат, и запросы пойдут по кругу.

### Proxmox: всё одной командой

Если сервер работает на Proxmox VE, шаги 3–4 делает скрипт `deploy/proxmox/gamedeck-lxc.sh`. Запуск в shell хоста PVE от root:

```bash
bash -c "$(curl -fsSL https://raw.githubusercontent.com/Futli/GameDeck/main/deploy/proxmox/gamedeck-lxc.sh)"
```

Он спросит ID, ресурсы, сеть и домен (Enter оставляет значение по умолчанию), затем:

1. скачает свежий шаблон Debian и создаст непривилегированный LXC с `nesting` и `keyctl`, без них Docker в LXC не работает;
2. поставит внутри Docker (если `get.docker.com` недоступен, то `docker.io` из Debian и compose с GitHub);
3. склонирует репозиторий в `/opt/gamedeck`, создаст `deploy/.env` со случайным паролем базы и запустит compose. Если образа в GHCR нет или он закрыт, соберёт его на месте;
4. дождётся, пока приложение станет `healthy`, и покажет, какие порты пробросить на роутере.

По умолчанию: 2 ядра, 2 ГБ RAM, 10 ГБ диска, DHCP на `vmbr0`, автозапуск вместе с хостом. Без вопросов: `YES=1 DOMAIN=game.example.com bash gamedeck-lxc.sh`.

## Шаг 2. Домен

Нужно имя, которое указывает на IP сервера.

- **Свой домен**: в DNS добавить A-запись, например `gamedeck.example.com → 203.0.113.10`. Подождать, пока `ping gamedeck.example.com` начнёт отвечать с этого IP.
- **Без домена**: бесплатный `203-0-113-10.sslip.io` (IP через дефисы) сразу указывает на `203.0.113.10`. Для первых тестов хватит, но для публичного запуска лучше свой домен: у sslip.io общие лимиты Let's Encrypt, и сертификат иногда не выдаётся.

## Шаг 3. Docker и код

```bash
ssh root@203.0.113.10

# Docker с compose-плагином (официальный скрипт)
curl -fsSL https://get.docker.com | sh
# если скрипт не скачивается (например, из РФ) — пакеты дистрибутива:
# apt install -y docker.io docker-compose-v2

# Файрвол: только SSH и веб
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable

git clone https://github.com/Futli/GameDeck.git /opt/gamedeck
cd /opt/gamedeck/deploy
```

## Шаг 4. Настройки и запуск

```bash
cp .env.example .env
nano .env        # DOMAIN и POSTGRES_PASSWORD (openssl rand -hex 24)
docker compose up -d --build
```

Первая сборка занимает пару минут. Проверка:

```bash
docker compose ps                       # app и postgres: healthy
curl https://ваш-домен/api/health       # {"ok":true,"rooms":0}
docker compose logs -f app              # логи сервера
```

Если сертификат не получен, смотрите `docker compose logs caddy`: обычно это значит, что домен ещё не указывает на сервер или закрыт порт 80.

## Шаг 5. Подключить к Telegram

1. В [@BotFather](https://t.me/BotFather): `/newbot`, затем `/newapp` (или Bot Settings → Configure Mini App) и указать `https://ваш-домен`.
2. В `deploy/.env` добавить `BOT_TOKEN` (токен бота) и `TELEGRAM_APP_URL` (`https://t.me/<бот>/<short name>`), затем `docker compose up -d`.
3. Открыть бота в Telegram и запустить приложение: имя и аватар подтянутся сами.

Как это устроено и как проверить: [telegram-guide.md](telegram-guide.md). Платежи Stars — отдельная задача.

## Шаг 6. Обновление

```bash
cd /opt/gamedeck && git pull
cd deploy && docker compose up -d --build
```

Пересобирается только `app`. Комнаты живут в памяти, поэтому идущие партии при обновлении прервутся, а рейтинг, монеты и покупки останутся в базе.

### Автообновление

На каждый push в `main` GitHub Actions (`.github/workflows/deploy.yml`) делает две вещи:

1. **test** — формат, линт, типы, неиспользуемый код и тесты, как `pnpm check` (на PR тоже).
2. **image** — собирает образ и кладёт в GitHub Container Registry: `ghcr.io/futli/gamedeck:latest` и `:<sha коммита>`. Образ появляется только после зелёных тестов.

Дальше есть два способа доставить образ на сервер.

**Сервер тянет сам (рекомендуется, особенно за чужим роутером).** Таймер systemd раз в 2 минуты запускает `deploy/auto-update.sh`. Скрипт смотрит, появился ли в `main` новый коммит и готов ли для него образ. Если да, он обновляет `/opt/gamedeck`, скачивает образ, перезапускает `app` и ждёт, пока тот ответит на проверку здоровья. Наружу ничего не открывается: ни SSH, ни ключей в GitHub. Включается один раз на сервере:

```bash
cd /opt/gamedeck && git pull
bash deploy/install-auto-update.sh
```

Первый запуск таймера один раз перезапустит приложение на текущем `main`. Что происходит, видно в журнале: `journalctl -u gamedeck-update.service -n 50`. Выключить: `systemctl disable --now gamedeck-update.timer`.

Упали тесты — образа нет, сервер остаётся на прежней версии. Откат: выключить таймер и запустить `APP_IMAGE=ghcr.io/futli/gamedeck:<sha> docker compose up -d --no-build`. Вернуть вперёд можно, отменив плохой коммит в `main` и включив таймер.

**GitHub заходит по SSH.** Шаг **deploy** в том же workflow заходит на сервер и делает то же самое сразу после сборки. Подходит серверу с белым IP. Нужен ключ:

```bash
# на сервере: отдельный ключ только для деплоя
ssh-keygen -t ed25519 -N '' -f ~/.ssh/gamedeck_deploy
cat ~/.ssh/gamedeck_deploy.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/gamedeck_deploy        # приватный ключ, скопировать в GitHub
```

В репозитории: **Settings → Secrets and variables → Actions**: переменная `DEPLOY_HOST` (IP или домен сервера), секреты `DEPLOY_USER` и `DEPLOY_SSH_KEY`. Пока `DEPLOY_HOST` не задан, шаг пропускается.

В обоих случаях первый запуск на сервере (шаги 3–4) делается руками: `.env` с паролем базы GitHub не хранит.

## Шаг 7. Резервная копия базы

```bash
# снять копию
docker compose exec -T postgres pg_dump -U gamedeck gamedeck | gzip > ~/gamedeck-$(date +%F).sql.gz

# восстановить в пустую базу
gunzip -c ~/gamedeck-2026-10-30.sql.gz | docker compose exec -T postgres psql -U gamedeck gamedeck
```

Копию стоит класть по cron раз в сутки и иногда уносить с сервера.

## Шаг 8. Прокси до Telegram

Нужен только серверу в России и только боту. Игроки, сайт и база работают напрямую.

```
app ──HTTP-прокси──▶ xray (тот же сервер) ══VLESS══▶ x-ui (за границей) ──▶ api.telegram.org
```

Почему не просто HTTP- или SOCKS-прокси на зарубежном сервере: такие протоколы легко распознаются и режутся на границе. VLESS из x-ui для этого и сделан. Но Node не умеет говорить по VLESS, поэтому рядом с приложением стоит маленький контейнер `xray`: приложению он показывает обычный HTTP-прокси, а наружу идёт по VLESS. Порт прокси наружу не открыт, и пускает он только на `api.telegram.org`.

1. В панели x-ui откройте подключение (inbound), добавьте в него отдельного клиента, например `gamedeck`, и скопируйте его ссылку `vless://…`. Отдельный клиент нужен, чтобы его можно было отключить, не трогая остальных.
2. На сервере сохраните ссылку в файл и соберите из неё конфиг. Ссылка — это ключ от вашего прокси, поэтому она идёт через файл, а не аргументом команды (аргументы остаются в истории оболочки):

   ```bash
   cd /opt/gamedeck/deploy && mkdir -p xray
   nano xray/link.txt          # вставить ссылку vless://, сохранить
   docker compose pull app     # свежий образ: в старом скрипта может не быть
   docker compose run --rm --no-deps -T app node dist/proxy/xray-config-cli.js < xray/link.txt > xray/config.json \
     && rm xray/link.txt && chmod 644 xray/config.json
   head -3 xray/config.json    # должен начинаться с {"log": …
   ```

   Папка `deploy/xray/` в git не попадает. Поддерживаются ссылки VLESS с Reality, TLS или без шифрования, транспорт tcp, ws, grpc, xhttp. Другую ссылку скрипт отклонит с объяснением.

3. В `deploy/.env` добавьте:

   ```bash
   COMPOSE_PROFILES=proxy
   TELEGRAM_PROXY_URL=http://xray:8118
   TELEGRAM_BOT_POLLING=1
   ```

4. Запустите и проверьте:

   ```bash
   docker compose up -d
   docker compose logs --tail 20 xray        # не должно быть ошибок конфига
   docker compose logs -f app | grep widget  # ждём «widget bot started»
   ```

   Если вместо этого повторяется «Telegram is unreachable», прокси не работает: смотрите логи `xray` и проверьте, что клиент в x-ui включён.

## Без Docker

Тоже можно: Node 22 + pnpm, `pnpm install && pnpm build`, `DATABASE_URL=... pnpm start` под systemd, перед ним Caddy или nginx. Но Docker проще повторить на новом сервере и откатить.
