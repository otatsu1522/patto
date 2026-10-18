/**
 * Rewrite production Web asset URLs so Cloudflare Pages can serve them.
 *
 * Metro uses httpServerLocation both in generated asset references and when
 * computing exported asset destinations. Rewrite the `assets/node_modules`
 * segment wherever it appears in the location, including Expo plugin assets
 * such as `/_expo/plugins/expo-sqlite/assets/node_modules/...`.
 */
function mapAssetSegments(segments) {
  // Keep the same pnpm layout as the previous post-build script:
  // .pnpm/<package-key>/node_modules/<package-path>
  //   -> pnpm/<package-key>/<package-path>
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

  // For non-pnpm installations, preserve the relative layout and rename any
  // path segment exactly equal to node_modules.
  return segments.map((segment) => (segment === 'node_modules' ? 'vendor_modules' : segment));
}

module.exports = function metroAssetPlugin(asset) {
  if (!asset || typeof asset.httpServerLocation !== 'string') {
    return asset;
  }

  const location = asset.httpServerLocation.replace(/\\/g, '/');
  // Do not require the location to start with `assets/node_modules`: Expo
  // plugin assets may have a prefix, e.g. `/_expo/plugins/expo-sqlite/`.
  const match = location.match(/^(.*\/)?assets\/node_modules\/(.+)$/);
  if (!match) return asset;

  const pathPrefix = match[1] ?? '';
  const segments = match[2].split('/');
  const mappedSegments = mapAssetSegments(segments);

  return {
    ...asset,
    httpServerLocation: `${pathPrefix}assets/vendor_modules/${mappedSegments.join('/')}`,
  };
};
