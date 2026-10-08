import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = await readFile('public/icon.svg');
const catalog = JSON.parse(await readFile('src/themes/catalog.json', 'utf8'));
const background = catalog.themes.find((theme) => theme.id === 'mercury').dark['background-base'];
const android = 'android/app/src/main/res';
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const directory = join(android, `mipmap-${density}`);
  await mkdir(directory, { recursive: true });
  const image = await sharp(source).resize(size, size).png().toBuffer();
  await writeFile(join(directory, 'ic_launcher.png'), image);
  await writeFile(join(directory, 'ic_launcher_round.png'), image);
  await sharp(source)
    .resize(Math.round(size * 1.3))
    .extend({
      top: Math.round(size * 0.45),
      bottom: Math.round(size * 0.45),
      left: Math.round(size * 0.45),
      right: Math.round(size * 0.45),
      background,
    })
    .resize(Math.round(size * 2.25))
    .png()
    .toFile(join(directory, 'ic_launcher_foreground.png'));
}
await mkdir('ios/App/App/Assets.xcassets/AppIcon.appiconset', { recursive: true });
await sharp(source)
  .resize(1024, 1024)
  .flatten({ background })
  .png()
  .toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
const splashDirectory = 'ios/App/App/Assets.xcassets/Splash.imageset';
await mkdir(splashDirectory, { recursive: true });
const splash = await sharp({
  create: { width: 2732, height: 2732, channels: 3, background },
})
  .composite([{ input: await sharp(source).resize(300, 300).png().toBuffer(), gravity: 'centre' }])
  .png()
  .toBuffer();
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  await writeFile(join(splashDirectory, name), splash);
await mkdir('docs/assets', { recursive: true });
await sharp(source).resize(256, 256).png().toFile('docs/assets/icon.png');
console.log('Generated Android and iOS app icons and the iOS launch screen.');
