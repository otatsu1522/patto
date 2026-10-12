const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite の Web 版は WebAssembly（.wasm）を読み込むため、アセットとして扱う
config.resolver.assetExts.push('wasm');

// 開発サーバーでも、expo-sqlite の Web 版に必要なヘッダーを付ける
// （本番は public/_headers が Cloudflare Pages で同じヘッダーを付ける）
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  middleware(req, res, next);
};

module.exports = config;
