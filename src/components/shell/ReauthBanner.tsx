import { useState } from 'react';
import { TextField } from '../ui/TextField';
import { useAuthStore } from '@/auth/authStore';
import { t } from '@/i18n';
import { useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

/** セッションの再認証が必要なとき、通常のテーマに沿ったダイアログでパスワードを再入力する。 */
export function ReauthBanner() {
  const needs = useAuthStore((s) => s.needsReauth && s.identity?.mode === 'account');
  if (!needs) return null;
  return <ReauthPrompt />;
}

/** 表示中だけマウントし、再認証要求が解除されたら入力状態も破棄する。 */
function ReauthPrompt() {
  const { colors } = useTheme();
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy || !password) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await useAuthStore.getState().reauthenticate(password);
      if (res.ok) {
        setPassword('');
      } else {
        setMessage(res.message);
      }
    } catch {
      setMessage(t('auth.reauthNeeded'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      visible
      title={t('auth.reauthSubmit')}
      onClose={() => {}}
      dismissible={false}
      footer={
        <Button
          label={t('auth.reauthSubmit')}
          onPress={() => void submit()}
          loading={busy}
          disabled={!password}
          fullWidth
        />
      }
    >
      <AppText color={message ? colors.danger : colors.textMuted}>
        {message ?? t('auth.reauthNeeded')}
      </AppText>
      <TextField
        label={t('auth.password')}
        value={password}
        secure
        autoCapitalize="none"
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onChangeText={setPassword}
        onSubmitEditing={() => void submit()}
      />
    </Dialog>
  );
}
