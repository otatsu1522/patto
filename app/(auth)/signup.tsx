import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useAuthStore } from '@/auth/authStore';
import { AuthLayout } from '@/components/auth/AuthLayout';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { LIMITS } from '@/config/limits';
import {
  firstError,
  validateEmail,
  validateMaxLength,
  validatePassword,
  validatePasswordMatch,
} from '@/domain/validation';
import { t } from '@/i18n';
import { useTheme } from '@/theme';

export default function SignupScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const errors = {
    name: validateMaxLength(name, LIMITS.displayNameMax),
    email: validateEmail(email),
    password: validatePassword(password),
    confirm: validatePasswordMatch(password, confirm),
  };

  const submit = async () => {
    setSubmitted(true);
    setMessage(null);
    if (firstError(errors.name, errors.email, errors.password, errors.confirm)) return;
    setBusy(true);
    const res = await useAuthStore.getState().signUp(email, password, name);
    setBusy(false);
    if (!res.ok) setMessage(res.message);
  };

  return (
    <AuthLayout>
      <TextField
        label={t('auth.displayName')}
        value={name}
        onChangeText={setName}
        error={submitted ? errors.name : null}
      />
      <TextField
        label={t('auth.email')}
        value={email}
        onChangeText={setEmail}
        error={submitted ? errors.email : null}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextField
        label={t('auth.password')}
        value={password}
        onChangeText={setPassword}
        error={submitted ? errors.password : null}
        secure
        autoCapitalize="none"
        autoComplete="new-password"
      />
      <TextField
        label={t('auth.passwordConfirm')}
        value={confirm}
        onChangeText={setConfirm}
        error={submitted ? errors.confirm : null}
        secure
        autoCapitalize="none"
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {message ? (
        <AppText variant="caption" color={colors.danger}>
          {message}
        </AppText>
      ) : null}
      <Button label={t('auth.signupSubmit')} onPress={submit} loading={busy} fullWidth />
      <Button
        label={t('auth.backToLogin')}
        variant="ghost"
        onPress={() => router.replace('/login')}
      />
    </AuthLayout>
  );
}
