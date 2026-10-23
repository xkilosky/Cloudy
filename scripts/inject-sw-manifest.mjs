import fs from 'fs';
import path from 'path';

const DIST_DIR = path.resolve('dist');
const SW_PATH = path.join(DIST_DIR, 'sw.js');

function collectAssets(dir, prefix = '') {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'sw.js') continue;
    const rel = `${prefix}/${entry.name}`;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectAssets(full, rel));
    } else if (/\.(html|js|css|png|svg|ico|webmanifest|json)$/i.test(entry.name)) {
      results.push(rel);
    }
  }
  return results;
}

if (fs.existsSync(SW_PATH)) {
  const assets = Array.from(new Set(['/', ...collectAssets(DIST_DIR)]));
  const swContent = fs.readFileSync(SW_PATH, 'utf8');
  const updated = swContent.replace(
    /\/\* __CLOUDY_PRECACHE_MANIFEST__ \*\/ \[[\s\S]*?\];/,
    `/* __CLOUDY_PRECACHE_MANIFEST__ */ ${JSON.stringify(assets, null, 2)};`
  );
  fs.writeFileSync(SW_PATH, updated, 'utf8');
  console.log(`Injected ${assets.length} precache assets into dist/sw.js`);
}
