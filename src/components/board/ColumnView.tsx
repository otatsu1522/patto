import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { BOARD, GESTURE, UI_METRICS } from '@/config/layout';
import { TIMING } from '@/config/timing';
import type { KanbanColumn, Task } from '@/domain/types';
import { t } from '@/i18n';
import {
  BORDER_WIDTH_EMPHASIS,
  RADIUS,
  SPACING,
  useTheme,
  ICON_SIZE,
  ICON_BUTTON_BOX,
  LAYER,
  OPACITY,
} from '@/theme';
import { AppText } from '../ui/AppText';
import { DropdownMenu, type MenuItem } from '../ui/DropdownMenu';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { useDragGesture, type DragHandlers } from './dragGesture';
import { TaskCard } from './TaskCard';
import { BORDER_WIDTH_NONE } from '@/theme/tokens';
import { canHover } from '@/lib/hover';
import { useWebWheelScroll } from '@/hooks/useWebWheelScroll';
import { useSettingsStore } from '@/store/settingsStore';

export interface ColumnViewProps {
  column: KanbanColumn;
  tasks: Task[];
  index: number;
  count: number;
  width: number;
  height: number;
  /** Web のスマホ表示で、この列を ScrollView のスナップ位置にする */
  webSnapAlign?: 'start' | 'center';
  webSnapPadding?: number;
  /** ボード外周からカンバン列までのレイアウト余白 */
  boardEdgePadding?: number;
  compactCards: boolean;
  detailedCards: boolean;
  showTaskDescription: boolean;
  showTaskDueDate: boolean;
  showTaskUpdatedAt: boolean;
  showTaskMetadataIcons: boolean;
  /** キーボードのカーソル: 自分のカンバンなら taskIndex（-1 はヘッダー）、それ以外は null */
  cursorTaskIndex: number | null;
  grabbed: boolean;
  /** ドラッグ中にこのカンバンが落とし先として強調されるか */
  dropTarget: boolean;
  draggingTaskId: string | null;
  draggingColumn: boolean;
  menuItems: MenuItem[];
  taskMenu: (task: Task) => MenuItem[];
  onAdvance: (task: Task) => void;
  /** 「タスクを追加」を押したとき（作成ダイアログを開く） */
  onAddTask: () => void;
  onCopyTitle: (task: Task) => void;
  onCopyDescription: (task: Task) => void;
  /** メニュー右端と先頭カンバンのヘッダー下線を接続する */
  connectHeaderLineToMenu?: boolean;
  /** 手動並び替えでタスクの画面位置を測るための参照登録 */
  onTaskMeasure: (taskId: string, node: View | null) => void;
  taskDrag: (task: Task) => DragHandlers;
  columnDrag: DragHandlers;
  /** 横スクロールなど他の操作が始まったら増える。入力欄のフォーカスを外す合図 */
  blurSignal: number;
  onRefresh?: () => Promise<void>;
}

/** 1つのカンバン（列）: ヘッダー、縦スクロールのタスク一覧（お気に入りは上、横線で区切る）、末尾の「タスクを追加」。 */
export function ColumnView(p: ColumnViewProps) {
  const { colors, taskColor, isDark, lineWidth, lineColor } = useTheme();
  const customOuterBorder = useSettingsStore((s) => s.settings.borderColor !== null);
  // カード端から基準線までを常に8pxにする。
  // 画面端・メニュー境界側は、BoardView の外側余白を差し引く。
  // カンバン間は、中央配置した区切り線の半幅を考慮する。
  const edgeCardPadding = Math.max(0, SPACING.sm - (p.boardEdgePadding ?? BOARD.columnGap / 2));
  const dividerCardPadding = Math.max(0, SPACING.sm - BOARD.columnGap / 2 + lineWidth / 2);
  const listPaddingLeft = p.index === 0 ? edgeCardPadding : dividerCardPadding;
  const listPaddingRight = p.index === p.count - 1 ? edgeCardPadding : dividerCardPadding;
  const [refreshing, setRefreshing] = useState(false);
  // Web ではカードの本文・更新日時などから始めたタッチでも縦スクロールできるよう補助する。
  // 縦方向だけ一覧を動かし、横方向のスワイプは外側のカンバンに任せる。
  const listRef = useWebWheelScroll({
    touchScroll: true,
    touchAction: 'pan-x pan-y',
    touchLongPressMs: GESTURE.longPressMs,
  });
  const listViewportRef = useRef<View>(null);
  const listOffset = useRef(0);
  const [listViewportHeight, setListViewportHeight] = useState(0);
  const [listContentHeight, setListContentHeight] = useState(0);
  // 一覧が縦方向へあふれる場合だけ、スクロールバー周辺の余白を調整する。
  // あふれていない場合は従来の余白計算をそのまま使う。
  const hasScrollableContent = listViewportHeight > 0 && listContentHeight > listViewportHeight + 1;
  const hasWebScrollbar = Platform.OS === 'web' && hasScrollableContent;
  // ScrollView 右端から、隣の区切り線または画面外周までの現状の間隔。
  // スクロールバー表示中の PC ブラウザーでは、枠線幅1px・2pxなら3px、それ以外は2px延ばす。
  const scrollbarRightGap =
    p.index < p.count - 1
      ? Math.max(0, BOARD.columnGap / 2 - lineWidth / 2)
      : Math.max(
          0,
          (p.boardEdgePadding ?? BOARD.columnGap / 2) - (customOuterBorder ? lineWidth : 0),
        );
  const scrollbarRightExpansion = hasWebScrollbar && canHover ? 2 : 0;
  // スマホでは、境界線側から取り除いた分をカード一覧の内側右余白へ移す。
  // ブラウザでは ScrollView の拡張と対応させ、ネイティブでも縦スクロール時に適用する。
  const isSmartphone = Platform.OS !== 'web' || !canHover;
  const scrollbarCardPaddingRight = hasScrollableContent
    ? 0 + (isSmartphone ? scrollbarRightGap : 0)
    : listPaddingRight;
  const taskRefs = useRef(new Map<string, View>());
  const headerGesture = useDragGesture({
    ...p.columnDrag,
    begin: (x, y) => {
      if (!headerRef.current) return p.columnDrag.begin(x, y);
      headerRef.current.measureInWindow((cx, cy, w, h) =>
        p.columnDrag.begin(x, y, { ox: x - cx, oy: y - cy, w, h }),
      );
    },
  });
  const headerRef = useRef<View>(null);

  const favorites = p.tasks.filter((x) => x.isFavorite);
  const others = p.tasks.filter((x) => !x.isFavorite);
  const taskIndexById = useMemo(
    () => new Map(p.tasks.map((task, index) => [task.id, index] as const)),
    [p.tasks],
  );
  const showDivider = favorites.length > 0 && others.length > 0;

  // キーボード操作で選択されたタスクが画面外へ出たら、一覧を必要な分だけスクロールする。
  useEffect(() => {
    if (p.cursorTaskIndex === null || p.cursorTaskIndex < 0) return;
    const current = p.tasks[p.cursorTaskIndex];
    const node = current ? taskRefs.current.get(current.id) : undefined;
    const list = listRef.current;
    const listViewport = listViewportRef.current;
    if (!node || !list || !listViewport) return;
    const frame = requestAnimationFrame(() => {
      node.measureInWindow((_x, taskY, _w, taskHeight) => {
        listViewport.measureInWindow((_lx, listY, _lw, listHeight) => {
          const top = listY + UI_METRICS.board.cursorScrollMargin;
          const bottom = listY + listHeight - UI_METRICS.board.cursorScrollMargin;
          if (taskY < top) {
            list.scrollTo({ y: Math.max(0, listOffset.current - (top - taskY)), animated: true });
          } else if (taskY + taskHeight > bottom) {
            list.scrollTo({ y: listOffset.current + taskY + taskHeight - bottom, animated: true });
          }
        });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [p.cursorTaskIndex, p.tasks, p.height, listRef]);

  const card = (task: Task) => {
    const i = taskIndexById.get(task.id) ?? -1;
    return (
      <TaskCard
        key={task.id}
        task={task}
        done={p.column.isDoneColumn}
        compact={p.compactCards}
        detailed={p.detailedCards}
        showDescription={p.showTaskDescription}
        showDueDate={p.showTaskDueDate}
        showUpdatedAt={p.showTaskUpdatedAt}
        showMetadataIcons={p.showTaskMetadataIcons}
        isLast={p.index === p.count - 1}
        canAdvance={p.count > 1}
        focused={p.cursorTaskIndex === i}
        grabbed={p.grabbed && p.cursorTaskIndex === i}
        dragging={p.draggingTaskId === task.id}
        menuItems={p.taskMenu(task)}
        onAdvance={() => p.onAdvance(task)}
        onCopyTitle={() => p.onCopyTitle(task)}
        onCopyDescription={() => p.onCopyDescription(task)}
        onMeasure={(id, node) => {
          if (node) taskRefs.current.set(id, node);
          else taskRefs.current.delete(id);
          p.onTaskMeasure(id, node);
        }}
        drag={p.taskDrag(task)}
      />
    );
  };

  const headerFocused = p.cursorTaskIndex === -1;
  return (
    <View
      style={[
        styles.column,
        {
          width: p.width,
          height: p.height,
          backgroundColor: colors.column,
          opacity: p.draggingColumn ? OPACITY.draggingColumn : OPACITY.fullyVisible,
          borderRightWidth: BORDER_WIDTH_NONE,
        },
        Platform.OS === 'web' && p.webSnapAlign
          ? ({
              scrollSnapAlign: p.webSnapAlign,
              scrollSnapStop: 'always',
              scrollMarginLeft: p.webSnapAlign === 'start' ? (p.webSnapPadding ?? 0) : 0,
            } as never)
          : undefined,
      ]}
    >
      <View
        style={[
          styles.header,
          // 下線の幅だけを下側の余白として確保し、ボタンの上下余白を揃える。
          { paddingBottom: lineWidth },
          p.grabbed && headerFocused && { backgroundColor: colors.border },
        ]}
      >
        <GestureDetector
          gesture={headerGesture}
          touchAction="manipulation"
          enableContextMenu={false}
        >
          <View
            ref={headerRef}
            collapsable={false}
            style={[styles.titleWrap, { minHeight: BOARD.touchTarget - lineWidth }]}
          >
            {p.column.color ? (
              <View style={[styles.dot, { backgroundColor: taskColor(p.column.color) }]} />
            ) : null}
            <AppText bold numberOfLines={UI_METRICS.text.singleLineMax} style={styles.title}>
              {p.column.title}
            </AppText>
            <AppText variant="caption" muted bold>
              {t('column.taskCount', { count: p.tasks.length })}
            </AppText>
            {p.column.isDoneColumn ? (
              <Icon name="doneMode" size={ICON_SIZE.xxl} color={colors.textMuted} />
            ) : null}
          </View>
        </GestureDetector>
        <IconButton
          icon="add"
          label={t('task.add')}
          onPress={p.onAddTask}
          box={ICON_BUTTON_BOX.large}
          size={ICON_SIZE.xxl}
        />
        <DropdownMenu
          items={p.menuItems}
          trigger={(open) => (
            <IconButton
              icon="more"
              label={p.column.title}
              onPress={open}
              box={ICON_BUTTON_BOX.large}
              size={ICON_SIZE.xxl}
            />
          )}
        />
        {headerFocused ? (
          <View
            pointerEvents="none"
            style={[styles.headerFocusFrame, { bottom: lineWidth, borderColor: colors.focus }]}
          />
        ) : null}
        <View
          pointerEvents="none"
          style={[
            styles.headerUnderline,
            {
              // カスタム外周線時も、先頭カンバンの横線はサイドバー境界から始める。
              // 接続ブリッジは BoardView 直下のレイヤーで描画し、兄弟カンバンに覆われないようにする。
              left: p.connectHeaderLineToMenu
                ? Platform.OS === 'web'
                  ? customOuterBorder
                    ? -(BOARD.columnGap / 2)
                    : 0
                  : -BOARD.columnGap
                : -(BOARD.columnGap / 2),
              backgroundColor: lineColor,
              height: lineWidth,
            },
          ]}
        />
      </View>

      <View
        ref={listViewportRef}
        collapsable={false}
        style={styles.listViewport}
        onLayout={(event) => setListViewportHeight(event.nativeEvent.layout.height)}
      >
        <ScrollView
          ref={listRef}
          style={[
            styles.list,
            Platform.OS === 'web' ? styles.webList : undefined,
            scrollbarRightExpansion > 0 ? { marginRight: -scrollbarRightExpansion } : undefined,
            // 縦スクロールバーを右側の境界まで延ばす場合も、一覧内の横スクロールは発生させない。
            hasWebScrollbar ? ({ overflowX: 'hidden' } as never) : undefined,
          ]}
          onScroll={(event) => {
            listOffset.current = event.nativeEvent.contentOffset.y;
          }}
          onContentSizeChange={(_width, height) => setListContentHeight(height)}
          scrollEventThrottle={TIMING.scrollEventThrottleMs}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingLeft: listPaddingLeft,
              // スクロールバー表示中は、PCブラウザの固定余白を加算せず、スマホは境界線側から
              // 取り除いた分をカード側へ移す。表示されない場合は従来値を維持する。
              paddingRight: scrollbarCardPaddingRight,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          persistentScrollbar
          indicatorStyle={isDark ? 'white' : 'black'}
          refreshControl={
            p.onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={async () => {
                  setRefreshing(true);
                  try {
                    await p.onRefresh?.();
                  } finally {
                    setRefreshing(false);
                  }
                }}
              />
            ) : undefined
          }
        >
          {favorites.map(card)}
          {showDivider ? (
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
          {others.map(card)}

          <Pressable
            accessibilityRole="button"
            onPress={p.onAddTask}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.add,
              { backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent' },
            ]}
          >
            <Icon name="add" size={ICON_SIZE.xl} color={colors.textMuted} />
            <AppText muted>{t('task.add')}</AppText>
          </Pressable>
        </ScrollView>
      </View>
      {p.dropTarget ? (
        <View
          pointerEvents="none"
          style={[styles.dropTargetFrame, { borderColor: colors.accent }]}
        />
      ) : null}
      {p.index < p.count - 1 ? (
        <View
          pointerEvents="none"
          style={[
            styles.columnDivider,
            {
              // 線の中心をカンバン間の gap の中央に配置する。
              right: -(BOARD.columnGap / 2 + lineWidth / 2),
              backgroundColor: lineColor,
              width: lineWidth,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { position: 'relative', overflow: 'visible' },
  dropTargetFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderWidth: BORDER_WIDTH_EMPHASIS,
    borderRadius: RADIUS.sm,
    zIndex: LAYER.dragColumn,
  },
  columnDivider: { position: 'absolute', top: 0, bottom: 0 },
  header: {
    // 下線の高さ分を下側の内余白に含め、操作領域を線の上で縦中央に配置する。
    position: 'relative',
    height: BOARD.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: SPACING.md,
    paddingRight: SPACING.xs,
    overflow: 'visible',
  },
  headerFocusFrame: {
    position: 'absolute',
    top: 0,
    right: 0,
    left: 0,
    borderTopWidth: BORDER_WIDTH_EMPHASIS,
    borderRightWidth: BORDER_WIDTH_EMPHASIS,
    borderBottomWidth: 0,
    borderLeftWidth: BORDER_WIDTH_EMPHASIS,
  },
  headerUnderline: {
    position: 'absolute',
    left: -(BOARD.columnGap / 2),
    right: -(BOARD.columnGap / 2),
    bottom: 0,
  },
  titleWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    cursor: 'grab',
  } as never,
  dot: {
    width: UI_METRICS.board.colorDotSize,
    height: UI_METRICS.board.colorDotSize,
    borderRadius: UI_METRICS.board.colorDotSize / 2,
  },
  title: { flexShrink: 1 },
  listViewport: { flex: 1, minHeight: 0 },
  list: { flex: 1 },
  webList: {
    overflowX: 'auto',
    touchAction: 'pan-x pan-y',
    WebkitOverflowScrolling: 'touch',
    overscrollBehaviorX: 'auto',
    overscrollBehaviorY: 'contain',
  } as never,
  listContent: { padding: SPACING.sm, gap: SPACING.sm },
  divider: {
    width: UI_METRICS.board.pinnedDividerWidth,
    alignSelf: 'center',
    flexShrink: 0,
    marginVertical: SPACING.xs,
  },
  add: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, padding: SPACING.md },
});
