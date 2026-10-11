import { StyleSheet, View } from 'react-native';
import { SPACING } from '@/theme';
import { AppText } from './AppText';

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <View style={styles.wrap}>
      <AppText variant="title" style={styles.center}>
        {title}
      </AppText>
      {hint ? (
        <AppText muted style={styles.center}>
          {hint}
        </AppText>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: SPACING.md, padding: SPACING.xl },
  center: { textAlign: 'center' },
});
