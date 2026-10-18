import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';

const projectRoot = process.cwd();
const distDir = resolve(projectRoot, 'dist');
const assetsDir = join(distDir, 'assets');
const textExtensions = new Set(['.js', '.html', '.htm', '.json', '.css', '.map', '.txt']);
const oldAssetReferencePattern = /assets\/node_modules\/[^"'`\s<>)\]]+/g;
const vendorAssetReferencePattern = /assets\/vendor_modules\/[^"'`\s<>)\]]+/g;

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
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
}

function localPathFromAssetReference(reference) {
  const pathname = reference.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  const localPath = resolve(distDir, pathname);
  if (!isInside(localPath, distDir)) {
    throw new Error(`Asset URL escapes dist directory: ${reference}`);
  }
  return localPath;
}

function fail(message) {
  console.error(`[verify-web-assets] ERROR: ${message}`);
  process.exitCode = 1;
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  throw new Error('dist directory not found. Run the Web export first.');
}
if (!existsSync(assetsDir) || !statSync(assetsDir).isDirectory()) {
  throw new Error('dist/assets directory not found.');
}

const files = collectFiles(distDir);
const forbiddenDirectories = [];
// Walk directories separately because collectFiles returns files only.
function collectDirectories(directory) {
  const dirs = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(directory, entry.name);
    dirs.push(fullPath, ...collectDirectories(fullPath));
  }
  return dirs;
}
for (const directory of collectDirectories(distDir)) {
  if (directory.split(sep).includes('node_modules')) forbiddenDirectories.push(directory);
}
if (forbiddenDirectories.length > 0) {
  fail(`Cloudflare Pages-excluded node_modules directory remains: ${forbiddenDirectories[0]}`);
}

const vendorAssetsDir = resolve(assetsDir, 'vendor_modules');
const wasmFiles = files.filter(
  (file) => isInside(file, vendorAssetsDir) && /^wa-sqlite.*\.wasm$/i.test(file.split(sep).at(-1)),
);
const ioniconsFiles = files.filter(
  (file) => isInside(file, vendorAssetsDir) && /^Ionicons\..*\.ttf$/i.test(file.split(sep).at(-1)),
);
if (wasmFiles.length === 0) fail('Required wa-sqlite WASM asset was not exported.');
if (ioniconsFiles.length === 0) fail('Required Ionicons font asset was not exported.');

const textFiles = files.filter((file) => textExtensions.has(extname(file).toLowerCase()));
let oldReferences = 0;
let vendorReferences = 0;
const missingReferences = [];

for (const file of textFiles) {
  const content = readFileSync(file, 'utf8');
  const oldMatches = content.match(oldAssetReferencePattern) ?? [];
  oldReferences += oldMatches.length;

  const matches = content.match(vendorAssetReferencePattern) ?? [];
  for (const match of matches) {
    vendorReferences++;
    const localPath = localPathFromAssetReference(match);
    if (!existsSync(localPath) || !statSync(localPath).isFile()) {
      missingReferences.push(
        `${relative(distDir, file)}: ${match} -> ${relative(distDir, localPath)}`,
      );
    }
  }
}

if (oldReferences > 0) {
  fail(
    `Found ${oldReferences} old assets/node_modules reference(s); Metro asset path rewrite did not fully apply.`,
  );
}
if (vendorReferences === 0) {
  fail(
    'No assets/vendor_modules references were found; expected package assets were not rewritten.',
  );
}
if (missingReferences.length > 0) {
  fail(
    `Found ${missingReferences.length} missing vendor asset target(s):\n${missingReferences.slice(0, 10).join('\n')}`,
  );
}

if (process.exitCode) {
  console.error('[verify-web-assets] Export verification failed; do not deploy this build.');
} else {
  console.log(`[verify-web-assets] Verified ${vendorReferences} vendor asset references.`);
  console.log(
    `[verify-web-assets] Found ${wasmFiles.length} WASM and ${ioniconsFiles.length} Ionicons font asset(s).`,
  );
}
