#!/usr/bin/env node
/**
 * Vivaldi compatibility workaround for Expo CLI's development-server CORS check.
 *
 * Vivaldi uses this fixed extension origin for some built-in UI requests:
 * chrome-extension://mpognobbkildjkofajifpdfhcoklimli
 * Expo CLI rejects that origin by default. This script adds only that exact host to
 * Expo CLI's existing allowed-host array. It does not disable CORS or allow arbitrary origins.
 *
 * It is run by `pnpm start` and `pnpm web`; after dependency updates it reapplies the patch.
 * If the installed Expo CLI changes its source layout, it warns and leaves the package untouched.
 *
 * Manual commands:
 *   node scripts/fix-expo-vivaldi-cors.mjs --check
 *   node scripts/fix-expo-vivaldi-cors.mjs --rollback
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const NODE_MODULES = path.join(ROOT, 'node_modules');
const VIVALDI_EXTENSION_ID = 'mpognobbkildjkofajifpdfhcoklimli';
const PATCH_MARKER = 'PATTO_VIVALDI_CORS_ALLOWLIST';
const BACKUP_SUFFIX = '.patto-vivaldi-cors.bak';
const MAX_DEPTH = 14;
let mode = 'patch';
if (process.argv.includes('--rollback')) {
  mode = 'rollback';
} else if (process.argv.includes('--check')) {
  mode = 'check';
}
const MODE = mode;

function findCorsMiddlewareFiles(rootDir) {
  const found = [];

  function walk(dir, depth) {
    if (depth > MAX_DEPTH) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.cache') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full, depth + 1);
      } else if (entry.isFile() && entry.name === 'CorsMiddleware.js') {
        const normalized = full.replace(/\\/g, '/');
        if (
          normalized.includes('/@expo/cli/build/') &&
          normalized.endsWith('/server/middleware/CorsMiddleware.js')
        ) {
          found.push(full);
        }
      }
    }
  }

  walk(rootDir, 0);
  return found;
}

function runForFile(file) {
  const original = fs.readFileSync(file, 'utf8');
  const backup = `${file}${BACKUP_SUFFIX}`;

  if (MODE === 'rollback') {
    if (!original.includes(PATCH_MARKER)) {
      if (fs.existsSync(backup)) fs.unlinkSync(backup);
      return 'not patched';
    }
    if (!fs.existsSync(backup)) return 'no backup';
    fs.writeFileSync(file, fs.readFileSync(backup, 'utf8'), 'utf8');
    fs.unlinkSync(backup);
    return 'rolled back';
  }

  if (original.includes(PATCH_MARKER)) return 'already patched';
  if (MODE === 'check') {
    return /\.\.\.DEFAULT_ALLOWED_CORS_(?:HOSTS|HOSTNAMES)\s*,?/.test(original)
      ? 'patch available'
      : 'unsupported source layout';
  }

  // Handle the allow-list names used by different Expo CLI versions.
  const anchorPattern = /\.\.\.DEFAULT_ALLOWED_CORS_(?:HOSTS|HOSTNAMES)\s*,?/;
  const match = original.match(anchorPattern);
  if (!match || match.index === undefined) return 'unsupported source layout';

  const spread = match[0].replace(/,\s*$/, '');
  const replacement = [
    `${spread},`,
    `        // ${PATCH_MARKER}: allow Vivaldi's built-in UI origin only`,
    `        '${VIVALDI_EXTENSION_ID}',`,
  ].join('\n');
  const patched =
    original.slice(0, match.index) + replacement + original.slice(match.index + match[0].length);

  if (patched === original) return 'no change';
  // Save the matching, unmodified version so the workaround can be rolled back safely.
  fs.writeFileSync(backup, original, 'utf8');
  fs.writeFileSync(file, patched, 'utf8');
  return 'patched';
}

if (!fs.existsSync(NODE_MODULES)) {
  console.warn('[Vivaldi/Expo CORS] node_modules was not found; skipped compatibility patch.');
} else {
  const files = findCorsMiddlewareFiles(NODE_MODULES);
  if (files.length === 0) {
    console.warn(
      '[Vivaldi/Expo CORS] Expo CLI CorsMiddleware.js was not found; ' +
        'skipped compatibility patch.',
    );
  } else {
    let changed = 0;
    let unsupported = 0;

    for (const file of files) {
      const status = runForFile(file);
      console.log(`[Vivaldi/Expo CORS] ${status}: ${path.relative(ROOT, file)}`);
      if (status === 'patched') changed += 1;
      if (status === 'unsupported source layout') unsupported += 1;
    }

    if (unsupported > 0 && changed === 0) {
      console.warn(
        '[Vivaldi/Expo CORS] Expo CLI source layout has changed. ' +
          'No middleware was modified. Use Chrome/Edge for local web testing ' +
          'or review this script.',
      );
    }
  }
}
