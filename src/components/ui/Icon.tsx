import { Ionicons } from '@expo/vector-icons';
import { ICONS, type IconKey } from '@/config/icons';
import { useTheme } from '@/theme';

interface Props {
  name: IconKey;
  size?: number;
  color?: string;
}

export function Icon({ name, size = 22, color }: Props) {
  const { colors, fontScale } = useTheme();
  return <Ionicons name={ICONS[name]} size={Math.round(size * Math.min(fontScale, 1.15))} color={color ?? colors.text} />;
}
