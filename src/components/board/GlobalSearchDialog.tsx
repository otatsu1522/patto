import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { BOARD, UI_METRICS } from '@/config/layout';
import { searchTasks, visibleProjects } from '@/domain/selectors';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { RADIUS, SPACING, useTheme, ICON_SIZE, ICON_BUTTON_BOX, LAYER } from '@/theme';
import { FONT } from '@/theme/tokens';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { Dialog } from '../ui/Dialog';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { SearchResults } from './SearchResults';
import { useAuthInputFocus } from '../auth/AuthInputFocusContext';

interface Props {
  visible: boolean;
  initialProjectId?: string | null;
  onClose: () => void;
  onSelect: (task: Task) => void;
}

/** プロジェクトを選んで全タスクを検索するダイアログ。検索ロジックと候補表示は既存処理を利用する。 */
export function GlobalSearchDialog({ visible, initialProjectId = null, onClose, onSelect }: Props) {
  const { colors, fs, controlLineWidth, controlLineColor } = useTheme();
  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const projectList = useMemo(() => visibleProjects(projects), [projects]);
  const projectListRef = useRef(projectList);

  useEffect(() => {
    projectListRef.current = projectList;
  }, [projectList]);

  const resultsScrollRef = useWebWheelScroll({ touchScroll: true, touchAction: 'pan-y' });
  const results = useMemo(
    () => searchTasks({ projects, columns, tasks }, query, projectId ?? undefined),
    [projects, columns, tasks, query, projectId],
  );

  const focusSearchInput = useCallback(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      setProjectId(
        initialProjectId &&
          projectListRef.current.some((project) => project.id === initialProjectId)
          ? initialProjectId
          : null,
      );
      setQuery('');
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, initialProjectId]);

  const close = () => {
    setQuery('');
    setProjectId(null);
    onClose();
  };

  const selectTask = (task: Task) => {
    setQuery('');
    setProjectId(null);
    onSelect(task);
  };

  return (
    <Dialog
      visible={visible}
      title={t('menu.search')}
      onClose={close}
      onShow={focusSearchInput}
      fixedBody
    >
      <View
        style={[
          styles.searchField,
          {
            backgroundColor: colors.bg,
            borderColor: controlLineColor,
            borderWidth: controlLineWidth,
          },
        ]}
      >
        <Icon name="search" size={ICON_SIZE.xl} color={colors.textMuted} />
        <GlobalSearchInput
          key={visible ? 'global-search-open' : 'global-search-closed'}
          inputRef={inputRef}
          visible={visible}
          value={query}
          onChangeText={setQuery}
          placeholder={t('board.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('board.searchPlaceholder')}
          textColor={colors.text}
          fontSize={fs(FONT.bodyLarge)}
        />
        <IconButton
          icon="close"
          label={t('menu.searchClear')}
          onPress={() => setQuery('')}
          box={ICON_BUTTON_BOX.compact}
          size={ICON_SIZE.lg}
          color={colors.textMuted}
        />
      </View>

      <View style={styles.belowSearch}>
        <ScrollView
          style={styles.filterScroll}
          contentContainerStyle={styles.filterScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.filters}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: projectId === null }}
              onPress={() => setProjectId(null)}
              style={[
                styles.filter,
                {
                  backgroundColor: projectId === null ? colors.primary : 'transparent',
                  borderColor: projectId === null ? colors.primary : controlLineColor,
                  borderWidth: controlLineWidth,
                },
              ]}
            >
              <AppText
                variant="caption"
                bold
                color={projectId === null ? colors.onPrimary : colors.text}
              >
                {t('menu.searchAll')}
              </AppText>
            </Pressable>
            {projectList.map((project) => {
              const selected = projectId === project.id;
              return (
                <Pressable
                  key={project.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setProjectId(project.id)}
                  style={[
                    styles.filter,
                    {
                      backgroundColor: selected ? colors.primary : 'transparent',
                      borderColor: selected ? colors.primary : controlLineColor,
                      borderWidth: controlLineWidth,
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    bold
                    numberOfLines={UI_METRICS.text.singleLineMax}
                    color={selected ? colors.onPrimary : colors.text}
                  >
                    {project.title}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>

        {query.trim() ? (
          <ScrollView
            ref={resultsScrollRef}
            style={[styles.resultsScroll, { backgroundColor: colors.surface }]}
            contentContainerStyle={styles.resultsContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            <SearchResults
              results={results}
              projects={projects}
              columns={columns}
              onPress={selectTask}
            />
          </ScrollView>
        ) : null}
      </View>
    </Dialog>
  );
}

interface GlobalSearchInputProps {
  inputRef: RefObject<TextInput | null>;
  visible: boolean;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  placeholderTextColor: string;
  accessibilityLabel: string;
  textColor: string;
  fontSize: number;
}

/** Dialog 内でフォーカス通知を取得し、共通ダイアログのキーボード位置調整へ伝える。 */
function GlobalSearchInput({
  inputRef,
  visible,
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  accessibilityLabel,
  textColor,
  fontSize,
}: GlobalSearchInputProps) {
  const revealAuthInput = useAuthInputFocus();
  return (
    <TextInput
      ref={inputRef}
      onFocus={() => revealAuthInput?.(inputRef.current)}
      onBlur={() => revealAuthInput?.(null)}
      showSoftInputOnFocus={visible}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      accessibilityLabel={accessibilityLabel}
      returnKeyType="search"
      style={[styles.input, { color: textColor, fontSize }]}
    />
  );
}

const styles = StyleSheet.create({
  searchField: {
    minHeight: BOARD.touchTarget,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
  },
  input: {
    flex: 1,
    minWidth: 0,
    paddingVertical: SPACING.sm,
    backgroundColor: 'transparent',
    outlineStyle: 'none',
  } as never,
  belowSearch: { flex: 1, minHeight: 0, position: 'relative' },
  filterScroll: { flex: 1, minHeight: 0 },
  filterScrollContent: { paddingBottom: SPACING.xs },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  resultsScroll: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: LAYER.searchResults,
    elevation: LAYER.searchResults,
  },
  resultsContent: { flexGrow: 1 },
  filter: {
    minHeight: UI_METRICS.search.filterChipMinHeight,
    maxWidth: UI_METRICS.search.filterChipMaxWidth,
    justifyContent: 'center',
    borderRadius: RADIUS.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
});
