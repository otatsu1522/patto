import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';

const distDir = join(process.cwd(), 'dist');
const assetsRoot = join(distDir, 'assets');
const sourceRoot = join(assetsRoot, 'node_modules');
const targetRoot = join(assetsRoot, 'vendor_modules');

const textExtensions = new Set(['.js', '.html', '.htm', '.json', '.css', '.map', '.txt']);

const assetReferencePattern = /assets\/node_modules\/[^"'`\s<>)\]]+/g;

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

function isInside(file, directory) {
  const rel = relative(directory, file);

  return (
    rel === '' ||
    (rel !== '..' && !rel.startsWith(`..${sep}`) && !relative(directory, file).startsWith(sep))
  );
}

/**
 * pnpm の .pnpm/<package-key>/node_modules/<package-path> を
 * vendor_modules/pnpm/<package-key>/<package-path> に変換する。
 *
 * 通常の node_modules 配置では、相対パスを維持する。
 * パス要素としての node_modules はすべて vendor_modules に変更する。
 */
function mapAssetSegments(segments) {
  if (segments[0] === '.pnpm') {
    const packageKey = segments[1];
    const nodeModulesIndex = segments.indexOf('node_modules', 2);

    if (!packageKey || nodeModulesIndex < 0) {
      throw new Error(`Unexpected pnpm asset path: ${segments.join('/')}`);
    }

    const packagePath = segments
      .slice(nodeModulesIndex + 1)
      .map((segment) => (segment === 'node_modules' ? 'vendor_modules' : segment));

    if (packagePath.length === 0) {
      throw new Error(`Package path is empty: ${segments.join('/')}`);
    }

    return ['pnpm', packageKey, ...packagePath];
  }

  return segments.map((segment) => (segment === 'node_modules' ? 'vendor_modules' : segment));
}

function mapAssetUrl(assetUrl) {
  const prefix = 'assets/node_modules/';

  if (!assetUrl.startsWith(prefix)) {
    throw new Error(`Unexpected asset URL: ${assetUrl}`);
  }

  const suffix = assetUrl.slice(prefix.length);
  const pathname = suffix.split(/[?#]/, 1)[0];
  const suffixSegments = pathname.split('/');

  const mappedSegments = mapAssetSegments(suffixSegments);
  const newUrl = `assets/vendor_modules/${mappedSegments.join('/')}`;
  const localPath = join(assetsRoot, ...newUrl.slice('assets/'.length).split('/'));

  return { newUrl, localPath };
}

if (!existsSync(distDir)) {
  throw new Error('dist directory not found. Run the Web export first.');
}

if (!existsSync(sourceRoot)) {
  throw new Error(`Asset directory not found: ${sourceRoot}`);
}

// Expo の出力に、古いスクリプトの生成物が残っていても混在させない。
if (existsSync(targetRoot)) {
  rmSync(targetRoot, { recursive: true, force: true });
}

const sourceFiles = collectFiles(sourceRoot);

if (sourceFiles.length === 0) {
  throw new Error('No asset files found under dist/assets/node_modules.');
}

const requiredAssets = [/^Ionicons\..*\.ttf$/i, /^wa-sqlite\..*\.wasm$/i];

for (const pattern of requiredAssets) {
  if (!sourceFiles.some((file) => pattern.test(basename(file)))) {
    throw new Error(`Required Web asset not found: ${pattern}`);
  }
}

const copiedTargets = new Set();
let copied = 0;

for (const source of sourceFiles) {
  const rel = relative(sourceRoot, source);
  const segments = rel.split(sep);
  const mappedSegments = mapAssetSegments(segments);
  const target = join(targetRoot, ...mappedSegments);

  if (copiedTargets.has(target) || existsSync(target)) {
    throw new Error(`Asset path collision: ${target}`);
  }

  copiedTargets.add(target);

  mkdirSync(join(target, '..'), { recursive: true });
  copyFileSync(source, target);
  copied++;
}

const textFiles = collectFiles(distDir).filter((file) => {
  if (isInside(file, sourceRoot) || isInside(file, targetRoot)) {
    return false;
  }

  return textExtensions.has(extname(file).toLowerCase());
});

let rewrittenReferences = 0;
let rewrittenFiles = 0;
const missingTargets = [];

for (const file of textFiles) {
  const original = readFileSync(file, 'utf8');

  const updated = original.replace(assetReferencePattern, (assetUrl) => {
    const { newUrl, localPath } = mapAssetUrl(assetUrl);

    rewrittenReferences++;

    if (!existsSync(localPath)) {
      missingTargets.push({ assetUrl, localPath });
    }

    return newUrl;
  });

  if (updated !== original) {
    writeFileSync(file, updated);
    rewrittenFiles++;
  }
}

if (rewrittenReferences === 0) {
  throw new Error('No node_modules asset references were rewritten.');
}

if (missingTargets.length > 0) {
  const details = missingTargets
    .slice(0, 10)
    .map(({ assetUrl, localPath }) => `${assetUrl} -> ${localPath}`)
    .join('\n');

  throw new Error(`Missing asset targets (${missingTargets.length}):\n${details}`);
}

// 古いパスへの参照が残っていたら、デプロイを止める。
for (const file of textFiles) {
  const content = readFileSync(file, 'utf8');

  if (/assets\/node_modules\//.test(content)) {
    throw new Error(`Old asset URL remains in: ${file}`);
  }
}

// すべての参照先を検証した後、Cloudflare が除外する元のディレクトリを削除する。
rmSync(sourceRoot, { recursive: true, force: true });

console.log(`[fix-web-assets] Copied ${copied} assets.`);
console.log(
  `[fix-web-assets] Rewrote ${rewrittenReferences} references in ${rewrittenFiles} files.`,
);
console.log('[fix-web-assets] Required font and WASM assets verified.');
