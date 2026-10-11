import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { Section } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { TextField } from '@/components/ui/TextField';
import { isSupabaseConfigured } from '@/config/env';
import { BOARD } from '@/config/layout';
import { LIMITS } from '@/config/limits';
import { firstError, validateEmail, validateMaxLength, validatePassword, validatePasswordMatch } from '@/domain/validation';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { SPACING, useTheme } from '@/theme';

const pendingCount = () => {
  const s = useDataStore.getState();
  return [...s.projects, ...s.columns, ...s.tasks].filter((r) => r.dirty).length;
};

/** ゲスト: アカウント作成 / ログイン画面へ戻る。アカウント: 表示名・パスワード変更・ログアウト・削除。 */
export default function ProfileScreen() {
  const identity = useAuthStore((s) => s.identity);
  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.profile')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.inner}>{identity?.mode === 'guest' ? <GuestSection local={!!identity.local} /> : <AccountSections />}</View>
      </ScrollView>
    </View>
  );
}

function Message({ text, ok }: { text: string | null; ok?: boolean }) {
  const { colors } = useTheme();
  if (!text) return null;
  return (
    <AppText variant="caption" color={ok ? colors.success : colors.danger}>
      {text}
    </AppText>
  );
}

function GuestSection({ local }: { local: boolean }) {
  const { confirm } = useFeedback();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const errors = {
    name: validateMaxLength(name, LIMITS.displayNameMax),
    email: validateEmail(email),
    password: validatePassword(password),
    confirm: validatePasswordMatch(password, confirmPw),
  };

  const create = async () => {
    setSubmitted(true);
    setMessage(null);
    if (firstError(errors.name, errors.email, errors.password, errors.confirm)) return;
    setBusy(true);
    const res = await useAuthStore.getState().upgradeGuest(email, password, name);
    setBusy(false);
    if (!res.ok) setMessage(res.message);
  };

  const leave = async () => {
    const r = await confirm({ title: t('settings.guestLeaveTitle'), message: t('settings.guestLeaveMessage'), confirmLabel: t('settings.guestLeaveConfirm'), destructive: true });
    if (r === 'confirm') await useAuthStore.getState().leaveGuest();
  };

  return (
    <>
      {!local && isSupabaseConfigured ? (
        <Section title={t('settings.createAccount')}>
          <View style={styles.form}>
            <AppText variant="caption" muted>
              {t('settings.createAccountHint')}
            </AppText>
            <TextField label={t('auth.displayName')} value={name} onChangeText={setName} error={submitted ? errors.name : null} />
            <TextField label={t('auth.email')} value={email} onChangeText={setEmail} error={submitted ? errors.email : null} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
            <TextField label={t('auth.password')} value={password} onChangeText={setPassword} error={submitted ? errors.password : null} secure autoCapitalize="none" />
            <TextField label={t('auth.passwordConfirm')} value={confirmPw} onChangeText={setConfirmPw} error={submitted ? errors.confirm : null} secure autoCapitalize="none" />
            <Message text={message} />
            <Button label={t('settings.createAccountSubmit')} onPress={create} loading={busy} fullWidth />
          </View>
        </Section>
      ) : null}
      <Button label={t('settings.backToLogin')} variant="danger" icon="logout" onPress={leave} fullWidth />
    </>
  );
}

function AccountSections() {
  const { confirm, toast } = useFeedback();
  const identity = useAuthStore((s) => s.identity);
  const [name, setName] = useState(identity?.displayName ?? '');
  const [nameMessage, setNameMessage] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSubmitted, setPwSubmitted] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const pwErrors = { current: current ? null : t('validation.required'), next: validatePassword(next), confirm: validatePasswordMatch(next, confirmPw) };

  const saveName = async () => {
    if (validateMaxLength(name, LIMITS.displayNameMax)) return;
    await useAuthStore.getState().updateDisplayName(name);
    setNameMessage(t('settings.profileSaved'));
  };

  const changePassword = async () => {
    setPwSubmitted(true);
    setPwMessage(null);
    if (firstError(pwErrors.current, pwErrors.next, pwErrors.confirm)) return;
    setPwBusy(true);
    const res = await useAuthStore.getState().changePassword(current, next);
    setPwBusy(false);
    if (res.ok) {
      setPwMessage({ text: t('settings.passwordChanged'), ok: true });
      setCurrent('');
      setNext('');
      setConfirmPw('');
      setPwSubmitted(false);
    } else setPwMessage({ text: res.message, ok: false });
  };

  const logout = async () => {
    const pending = pendingCount();
    const r = await confirm({
      title: t('settings.logoutTitle'),
      message: pending > 0 ? t('settings.logoutPending', { count: pending }) : t('settings.logoutMessage'),
      confirmLabel: t('settings.logoutNow'),
      destructive: true,
    });
    if (r === 'confirm') await useAuthStore.getState().signOut();
  };

  const deleteAccount = async () => {
    setDeleteMessage(null);
    const pending = pendingCount();
    const r = await confirm({
      title: t('settings.deleteAccount'),
      message: pending > 0 ? `${t('settings.deleteAccountWarning')}\n${t('settings.deleteAccountPending')}` : t('settings.deleteAccountWarning'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (r !== 'confirm') return;
    const res = await useAuthStore.getState().deleteAccount();
    if (!res.ok) setDeleteMessage(res.message);
    else toast(t('settings.deleteAccountDone'));
  };

  return (
    <>
      <Section title={t('settings.account')}>
        <View style={styles.form}>
          <AppText variant="caption" muted>
            {t('settings.emailLabel')}
          </AppText>
          <AppText>{identity?.email}</AppText>
          <TextField label={t('auth.displayName')} value={name} onChangeText={(v) => { setName(v); setNameMessage(null); }} error={validateMaxLength(name, LIMITS.displayNameMax)} />
          <Message text={nameMessage} ok />
          <Button label={t('settings.saveProfile')} variant="secondary" onPress={saveName} />
        </View>
      </Section>

      <Section title={t('settings.changePassword')}>
        <View style={styles.form}>
          <TextField label={t('auth.password')} value={current} onChangeText={setCurrent} error={pwSubmitted ? pwErrors.current : null} secure autoCapitalize="none" />
          <TextField label={t('settings.newPassword')} value={next} onChangeText={setNext} error={pwSubmitted ? pwErrors.next : null} secure autoCapitalize="none" />
          <TextField label={t('auth.passwordConfirm')} value={confirmPw} onChangeText={setConfirmPw} error={pwSubmitted ? pwErrors.confirm : null} secure autoCapitalize="none" />
          <Message text={pwMessage?.text ?? null} ok={pwMessage?.ok} />
          <Button label={t('settings.changePassword')} onPress={changePassword} loading={pwBusy} />
        </View>
      </Section>

      <Button label={t('settings.logout')} variant="secondary" icon="logout" onPress={logout} fullWidth />

      <Section title={t('settings.deleteAccount')}>
        <View style={styles.form}>
          <AppText variant="caption" muted>
            {t('settings.deleteAccountWarning')}
          </AppText>
          <TextField label={t('settings.deleteAccountType', { word: t('settings.deleteAccountWord') })} value={typed} onChangeText={setTyped} autoCapitalize="none" />
          <Message text={deleteMessage} />
          <Button label={t('settings.deleteAccount')} variant="danger" disabled={typed !== t('settings.deleteAccountWord')} onPress={deleteAccount} />
        </View>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { padding: SPACING.lg, alignItems: 'center' },
  inner: { width: '100%', maxWidth: BOARD.dialogMaxWidth + 120, gap: SPACING.lg },
  form: { padding: SPACING.lg, gap: SPACING.md },
});
