import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const SOURCE_ICON = path.resolve('assets/cloudy-logo-1024.png');
const TRANSPARENT_LOGO = path.resolve('public/cloudy-logo.png');
const RES_DIR = path.resolve('android/app/src/main/res');

const MIPMAPS = [
  { folder: 'mipmap-mdpi', launcher: 48, foreground: 108 },
  { folder: 'mipmap-hdpi', launcher: 72, foreground: 162 },
  { folder: 'mipmap-xhdpi', launcher: 96, foreground: 216 },
  { folder: 'mipmap-xxhdpi', launcher: 144, foreground: 324 },
  { folder: 'mipmap-xxxhdpi', launcher: 192, foreground: 432 },
];

async function main() {
  if (!fs.existsSync(RES_DIR)) {
    console.log('android/ project not found yet, skipping Android mipmap generation.');
    return;
  }

  for (const m of MIPMAPS) {
    const dir = path.join(RES_DIR, m.folder);
    fs.mkdirSync(dir, { recursive: true });

    // Square & Round Launcher Icons
    await sharp(SOURCE_ICON)
      .resize(m.launcher, m.launcher)
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher.png'));

    const roundMask = Buffer.from(
      `<svg width="${m.launcher}" height="${m.launcher}"><circle cx="${m.launcher / 2}" cy="${m.launcher / 2}" r="${m.launcher / 2}" fill="#fff"/></svg>`
    );
    await sharp(SOURCE_ICON)
      .resize(m.launcher, m.launcher)
      .composite([{ input: roundMask, blend: 'dest-in' }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    // Adaptive Icon Foreground (66% safe zone centered)
    const innerSize = Math.round(m.foreground * 0.62);
    const innerBuf = await sharp(TRANSPARENT_LOGO)
      .resize(innerSize, innerSize, { fit: 'contain' })
      .png()
      .toBuffer();

    await sharp({
      create: {
        width: m.foreground,
        height: m.foreground,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: innerBuf, gravity: 'center' }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }

  // Set adaptive icon background color to Cloudy Obsidian #05080F
  const bgValuesPath = path.join(RES_DIR, 'values', 'ic_launcher_background.xml');
  if (fs.existsSync(path.dirname(bgValuesPath))) {
    fs.writeFileSync(
      bgValuesPath,
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#05080F</color>\n</resources>\n`,
      'utf8'
    );
  }

  console.log('Configured custom X-Kilo Cloudy Android launcher icons across all mipmap densities!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
