# Подключение OCC

## Требования

- OpenCode с HTTP API (`/global/health`, `/session`, `/permission`, `/question`). OCC ориентирован на OpenCode 1.18.x и совместимый v1 HTTP API новых версий.
- Node.js 22+ для CLI/моста. Плагин запускается внутри OpenCode.
- Для автоматического публичного туннеля — `cloudflared` в PATH. Он отдельно устанавливается через `winget install Cloudflare.cloudflared`, `brew install cloudflared` или менеджер пакетов Linux.

## 1. Установить companion

```sh
npm install -g https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/hvhbigname-occ-bridge-1.0.0.tgz
occ-pocket install --tunnel
```

Без глобальной установки:

```sh
npx --yes --package=https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/hvhbigname-occ-bridge-1.0.0.tgz occ-pocket install --tunnel
```

Установщик помещает самостоятельный `occ-pocket.js` в `~/.config/opencode/plugins/`. Существующий `opencode.json` не требуется менять. Старый файл OCC-плагина при обновлении копируется в `occ-pocket/occ-pocket.previous.js`. Перезапусти OpenCode после установки или обновления.

## 2. Запустить OpenCode с доступным API

```sh
opencode --port 4096
```

Плагин сам поднимет мост на `127.0.0.1:4141`, подключит его к серверу текущего процесса и создаст Cloudflare Quick Tunnel. Страница QR появится в `~/.config/opencode/occ-pocket/pairing.html`.

Если API защищён паролем, процесс моста/плагина должен иметь те же `OPENCODE_SERVER_PASSWORD` и `OPENCODE_SERVER_USERNAME`. По умолчанию логин `opencode`.

### Уже запущенная сессия

Если TUI уже слушает порт, подключи standalone-мост:

```sh
occ-pocket start --upstream http://127.0.0.1:4096 --tunnel
```

**Не запускай ещё один `opencode serve`, если нужно отвечать на вопросы уже работающего TUI.** История лежит в общей базе, но ожидание разрешения и работающий процесс относятся к конкретному серверу. Если TUI не выставляет HTTP-порт, сначала сохрани ход работы и перезапусти его с `--port`.

## 3. Связать телефон

Открой приложение → «Подключить компьютер» → сканируй QR → «Подключиться». Ссылку `occ://pair?...` можно вставить вручную.

Каждый QR действует **10 минут, один раз**. Для второго телефона/повторной попытки:

```sh
occ-pocket pair
```

Разрешён максимум 12 попыток в минуту на адрес клиента. За туннелем этот лимит может делиться между телефонами. Постоянные ключи устройств сохраняются на компьютере только в виде SHA-256-хешей. В телефоне — в Keystore/Keychain.

## Свой туннель

Направь существующий HTTPS-туннель на **OCC-мост, порт 4141**:

```sh
occ-pocket install --url https://occ.example.com
```

Поддерживаются Cloudflare named tunnel, ngrok, reverse proxy и другие прозрачные HTTP/SSE туннели. Требования: сохранить Authorization, не буферизовать SSE, не переписывать `/api/` и `/occ/`, разрешить запросы до 16 МБ. Авторизацию провайдера туннеля в браузере клиент не имитирует.

Если туннель установлен на удалённой машине, мост по умолчанию слушает loopback своего ПК. Настрой маршрутизацию явно; не выставляй голый сервер OpenCode наружу без защиты.

## Wi-Fi / VPN

```sh
occ-pocket install --lan
```

Этот режим слушает `0.0.0.0:4141`. Телефон и компьютер должны видеть друг друга, а firewall — разрешать TCP 4141. Автовыбор берёт первый внешний IPv4; при нескольких адаптерах укажи нужный адрес:

```sh
occ-pocket pair --url http://192.168.1.20:4141
```

HTTP разрешён только для локальных адресов, `.local` и VPN-диапазона Tailscale `100.64.0.0/10`. Для публичных доменов клиент требует HTTPS. Сертификат HTTPS должен быть доверенным системе; обхода TLS-проверок нет.

## Прямое подключение

В форме подключения выбери «Сервер», введи URL OpenCode и Basic auth. Плагин не обязателен. Сессии/чат/модели/разрешения работают через API. Управление устройствами и push-мост доступны только в режиме OCC-моста.

## Сбои

| Симптом | Проверка |
| --- | --- |
| QR не появился | `cloudflared --version`, логи `occ-pocket` в OpenCode, занятость 4141. |
| Сервер не отвечает | Открой `http://127.0.0.1:4096/global/health` на ПК; проверь порт текущего TUI. |
| HTTP 401 | Пароль прямого сервера или отозванный ключ устройства; сформируй новый QR. |
| История есть, вопроса нет | Возможно, выбран другой процесс OpenCode. |
| Старый Quick Tunnel недоступен | После перезапуска у Quick Tunnel другой URL. Новый QR или постоянный named tunnel. |
| На Wi-Fi не подключается | AP isolation, firewall, неверный сетевой адаптер, фоновые VPN. |
| В браузере CORS | Добавь `--origin http://127.0.0.1:1420` к standalone-мосту. |

Настройки моста: `~/.config/opencode/occ-pocket/bridge.json`. `OCC_STATE_DIR` позволяет задать отдельную директорию состояния; `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` учитываются установщиком.
