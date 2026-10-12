import { usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { withAlpha } from '@/lib/color';
import { APP_NAME } from '@/config/app';
import { BOARD } from '@/config/layout';
import { archivedProjects, searchTasks, visibleProjects } from '@/domain/selectors';
import type { Project } from '@/domain/types';
import { pushUndo } from '@/features/undo';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useUiStore } from '@/store/uiStore';
import { syncNow } from '@/sync/controller';
import { FONT, SPACING, useTheme } from '@/theme';
import { ProjectDialog } from '../board/NameDialogs';
import { SearchResults } from '../board/SearchResults';
import { AppText } from '../ui/AppText';
import { DropdownMenu } from '../ui/DropdownMenu';
import { useFeedback } from '../ui/FeedbackProvider';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useSyncLabel } from './SyncIndicator';
import { BORDER_WIDTH } from '@/theme/tokens';

interface Props {
  width: number;
  /** 左上にメニューアイコンを出す（PCの常設メニュー）。スマホは画面上部のバーのアイコンを使うので出さない */
  showMenuIcon: boolean;
  /** メニューアイコンを押したとき（たたむ） */
  onToggle: () => void;
  /** 画面を移動したとき（スマホではメニューを閉じる） */
  onNavigate: () => void;
}

/** 左のメニュー: メニューアイコン+アプリ名、検索、プロジェクト一覧、新規作成、設定、同期状態。 */
export function Sidebar({ width, showMenuIcon, onToggle, onNavigate }: Props) {
  const { colors, fs, taskColor } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { confirm, toast } = useFeedback();
  const sync = useSyncLabel();
  const identity = useAuthStore((s) => s.identity);

  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const updateSettings = useSettingsStore((s) => s.update);
  const searchTick = useUiStore((s) => s.searchFocusTick);

  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const searchRef = useRef<TextInput>(null);
  const mountedTick = useRef(searchTick);

  useEffect(() => {
    if (searchTick !== mountedTick.current) searchRef.current?.focus();
  }, [searchTick]);

  const list = useMemo(() => visibleProjects(projects), [projects]);
  const favorites = list.filter((p) => p.isFavorite);
  const normals = list.filter((p) => !p.isFavorite);
  const archived = useMemo(() => archivedProjects(projects), [projects]);
  // プロジェクトごとのタスク数（削除・アーカイブ済みは含めない。DONEモードのタスクは含める）
  const taskCounts = useMemo(() => {
    const liveColumns = new Set(columns.filter((c) => c.deletedAt === null).map((c) => c.id));
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.deletedAt !== null || task.archivedAt !== null || !liveColumns.has(task.columnId)) continue;
      counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [columns, tasks]);
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
    if (currentId === p.id) router.replace('/home');
  };

  const row = (p: Project) => {
    // 選択中の行は、ホバー（薄いグレー）と区別できるよう文字色と背景を反転する
    const selected = currentId === p.id;
    const fg = selected ? colors.onPrimary : colors.text;
    return (
      <View key={p.id} style={[styles.item, { backgroundColor: selected ? colors.primary : 'transparent' }]}>
        <Pressable accessibilityRole="button" onPress={() => open(p.id)} style={styles.itemMain}>
          <View style={[styles.dot, { backgroundColor: p.color ? taskColor(p.color) : 'transparent', borderColor: p.color ? 'transparent' : selected ? colors.onPrimary : colors.border }]} />
          <AppText numberOfLines={1} ellipsizeMode="tail" bold={selected} color={fg} style={styles.flex}>
            {p.title}
          </AppText>
          <AppText variant="caption" color={selected ? colors.onPrimary : colors.textMuted}>
            {t('column.taskCount', { count: taskCounts.get(p.id) ?? 0 })}
          </AppText>
        </Pressable>
        <DropdownMenu
          items={[
            { label: t('project.edit'), icon: 'edit', onPress: () => setEditing(p) },
            { label: p.isFavorite ? t('common.unfavorite') : t('common.favorite'), icon: p.isFavorite ? 'unpin' : 'pin', onPress: () => void store.updateProject(p.id, { isFavorite: !p.isFavorite }) },
            { label: t('common.duplicate'), icon: 'copy', onPress: () => void store.duplicateProject(p.id) },
            { label: p.archivedAt ? t('project.unarchiveAction') : t('project.archiveAction'), icon: 'archive', onPress: () => void store.setProjectArchived(p.id, p.archivedAt === null) },
            { label: t('common.delete'), icon: 'trash', destructive: true, separator: true, onPress: () => void removeProject(p) },
          ]}
          trigger={(openMenu) => (
            <IconButton icon="more" label={p.title} color={fg} hoverColor={selected ? withAlpha(colors.onPrimary, 0.25) : undefined} onPress={openMenu} box={40} size={20} />
          )}
        />
      </View>
    );
  };

  return (
    <View style={[styles.root, { width, backgroundColor: colors.surface, borderRightColor: colors.border, }]}>
      {/* 画面上部のバーと同じ位置にメニューアイコンを置く（押すと閉じる） */}
      <View style={styles.brand}>
        {showMenuIcon ? <IconButton icon="menu" label={t('menu.open')} onPress={onToggle} /> : null}
        <AppText variant="title" numberOfLines={1} style={[styles.flex, !showMenuIcon && styles.brandName]}>
          {APP_NAME}
        </AppText>
      </View>

      <View style={[styles.search, { borderBottomColor: colors.divider }]}>
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

      <ScrollView style={styles.flex} keyboardShouldPersistTaps="handled" persistentScrollbar>
        {query.trim() ? (
          <SearchResults
            results={results}
            projects={projects}
            columns={columns}
            onPress={(task) => {
              open(task.projectId);
              setQuery('');
            }}
          />
        ) : (
          <View style={styles.listContent}>
            <AppText variant="label" muted style={styles.sectionTitle}>
              {t('menu.projects')}
            </AppText>
            {list.length === 0 ? (
              <AppText muted style={styles.hint}>
                {t('menu.noProjects')}
              </AppText>
            ) : null}
            {favorites.map(row)}
            {favorites.length > 0 && normals.length > 0 ? <View style={[styles.divider, { backgroundColor: colors.divider }]} /> : null}
            {normals.map(row)}

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                useUiStore.getState().requestNewProject();
                onNavigate();
              }}
              style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [styles.itemMain, { backgroundColor: pressed || hovered ? colors.hover : 'transparent' }]}
            >
              <Icon name="add" size={20} color={colors.textMuted} />
              <AppText muted numberOfLines={1} style={styles.flex}>
                {t('menu.newProject')}
              </AppText>
            </Pressable>

            {archived.length > 0 ? (
              <>
                <Pressable accessibilityRole="button" onPress={() => setShowArchived((v) => !v)} style={styles.archiveToggle}>
                  <Icon name={showArchived ? 'down' : 'right'} size={14} color={colors.textMuted} />
                  <AppText variant="caption" muted>
                    {t('menu.archivedProjects')} ({archived.length})
                  </AppText>
                </Pressable>
                {showArchived ? archived.map(row) : null}
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <View style={[styles.rule, { backgroundColor: colors.divider }]} />
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            // メニューは閉じない（戻ったときも開いたままの状態を保つ）
            router.push('/settings');
          }}
          style={styles.footerRow}
        >
          <Icon name="settings" size={20} color={colors.textMuted} />
          <AppText>{t('menu.settings')}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sync.enabled ? `${t('sync.now')} (${sync.label})` : sync.label}
          disabled={!sync.enabled}
          onPress={() => void syncNow()}
          style={styles.footerRow}
        >
          <Icon name={sync.icon} size={18} color={sync.color} />
          <AppText variant="caption" color={sync.color} numberOfLines={1} style={styles.flex}>
            {identity?.mode === 'guest' ? `${t('menu.guestBadge')} · ` : ''}
            {sync.label}
          </AppText>
        </Pressable>
      </View>

      <ProjectDialog
        visible={editing !== null}
        project={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const target = editing;
          setEditing(null);
          if (target) await store.updateProject(target.id, v);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { borderRightWidth: BORDER_WIDTH, flexShrink: 0 },
  flex: { flex: 1 },
  brandName: { paddingLeft: SPACING.sm + SPACING.xs },
  brand: { flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: SPACING.sm, gap: SPACING.xs, marginBottom: SPACING.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginHorizontal: SPACING.lg, borderBottomWidth: BORDER_WIDTH, minHeight: 44, marginBottom: SPACING.sm },
  searchInput: { flex: 1, paddingVertical: SPACING.sm, backgroundColor: 'transparent', outlineStyle: 'none' } as never,
  listContent: { paddingVertical: SPACING.sm },
  sectionTitle: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs },
  hint: { padding: SPACING.lg },
  item: { flexDirection: 'row', alignItems: 'center', paddingRight: 2 },
  itemMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: BOARD.touchTarget, paddingLeft: SPACING.lg, paddingRight: SPACING.sm },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: BORDER_WIDTH },
  divider: { height: BORDER_WIDTH, marginVertical: SPACING.xs, marginHorizontal: SPACING.lg },
  rule: { height: BORDER_WIDTH, marginHorizontal: SPACING.lg },
  archiveToggle: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, padding: SPACING.lg },
  footer: { paddingVertical: SPACING.xs },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md, minHeight: BOARD.touchTarget, paddingHorizontal: SPACING.lg },
});
