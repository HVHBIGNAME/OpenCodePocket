<p align="center"><img src="docs/assets/cover.svg" alt="OpenCode Pocket — Your code. Within reach." width="100%" /></p>

<p align="center">
  <a href="https://github.com/HVHBIGNAME/OpenCodePocket/releases/latest"><b>Скачать APK / IPA</b></a> &nbsp; / &nbsp;
  <a href="docs/connect.md">Подключение</a> &nbsp; / &nbsp;
  <a href="docs/build.md">Собрать самому</a> &nbsp; / &nbsp;
  <a href="docs/notifications.md">Уведомления</a>
</p>

# OpenCode Pocket / OCC

**Твой код. Всегда рядом.** Мобильный клиент [OpenCode](https://opencode.ai) для Android и iOS. Продолжай сессии с компьютера, отправляй промпты, отвечай на вопросы и управляй моделями — с телефона.

**37 оригинальных тем OpenCode** — все светлые и тёмные варианты, поиск по каталогу и системный режим. По умолчанию — Mercury. Цвета берутся из исходных палитр и алгоритмов OpenCode, включая поверхности, текст, кнопки, Markdown и изменения файлов.

## Что умеет

| | |
| --- | --- |
| **Подключиться за минуту** | Плагин-мост, одноразовый QR, свой HTTPS-туннель, Wi-Fi/VPN или прямое подключение к OpenCode. |
| **Продолжить на телефоне** | Актуальные сессии, потоковый текст, инструменты, задачи, файлы и патчи. Создание, переименование и ответвление сессий. |
| **Оставаться в диалоге** | Промпты, картинки/PDF, slash-команды, остановка генерации, вопросы с несколькими ответами и разрешения. |
| **Настроить интеллект** | Модели, агенты, варианты, параметры, API-ключи и свои OpenAI-совместимые провайдеры. |
| **Выбрать свою тему** | Полный каталог OpenCode: 37 тем × 2 режима. Выбор сохраняется на устройстве и работает без подключения к компьютеру. |
| **Задать правила** | Автодоступ, подтверждение отдельных действий, правила по шаблонам и JSON-редактор `permission`. |
| **Надиктовать мысль** | Android SpeechRecognizer / iOS Speech. Строгое распознавание на устройстве включено по умолчанию. |
| **Не пропустить вопрос** | Android: фоновый сервис. iOS: APNs с настроенной подписью и ключом на мосте. Внешний push-канал ntfy также поддерживается. |
| **Контролировать доступ** | Отдельный ключ на каждое устройство, список устройств и отзыв доступа. Android Keystore + AES-256-GCM, iOS Keychain. |
| **Находить сбои** | Автоматические обезличенные отчёты, очередь без сети, native crash collection и группировка в GitHub Issues через авторизованный мост. |

Независимый проект, не официальный продукт Anomaly. Обезличенная диагностика сбоев включена по умолчанию и отключается в настройках. [Состав отчётов и настройка GitHub →](docs/diagnostics.md) Для использования клиента не нужен аккаунт OCC или обязательный облачный backend. Выбранный туннель и AI-провайдер работают по своим правилам.

## Установка

**Android:** [скачать подписанный APK](https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/OpenCodePocket-1.0.0-android.apk). APK подписан постоянным ключом проекта. Android 8+.

**iOS:** [скачать IPA](https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/OpenCodePocket-1.0.0-ios-unsigned.ipa). Это скомпилированный arm64 IPA для iOS 15+, **без Apple-подписи**. Для установки нужна самостоятельная подпись через Sideloadly/AltStore или свою Apple Developer-команду. Фоновый APNs требует подходящих entitlements и provisioning profile. [Подробнее](docs/build.md#ios).

### Компьютер → телефон

Установи [Node.js 22+](https://nodejs.org/) и [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/), затем:

```sh
npm install -g https://github.com/HVHBIGNAME/OpenCodePocket/releases/download/v1.0.0/hvhbigname-occ-bridge-1.0.0.tgz
occ-pocket install --tunnel
opencode --port 4096
```

1. После установки плагина **перезапусти OpenCode** с указанным портом.
2. Открой `~/.config/opencode/occ-pocket/pairing.html` (Windows: `%USERPROFILE%\.config\opencode\occ-pocket\pairing.html`).
3. В OCC: **Подключить компьютер → Сканировать QR-код → Подключиться**.

Новый одноразовый QR: `occ-pocket pair`. Срок действия — 10 минут. Секрет OpenCode не попадает в QR. Устройства можно отозвать в настройках OCC.

Если OpenCode уже слушает порт, можно подключить мост без перезапуска:

```sh
occ-pocket start --upstream http://127.0.0.1:4096 --tunnel
```

Важно подключаться к **тому же процессу OpenCode**, в котором идёт работа. Другой `opencode serve` видит сохранённые сессии, но не переносит выполняющийся инструмент и ожидающие в памяти вопросы из первого процесса.

Свой туннель: `--url https://your-tunnel.example` вместо `--tunnel`. Локальная сеть/VPN: `--lan`. [Все сценарии →](docs/connect.md)

## Интерфейс

Сессии, диалог и запросы — тема **Mercury, тёмная**:

<p align="center"><img src="docs/assets/mobile-sessions.png" alt="OCC на телефоне: сессии" width="31%" /> &nbsp; <img src="docs/assets/mobile-chat.png" alt="OCC: удобный мобильный чат" width="31%" /> &nbsp; <img src="docs/assets/mobile-inbox.png" alt="OCC: пошаговые вопросы" width="31%" /></p>

Интерфейс рассчитан на телефон: главный экран сразу открывает сессии, нижняя навигация даёт доступ к запросам и моделям, а чат использует всю высоту экрана. Модель и режим выбираются в нижней панели. Клавиатура не перекрывает отправку, длинные вопросы разбиты на шаги, новые сессии доступны большим пальцем.

Модель и режим сессии, каталог моделей и настройки:

<p align="center"><img src="docs/assets/mobile-options.png" alt="Модель, агент и вариант сессии" width="31%" /> &nbsp; <img src="docs/assets/mobile-models.png" alt="Каталог моделей и провайдеров" width="31%" /> &nbsp; <img src="docs/assets/mobile-settings.png" alt="Настройки оформления" width="31%" /></p>

### Темы — как в OpenCode

**Настройки → Оформление → Тема**. Полный каталог с поиском, светлый / тёмный / системный режим. Ниже — выбор темы, **Catppuccin Dark** и **GitHub Light**:

<p align="center"><img src="docs/assets/mobile-themes.png" alt="Все темы OpenCode с поиском" width="31%" /> &nbsp; <img src="docs/assets/theme-catppuccin.png" alt="Catppuccin: тёмная тема" width="31%" /> &nbsp; <img src="docs/assets/theme-github-light.png" alt="GitHub: светлая тема" width="31%" /></p>

<details>
<summary>Все 37 тем</summary>

AMOLED, Aura, Ayu, Carbonfox, Catppuccin, Catppuccin Frappe, Catppuccin Macchiato, Cobalt2, Cursor, Dracula, Everforest, Flexoki, GitHub, Gruvbox, Kanagawa, Lucent Orng, Material, Matrix, Mercury, Monokai, Night Owl, Nord, OC-2, One Dark, One Dark Pro, OpenCode, Orng, Osaka Jade, Palenight, Rose Pine, Shades of Purple, Solarized, Synthwave '84, Tokyonight, Vercel, Vesper, Zenburn.

Оригиналы и MIT-лицензия сохранены в [`third_party/opencode`](third_party/opencode). `npm run themes:check` проверяет точное совпадение с обоими оригинальными алгоритмами расчёта цветов на зафиксированной ревизии OpenCode.

</details>

Скриншоты используют воспроизводимые тестовые сессии. Рабочее приложение показывает данные подключённого сервера.

## Разработка

```sh
npm ci
npm run dev              # http://127.0.0.1:1420
npm run check            # TypeScript + exact theme validation + unit/integration tests
npx playwright install chromium webkit
npm run test:e2e         # Compact Android + Android layout + iOS WebKit
npm run build            # Web UI + bundled companion
npm run native:sync      # Sync web assets to native projects
```

Браузерная версия хранит ключи только в памяти вкладки. Для браузерной разработки разреши origin на мосте: `occ-pocket start --origin http://127.0.0.1:1420`. Нативный клиент использует системный HTTP и не зависит от браузерного CORS.

```
src/                         React + TypeScript, интерфейс и клиент API
shared/                      QR-протокол, SSE decoder, уведомления
packages/bridge/             Плагин OpenCode, CLI, прокси, APNs/ntfy
android/                     Android shell, AES-GCM vault, speech, event service
ios/                         iOS shell, Keychain, speech, SSE, APNs registration
tests/                       Unit, integration, browser and native QA
docs/                        Подключение, подпись, ограничения, дизайн
```

Сборки запускаются в [GitHub Actions](https://github.com/HVHBIGNAME/OpenCodePocket/actions). Публикация APK/IPA и companion происходит только по тегу `v*`, после успешных проверок.

## Возможности и границы версии 1.0

- Код и инструменты исполняются **на компьютере**. Телефон — полноценный клиент этого процесса.
- Офлайн-диктовка зависит от устройства и языкового пакета; для Android используется именно on-device API (Android 12+). Если его нет, приложение объясняет причину, не переключая аудио в облако автоматически.
- В фоне iOS нельзя держать обычный SSE бесконечно. Для настоящей фоновой доставки настрой [APNs или ntfy](docs/notifications.md). IPA без подходящей подписи не получает APNs.
- При пропадании сети включается переподключение. Неуспешные промпты сохраняются в черновике; автоматической повторной отправки, способной продублировать задачу, нет.
- Бесплатный Cloudflare Quick Tunnel меняет адрес при перезапуске и требует нового подключения. Для постоянного адреса используй именованный туннель/VPN.
- OAuth-вход провайдера выполняется на компьютере; подключённые модели доступны в OCC. API-ключи можно добавлять с телефона.

Проверки и фактические результаты перечислены в [docs/verification.md](docs/verification.md). Ветка исследований локального исполнения появится отдельно от релиза 1.0.

---

**[HVHBIGNAME](https://github.com/HVHBIGNAME)** · Independent software · [MIT](LICENSE)
