import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const assetsRoot = join(distDir, 'assets');
const sourceRoot = join(assetsRoot, 'node_modules');
const jsRoot = join(distDir, '_expo', 'static', 'js', 'web');

if (!existsSync(sourceRoot)) {
  throw new Error(`Asset directory not found: ${sourceRoot}`);
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

// pnpm の配置を、実際のパッケージパスに正規化する。
function getPackagePath(source) {
  const segments = relative(sourceRoot, source).split(sep);

  if (segments[0] === '.pnpm') {
    const nodeModulesIndex = segments.indexOf('node_modules', 1);

    if (nodeModulesIndex < 0) {
      return null;
    }

    return segments.slice(nodeModulesIndex + 1);
  }

  // Cloudflare など、node_modules 以下がフラットな場合。
  return segments;
}

let copied = 0;

for (const source of collectFiles(sourceRoot)) {
  const packagePath = getPackagePath(source);

  if (!packagePath || packagePath.length === 0) {
    continue;
  }

  // node_modules の外に公開用アセットを配置する。
  const target = join(assetsRoot, 'vendor', ...packagePath);

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  copied++;
}

if (copied === 0) {
  throw new Error('No assets were copied to dist/assets/vendor.');
}

// 生成済み JavaScript 内のアセット参照先も変更する。
if (!existsSync(jsRoot)) {
  throw new Error(`Web JavaScript directory not found: ${jsRoot}`);
}

let rewritten = 0;
const jsFiles = collectFiles(jsRoot).filter((file) => file.endsWith('.js'));

for (const file of jsFiles) {
  const original = readFileSync(file, 'utf8');

  const updated = original
    .replace(
      /assets\/node_modules\/\.pnpm\/[^/]+\/node_modules\//g,
      () => {
        rewritten++;
        return 'assets/vendor/';
      },
    )
    .replace(
      /assets\/node_modules\//g,
      () => {
        rewritten++;
        return 'assets/vendor/';
      },
    );

  if (updated !== original) {
    writeFileSync(file, updated);
  }
}

if (rewritten === 0) {
  throw new Error('No node_modules asset references were found in web bundles.');
}

console.log(`[fix-web-assets] Copied ${copied} assets to dist/assets/vendor.`);
console.log(`[fix-web-assets] Rewrote ${rewritten} references in ${jsFiles.length} JavaScript files.`);
