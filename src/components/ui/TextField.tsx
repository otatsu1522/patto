import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { BOARD, UI_METRICS } from '@/config/layout';
import { t } from '@/i18n';
import { FONT, RADIUS, SPACING, useTheme, ICON_SIZE, ICON_BUTTON_BOX } from '@/theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { useAuthInputFocus } from '../auth/AuthInputFocusContext';

interface Props extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  secure?: boolean;
  /** 固定行数ではなく、表示上の折り返しに合わせて高さを伸ばす。 */
  autoGrow?: boolean;
  /** autoGrow 時も改行を許さず、Enter で確定する。 */
  singleLine?: boolean;
  /** 複数行入力の行数 */
  lines?: number;
  /** 指定すると、入力があるときに右端に×を出し、押すとこれを呼ぶ（クリア用） */
  onClear?: () => void;
  /** Web の autoGrow 入力で Enter（Shift+Enter を含む）が押されたときの確定処理。 */
  onEnter?: () => void;
}

export const TextField = forwardRef<TextInput, Props>(function TextField(
  {
    label,
    error,
    secure,
    lines,
    autoGrow = false,
    singleLine = false,
    onClear,
    onEnter,
    onFocus,
    onBlur,
    onContentSizeChange,
    onSubmitEditing,
    ...rest
  },
  ref,
) {
  const { colors, fs, controlLineWidth, controlLineColor } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [hidden, setHidden] = useState(true);
  const [measuredContentHeight, setMeasuredContentHeight] = useState<number | null>(null);
  const baselineContentHeight = useRef<number | null>(null);
  const [keyboardAvailableHeight, setKeyboardAvailableHeight] = useState<number | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const revealAuthInput = useAuthInputFocus();
  const setInputRef = useCallback(
    (input: TextInput | null) => {
      inputRef.current = input;
      if (typeof ref === 'function') ref(input);
      else if (ref) (ref as { current: TextInput | null }).current = input;
    },
    [ref],
  );
  const multiline = autoGrow || (lines ?? 1) > 1;
  const autoGrowBaseLines = Math.max(1, lines ?? 1);
  // React Native の型定義に boxSizing がないバージョンにも対応しつつ、
  // Web では textarea の padding が height に加算されないようにする。
  const webBoxSizing =
    Platform.OS === 'web' ? ({ boxSizing: 'border-box' } as unknown as ViewStyle) : null;
  const webInputBoxSizing =
    Platform.OS === 'web' ? ({ boxSizing: 'border-box' } as unknown as TextStyle) : null;
  const autoGrowLineHeight = fs(FONT.body) * UI_METRICS.textField.lineHeightMultiplier;
  const autoGrowMinHeight = Math.max(
    BOARD.touchTarget - UI_METRICS.textField.autoGrowMinHeightAdjustment,
    autoGrowLineHeight * autoGrowBaseLines + SPACING.sm * 2,
  );
  // 初期表示の行数（タイトルは1行、説明欄は既定4行）に対して上下の padding を均等にする。
  const autoGrowVerticalPadding = Math.max(
    0,
    (autoGrowMinHeight - autoGrowLineHeight * autoGrowBaseLines) / 2,
  );
  const visibleHeight = Math.min(windowHeight, keyboardAvailableHeight ?? windowHeight);
  // 入力欄自体が画面／キーボードの高さを占有しないよう、表示領域の一部を上限にする。
  const autoGrowMaxHeight = Math.max(
    autoGrowMinHeight,
    Math.min(
      UI_METRICS.textField.autoGrowMaxHeight,
      visibleHeight * UI_METRICS.textField.autoGrowMaxViewportRatio,
    ),
  );
  const autoGrowHeight = Math.min(
    autoGrowMaxHeight,
    Math.max(autoGrowMinHeight, measuredContentHeight ?? autoGrowMinHeight),
  );
  const measureWebAutoGrow = useCallback(() => {
    if (Platform.OS !== 'web' || !autoGrow) return;

    // React Native Web の ref は実 DOM 要素そのものではなく getNativeRef() を
    // 介して textarea を返す場合があるため、両方の形に対応する。
    const input = inputRef.current as unknown as
      | (HTMLTextAreaElement & { getNativeRef?: () => HTMLTextAreaElement | null })
      | { getNativeRef?: () => HTMLTextAreaElement | null }
      | null;
    const node = (
      input && typeof input.getNativeRef === 'function' ? input.getNativeRef() : input
    ) as HTMLTextAreaElement | null;
    if (!node || !node.style || typeof node.scrollHeight !== 'number') return;

    // 拡張後の高さが残ったままでは、文字を削除しても scrollHeight が縮まないことがある。
    // いったん高さ・上下限を解除して現在の内容だけを測定し、同期的に元へ戻す。
    const previousHeight = node.style.height;
    const previousMinHeight = node.style.minHeight;
    const previousMaxHeight = node.style.maxHeight;
    const previousOverflowY = node.style.overflowY;
    node.style.height = '0px';
    node.style.minHeight = '0px';
    node.style.maxHeight = 'none';
    node.style.overflowY = 'hidden';
    const contentHeight = node.scrollHeight;
    node.style.height = previousHeight;
    node.style.minHeight = previousMinHeight;
    node.style.maxHeight = previousMaxHeight;
    node.style.overflowY = previousOverflowY;

    const nextHeight = Math.min(autoGrowMaxHeight, Math.max(autoGrowMinHeight, contentHeight));
    setMeasuredContentHeight((current) => (current === nextHeight ? current : nextHeight));
  }, [autoGrow, autoGrowMaxHeight, autoGrowMinHeight]);
  const handleWebKeyPress = useCallback(
    (event: {
      nativeEvent: { key: string; isComposing?: boolean; keyCode?: number };
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => {
      const keyEvent = event.nativeEvent;
      // React Native Web の onKeyPress は、DOM KeyboardEvent ではなく nativeEvent.key を渡す。
      // singleLine のタスク名は Enter と Shift+Enter で確定し、改行を挿入しない。
      if (
        !autoGrow ||
        !singleLine ||
        keyEvent.key !== 'Enter' ||
        keyEvent.isComposing ||
        keyEvent.keyCode === 229
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onEnter?.();
      inputRef.current?.blur();
    },
    [autoGrow, singleLine, onEnter],
  );

  useEffect(() => {
    if (!autoGrow) return;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const viewport = window.visualViewport;
      if (!viewport) return;
      const updateViewportHeight = () => {
        const keyboardOpen =
          viewport.height < window.innerHeight - UI_METRICS.keyboard.textFieldViewportDeltaPx;
        setKeyboardAvailableHeight(keyboardOpen ? viewport.height : null);
      };
      viewport.addEventListener('resize', updateViewportHeight);
      window.addEventListener('resize', updateViewportHeight);
      return () => {
        viewport.removeEventListener('resize', updateViewportHeight);
        window.removeEventListener('resize', updateViewportHeight);
      };
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvent, (event) => {
      const screenY = event.endCoordinates.screenY;
      const available = screenY > 0 ? screenY : windowHeight - event.endCoordinates.height;
      setKeyboardAvailableHeight(Math.max(1, Math.min(windowHeight, available)));
    });
    const hide = Keyboard.addListener(hideEvent, () => setKeyboardAvailableHeight(null));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [autoGrow, windowHeight]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !autoGrow) return;
    measureWebAutoGrow();
  }, [autoGrow, rest.value, measureWebAutoGrow]);

  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="label" muted>
          {label}
        </AppText>
      ) : null}
      <View
        style={[
          styles.box,
          {
            borderColor: error ? colors.danger : controlLineColor,
            backgroundColor: colors.surface,
            borderWidth: controlLineWidth,
          },
          // autoGrow の初期表示は指定行数に応じた高さにし、外枠側で高さを管理する。
          // Textarea のブラウザー既定サイズで外枠が押し広げられないようにする。
          autoGrow
            ? {
                height: autoGrowHeight + controlLineWidth * 2,
                maxHeight: autoGrowMaxHeight + controlLineWidth * 2,
                alignItems: 'stretch',
                overflow: 'hidden',
              }
            : null,
          autoGrow ? webBoxSizing : null,
        ]}
      >
        <TextInput
          ref={setInputRef}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && hidden}
          multiline={multiline}
          numberOfLines={autoGrow ? autoGrowBaseLines : lines}
          {...rest}
          onKeyPress={
            Platform.OS === 'web' && autoGrow ? (handleWebKeyPress as never) : rest.onKeyPress
          }
          blurOnSubmit={autoGrow && singleLine && Platform.OS === 'web' ? true : rest.blurOnSubmit}
          submitBehavior={autoGrow && singleLine ? 'submit' : rest.submitBehavior}
          onSubmitEditing={
            Platform.OS === 'web' && autoGrow && singleLine
              ? undefined
              : (event) => {
                  onSubmitEditing?.(event);
                  if (autoGrow && singleLine) inputRef.current?.blur();
                }
          }
          onContentSizeChange={(event) => {
            onContentSizeChange?.(event);
            if (!autoGrow) return;
            const contentHeight = event.nativeEvent.contentSize.height;
            if (Platform.OS === 'web') {
              // Web では制御値の更新でも測定し、textarea の実内容高さへ追従させる。
              measureWebAutoGrow();
            } else {
              // ネイティブは1行分の内容高さを基準にして初期行数を超えた分を加算する。
              const baseline = baselineContentHeight.current;
              const lineHeight = fs(FONT.body) * UI_METRICS.textField.lineHeightMultiplier;
              if (baseline === null) {
                const hasInitialValue = typeof rest.value === 'string' && rest.value.length > 0;
                // 編集時は最初のサイズ通知から既に折り返し済みの場合がある。
                // 空欄の実測値を基準にする従来方式では、その折り返し分を失うため、
                // 初期値がある場合は1行分の高さを基準として初回から拡張する。
                // ネイティブ TextInput の contentSize には上下 padding が含まれる。
                // 1行分の基準にも padding を含めないと、1行の既存タイトルを2行分と誤判定する。
                const singleLineBaseline = autoGrowLineHeight + autoGrowVerticalPadding * 2;
                baselineContentHeight.current = hasInitialValue
                  ? singleLineBaseline
                  : contentHeight;
                const addedHeight =
                  contentHeight -
                  baselineContentHeight.current -
                  autoGrowLineHeight * (autoGrowBaseLines - 1);
                setMeasuredContentHeight(
                  hasInitialValue &&
                    addedHeight >= lineHeight * UI_METRICS.textField.autoGrowStepFraction
                    ? Math.min(autoGrowMaxHeight, autoGrowMinHeight + addedHeight)
                    : null,
                );
              } else {
                const addedHeight =
                  contentHeight - baseline - autoGrowLineHeight * (autoGrowBaseLines - 1);
                setMeasuredContentHeight(
                  addedHeight >= lineHeight * UI_METRICS.textField.autoGrowStepFraction
                    ? Math.min(autoGrowMaxHeight, autoGrowMinHeight + addedHeight)
                    : null,
                );
              }
            }
            // 入力文字の折り返しで高さが変わった後も、入力欄を表示領域内に保つ。
            revealAuthInput?.(inputRef.current);
          }}
          onFocus={(event) => {
            onFocus?.(event);
            revealAuthInput?.(inputRef.current);
          }}
          onBlur={(event) => {
            onBlur?.(event);
            revealAuthInput?.(null);
          }}
          style={[
            styles.input,
            {
              color: colors.text,
              fontSize: fs(FONT.body),
              ...(autoGrow
                ? {
                    // 初期状態から明示的に1行分の高さを指定する。
                    // Web の textarea は box-sizing により padding 分の高さが加算されることがあるため、
                    // border-box を指定し、外枠と入力欄の高さを一致させる。
                    height: autoGrowHeight,
                    minHeight: autoGrowMinHeight,
                    maxHeight: autoGrowMaxHeight,
                    lineHeight: autoGrowLineHeight,
                    paddingVertical: autoGrowVerticalPadding,
                  }
                : multiline
                  ? {
                      height:
                        fs(FONT.body) * UI_METRICS.textField.lineHeightMultiplier * (lines ?? 1) +
                        SPACING.sm * 2,
                      minHeight:
                        fs(FONT.body) * UI_METRICS.textField.lineHeightMultiplier * (lines ?? 1) +
                        SPACING.sm * 2,
                      maxHeight:
                        fs(FONT.body) * UI_METRICS.textField.lineHeightMultiplier * (lines ?? 1) +
                        SPACING.sm * 2,
                    }
                  : {
                      minHeight:
                        BOARD.touchTarget - UI_METRICS.textField.autoGrowMinHeightAdjustment,
                    }),
            },
            autoGrow ? webInputBoxSizing : null,
            multiline &&
              ({
                textAlignVertical: 'top',
                ...(Platform.OS === 'web' ? { overflowY: 'auto' } : {}),
              } as never),
          ]}
        />
        {onClear && !secure && typeof rest.value === 'string' && rest.value.length > 0 ? (
          <IconButton
            icon="close"
            label={t('task.dueClear')}
            onPress={onClear}
            box={ICON_BUTTON_BOX.compact}
            size={ICON_SIZE.lg}
            color={colors.textMuted}
          />
        ) : null}
        {secure ? (
          <IconButton
            icon={hidden ? 'eye' : 'eyeOff'}
            label={hidden ? t('auth.showPassword') : t('auth.hidePassword')}
            onPress={() => setHidden((v) => !v)}
            box={ICON_BUTTON_BOX.medium}
            size={ICON_SIZE.xl}
          />
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: SPACING.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  input: { flex: 1, paddingVertical: SPACING.sm, outlineStyle: 'none' } as never,
});
