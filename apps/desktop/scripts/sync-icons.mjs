/**
 * Source logo : assets/icons/icon.png (+ logo-wide.png pour l’UI)
 * → apps/desktop/build/icon.png + public/icon.png + icon.ico
 * Note : l’ICO exige un PNG carré.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pngToIco from 'png-to-ico';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(__dirname, '..');
const monorepoRoot = path.resolve(desktopRoot, '../..');
const iconsDir = path.join(monorepoRoot, 'assets', 'icons');
const sourceLogo = path.join(iconsDir, 'icon.png');
const brandedLogo = path.join(iconsDir, 'logo-wide.png');

const buildPng = path.join(desktopRoot, 'build', 'icon.png');
const publicPng = path.join(desktopRoot, 'public', 'icon.png');
const buildIco = path.join(desktopRoot, 'build', 'icon.ico');
const publicIco = path.join(desktopRoot, 'public', 'icon.ico');

if (!fs.existsSync(sourceLogo)) {
  console.error(`[icons] Logo introuvable : ${sourceLogo}`);
  console.error('[icons] Placez icon.png (carré) et logo-wide.png dans assets/icons/');
  process.exit(1);
}

for (const dir of [path.dirname(buildPng), path.dirname(publicPng)]) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.copyFileSync(sourceLogo, buildPng);
fs.copyFileSync(sourceLogo, publicPng);
console.log('[icons] PNG ←', sourceLogo);
if (fs.existsSync(brandedLogo)) {
  console.log('[icons] Brand wide present:', brandedLogo);
}
console.log('[icons]   →', buildPng);
console.log('[icons]   →', publicPng);

const icoBuf = await pngToIco(sourceLogo);
fs.writeFileSync(buildIco, icoBuf);
fs.copyFileSync(buildIco, publicIco);
console.log('[icons] ICO →', buildIco);
console.log('[icons] ICO →', publicIco);
