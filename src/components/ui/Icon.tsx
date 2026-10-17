import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Path, Rect } from 'react-native-svg';
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
  if (name === 'panelLeft') {
    return (
      <Svg width={px} height={px} viewBox="0 0 24 24">
        <Rect
          x="3.25"
          y="4.25"
          width="17.5"
          height="15.5"
          rx="1.75"
          fill="none"
          stroke={tint}
          strokeWidth="1.7"
        />
        <Line x1="9" y1="4.5" x2="9" y2="19.5" stroke={tint} strokeWidth="1.7" />
      </Svg>
    );
  }
  const path = SVG_ICONS[name];
  if (path) {
    return (
      <Svg
        width={px}
        height={px}
        viewBox={name === 'keyboard' || name === 'deleteSweep' ? '0 0 24 24' : '0 -960 960 960'}
      >
        <Path d={path} fill={tint} />
      </Svg>
    );
  }
  return <Ionicons name={ICONS[name]} size={px} color={tint} />;
}
