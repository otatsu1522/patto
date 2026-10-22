import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { UI_METRICS } from '@/config/layout';
import type { ToastCategory } from '@/config/defaults';
import { t } from '@/i18n';
import { useSettingsStore } from '@/store/settingsStore';
import { FONT_WEIGHT, RADIUS, SHADOW, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { Button } from './Button';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SystemBars } from './SystemBars';
import { getSystemBarInsets } from '@/lib/systemBarInsets';
import { DIAGNOSTIC_MESSAGES } from '@/config/diagnostics';
import { useUiStore } from '@/store/uiStore';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  destructive?: boolean;
  /** 初期化など、破壊的確認の中でも塗りつぶしを維持する場合のみ指定する。 */
  destructiveFilled?: boolean;
}
export type ConfirmResult = 'confirm' | 'cancel';

interface Toast {
  message: string;
  category: ToastCategory;
  /** 独立設定を持つトーストは、通知分類のON/OFFとは別に扱う。 */
  bypassCategoryFilter?: boolean;
  actionLabel?: string;
  onAction?: () => void | Promise<void>;
}

interface Feedback {
  confirm: (o: ConfirmOptions) => Promise<ConfirmResult>;
  /** 理由を伝える単一ボタンのダイアログ。 */
  alert: (title: string, message: string) => void;
  /** カテゴリはシステム設定のトースト表示対象でフィルターする。失敗は呼び出し元でダイアログ表示する。 */
  toast: (
    message: string,
    action?: { label: string; onPress: () => void | Promise<void> },
    options?: { category: ToastCategory; bypassCategoryFilter?: boolean },
  ) => void;
}

const Ctx = createContext<Feedback | null>(null);

export const useFeedback = (): Feedback => {
  const v = useContext(Ctx);
  if (!v) throw new Error(DIAGNOSTIC_MESSAGES.feedbackProviderMissing);
  return v;
};

/** 確認ダイアログとスナックバー（「元に戻す」付き通知）を提供する。 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { colors, lineWidth, lineColor } = useTheme();
  const insets = getSystemBarInsets(useSafeAreaInsets());
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const [dialogMode, setDialogMode] = useState<'confirm' | 'alert'>('confirm');
  const pushDialog = useUiStore((s) => s.pushDialog);
  const popDialog = useUiStore((s) => s.popDialog);
  const isDialogVisible = dialog !== null;

  useLayoutEffect(() => {
    if (!isDialogVisible) return;
    pushDialog();
    return popDialog;
  }, [isDialogVisible, pushDialog, popDialog]);
  const resolver = useRef<((r: ConfirmResult) => void) | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const settings = useSettingsStore((s) => s.settings);
  const storageErrorVersion = useSettingsStore((s) => s.storageErrorVersion);
  const storageErrorKey = useSettingsStore((s) => s.storageErrorKey);
  const handledStorageErrorVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const confirm = useCallback((o: ConfirmOptions) => {
    return new Promise<ConfirmResult>((resolve) => {
      resolver.current = resolve;
      setDialogMode('confirm');
      setDialog(o);
    });
  }, []);

  const alert = useCallback((title: string, message: string) => {
    resolver.current = null;
    setDialogMode('alert');
    setDialog({ title, message, confirmLabel: t('common.ok') });
  }, []);

  // ストレージ保存エラーは画面固有のイベントハンドラーに依存せず、共通ダイアログで通知する。
  // Effectの実行中にダイアログstateを同期更新しないよう、通知は次のタスクへ送る。
  useEffect(() => {
    if (storageErrorVersion <= handledStorageErrorVersion.current) return;
    handledStorageErrorVersion.current = storageErrorVersion;
    if (!storageErrorKey) return;
    const notificationTimer = setTimeout(() => {
      alert(t('common.error'), t(storageErrorKey));
    }, 0);
    return () => clearTimeout(notificationTimer);
  }, [storageErrorVersion, storageErrorKey, alert]);

  const close = (r: ConfirmResult) => {
    setDialog(null);
    const resolve = resolver.current;
    resolver.current = null;
    setDialogMode('confirm');
    resolve?.(r);
  };

  const showToast = useCallback(
    (
      message: string,
      action?: { label: string; onPress: () => void | Promise<void> },
      options?: { category: ToastCategory; bypassCategoryFilter?: boolean },
    ) => {
      const settings = useSettingsStore.getState().settings;
      if (!settings.toastEnabled) return;
      if (
        !options?.bypassCategoryFilter &&
        (!options?.category || !settings.toastCategories.includes(options.category))
      )
        return;
      if (timer.current) clearTimeout(timer.current);
      setToast({
        message,
        category: options?.category ?? 'system',
        bypassCategoryFilter: options?.bypassCategoryFilter,
        actionLabel: action?.label,
        onAction: action?.onPress,
      });
      timer.current = setTimeout(() => setToast(null), settings.toastDurationSeconds * 1000);
    },
    [],
  );

  useEffect(() => {
    if (!toast) return;

    // 設定ストアの変更通知内で既存トーストを破棄する。
    // effect の実行中に setState を同期実行せず、React の cascade-render 警告を避ける。
    const unsubscribe = useSettingsStore.subscribe((state) => {
      if (
        state.settings.toastEnabled &&
        (toast.bypassCategoryFilter || state.settings.toastCategories.includes(toast.category))
      ) {
        return;
      }
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      setToast(null);
    });

    return unsubscribe;
  }, [toast]);

  const value = useMemo(() => ({ confirm, alert, toast: showToast }), [confirm, alert, showToast]);

  return (
    <Ctx.Provider value={value}>
      {children}
      {toast &&
      settings.toastEnabled &&
      (toast.bypassCategoryFilter || settings.toastCategories.includes(toast.category)) ? (
        <View
          pointerEvents="box-none"
          style={[styles.toastWrap, { bottom: insets.bottom + SPACING.lg }]}
        >
          <View style={[styles.toast, SHADOW.float, { backgroundColor: colors.inverse }]}>
            <AppText
              color={colors.onInverse}
              style={[styles.toastText, { fontWeight: FONT_WEIGHT.medium }]}
            >
              {toast.message}
            </AppText>
            {toast.onAction ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  const action = toast.onAction;
                  setToast(null);
                  void (async () => {
                    try {
                      await action?.();
                    } catch {
                      alert(t('common.error'), t('operation.saveFailed'));
                    }
                  })();
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
      <Modal
        visible={dialog !== null}
        transparent
        animationType="none"
        onRequestClose={() => close('cancel')}
        statusBarTranslucent
        navigationBarTranslucent
      >
        <View style={styles.modalRoot}>
          {dialog !== null ? <SystemBars manageSystemUi={false} /> : null}
          <View
            style={[
              styles.backdrop,
              {
                backgroundColor: colors.overlay,
                top: 0,
                bottom: 0,
                paddingTop: insets.top + SPACING.lg,
                paddingBottom: insets.bottom + SPACING.lg,
              },
            ]}
          >
            {dialog ? (
              <View
                style={[
                  styles.card,
                  SHADOW.float,
                  {
                    backgroundColor: colors.surface,
                    borderColor: lineColor,
                    borderWidth: lineWidth,
                  },
                ]}
              >
                <AppText variant="title">{dialog.title}</AppText>
                {dialog.message ? <AppText muted>{dialog.message}</AppText> : null}
                <View style={styles.actions}>
                  {dialogMode === 'confirm' ? (
                    <Button
                      label={t('common.cancel')}
                      variant="secondary"
                      onPress={() => close('cancel')}
                    />
                  ) : null}
                  <Button
                    label={dialog.confirmLabel ?? t('common.ok')}
                    variant={
                      dialogMode === 'confirm' && dialog.destructive
                        ? dialog.destructiveFilled
                          ? 'danger'
                          : 'outlineDanger'
                        : 'primary'
                    }
                    onPress={() => close('confirm')}
                  />
                </View>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  card: {
    width: '100%',
    maxWidth: UI_METRICS.dialog.feedbackCardMaxWidth,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    gap: SPACING.md,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: SPACING.sm,
    marginTop: SPACING.sm,
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: SPACING.xl,
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
    borderRadius: RADIUS.md,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    maxWidth: UI_METRICS.dialog.toastMaxWidth,
  },
  toastText: { flexShrink: 1 },
});
