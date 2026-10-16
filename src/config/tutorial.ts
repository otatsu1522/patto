import type { StringKey } from '@/i18n';
import type { TaskColorKey } from '@/theme/taskColors';

/**
 * 初回起動時に作るサンプルプロジェクト（TUTORIAL）。文言は i18n の tutorial.* で変更する。
 * columns の順番は DEFAULT_COLUMNS（TODO / DOING / DONE）に対応する。
 */
interface TutorialTask {
  title: StringKey;
  description: StringKey;
  color: TaskColorKey;
}

export const TUTORIAL_PROJECT_TITLE: StringKey = 'defaults.tutorial.project';
export const TUTORIAL_PROJECT_COLOR: TaskColorKey = 'red';

/** 既存のチュートリアルにだけ追加分を移行するためのバージョンと旧テンプレート数。 */
export const TUTORIAL_TASKS_VERSION = '2';
export const TUTORIAL_PREVIOUS_TASK_COUNTS = [10, 1, 2] as const;

export const TUTORIAL_TASKS: TutorialTask[][] = [
  // TODO: アプリの機能一覧
  [
    ['tutorial.todo1.title', 'tutorial.todo1.desc', 'red'],
    ['tutorial.todo2.title', 'tutorial.todo2.desc', 'yellow'],
    ['tutorial.todo3.title', 'tutorial.todo3.desc', 'blue'],
    ['tutorial.todo4.title', 'tutorial.todo4.desc', 'orange'],
    ['tutorial.todo5.title', 'tutorial.todo5.desc', 'amber'],
    ['tutorial.todo6.title', 'tutorial.todo6.desc', 'lime'],
    ['tutorial.todo7.title', 'tutorial.todo7.desc', 'green'],
    ['tutorial.todo8.title', 'tutorial.todo8.desc', 'teal'],
    ['tutorial.todo9.title', 'tutorial.todo9.desc', 'sky'],
    ['tutorial.todo10.title', 'tutorial.todo10.desc', 'indigo'],
    ['tutorial.todo11.title', 'tutorial.todo11.desc', 'purple'],
    ['tutorial.todo12.title', 'tutorial.todo12.desc', 'pink'],
    ['tutorial.todo13.title', 'tutorial.todo13.desc', 'rose'],
    ['tutorial.todo14.title', 'tutorial.todo14.desc', 'brown'],
    ['tutorial.todo15.title', 'tutorial.todo15.desc', 'slate'],
    ['tutorial.todo16.title', 'tutorial.todo16.desc', 'orange'],
    ['tutorial.todo17.title', 'tutorial.todo17.desc', 'amber'],
  ].map(([title, description, color]) => ({
    title: title as StringKey,
    description: description as StringKey,
    color: color as TaskColorKey,
  })),
  // DOING: いま取り組むこと
  [{ title: 'tutorial.doing1.title', description: 'tutorial.doing1.desc', color: 'purple' }],
  // DONE: 済んだこと
  [
    { title: 'tutorial.done1.title', description: 'tutorial.done1.desc', color: 'pink' },
    { title: 'tutorial.done2.title', description: 'tutorial.done2.desc', color: 'rose' },
  ],
];
