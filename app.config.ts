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
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#FFFFFF' },
  },
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  plugins: [
    'expo-router',
    'expo-sharing',
    'expo-secure-store',
    'expo-sqlite',
    'expo-localization',
    'expo-system-ui',
    ['expo-navigation-bar', { enforceContrast: false }],
    [
      'expo-splash-screen',
      { image: './assets/splash-icon.png', imageWidth: 200, backgroundColor: '#FFFFFF' },
    ],
  ],
  experiments: { typedRoutes: false },
  extra: {
    eas: {
      projectId: 'a2f9e536-0aa9-4307-b82d-8f2cd433cd72',
    },
  },
};

export default config;
