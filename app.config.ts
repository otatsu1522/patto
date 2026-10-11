import type { ExpoConfig } from 'expo/config';
import info from './src/config/app.info.json';

// アプリ名・バージョンなどは src/config/app.info.json だけを編集すれば反映されます。
const config: ExpoConfig = {
  name: info.name,
  slug: info.slug,
  scheme: info.scheme,
  version: info.version,
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  ios: { supportsTablet: true, bundleIdentifier: info.iosBundleId },
  android: {
    package: info.androidPackage,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#2F5BEA' },
  },
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    'expo-localization',
    ['expo-splash-screen', { image: './assets/splash-icon.png', imageWidth: 200, backgroundColor: '#2F5BEA' }],
  ],
  experiments: { typedRoutes: false },
};

export default config;
