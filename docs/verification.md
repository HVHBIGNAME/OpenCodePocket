# Проверка версии 1.0.0

Дата: 5 октября 2026.

## Выполнено локально

- `npm run typecheck` — TypeScript strict, включая companion и тестовые сценарии.
- 33 unit/integration проверки: QR, URL validation, UTF-8/CRLF SSE, авторизация, одноразовость и TTL, rate limit, CORS, upstream credentials, отзыв устройств, resume/replay, обновление сообщений.
- 12 Playwright сценариев на desktop Chromium, Android-viewport Chromium и iOS-viewport WebKit. Подключение через реальный companion, диалог, потоковый ответ, patch/todo/file views, вопросы, разрешения, model/config/provider flows и отсутствие горизонтального overflow.
- `npm audit` — 0 известных уязвимостей на момент установки зависимостей.

## Нативные сборки

Android и iOS компилируются отдельными job в [Build OCC](https://github.com/HVHBIGNAME/OpenCodePocket/actions/workflows/build.yml). У каждого run есть логи, подпись Android проверяется `apksigner`, APK/IPA прикладываются как artifacts. Финальный tagged run является источником релизных файлов.

Физический iPhone не подключался. WebKit viewport проверяет браузерный слой, но не заменяет запуск IPA на устройстве. Доставка APNs требует Apple-подписи и ключей владельца; без них end-to-end APNs не проверяется. Реальное качество распознавания речи зависит от оборудования и языкового пакета.

Не вызываем реальных AI-провайдеров в CI: протокол проверяется воспроизводимым fixture, а native smoke — отдельным Android-эмулятором. Проверка конкретного платного провайдера выполняется пользователем после подключения своего OpenCode.
