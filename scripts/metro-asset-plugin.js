/**
 * Rewrite production Web asset URLs so Cloudflare Pages can serve them.
 *
 * Metro uses httpServerLocation both in generated asset references and when
 * computing exported asset destinations. Changing this field here keeps both
 * paths in sync and avoids rewriting the exported bundle after the build.
 */
const ASSET_PATH_PREFIXES = [
  { from: '/assets/node_modules/', to: '/assets/vendor_modules/' },
  { from: 'assets/node_modules/', to: 'assets/vendor_modules/' },
];

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
  const prefix = ASSET_PATH_PREFIXES.find(({ from }) => location.startsWith(from));

  // Leave application assets and paths outside the target directory unchanged.
  if (!prefix) {
    return asset;
  }

  const suffix = location.slice(prefix.from.length);
  const segments = suffix.split('/');
  const mappedSegments = mapAssetSegments(segments);

  return {
    ...asset,
    httpServerLocation: `${prefix.to}${mappedSegments.join('/')}`,
  };
};
