import Constants from 'expo-constants';
import info from './app.info.json';

/** アプリ名・説明・ライセンスなどの表示用定義。値は app.info.json から読み込む。 */
export const APP_NAME: string = info.name;
export const APP_DESCRIPTION: string = info.description;
export const APP_LICENSE: string = info.license;
export const APP_COPYRIGHT: string = `Copyright (c) ${info.copyrightYear} ${info.copyrightHolder}`;
/** アプリについて画面用の表示表記。LICENSE 本文の法的表記は APP_COPYRIGHT を維持する。 */
export const APP_DISPLAY_COPYRIGHT: string = `©Copyright ${info.copyrightYear} ${info.copyrightHolder}`;
export const APP_LINKS = info.links as { terms: string; privacy: string; contact: string };
export const APP_TECH = info.tech as { name: string; url: string; descriptionKey: string }[];
export const APP_VERSION: string = Constants.expoConfig?.version ?? info.version;
export const APP_WEB_URL: string = info.websiteUrl;
