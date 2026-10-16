import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { useFeedback } from '@/components/ui/FeedbackProvider';
import { Section } from '@/components/ui/Rows';
import { ScreenHeader } from '@/components/ui/ScreenHeader';
import { TextField } from '@/components/ui/TextField';
import { isSupabaseConfigured } from '@/config/env';
import { BOARD, UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import { LIMITS } from '@/config/limits';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import {
  AuthInputFocusProvider,
  useInputFocusScroller,
} from '@/components/auth/AuthInputFocusContext';
import {
  firstError,
  validateEmail,
  validateMaxLength,
  validatePassword,
  validatePasswordMatch,
} from '@/domain/validation';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { SPACING, useTheme } from '@/theme';
import { isTouchWeb } from '@/lib/hover';

const pendingCount = () => {
  const s = useDataStore.getState();
  return [...s.projects, ...s.columns, ...s.tasks].filter((r) => r.dirty).length;
};

/** ゲスト: アカウント作成 / ログイン画面へ戻る。アカウント: 表示名・メールアドレス・パスワード変更・削除。 */
export default function ProfileScreen() {
  const scrollRef = useWebWheelScroll();
  const { revealFocusedInput, onScroll } = useInputFocusScroller(scrollRef);
  const identity = useAuthStore((s) => s.identity);

  // モバイル Web の一部ブラウザーは、ソフトウェアキーボード表示時も layout viewport を縮めない。
  // その場合はアカウント画面のスクロール領域自体を visual viewport に合わせる。
  useEffect(() => {
    if (Platform.OS !== 'web' || !isTouchWeb || typeof window === 'undefined') return;
    const viewport = window.visualViewport;
    if (!viewport) return;

    type WebScrollHandle = {
      getScrollableNode?: () => unknown;
      _scrollNodeRef?: { current?: unknown };
    };
    const getScrollNode = (): HTMLElement | null => {
      const handle = scrollRef.current as unknown as WebScrollHandle | null;
      const node = handle?.getScrollableNode?.() ?? handle?._scrollNodeRef?.current;
      return typeof HTMLElement !== 'undefined' && node instanceof HTMLElement ? node : null;
    };

    let adjustedNode: HTMLElement | null = null;
    let originalStyles: {
      height: string;
      maxHeight: string;
      flex: string;
      minHeight: string;
    } | null = null;
    const restore = () => {
      if (adjustedNode && originalStyles) {
        adjustedNode.style.height = originalStyles.height;
        adjustedNode.style.maxHeight = originalStyles.maxHeight;
        adjustedNode.style.flex = originalStyles.flex;
        adjustedNode.style.minHeight = originalStyles.minHeight;
      }
      adjustedNode = null;
      originalStyles = null;
    };

    const syncViewport = () => {
      const node = getScrollNode();
      if (!node) return;
      const keyboardVisible =
        window.innerHeight - viewport.height > UI_METRICS.keyboard.profileViewportDeltaPx;
      if (!keyboardVisible) {
        restore();
        return;
      }
      if (adjustedNode !== node) {
        restore();
        adjustedNode = node;
        originalStyles = {
          height: node.style.height,
          maxHeight: node.style.maxHeight,
          flex: node.style.flex,
          minHeight: node.style.minHeight,
        };
      }
      const rect = node.getBoundingClientRect();
      const visibleBottom = viewport.offsetTop + viewport.height;
      const availableHeight = Math.max(1, visibleBottom - rect.top);
      node.style.height = `${availableHeight}px`;
      node.style.maxHeight = `${availableHeight}px`;
      node.style.flex = '0 0 auto';
      node.style.minHeight = '0';
      window.requestAnimationFrame(() => revealFocusedInput());
    };

    viewport.addEventListener('resize', syncViewport);
    viewport.addEventListener('scroll', syncViewport);
    window.addEventListener('resize', syncViewport);
    syncViewport();
    return () => {
      viewport.removeEventListener('resize', syncViewport);
      viewport.removeEventListener('scroll', syncViewport);
      window.removeEventListener('resize', syncViewport);
      restore();
    };
  }, [revealFocusedInput, scrollRef]);

  return (
    <View style={styles.fill}>
      <ScreenHeader title={t('settings.profile')} />
      <KeyboardAvoidingView
        behavior={
          Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined
        }
        style={styles.fill}
      >
        <AuthInputFocusProvider value={revealFocusedInput}>
          <ScrollView
            ref={scrollRef}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            onScroll={onScroll}
            scrollEventThrottle={TIMING.scrollEventThrottleMs}
          >
            <View style={styles.inner}>
              {identity?.mode === 'guest' ? (
                <GuestSection local={!!identity.local} />
              ) : (
                <AccountSections />
              )}
            </View>
          </ScrollView>
        </AuthInputFocusProvider>
      </KeyboardAvoidingView>
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
    const r = await confirm({
      title: t('settings.guestLeaveTitle'),
      message: t('settings.guestLeaveMessage'),
      confirmLabel: t('settings.guestLeaveConfirm'),
      destructive: true,
    });
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
            />
            <TextField
              label={t('auth.password')}
              value={password}
              onChangeText={setPassword}
              error={submitted ? errors.password : null}
              secure
              autoCapitalize="none"
            />
            <TextField
              label={t('auth.passwordConfirm')}
              value={confirmPw}
              onChangeText={setConfirmPw}
              error={submitted ? errors.confirm : null}
              secure
              autoCapitalize="none"
            />
            <Message text={message} />
            <Button
              label={t('settings.createAccountSubmit')}
              onPress={create}
              loading={busy}
              fullWidth
            />
          </View>
        </Section>
      ) : null}
      <Button
        label={t('settings.backToLogin')}
        variant="danger"
        icon="logout"
        onPress={leave}
        fullWidth
      />
    </>
  );
}

function AccountSections() {
  const { confirm, toast } = useFeedback();
  const identity = useAuthStore((s) => s.identity);
  const [name, setName] = useState(identity?.displayName ?? '');
  const [nameMessage, setNameMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [email, setEmail] = useState(identity?.email ?? '');
  const [emailSubmitted, setEmailSubmitted] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMessage, setEmailMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSubmitted, setPwSubmitted] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const pwErrors = {
    current: current ? null : t('validation.required'),
    next: validatePassword(next),
    confirm: validatePasswordMatch(next, confirmPw),
  };
  const emailError = emailSubmitted ? validateEmail(email) : null;

  const saveName = async () => {
    const error = validateMaxLength(name, LIMITS.displayNameMax);
    if (error) {
      setNameMessage({ text: error, ok: false });
      return;
    }
    const res = await useAuthStore.getState().updateDisplayName(name);
    setNameMessage(
      res.ok ? { text: t('settings.profileSaved'), ok: true } : { text: res.message, ok: false },
    );
  };

  const changeEmail = async () => {
    setEmailSubmitted(true);
    setEmailMessage(null);
    if (validateEmail(email)) return;
    if (email.trim().toLowerCase() === identity?.email.toLowerCase()) {
      setEmailMessage({ text: t('settings.emailSame'), ok: false });
      return;
    }
    setEmailBusy(true);
    const res = await useAuthStore.getState().changeEmail(email);
    setEmailBusy(false);
    if (res.ok) {
      setEmailMessage({ text: res.message ?? t('settings.emailChanged'), ok: true });
      setEmailSubmitted(false);
    } else setEmailMessage({ text: res.message, ok: false });
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

  const deleteAccount = async () => {
    setDeleteMessage(null);
    const pending = pendingCount();
    const r = await confirm({
      title: t('settings.deleteAccount'),
      message:
        pending > 0
          ? `${t('settings.deleteAccountWarning')}\n${t('settings.deleteAccountPending')}`
          : t('settings.deleteAccountWarning'),
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
      <Section title={t('auth.displayName')}>
        <View style={styles.form}>
          <AppText variant="caption" muted>
            {t('settings.displayNameHint')}
          </AppText>
          <TextField
            label={t('auth.displayName')}
            value={name}
            onChangeText={(v) => {
              setName(v);
              setNameMessage(null);
            }}
            error={validateMaxLength(name, LIMITS.displayNameMax)}
          />
          <Message text={nameMessage?.text ?? null} ok={nameMessage?.ok} />
          <Button label={t('settings.saveProfile')} onPress={saveName} />
        </View>
      </Section>

      {isSupabaseConfigured && !identity?.local ? (
        <Section title={t('settings.emailChange')}>
          <View style={styles.form}>
            <AppText variant="caption" muted>
              {t('settings.emailChangeHint')}
            </AppText>
            <TextField
              label={t('auth.email')}
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                setEmailMessage(null);
              }}
              error={emailError}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <Message text={emailMessage?.text ?? null} ok={emailMessage?.ok} />
            <Button
              label={t('settings.emailChangeSubmit')}
              onPress={changeEmail}
              loading={emailBusy}
            />
          </View>
        </Section>
      ) : null}

      <Section title={t('settings.changePassword')}>
        <View style={styles.form}>
          <AppText variant="caption" muted>
            {t('settings.passwordChangeHint')}
          </AppText>
          <TextField
            label={t('auth.password')}
            value={current}
            onChangeText={setCurrent}
            error={pwSubmitted ? pwErrors.current : null}
            secure
            autoCapitalize="none"
          />
          <TextField
            label={t('settings.newPassword')}
            value={next}
            onChangeText={setNext}
            error={pwSubmitted ? pwErrors.next : null}
            secure
            autoCapitalize="none"
          />
          <TextField
            label={t('auth.passwordConfirm')}
            value={confirmPw}
            onChangeText={setConfirmPw}
            error={pwSubmitted ? pwErrors.confirm : null}
            secure
            autoCapitalize="none"
          />
          <Message text={pwMessage?.text ?? null} ok={pwMessage?.ok} />
          <Button label={t('settings.changePassword')} onPress={changePassword} loading={pwBusy} />
        </View>
      </Section>

      <Section title={t('settings.deleteAccount')}>
        <View style={styles.form}>
          <AppText variant="caption" muted>
            {t('settings.deleteAccountWarning')}
          </AppText>
          <TextField
            label={t('settings.deleteAccountType', { word: t('settings.deleteAccountWord') })}
            value={typed}
            onChangeText={setTyped}
            autoCapitalize="none"
          />
          <Message text={deleteMessage} />
          <Button
            label={t('settings.deleteAccount')}
            variant="danger"
            disabled={typed !== t('settings.deleteAccountWord')}
            onPress={deleteAccount}
          />
        </View>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    touchAction: 'pan-y',
    overscrollBehaviorY: 'auto',
  } as never,
  content: { padding: SPACING.lg, alignItems: 'center', flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: BOARD.dialogMaxWidth + UI_METRICS.dialog.settingsPanelExtraWidth,
    gap: SPACING.lg,
  },
  form: { padding: SPACING.lg, gap: SPACING.md },
});
