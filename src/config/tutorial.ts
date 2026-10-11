import type { StringKey } from '@/i18n';

/**
 * 初回起動時に作るサンプルプロジェクト（TUTORIAL）。文言は i18n の tutorial.* で変更する。
 * columns の順番は DEFAULT_COLUMNS（TODO / DOING / DONE）に対応する。
 */
interface TutorialTask {
  title: StringKey;
  description: StringKey;
}

export const TUTORIAL_PROJECT_TITLE: StringKey = 'defaults.tutorial.project';

export const TUTORIAL_TASKS: TutorialTask[][] = [
  // TODO: アプリの機能一覧
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({
    title: `tutorial.todo${n}.title` as StringKey,
    description: `tutorial.todo${n}.desc` as StringKey,
  })),
  // DOING: いま取り組むこと
  [{ title: 'tutorial.doing1.title', description: 'tutorial.doing1.desc' }],
  // DONE: 済んだこと
  [
    { title: 'tutorial.done1.title', description: 'tutorial.done1.desc' },
    { title: 'tutorial.done2.title', description: 'tutorial.done2.desc' },
  ],
];
