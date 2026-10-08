# Сборка OCC

## Общая часть

Node.js 22+, npm и Git:

```sh
git clone https://github.com/HVHBIGNAME/OpenCodePocket.git
cd OpenCodePocket
npm ci
npm run check
npm run build
npm run assets
npx cap sync
```

`dist/` — браузерный bundle. `packages/bridge/dist/` — три самостоятельных ESM entrypoint: `cli.js`, `plugin.js`, `server.js`. Пакет плагина создаётся через `npm pack ./packages/bridge`.

## Android

JDK 21, Android SDK 36, build-tools 36 и принятые SDK licenses. Задай `ANDROID_HOME` или локальный `android/local.properties`.

```sh
# Из android/
./gradlew assembleDebug
```

Windows: `gradlew.bat assembleDebug`. Результат: `android/app/build/outputs/apk/debug/app-debug.apk`.

Release использует:

```dotenv
OCC_KEYSTORE_FILE=/absolute/path/occ-release.keystore
OCC_KEYSTORE_PASSWORD=your-private-password
```

Alias: `occ`. Затем `./gradlew assembleRelease lintRelease`. Если переменных нет, локальная release-сборка не подписывается. В GitHub Actions отсутствие секрета считается ошибкой.

### Постоянный ключ в GitHub Actions

Репозиторий использует encrypted secrets `ANDROID_KEYSTORE_BASE64` и `ANDROID_KEYSTORE_PASSWORD`. `scripts/setup-signing.mjs` создаёт/повторно использует приватную идентичность в игнорируемой `.secrets/` и загружает secrets через авторизованный `gh`. Это owner-only setup, не обязательный шаг для обычной локальной разработки. Сделай приватную резервную копию ключа: он нужен для обновления установленного APK.

Выпуски APK рассчитаны на Android 8+. На Android ниже 12 строгая локальная диктовка недоступна; основной клиент работает.

## iOS

Нужны macOS, Xcode 26+ и Swift Package Manager. GitHub Actions использует `macos-26`; физический iPhone для компиляции не требуется.

```sh
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App \
  -configuration Release -destination 'generic/platform=iOS' \
  -derivedDataPath build/ios \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY='' build
```

Скопируй `build/ios/Build/Products/Release-iphoneos/App.app` в `Payload/` и заархивируй **папку Payload** ZIP-архивом с расширением `.ipa`. Это настоящий скомпилированный iOS arm64 bundle, но **он не установится без подписи**.

Варианты установки unsigned IPA:

- Подписать через Sideloadly или AltStore. Условия подписи и период обновления зависят от Apple ID.
- Открыть `ios/App/App.xcodeproj`, выбрать свою Team, уникальный Bundle Identifier при необходимости, затем Archive → Distribute App.

Если нужен APNs: добавь Push Notifications capability и корректный provisioning profile; используй `App.entitlements` как шаблон, согласуй environment с `OCC_APNS_PRODUCTION` и Bundle ID с `OCC_APNS_TOPIC` на мосте. Репозиторий не содержит Apple signing certificate или provisioning profile.

## Проверки

```sh
npm run check
npx playwright install chromium webkit
npm run test:e2e
```

Тесты используют настоящий HTTP companion и отдельный mock OpenCode, без внешних AI-вызовов и расходов. Fixture слушает только localhost (`4097` и `4142`) и не входит в приложение или companion bundle. Каждый сценарий получает отдельное состояние companion. Браузерные проекты: компактный Android (360 px), Android / Pixel 7 и iOS / WebKit. Дополнительно проверяется ввод при ширине 320 px и уменьшенной высоте экрана.

Android smoke QA выполняется на локальном эмуляторе отдельным скриптом `tests/native/android-smoke.mjs`. Он требует запущенного fixture, установленного debug APK и `adb`; подробности выводятся при запуске.

```sh
# В отдельном терминале:
npx tsx tests/fixtures/server.ts
# После загрузки эмулятора и установки debug APK:
node tests/native/android-smoke.mjs emulator-5554
```

Сценарий сбрасывает тестовые данные OCC на эмуляторе и проверяет нативный HTTP, Keystore, клавиатуру, SSE, фоновое уведомление и восстановление подключения. Изображения сохраняются в `artifacts/screenshots/android-native*.png`.

Для проверки установленного OpenCode с изолированными настройками и данными:

```sh
npm run build:bridge
node tests/integration/live-opencode.mjs
```

При необходимости путь к исполняемому файлу задаётся через `OCC_OPENCODE_BIN`. Этот сценарий проверяет загрузку плагина и API, не отправляя запросы AI-провайдерам.

## Релиз

1. Обнови version, Android versionCode и release notes.
2. Проверь workflow на `main` и нативную сборку.
3. Создай соответствующий тег `vX.Y.Z` и отправь его на GitHub.
4. CI заново собирает APK / IPA, запускает тесты, добавляет companion и SHA-256, затем создаёт Release.

Исследования в `experiments/` не импортируются приложением и не являются частью релизного бинарника.
