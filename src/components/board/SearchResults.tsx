import { Pressable, StyleSheet, View } from 'react-native';
import { UI_METRICS } from '@/config/layout';
import type { KanbanColumn, Project, Task } from '@/domain/types';
import { t } from '@/i18n';
import { SPACING, useTheme } from '@/theme';
import { AppText } from '../ui/AppText';
import { canHover } from '@/lib/hover';

interface Props {
  results: Task[];
  projects: Project[];
  columns: KanbanColumn[];
  onPress: (task: Task) => void;
}

/**
 * 検索結果の一覧。1件ごとに、上に薄く「プロジェクト名 › カンバン名」、続けてタスクのタイトルと説明を表示する。
 */
export function SearchResults({ results, projects, columns, onPress }: Props) {
  const { colors, lineWidth, lineColor } = useTheme();
  if (results.length === 0) {
    return (
      <AppText muted style={styles.empty}>
        {t('menu.searchEmpty')}
      </AppText>
    );
  }
  return (
    <View>
      {results.map((task) => {
        const project = projects.find((p) => p.id === task.projectId);
        const column = columns.find((c) => c.id === task.columnId);
        return (
          <Pressable
            key={task.id}
            accessibilityRole="button"
            onPress={() => onPress(task)}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.item,
              {
                borderBottomColor: lineColor,
                borderBottomWidth: lineWidth,
                backgroundColor: pressed || (hovered && canHover) ? colors.hover : 'transparent',
              },
            ]}
          >
            <View pointerEvents="none">
              <AppText variant="caption" muted numberOfLines={UI_METRICS.text.singleLineMax}>
                {project?.title ?? ''}
                {t('common.breadcrumbSeparator')}
                {column?.title ?? ''}
              </AppText>
            </View>
            <View pointerEvents="none">
              <AppText bold>{task.title}</AppText>
            </View>
            {task.description ? (
              <View pointerEvents="none">
                <AppText variant="caption" muted numberOfLines={UI_METRICS.text.previewLines}>
                  {task.description}
                </AppText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: SPACING.lg },
  item: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    gap: UI_METRICS.search.resultGap,
  },
});
