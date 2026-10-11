/** 余白・角丸・文字の基準値。角丸はなし（直角）。pill は「色の丸」だけに使う。 */
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 0, md: 0, lg: 0, pill: 999 } as const;
export const FONT = { caption: 12, body: 15, bodyLarge: 17, title: 20, headline: 26 } as const;
export const SHADOW = {
  card: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  float: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
} as const;
