import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import { exportBoards, parseTrello } from '@/domain/trello';
import { useDataStore } from '@/store/dataStore';
import { formatDate } from '@/lib/dates';
import { APP_NAME } from '@/config/app';

/** 指定プロジェクトを Trello 形式の JSON として書き出す（Web: ダウンロード / スマホ: 共有シート）。 */
export async function exportProjects(projectIds: string[]): Promise<void> {
  const json = exportBoards(useDataStore.getState().snapshot(), projectIds);
  const fileName = `${APP_NAME.toLowerCase()}-export-${formatDate(Date.now())}.json`;

  if (Platform.OS === 'web') {
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  file.write(json);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json' });
}

/** ファイルを選んで Trello 形式の JSON を取り込む。取り込んだプロジェクト数、キャンセル時は null。 */
export async function importProjects(): Promise<number | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', '*/*'], copyToCacheDirectory: true });
  if (res.canceled || !res.assets[0]) return null;
  const asset = res.assets[0];
  const text = Platform.OS === 'web' && asset.file ? await asset.file.text() : await new File(asset.uri).text();
  const boards = parseTrello(text);
  return useDataStore.getState().importBoards(boards);
}
