import { Text, type TextProps, type TextStyle } from 'react-native';
import { FONT, useTheme } from '@/theme';

type Variant = 'body' | 'caption' | 'title' | 'headline' | 'label';

interface Props extends TextProps {
  variant?: Variant;
  muted?: boolean;
  bold?: boolean;
  color?: string;
}

const SIZE: Record<Variant, number> = {
  body: FONT.body,
  caption: FONT.caption,
  title: FONT.title,
  headline: FONT.headline,
  label: FONT.caption + 1,
};

/** 文字サイズ設定を反映した共通テキスト。画面の文字はこのコンポーネントで描画する。 */
export function AppText({ variant = 'body', muted, bold, color, style, ...rest }: Props) {
  const { colors, fs } = useTheme();
  const base: TextStyle = {
    fontSize: fs(SIZE[variant]),
    color: color ?? (muted ? colors.textMuted : colors.text),
    fontWeight: bold || variant === 'title' || variant === 'headline' ? '700' : variant === 'label' ? '600' : '400',
  };
  return <Text {...rest} style={[base, style]} />;
}
