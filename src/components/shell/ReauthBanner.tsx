import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { t } from '@/i18n';
import { FONT, RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';

/** ログインの有効期限が切れたとき、パスワードを入力して再ログインする帯。データは消えない。 */
export function ReauthBanner() {
  const { colors, fs } = useTheme();
  const needs = useAuthStore((s) => s.needsReauth && s.identity?.mode === 'account');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!needs) return null;

  const submit = async () => {
    setBusy(true);
    const res = await useAuthStore.getState().reauthenticate(password);
    setBusy(false);
    if (res.ok) setPassword('');
    else setMessage(res.message);
  };

  return (
    <View style={[styles.bar, { backgroundColor: colors.warning }]}>
      <AppText variant="caption" bold color={colors.onWarning} style={styles.text}>
        {message ?? t('auth.reauthNeeded')}
      </AppText>
      <TextInput
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        placeholder={t('auth.password')}
        placeholderTextColor={colors.textMuted}
        onSubmitEditing={submit}
        accessibilityLabel={t('auth.password')}
        style={[
          styles.input,
          { backgroundColor: colors.surface, color: colors.text, fontSize: fs(FONT.body) },
        ]}
      />
      <Button label={t('auth.reauthSubmit')} onPress={submit} loading={busy} variant="secondary" />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
    padding: SPACING.sm,
  },
  text: { flexGrow: 1, flexBasis: 200 },
  input: {
    minWidth: 160,
    flexGrow: 1,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    minHeight: 44,
    outlineStyle: 'none',
  } as never,
});
