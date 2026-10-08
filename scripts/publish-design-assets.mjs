import { copyFile, mkdir, unlink } from 'node:fs/promises';

await mkdir('docs/assets', { recursive: true });
for (const [source, destination] of [
  ['android-layout-sessions.png', 'mobile-sessions.png'],
  ['android-layout-chat.png', 'mobile-chat.png'],
  ['android-layout-inbox.png', 'mobile-inbox.png'],
  ['android-layout-welcome.png', 'mobile-welcome.png'],
  ['android-layout-options.png', 'mobile-options.png'],
  ['android-layout-models.png', 'mobile-models.png'],
  ['android-layout-settings.png', 'mobile-settings.png'],
  ['android-layout-themes.png', 'mobile-themes.png'],
  ['android-layout-catppuccin.png', 'theme-catppuccin.png'],
  ['android-layout-github-light.png', 'theme-github-light.png'],
])
  await copyFile(`artifacts/screenshots/${source}`, `docs/assets/${destination}`);
for (const obsolete of ['docs/assets/desktop.png', 'docs/assets/mobile-overview.png']) {
  await unlink(obsolete).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
console.log('Promoted verified UI screenshots into documentation assets.');
