import { usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { APP_NAME } from '@/config/app';
import { BOARD } from '@/config/layout';
import { archivedProjects, searchTasks, visibleProjects } from '@/domain/selectors';
import type { Project } from '@/domain/types';
import { useLayoutMode } from '@/hooks/useLayout';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { FONT, RADIUS, SPACING, useTheme } from '@/theme';
import { TASK_COLORS } from '@/theme/taskColors';
import { pushUndo } from '@/features/undo';
import { ProjectDialog } from '../board/NameDialogs';
import { AppText } from '../ui/AppText';
import { DropdownMenu } from '../ui/DropdownMenu';
import { useFeedback } from '../ui/FeedbackProvider';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Logo } from '../ui/Logo';
import { useSyncLabel } from './SyncIndicator';

/** 左のメニュー: アプリ名、検索、プロジェクト一覧、新規追加、設定。 */
export function Sidebar({ onNavigate }: { onNavigate: () => void }) {
  const { colors, fs } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useLayoutMode();
  const { confirm, toast } = useFeedback();
  const sync = useSyncLabel();
  const identity = useAuthStore((s) => s.identity);

  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const updateSettings = useSettingsStore((s) => s.update);
  const searchTick = useUiStore((s) => s.searchFocusTick);
  const toggleCollapsed = useUiStore((s) => s.toggleSidebarCollapsed);

  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<{ project: Project | null } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<TextInput>(null);

  const mountedTick = useRef(searchTick);
  useEffect(() => {
    if (searchTick !== mountedTick.current) searchRef.current?.focus();
  }, [searchTick]);

  const list = useMemo(() => visibleProjects(projects), [projects]);
  const archived = useMemo(() => archivedProjects(projects), [projects]);
  const results = useMemo(() => searchTasks({ projects, columns, tasks }, query), [projects, columns, tasks, query]);
  const currentId = pathname.startsWith('/project/') ? pathname.split('/')[2] : null;

  const open = (id: string) => {
    updateSettings({ lastProjectId: id });
    router.push({ pathname: '/project/[id]', params: { id } });
    onNavigate();
  };

  const store = useDataStore.getState();

  const removeProject = async (p: Project) => {
    const r = await confirm({ title: t('project.deleteTitle'), message: t('project.deleteMessage', { name: p.title }), confirmLabel: t('common.delete'), destructive: true });
    if (r !== 'confirm') return;
    await store.deleteProject(p.id);
    const undo = pushUndo(() => store.restoreItem('project', p.id));
    toast(t('board.undoDeleted'), { label: t('common.undo'), onPress: () => void undo() });
    if (currentId === p.id) router.replace('/');
  };

  const row = (p: Project) => (
    <View key={p.id} style={[styles.item, { backgroundColor: currentId === p.id ? colors.column : 'transparent' }]}>
      <Pressable accessibilityRole="button" onPress={() => open(p.id)} style={styles.itemMain}>
        <View style={[styles.dot, { backgroundColor: p.color ? TASK_COLORS[p.color] : colors.border }]} />
        <AppText numberOfLines={1} bold={currentId === p.id} style={styles.flex}>
          {p.title}
        </AppText>
        {p.isFavorite ? <Icon name="star" size={14} color={colors.accent} /> : null}
      </Pressable>
      <DropdownMenu
        items={[
          { label: t('common.edit'), icon: 'edit', onPress: () => setDialog({ project: p }) },
          { label: p.isFavorite ? t('common.unfavorite') : t('common.favorite'), icon: p.isFavorite ? 'starOutline' : 'star', onPress: () => void store.updateProject(p.id, { isFavorite: !p.isFavorite }) },
          { label: t('common.duplicate'), icon: 'copy', onPress: () => void store.duplicateProject(p.id) },
          { label: p.archivedAt ? t('project.unarchiveAction') : t('project.archiveAction'), icon: 'archive', onPress: () => void store.setProjectArchived(p.id, p.archivedAt === null) },
          { label: t('common.delete'), icon: 'trash', destructive: true, separator: true, onPress: () => void removeProject(p) },
        ]}
        trigger={(openMenu) => <IconButton icon="more" label={p.title} onPress={openMenu} box={36} size={18} />}
      />
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.surface, borderRightColor: colors.border }]}>
      <View style={styles.brand}>
        <Logo size={32} />
        <AppText variant="title" style={styles.flex}>
          {APP_NAME}
        </AppText>
        {mode === 'expanded' ? <IconButton icon="back" label={t('menu.open')} onPress={toggleCollapsed} box={36} /> : null}
      </View>

      <View style={[styles.search, { backgroundColor: colors.column, borderColor: colors.border }]}>
        <Icon name="search" size={18} color={colors.textMuted} />
        <TextInput
          ref={searchRef}
          value={query}
          onChangeText={setQuery}
          placeholder={t('menu.search')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('menu.search')}
          style={[styles.searchInput, { color: colors.text, fontSize: fs(FONT.body) }]}
        />
        {query ? <IconButton icon="close" label={t('common.close')} onPress={() => setQuery('')} box={32} size={16} /> : null}
      </View>

      <ScrollView style={styles.flex} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
        {query.trim() ? (
          results.length === 0 ? (
            <AppText muted style={styles.hint}>
              {t('menu.searchEmpty')}
            </AppText>
          ) : (
            results.map((task) => (
              <Pressable
                key={task.id}
                accessibilityRole="button"
                onPress={() => {
                  open(task.projectId);
                  setQuery('');
                }}
                style={styles.result}
              >
                <AppText numberOfLines={1}>{task.title}</AppText>
                <AppText variant="caption" muted numberOfLines={1}>
                  {projects.find((p) => p.id === task.projectId)?.title}
                </AppText>
              </Pressable>
            ))
          )
        ) : (
          <>
            <AppText variant="label" muted style={styles.sectionTitle}>
              {t('menu.projects')}
            </AppText>
            {list.length === 0 ? (
              <AppText muted style={styles.hint}>
                {t('menu.noProjects')}
              </AppText>
            ) : (
              list.map(row)
            )}
            {archived.length > 0 ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => setShowArchived((v) => !v)} style={styles.archiveToggle}>
                  <Icon name={showArchived ? 'left' : 'right'} size={14} color={colors.textMuted} />
                  <AppText variant="caption" muted>
                    {t('menu.archivedProjects')} ({archived.length})
                  </AppText>
                </Pressable>
                {showArchived ? archived.map(row) : null}
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable accessibilityRole="button" onPress={() => {
            useUiStore.getState().requestNewProject();
            onNavigate();
          }}
          style={styles.footerRow}>
          <Icon name="add" size={20} color={colors.primary} />
          <AppText color={colors.primary} bold>
            {t('menu.newProject')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            router.push('/settings');
            onNavigate();
          }}
          style={styles.footerRow}
        >
          <Icon name="settings" size={20} color={colors.textMuted} />
          <AppText>{t('menu.settings')}</AppText>
        </Pressable>
        <View style={styles.status}>
          <Icon name={sync.icon} size={14} color={sync.color} />
          <AppText variant="caption" color={sync.color} numberOfLines={1} style={styles.flex}>
            {identity?.mode === 'guest' ? `${t('menu.guestBadge')} · ` : ''}
            {sync.label}
          </AppText>
        </View>
      </View>

      <ProjectDialog
        visible={dialog !== null}
        project={dialog?.project ?? null}
        onClose={() => setDialog(null)}
        onSubmit={async (v) => {
          const editing = dialog?.project;
          setDialog(null);
          if (editing) await store.updateProject(editing.id, v);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: BOARD.sidebarWidth, maxWidth: '100%', flex: 1, borderRightWidth: StyleSheet.hairlineWidth },
  flex: { flex: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, padding: SPACING.lg, paddingBottom: SPACING.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.md, paddingLeft: SPACING.md, borderRadius: RADIUS.md, borderWidth: 1, minHeight: 40 },
  searchInput: { flex: 1, paddingVertical: SPACING.sm, outlineStyle: 'none' } as never,
  listContent: { padding: SPACING.md, gap: 2 },
  sectionTitle: { paddingHorizontal: SPACING.sm, paddingVertical: SPACING.xs },
  hint: { padding: SPACING.md },
  item: { flexDirection: 'row', alignItems: 'center', borderRadius: RADIUS.md, paddingRight: 2 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, minHeight: BOARD.touchTarget, paddingLeft: SPACING.md },
  dot: { width: 10, height: 10, borderRadius: 5 },
  result: { paddingVertical: SPACING.sm, paddingHorizontal: SPACING.md, minHeight: BOARD.touchTarget, justifyContent: 'center' },
  archiveToggle: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, padding: SPACING.md },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, padding: SPACING.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: BOARD.touchTarget, paddingHorizontal: SPACING.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, paddingHorizontal: SPACING.md, paddingVertical: SPACING.xs },
});
