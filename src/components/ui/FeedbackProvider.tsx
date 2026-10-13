import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { t } from '@/i18n';
import { useSettingsStore } from '@/store/settingsStore';
import { RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { BORDER_WIDTH } from '@/theme/tokens';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** 3つ目の選択肢（例:「別のカンバンへ移動」）。選ぶと 'extra' が返る */
  extraLabel?: string;
}
export type ConfirmResult = 'confirm' | 'extra' | 'cancel';

interface Toast {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Feedback {
  confirm: (o: ConfirmOptions) => Promise<ConfirmResult>;
  /** force: true は、設定でトーストをOFFにしていても出す（失敗の知らせなど） */
  toast: (message: string, action?: { label: string; onPress: () => void }, options?: { force?: boolean }) => void;
}

const Ctx = createContext<Feedback | null>(null);

export const useFeedback = (): Feedback => {
  const v = useContext(Ctx);
  if (!v) throw new Error('FeedbackProvider が見つかりません');
  return v;
};

const TOAST_MS = 5000;

/** 確認ダイアログとスナックバー（「元に戻す」付き通知）を提供する。 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
      setDialog(o);
    });
  }, []);

  const close = (r: ConfirmResult) => {
    setDialog(null);
    resolver.current?.(r);
    resolver.current = null;
  };

  const showToast = useCallback((message: string, action?: { label: string; onPress: () => void }, options?: { force?: boolean }) => {
    if (!options?.force && !useSettingsStore.getState().settings.toastEnabled) return;
    if (timer.current) clearTimeout(timer.current);
    setToast({ message, actionLabel: action?.label, onAction: action?.onPress });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const value = useMemo(() => ({ confirm, toast: showToast }), [confirm, showToast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast ? (
        <View pointerEvents="box-none" style={styles.toastWrap}>
          <View style={[styles.toast, SHADOW.float, { backgroundColor: colors.inverse }]}>
            <AppText color={colors.onInverse} style={styles.toastText}>
              {toast.message}
            </AppText>
            {toast.onAction ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  toast.onAction?.();
                  setToast(null);
                }}
              >
                <AppText bold color={colors.inverseAccent}>
                  {toast.actionLabel}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
      <Modal visible={dialog !== null} transparent animationType="fade" onRequestClose={() => close('cancel')} statusBarTranslucent>
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <View style={[styles.card, SHADOW.float, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <AppText variant="title">{dialog?.title}</AppText>
            {dialog?.message ? <AppText muted>{dialog.message}</AppText> : null}
            <View style={styles.actions}>
              <Button label={t('common.cancel')} variant="secondary" onPress={() => close('cancel')} />
              {dialog?.extraLabel ? <Button label={dialog.extraLabel} variant="secondary" onPress={() => close('extra')} /> : null}
              <Button
                label={dialog?.confirmLabel ?? t('common.ok')}
                variant={dialog?.destructive ? 'danger' : 'primary'}
                onPress={() => close('confirm')}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  card: { width: '100%', maxWidth: 440, borderRadius: RADIUS.lg, borderWidth: BORDER_WIDTH, padding: SPACING.lg, gap: SPACING.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: SPACING.sm, marginTop: SPACING.sm },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: SPACING.xl, alignItems: 'center', paddingHorizontal: SPACING.lg },
  toast: { flexDirection: 'row', alignItems: 'center', gap: SPACING.lg, borderRadius: RADIUS.md, paddingVertical: SPACING.md, paddingHorizontal: SPACING.lg, maxWidth: 520 },
  toastText: { flexShrink: 1 },
});
