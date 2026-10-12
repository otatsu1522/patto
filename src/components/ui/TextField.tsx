import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { BOARD } from '@/config/layout';
import { t } from '@/i18n';
import { FONT, RADIUS, SPACING, useTheme } from '@/theme';
import { AppText } from './AppText';
import { IconButton } from './IconButton';
import { BORDER_WIDTH } from '@/theme/tokens';

interface Props extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  secure?: boolean;
  /** 複数行入力の行数 */
  lines?: number;
}

export const TextField = forwardRef<TextInput, Props>(function TextField(
  { label, error, secure, lines, ...rest },
  ref,
) {
  const { colors, fs } = useTheme();
  const [hidden, setHidden] = useState(true);
  const multiline = (lines ?? 1) > 1;
  return (
    <View style={styles.wrap}>
      {label ? (
        <AppText variant="label" muted>
          {label}
        </AppText>
      ) : null}
      <View style={[styles.box, { borderColor: error ? colors.danger : colors.border, backgroundColor: colors.surface }]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.textMuted}
          secureTextEntry={secure && hidden}
          multiline={multiline}
          numberOfLines={lines}
          {...rest}
          style={[
            styles.input,
            { color: colors.text, fontSize: fs(FONT.body), minHeight: multiline ? fs(FONT.body) * 1.5 * (lines ?? 1) + SPACING.md : BOARD.touchTarget - 2 },
            multiline && { textAlignVertical: 'top' },
          ]}
        />
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
  box: { flexDirection: 'row', alignItems: 'center', borderWidth: BORDER_WIDTH, borderRadius: RADIUS.md, paddingHorizontal: SPACING.md },
  input: { flex: 1, paddingVertical: SPACING.sm, outlineStyle: 'none' } as never,
});
