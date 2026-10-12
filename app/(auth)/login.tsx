import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { APP_DESCRIPTION } from '@/config/app';
import { isSupabaseConfigured } from '@/config/env';
import { firstError, validateEmail } from '@/domain/validation';
import { t } from '@/i18n';
import { SPACING, useTheme } from '@/theme';
import { BORDER_WIDTH } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const required = () => (password.length === 0 ? t('validation.required') : null);
  const emailError = submitted ? validateEmail(email) : null;
  const passwordError = submitted ? required() : null;

  const submit = async () => {
    setSubmitted(true);
    setMessage(null);
    if (firstError(validateEmail(email), required())) return;
    setBusy(true);
    const res = await useAuthStore.getState().signIn(email, password);
    setBusy(false);
    if (!res.ok) setMessage(res.message);
  };

  const guest = async () => {
    setMessage(null);
    setBusy(true);
    const res = await useAuthStore.getState().continueAsGuest();
    setBusy(false);
    if (!res.ok) setMessage(res.message);
  };

  return (
    <AuthLayout subtitle={APP_DESCRIPTION}>
      <TextField label={t('auth.email')} value={email} onChangeText={setEmail} error={emailError} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" autoComplete="email" />
      <TextField label={t('auth.password')} value={password} onChangeText={setPassword} error={passwordError} secure autoCapitalize="none" textContentType="password" autoComplete="password" onSubmitEditing={submit} returnKeyType="go" />
      {message ? (
        <AppText variant="caption" color={colors.danger}>
          {message}
        </AppText>
      ) : null}
      <Button label={t('auth.login')} onPress={submit} loading={busy} disabled={!isSupabaseConfigured} fullWidth />
      <View style={styles.links}>
        <Button label={t('auth.signup')} variant="ghost" onPress={() => router.push('/signup')} disabled={!isSupabaseConfigured} />
      </View>
      <View style={styles.divider}>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
        <AppText variant="caption" muted>
          {t('common.or')}
        </AppText>
        <View style={[styles.line, { backgroundColor: colors.border }]} />
      </View>
      <Button label={t('auth.guest')} variant="secondary" icon="person" onPress={guest} loading={busy} fullWidth />
      <AppText variant="caption" muted style={styles.note}>
        {isSupabaseConfigured ? t('auth.guestNote') : `${t('auth.notConfigured')}\n${t('auth.notConfiguredGuest')}`}
      </AppText>
    </AuthLayout>
  );
}

const styles = StyleSheet.create({
  links: { alignItems: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  line: { flex: 1, height: BORDER_WIDTH },
  note: { textAlign: 'center' },
});
