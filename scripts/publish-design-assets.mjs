import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('docs/assets', { recursive: true });
for (const [source, destination] of [
  ['desktop-overview.png', 'desktop.png'],
  ['android-layout-overview.png', 'mobile-overview.png'],
  ['android-layout-chat.png', 'mobile-chat.png'],
  ['android-layout-inbox.png', 'mobile-inbox.png'],
]) await copyFile(`artifacts/screenshots/${source}`, `docs/assets/${destination}`);
console.log('Promoted verified UI screenshots into documentation assets.');
