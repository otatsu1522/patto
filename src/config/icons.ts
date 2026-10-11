import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** アプリ内で使うアイコンの対応表（アイコンを変えるときはここだけ編集）。 */
export const ICONS = {
  menu: 'menu',
  more: 'ellipsis-horizontal',
  moreHorizontal: 'ellipsis-horizontal',
  add: 'add',
  close: 'close',
  back: 'chevron-back',
  left: 'chevron-back',
  right: 'chevron-forward',
  star: 'star',
  starOutline: 'star-outline',
  sync: 'sync',
  offline: 'cloud-offline-outline',
  synced: 'cloud-done-outline',
  error: 'alert-circle-outline',
  settings: 'settings-outline',
  search: 'search',
  eye: 'eye-outline',
  eyeOff: 'eye-off-outline',
  trash: 'trash-outline',
  archive: 'archive-outline',
  restore: 'arrow-undo-outline',
  edit: 'create-outline',
  copy: 'copy-outline',
  calendar: 'calendar-outline',
  check: 'checkmark',
  person: 'person-circle-outline',
  info: 'information-circle-outline',
  keyboard: 'keypad-outline',
  document: 'document-text-outline',
  download: 'download-outline',
  upload: 'cloud-upload-outline',
  moon: 'moon-outline',
  logout: 'log-out-outline',
  folder: 'folder-outline',
  grab: 'hand-left-outline',
  uturn: 'return-down-back-outline',
  doneMode: 'checkmark-done-circle',
  forward: 'chevron-forward',
  down: 'chevron-down',
} as const satisfies Record<string, IconName>;

export type IconKey = keyof typeof ICONS;
