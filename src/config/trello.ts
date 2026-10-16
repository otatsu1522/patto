import type { TaskColorKey } from '@/theme/taskColors';

/** Trello 形式との互換性に関する値。インポート／エクスポート規約をここで管理する。 */
export const TRELLO_FORMAT = {
  defaultBoardColor: 'blue',
  emptyLabelName: '',
  positionStep: 65536,
  doneColumnPattern: /^(done|完了|終了|済)/i,
  colorAliases: {
    black: 'slate',
    grey: 'slate',
    gray: 'slate',
  } as Record<string, TaskColorKey | null>,
} as const;
