import { ScrollView, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui/AppText';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { LICENSE_TEXT } from '@/config/license';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { SPACING } from '@/theme';

export default function LicenseScreen() {
  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.license')} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.inner}>
          <AppText variant="caption">{LICENSE_TEXT}</AppText>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: SPACING.lg, alignItems: 'center' },
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120 },
});
