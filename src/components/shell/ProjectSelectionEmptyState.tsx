import { StyleSheet, View } from 'react-native';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { t } from '@/i18n';
import { useUiStore } from '@/store/uiStore';

/** プロジェクト未選択時に表示する共通画面。 */
export function ProjectSelectionEmptyState() {
  return (
    <View style={styles.wrap}>
      <EmptyState
        title={t('project.empty')}
        hint={t('project.emptyHint')}
        action={
          <Button
            label={t('project.create')}
            variant="outline"
            icon="add"
            onPress={() => useUiStore.getState().requestNewProject()}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
