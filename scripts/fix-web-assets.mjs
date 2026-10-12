import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const assetsRoot = join(process.cwd(), 'dist', 'assets');
const pnpmRoot = join(assetsRoot, 'node_modules', '.pnpm');

if (!existsSync(pnpmRoot)) {
  console.log('[fix-web-assets] pnpm asset directory not found.');
  process.exit(0);
}

function collectFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

let copied = 0;

for (const source of collectFiles(pnpmRoot)) {
  const segments = relative(pnpmRoot, source).split(sep);

  // .pnpm/<package>/node_modules/<package-path>/...
  if (segments.length < 4 || segments[1] !== 'node_modules') {
    continue;
  }

  const target = join(
    assetsRoot,
    'node_modules',
    ...segments.slice(2),
  );

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  copied++;
}

console.log(`[fix-web-assets] Copied ${copied} assets.`);
