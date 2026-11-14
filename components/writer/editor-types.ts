import type React from 'react';
import type { EditorEvent, EditorHandle } from '@/lib/writer-editor-html';

export type RichEditorProps = {
  chapterId: string;
  /** Read only when chapterId changes; the editor is never remounted per keystroke. */
  html: string;
  night: boolean;
  /** Read-only while conflicts or irreversible operations are in progress. */
  readOnly?: boolean;
  height: number;
  onEvent: (e: EditorEvent) => void;
  ref?: React.Ref<EditorHandle>;
};
