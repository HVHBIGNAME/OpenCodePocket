import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const source = await readFile('public/icon.svg');
const android = 'android/app/src/main/res';
for (const [density, size] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
  const directory = join(android, `mipmap-${density}`);
  await mkdir(directory, { recursive: true });
  const image = await sharp(source).resize(size, size).png().toBuffer();
  await writeFile(join(directory, 'ic_launcher.png'), image);
  await writeFile(join(directory, 'ic_launcher_round.png'), image);
  await sharp(source).resize(Math.round(size * 1.3)).extend({ top: Math.round(size * .45), bottom: Math.round(size * .45), left: Math.round(size * .45), right: Math.round(size * .45), background: '#101310' }).resize(Math.round(size * 2.25)).png().toFile(join(directory, 'ic_launcher_foreground.png'));
}
await mkdir('ios/App/App/Assets.xcassets/AppIcon.appiconset', { recursive: true });
await sharp(source).resize(1024, 1024).flatten({ background: '#101310' }).png().toFile('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png');
await mkdir('docs/assets', { recursive: true });
await sharp(source).resize(256, 256).png().toFile('docs/assets/icon.png');
console.log('Generated Android and iOS app icons.');
