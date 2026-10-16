/** 操作を実行できない理由を、画面で安全に表示するためのエラー。 */
export class UserActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserActionError';
  }
}
