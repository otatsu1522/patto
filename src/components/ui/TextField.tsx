import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { FONT, RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { BORDER_WIDTH } from '@/theme/tokens';
import { useAuthInputFocus } from '../auth/AuthInputFocusContext';

interface Props extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  secure?: boolean;
  /** 固定行数ではなく、表示上の折り返しに合わせて高さを伸ばす。 */
  autoGrow?: boolean;
  /** 複数行入力の行数 */
  lines?: number;
  /** 指定すると、入力があるときに右端に×を出し、押すとこれを呼ぶ（クリア用） */
  onClear?: () => void;
}

export const TextField = forwardRef<TextInput, Props>(function TextField(
  {
    label,
    error,
    secure,
    lines,
    autoGrow = false,
    onClear,
    onFocus,
    onBlur,
    onContentSizeChange,
    onSubmitEditing,
    ...rest
  },
  ref,
) {
  const { colors, fs } = useTheme();
  const { height: windowHeight } = useWindowDimensions();
  const [hidden, setHidden] = useState(true);
  const [measuredContentHeight, setMeasuredContentHeight] = useState<number | null>(null);
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
  const autoGrowMinHeight = Math.max(BOARD.touchTarget - 2, fs(FONT.body) * 1.5 + SPACING.sm * 2);
  const visibleHeight = Math.min(windowHeight, keyboardAvailableHeight ?? windowHeight);
  // 入力欄自体が画面／キーボードの高さを占有しないよう、表示領域の一部を上限にする。
  const autoGrowMaxHeight = Math.max(autoGrowMinHeight, Math.min(320, visibleHeight * 0.36));
  const autoGrowHeight = Math.min(
    autoGrowMaxHeight,
    Math.max(autoGrowMinHeight, measuredContentHeight ?? autoGrowMinHeight),
  );

  useEffect(() => {
    if (!autoGrow) return;

    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') return;
      const viewport = window.visualViewport;
      if (!viewport) return;
      const updateViewportHeight = () => {
        const keyboardOpen = viewport.height < window.innerHeight - 80;
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
          { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface },
        ]}
      >
        <TextInput
          ref={setInputRef}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && hidden}
          multiline={multiline}
          numberOfLines={autoGrow ? undefined : lines}
          {...rest}
          blurOnSubmit={autoGrow && Platform.OS === 'web' ? true : rest.blurOnSubmit}
          submitBehavior={autoGrow ? 'submit' : rest.submitBehavior}
          onContentSizeChange={(event) => {
            onContentSizeChange?.(event);
            if (!autoGrow) return;
            setMeasuredContentHeight(event.nativeEvent.contentSize.height);
            // 入力文字の折り返しで高さが変わった後も、入力欄を表示領域内に保つ。
            revealAuthInput?.(inputRef.current);
          }}
          onSubmitEditing={(event) => {
            onSubmitEditing?.(event);
            if (autoGrow) inputRef.current?.blur();
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
                    height: autoGrowHeight,
                    minHeight: autoGrowMinHeight,
                    maxHeight: autoGrowMaxHeight,
                  }
                : multiline
                  ? {
                      height: fs(FONT.body) * 1.5 * (lines ?? 1) + SPACING.sm * 2,
                      minHeight: fs(FONT.body) * 1.5 * (lines ?? 1) + SPACING.sm * 2,
                      maxHeight: fs(FONT.body) * 1.5 * (lines ?? 1) + SPACING.sm * 2,
                    }
                  : { minHeight: BOARD.touchTarget - 2 }),
            },
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
            box={32}
            size={18}
            color={colors.textMuted}
          />
        ) : null}
        {secure ? (
          <IconButton
            icon={hidden ? 'eye' : 'eyeOff'}
            label={hidden ? t('auth.showPassword') : t('auth.hidePassword')}
            onPress={() => setHidden((v) => !v)}
            box={36}
            size={20}
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
    borderWidth: BORDER_WIDTH,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
  },
  input: { flex: 1, paddingVertical: SPACING.sm, outlineStyle: 'none' } as never,
});
