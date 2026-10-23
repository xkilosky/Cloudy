import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const RAW_UPLOAD = path.resolve('assets/cloudy-logo-source.png');
const SOURCE = path.resolve('assets/cloudy-logo-1024.png');
const PUBLIC_DIR = path.resolve('public');
const ICONS_DIR = path.resolve('public/icons');

fs.mkdirSync(ICONS_DIR, { recursive: true });

async function main() {
  if (fs.existsSync(RAW_UPLOAD)) {
    await sharp(RAW_UPLOAD)
      .resize(1024, 1024)
      .png({ compressionLevel: 9 })
      .toFile(SOURCE);
    fs.unlinkSync(RAW_UPLOAD);
  }

  const meta = await sharp(SOURCE).metadata();
  console.log(`Source logo: ${meta.width}x${meta.height} (${meta.format})`);

  // 1. Extract raw RGBA pixels and smoothly make pure-black background transparent
  const { data, info } = await sharp(SOURCE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    const maxCh = Math.max(r, g, b);
    if (maxCh <= 8) {
      out[i + 3] = 0;
    } else if (maxCh < 36) {
      const alpha = Math.round(((maxCh - 8) / (36 - 8)) * 255);
      out[i + 3] = alpha;
      const scale = 255 / Math.max(alpha, 1);
      out[i] = Math.min(255, Math.round(r * scale));
      out[i + 1] = Math.min(255, Math.round(g * scale));
      out[i + 2] = Math.min(255, Math.round(b * scale));
    }
  }

  const trimmedBuffer = await sharp(out, {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .trim()
    .png()
    .toBuffer();

  const trimMeta = await sharp(trimmedBuffer).metadata();
  const maxDim = Math.max(trimMeta.width || 512, trimMeta.height || 512);
  const canvasSize = Math.round(maxDim * 1.12);

  const squareBuf = await sharp({
    create: {
      width: canvasSize,
      height: canvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: trimmedBuffer, gravity: 'center' }])
    .png()
    .toBuffer();

  await sharp(squareBuf)
    .resize(512, 512)
    .png({ compressionLevel: 9 })
    .toFile(path.join(PUBLIC_DIR, 'cloudy-logo.png'));

  // 2. Standard PWA app icons
  const sizes = [32, 72, 96, 128, 144, 152, 180, 192, 384, 512];
  for (const size of sizes) {
    const iconName =
      size === 32
        ? 'favicon-32x32.png'
        : size === 180
          ? 'apple-touch-icon.png'
          : `icon-${size}x${size}.png`;

    await sharp(SOURCE)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toFile(path.join(ICONS_DIR, iconName));
  }

  fs.copyFileSync(
    path.join(ICONS_DIR, 'favicon-32x32.png'),
    path.join(PUBLIC_DIR, 'favicon.png')
  );

  // 3. Maskable 512x512 icon (safe zone padded for Android adaptive circular/squircle masks)
  const innerLogo = await sharp(path.join(PUBLIC_DIR, 'cloudy-logo.png'))
    .resize(356, 356, { fit: 'contain' })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 5, g: 8, b: 15, alpha: 1 },
    },
  })
    .composite([{ input: innerLogo, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(ICONS_DIR, 'maskable-icon-512x512.png'));

  console.log('Generated transparent logo + all PWA & Android icons successfully!');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
