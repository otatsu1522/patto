import { ja, type StringKey } from './ja';

export type { StringKey };

/** 文言を取得する。{name} 形式のプレースホルダは params で置換する。 */
export function t(key: StringKey, params?: Record<string, string | number>): string {
  let text: string = ja[key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}
