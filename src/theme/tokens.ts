/** 余白・角丸・文字の基準値。 */
export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const RADIUS = { sm: 6, md: 10, lg: 14, pill: 999 } as const;
export const FONT = { caption: 12, body: 15, bodyLarge: 17, title: 20, headline: 26 } as const;
export const SHADOW = {
  card: { shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  float: { shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
} as const;
