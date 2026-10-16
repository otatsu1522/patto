import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { searchTasks, visibleProjects } from '@/domain/selectors';
import type { Task } from '@/domain/types';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { RADIUS, SPACING, useTheme } from '@/theme';
import { BORDER_WIDTH } from '@/theme/tokens';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { Dialog } from '../ui/Dialog';
import { AppText } from '../ui/AppText';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { SearchResults } from './SearchResults';

interface Props {
  visible: boolean;
  initialProjectId?: string | null;
  onClose: () => void;
  onSelect: (task: Task) => void;
}

/** プロジェクトを選んで全タスクを検索するダイアログ。検索ロジックと候補表示は既存処理を利用する。 */
export function GlobalSearchDialog({ visible, initialProjectId = null, onClose, onSelect }: Props) {
  const { colors, fs } = useTheme();
  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    // Modal の表示直後に focus すると、モバイル OS がキーボード表示要求を捨てることがある。
    // 入力欄がマウントされ、Modal の遷移が終わった後にフォーカスする。
    focusTimerRef.current = setTimeout(() => {
      inputRef.current?.focus();
      focusTimerRef.current = null;
    }, 80);
  }, []);

  useEffect(() => {
    if (!visible) {
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
      return;
    }
    const focusFrame = requestAnimationFrame(focusSearchInput);
    const frame = requestAnimationFrame(() => {
      setProjectId(
        initialProjectId &&
          projectListRef.current.some((project) => project.id === initialProjectId)
          ? initialProjectId
          : null,
      );
      setQuery('');
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
      focusTimerRef.current = null;
    };
  }, [visible, initialProjectId, focusSearchInput]);

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
      wide
      fixedBody
    >
      <View
        style={[styles.searchField, { backgroundColor: colors.bg, borderColor: colors.border }]}
      >
        <Icon name="search" size={20} color={colors.textMuted} />
        <TextInput
          key={visible ? 'global-search-open' : 'global-search-closed'}
          ref={inputRef}
          showSoftInputOnFocus={visible}
          value={query}
          onChangeText={setQuery}
          placeholder={t('board.searchPlaceholder')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('board.searchPlaceholder')}
          returnKeyType="search"
          style={[styles.input, { color: colors.text, fontSize: fs(16) }]}
        />
        <IconButton
          icon="close"
          label={t('menu.searchClear')}
          onPress={() => setQuery('')}
          box={32}
          size={18}
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
                  borderColor: projectId === null ? colors.primary : colors.border,
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
                      borderColor: selected ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <AppText
                    variant="caption"
                    bold
                    numberOfLines={1}
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

const styles = StyleSheet.create({
  searchField: {
    minHeight: 44,
    borderWidth: BORDER_WIDTH,
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
    zIndex: 10,
    elevation: 10,
  },
  resultsContent: { flexGrow: 1 },
  filter: {
    minHeight: 32,
    maxWidth: 240,
    justifyContent: 'center',
    borderWidth: BORDER_WIDTH,
    borderRadius: 0,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
});
