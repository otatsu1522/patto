import { usePathname, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useAuthStore } from '@/auth/authStore';
import { withAlpha } from '@/lib/color';
import { APP_NAME } from '@/config/app';
import { BOARD, GESTURE, UI_METRICS } from '@/config/layout';
import { archivedProjects, visibleProjects } from '@/domain/selectors';
import type { Project } from '@/domain/types';
import { UserActionError } from '@/domain/operationError';
import { clearBucket } from '@/features/maintenance';
import { showUndoToast } from '@/features/undo';
import { useManualSync } from '@/hooks/useManualSync';
import { useProjectNavigation } from '@/hooks/useProjectNavigation';
import { useLayoutMode } from '@/hooks/useLayout';
import { closeSettingsMenu, requestSettingsMenuCloseAfterRender } from '@/hooks/settingsMenu';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { t } from '@/i18n';
import { useDataStore } from '@/store/dataStore';
import { useUiStore } from '@/store/uiStore';
import { FONT, SPACING, useTheme, ICON_SIZE, ICON_BUTTON_BOX, LAYER, OPACITY } from '@/theme';
import { ProjectDialog } from '../board/NameDialogs';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { useFeedback } from '../ui/FeedbackProvider';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useSyncLabel } from './SyncIndicator';
import { canHover, isTouchWeb } from '@/lib/hover';

interface Props {
  width: number;
  /** 左上にメニューアイコンを出す（PCの常設メニュー）。スマホは画面上部のバーのアイコンを使うので出さない */
  showMenuIcon: boolean;
  /** メニューアイコンを押したとき（たたむ） */
  onToggle: () => void;
  /** スマホ Web のメニュー内で右から左へスワイプしたときの閉じる処理 */
  onSwipeClose?: () => void;
}

/** 左のメニュー: メニューアイコン+アプリ名、プロジェクト一覧、新規作成、検索、設定、同期状態。 */
export function Sidebar({ width, showMenuIcon, onToggle, onSwipeClose }: Props) {
  const { colors, taskColor, fs, lineWidth, lineColor } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const { mode } = useLayoutMode();
  const { confirm, toast, alert } = useFeedback();
  const syncManually = useManualSync();
  const sync = useSyncLabel();
  const identity = useAuthStore((s) => s.identity);

  const projects = useDataStore((s) => s.projects);
  const columns = useDataStore((s) => s.columns);
  const tasks = useDataStore((s) => s.tasks);
  const [editing, setEditing] = useState<Project | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const projectScrollRef = useWebWheelScroll({ touchScroll: true, touchAction: 'pan-y' });
  const onSwipeCloseRef = useRef(onSwipeClose);
  useEffect(() => {
    onSwipeCloseRef.current = onSwipeClose;
  }, [onSwipeClose]);

  // React Native Web の子 ScrollView 上では synthetic touch の座標が欠けることがあるため、
  // スマホ Web では document の capture フェーズでドロワー内の実タッチを追跡する。
  useEffect(() => {
    if (!isTouchWeb || typeof document === 'undefined') return;

    let start: { x: number; y: number; lastX: number; lastY: number } | null = null;
    const isDrawerTarget = (target: EventTarget | null) =>
      target instanceof Element && target.closest('#patto-mobile-sidebar') !== null;

    const onTouchStart = (event: TouchEvent) => {
      if (!onSwipeCloseRef.current || !isDrawerTarget(event.target) || event.touches.length !== 1) {
        start = null;
        return;
      }
      const touch = event.touches[0];
      start = { x: touch.clientX, y: touch.clientY, lastX: touch.clientX, lastY: touch.clientY };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!start || event.touches.length !== 1) return;
      const touch = event.touches[0];
      start.lastX = touch.clientX;
      start.lastY = touch.clientY;
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!start) return;
      const touch = event.changedTouches[0];
      const endX = touch?.clientX ?? start.lastX;
      const endY = touch?.clientY ?? start.lastY;
      const dx = endX - start.x;
      const dy = endY - start.y;
      start = null;
      if (
        dx <= -GESTURE.drawerCloseDistancePx &&
        Math.abs(dx) > Math.abs(dy) * GESTURE.drawerHorizontalIntentRatio
      )
        onSwipeCloseRef.current?.();
    };

    const onTouchCancel = () => {
      start = null;
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: true });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', onTouchCancel, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', onTouchCancel, true);
    };
  }, []);

  const list = useMemo(() => visibleProjects(projects), [projects]);
  const favorites = list.filter((p) => p.isFavorite);
  const normals = list.filter((p) => !p.isFavorite);
  const archived = useMemo(() => archivedProjects(projects), [projects]);
  const trashedProjects = useMemo(
    () =>
      projects
        .filter((p) => p.deletedAt !== null)
        .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [projects],
  );
  // プロジェクトごとのタスク数（削除・アーカイブ済みは含めない。DONEモードのタスクは含める）
  const taskCounts = useMemo(() => {
    const liveColumns = new Set(columns.filter((c) => c.deletedAt === null).map((c) => c.id));
    const counts = new Map<string, number>();
    for (const task of tasks) {
      if (task.deletedAt !== null || task.archivedAt !== null || !liveColumns.has(task.columnId))
        continue;
      counts.set(task.projectId, (counts.get(task.projectId) ?? 0) + 1);
    }
    return counts;
  }, [columns, tasks]);
  const currentId = pathname.startsWith('/project/') ? pathname.split('/')[2] : null;
  const settingsSelected = pathname.startsWith('/settings');

  const open = useProjectNavigation();

  const store = useDataStore.getState();

  const duplicateProject = async (p: Project) => {
    try {
      const copied = await useDataStore.getState().duplicateProject(p.id);
      if (copied) {
        showUndoToast(
          toast,
          t('toast.duplicated'),
          () => useDataStore.getState().deleteProject(copied.id),
          'editing',
        );
      }
    } catch (error) {
      alert(
        t('common.error'),
        error instanceof UserActionError ? error.message : t('operation.duplicateFailed'),
      );
    }
  };

  const removeProject = async (p: Project) => {
    const r = await confirm({
      title: t('project.deleteTitle'),
      message: t('project.deleteMessage', { name: p.title }),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (r !== 'confirm') return;
    await store.deleteProject(p.id);
    showUndoToast(
      toast,
      t('board.undoDeleted'),
      () => useDataStore.getState().restoreItem('project', p.id),
      'editing',
    );
    // 選択中のプロジェクトを削除してもルートを変えない。BoardViewを維持し、
    // メニューは開いたまま、右側の内容だけを空にする。
  };

  const restoreTrashedProject = async (p: Project) => {
    try {
      await useDataStore.getState().restoreItem('project', p.id);
      toast(t('project.restoreDone'), undefined, { category: 'editing' });
    } catch {
      alert(t('common.error'), t('project.restoreTrashFailed'));
    }
  };

  const permanentlyDeleteTrashedProject = async (p: Project) => {
    const answer = await confirm({
      title: t('project.permanentDeleteTitle'),
      message: t('project.permanentDeleteMessage', { name: p.title }),
      confirmLabel: t('settings.clearPermanently'),
      destructive: true,
    });
    if (answer !== 'confirm') return;

    try {
      const result = await clearBucket('trash', p.id, true);
      if (!result.ok) {
        alert(t('common.error'), result.message);
        return;
      }
      if (result.count === 0) return;
      toast(t('project.permanentDeleteDone'), undefined, { category: 'system' });
    } catch {
      alert(t('common.error'), t('project.permanentDeleteFailed'));
    }
  };

  const row = (p: Project) => {
    // 選択中の行は、ホバー（薄いグレー）と区別できるよう文字色と背景を反転する
    const selected = currentId === p.id;
    const fg = selected ? colors.onPrimary : colors.text;
    const archiveMenuItem: MenuItem = {
      label: p.archivedAt ? t('project.unarchiveAction') : t('project.archiveAction'),
      icon: 'archive',
      onPress: () => {
        const previousArchivedAt = p.archivedAt;
        const archived = previousArchivedAt === null;
        void (async () => {
          await useDataStore.getState().setProjectArchived(p.id, archived);
          showUndoToast(
            toast,
            t(archived ? 'toast.projectArchived' : 'toast.projectUnarchived'),
            () => useDataStore.getState().updateProject(p.id, { archivedAt: previousArchivedAt }),
            'editing',
          );
        })();
      },
    };
    const deleteMenuItem: MenuItem = {
      label: t('common.delete'),
      icon: 'trash',
      destructive: true,
      separator: true,
      onPress: () => void removeProject(p),
    };
    const menuItems: MenuItem[] = p.archivedAt
      ? [archiveMenuItem, deleteMenuItem]
      : [
          { label: t('project.edit'), icon: 'edit', onPress: () => setEditing(p) },
          {
            label: p.isFavorite ? t('common.unfavorite') : t('common.favorite'),
            icon: p.isFavorite ? 'unpin' : 'pin',
            onPress: () => {
              const isFavorite = !p.isFavorite;
              void (async () => {
                await useDataStore.getState().updateProject(p.id, { isFavorite });
                showUndoToast(
                  toast,
                  t(isFavorite ? 'toast.pinned' : 'toast.unpinned'),
                  () => useDataStore.getState().updateProject(p.id, { isFavorite: p.isFavorite }),
                  'editing',
                );
              })();
            },
          },
          {
            label: t('common.duplicate'),
            icon: 'copy',
            separator: true,
            onPress: () => void duplicateProject(p),
          },
          archiveMenuItem,
          deleteMenuItem,
        ];
    return (
      <View
        key={p.id}
        style={[styles.item, { backgroundColor: selected ? colors.primary : 'transparent' }]}
      >
        <Pressable accessibilityRole="button" onPress={() => open(p.id)} style={styles.itemMain}>
          <View
            style={[
              styles.dot,
              {
                backgroundColor: p.color ? taskColor(p.color) : 'transparent',
                borderColor: p.color ? 'transparent' : colors.border,
                borderWidth: lineWidth,
              },
            ]}
          />
          <AppText
            numberOfLines={UI_METRICS.text.singleLineMax}
            ellipsizeMode="tail"
            bold
            color={fg}
            style={styles.projectTitle}
          >
            {p.title}
          </AppText>
          <AppText variant="caption" bold color={selected ? colors.onPrimary : colors.textMuted}>
            {t('column.taskCount', { count: taskCounts.get(p.id) ?? 0 })}
          </AppText>
        </Pressable>
        <DropdownMenu
          items={menuItems}
          trigger={(openMenu) => (
            <IconButton
              icon="more"
              label={p.title}
              color={fg}
              hoverColor={selected ? withAlpha(colors.onPrimary, OPACITY.hoverOverlay) : undefined}
              onPress={openMenu}
              box={ICON_BUTTON_BOX.large}
              size={ICON_SIZE.xl}
            />
          )}
        />
      </View>
    );
  };

  const trashedProjectRow = (p: Project) => (
    <View key={p.id} style={[styles.item, { backgroundColor: 'transparent' }]}>
      <View style={styles.itemMain}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor: p.color ? taskColor(p.color) : 'transparent',
              borderColor: p.color ? 'transparent' : colors.border,
              borderWidth: lineWidth,
            },
          ]}
        />
        <AppText
          numberOfLines={UI_METRICS.text.singleLineMax}
          ellipsizeMode="tail"
          bold
          color={colors.text}
          style={styles.projectTitle}
        >
          {p.title}
        </AppText>
      </View>
      <DropdownMenu
        items={[
          {
            label: t('common.undo'),
            icon: 'restore',
            onPress: () => void restoreTrashedProject(p),
          },
          {
            label: t('settings.clearPermanently'),
            icon: 'deleteForever',
            destructive: true,
            separator: true,
            onPress: () => void permanentlyDeleteTrashedProject(p),
          },
        ]}
        trigger={(openMenu) => (
          <IconButton
            icon="more"
            label={p.title}
            color={colors.textMuted}
            onPress={openMenu}
            box={ICON_BUTTON_BOX.large}
            size={ICON_SIZE.xl}
          />
        )}
      />
    </View>
  );

  return (
    <View
      nativeID="patto-mobile-sidebar"
      style={[
        styles.root,
        { width, backgroundColor: colors.surface },
        // ネイティブは初期 ZIP の右境界線を使用する。独立線は Web のみ。
        Platform.OS !== 'web'
          ? { borderRightColor: lineColor, borderRightWidth: lineWidth }
          : undefined,
      ]}
    >
      {/* 画面上部のバーと同じ位置にメニューアイコンを置く（押すと閉じる） */}
      <View style={styles.brand}>
        {showMenuIcon ? (
          <IconButton icon="panelLeft" label={t('menu.toggle')} onPress={onToggle} />
        ) : null}
        <AppText
          variant="title"
          numberOfLines={UI_METRICS.text.singleLineMax}
          style={[styles.flex, { fontSize: fs(FONT.headline) }, !showMenuIcon && styles.brandName]}
        >
          {APP_NAME}
        </AppText>
        <IconButton
          icon="search"
          label={t('menu.search')}
          onPress={() => useUiStore.getState().setGlobalSearchOpen(true)}
          box={ICON_BUTTON_BOX.large}
          size={ICON_SIZE.xl}
        />
      </View>

      <ScrollView
        ref={projectScrollRef}
        style={[
          styles.projectScroll,
          styles.flex,
          Platform.OS === 'web'
            ? ({
                overflowY: 'auto',
                overscrollBehaviorY: 'contain',
                // 右端の縁マスク（lineWidth + 1px）にプロジェクト一覧のスクロールバーが隠れないよう、
                // Web ではスクロール領域そのものを内側へずらす。
                marginRight: lineWidth + 1,
              } as never)
            : undefined,
        ]}
        contentContainerStyle={styles.projectScrollContent}
        keyboardShouldPersistTaps="handled"
        persistentScrollbar
      >
        <View style={styles.listContent}>
          {list.length === 0 ? (
            <AppText muted style={styles.hint}>
              {t('menu.noProjects')}
            </AppText>
          ) : null}
          {favorites.map(row)}
          {favorites.length > 0 && normals.length > 0 ? (
            <View
              style={[
                styles.divider,
                {
                  backgroundColor: lineColor,
                  height: lineWidth,
                  minHeight: lineWidth,
                  maxHeight: lineWidth,
                },
              ]}
            />
          ) : null}
          {normals.map(row)}

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              useUiStore.getState().requestNewProject();
            }}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.itemMain,
              {
                backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent',
              },
            ]}
          >
            <Icon name="add" size={ICON_SIZE.xl} color={colors.textMuted} />
            <AppText muted numberOfLines={UI_METRICS.text.singleLineMax} style={styles.flex}>
              {t('menu.newProject')}
            </AppText>
          </Pressable>

          {archived.length > 0 ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowArchived((v) => !v)}
                style={styles.archiveToggle}
              >
                <View style={styles.archiveToggleIconSlot}>
                  <Icon
                    name={showArchived ? 'down' : 'right'}
                    size={ICON_SIZE.sm}
                    color={colors.textMuted}
                  />
                </View>
                <AppText variant="caption" muted>
                  {t('menu.archivedProjectsCount', { count: archived.length })}
                </AppText>
              </Pressable>
              {showArchived ? archived.map(row) : null}
            </>
          ) : null}
          {trashedProjects.length > 0 ? (
            <>
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowTrash((v) => !v)}
                style={styles.archiveToggle}
              >
                <View style={styles.archiveToggleIconSlot}>
                  <Icon
                    name={showTrash ? 'down' : 'right'}
                    size={ICON_SIZE.sm}
                    color={colors.textMuted}
                  />
                </View>
                <AppText variant="caption" muted>
                  {t('menu.trashProjectsCount', { count: trashedProjects.length })}
                </AppText>
              </Pressable>
              {showTrash ? trashedProjects.map(trashedProjectRow) : null}
            </>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.rule, { backgroundColor: lineColor, height: lineWidth }]} />
      <View style={styles.footer}>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            if (mode === 'expanded') {
              router.navigate('/settings');
              return;
            }

            if (pathname.startsWith('/settings')) {
              if (pathname === '/settings') {
                // すでに設定トップなら内容は変わらないため、メニューだけを閉じる。
                closeSettingsMenu();
                return;
              }
              // 設定内の下層画面からトップへ戻す場合も、トップ表示後にメニューを閉じる。
              requestSettingsMenuCloseAfterRender('/settings');
              router.replace('/settings');
              return;
            }
            // プロジェクトを履歴に残さず、設定内容を表示してからメニューを閉じる。
            requestSettingsMenuCloseAfterRender('/settings');
            router.replace('/settings');
          }}
          style={[
            styles.footerRow,
            { backgroundColor: settingsSelected ? colors.primary : 'transparent' },
          ]}
        >
          <Icon
            name="settings"
            size={ICON_SIZE.xl}
            color={settingsSelected ? colors.onPrimary : colors.text}
          />
          <AppText color={settingsSelected ? colors.onPrimary : colors.text}>
            {t('menu.settings')}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            sync.enabled
              ? `${t('sync.now')} (${sync.label}${sync.pendingLabel ? ` (${sync.pendingLabel})` : ''})`
              : sync.label
          }
          disabled={!sync.enabled}
          onPress={() => void syncManually()}
          style={styles.footerRow}
        >
          <Icon name={sync.icon} size={ICON_SIZE.xl} color={sync.color} />
          <View style={styles.syncTextRow}>
            <AppText
              color={sync.color}
              numberOfLines={UI_METRICS.text.singleLineMax}
              style={styles.syncPrimaryLabel}
            >
              {identity?.mode === 'guest' ? `${t('menu.guestBadge')} · ` : ''}
              {sync.label}
            </AppText>
            {sync.pendingLabel ? (
              <AppText muted numberOfLines={1} style={styles.syncPendingLabel}>
                ({sync.pendingLabel})
              </AppText>
            ) : null}
          </View>
        </Pressable>
      </View>

      <ProjectDialog
        visible={editing !== null}
        project={editing}
        onClose={() => setEditing(null)}
        onSubmit={async (v) => {
          const target = editing;
          setEditing(null);
          if (target) {
            await useDataStore.getState().updateProject(target.id, v);
            showUndoToast(
              toast,
              t('toast.projectUpdated'),
              () =>
                useDataStore.getState().updateProject(target.id, {
                  title: target.title,
                  description: target.description,
                  color: target.color,
                }),
              'editing',
            );
          }
        }}
      />
      {Platform.OS === 'web' ? (
        <View
          pointerEvents="none"
          style={[styles.rightEdge, { backgroundColor: colors.surface, width: lineWidth + 1 }]}
        >
          <View style={[styles.rightEdgeLine, { backgroundColor: lineColor, width: lineWidth }]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexShrink: 0, height: '100%', minHeight: 0 },
  // 縦線はサイドバー自身のスクロールレイヤー内に置き、開閉スクロールと同じタイミングで移動させる。
  rightEdge: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    zIndex: LAYER.sidebarEdge,
    elevation: LAYER.sidebarEdge,
  },
  rightEdgeLine: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
  },
  flex: { flex: 1, minHeight: 0 },
  projectScroll: { flex: 1, minHeight: 0 },
  projectScrollContent: { flexGrow: 1 },
  projectTitle: { flexShrink: 1, minWidth: 0 },
  brandName: { paddingLeft: SPACING.sm + SPACING.xs },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    height: BOARD.headerHeight,
    paddingHorizontal: SPACING.sm,
    gap: SPACING.xs,
  },
  listContent: { paddingBottom: SPACING.xs },
  sectionTitle: { paddingHorizontal: SPACING.lg, paddingVertical: SPACING.xs },
  hint: { padding: SPACING.lg },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: UI_METRICS.board.sidebarItemRightPadding,
  },
  itemMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: BOARD.touchTarget,
    paddingLeft: SPACING.lg,
    paddingRight: SPACING.sm,
  },
  dot: {
    width: UI_METRICS.board.colorDotSize,
    height: UI_METRICS.board.colorDotSize,
    borderRadius: UI_METRICS.board.colorDotSize / 2,
  },
  divider: {
    width: UI_METRICS.board.pinnedDividerWidth,
    alignSelf: 'center',
    flexShrink: 0,
    marginVertical: SPACING.xs,
  },
  // 設定項目の直前に置く区切り線。上側の余白はなくし、下側のみ従来の余白を残す。
  rule: { marginTop: 0, marginBottom: SPACING.xs, marginHorizontal: 0 },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
  },
  archiveToggleIconSlot: {
    width: ICON_SIZE.xl,
    alignItems: 'center',
  },
  footer: { paddingTop: 0, paddingBottom: SPACING.xs },
  syncTextRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: SPACING.xs,
  },
  syncPrimaryLabel: { flexShrink: 1, minWidth: 0 },
  syncPendingLabel: { flexShrink: 0 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: BOARD.touchTarget,
    paddingHorizontal: SPACING.lg,
  },
});
