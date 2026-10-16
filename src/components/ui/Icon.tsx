import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { ICONS, type IconKey } from '@/config/icons';
import { SVG_ICONS } from '@/config/svgIcons';
import { FONT_SCALE, ICON_SIZE, useTheme } from '@/theme';

interface Props {
  name: IconKey;
  size?: number;
  color?: string;
}

export function Icon({ name, size = ICON_SIZE.xxl, color }: Props) {
  const { colors, fontScale } = useTheme();
  const px = Math.round(size * Math.min(fontScale, FONT_SCALE.iconMax));
  const tint = color ?? colors.text;
  const path = SVG_ICONS[name];
  if (path) {
    return (
      <Svg width={px} height={px} viewBox="0 -960 960 960">
        <Path d={path} fill={tint} />
      </Svg>
    );
  }
  return <Ionicons name={ICONS[name]} size={px} color={tint} />;
}
