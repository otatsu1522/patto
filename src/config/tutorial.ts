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

export const TUTORIAL_TASKS: TutorialTask[][] = [
  // TODO: アプリの機能一覧
  [
    ['tutorial.todo1.title', 'tutorial.todo1.desc', 'red'],
    ['tutorial.todo2.title', 'tutorial.todo2.desc', 'orange'],
    ['tutorial.todo3.title', 'tutorial.todo3.desc', 'amber'],
    ['tutorial.todo4.title', 'tutorial.todo4.desc', 'yellow'],
    ['tutorial.todo5.title', 'tutorial.todo5.desc', 'lime'],
    ['tutorial.todo6.title', 'tutorial.todo6.desc', 'green'],
    ['tutorial.todo7.title', 'tutorial.todo7.desc', 'teal'],
    ['tutorial.todo8.title', 'tutorial.todo8.desc', 'sky'],
    ['tutorial.todo9.title', 'tutorial.todo9.desc', 'blue'],
    ['tutorial.todo10.title', 'tutorial.todo10.desc', 'indigo'],
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
