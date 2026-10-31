'use client';

import { createContext, useContext } from 'react';

const EditorContext = createContext(false);

/** Whether this visitor sees the editing controls (see `src/server/editor.ts`). */
export function EditorProvider({
  editor,
  children,
}: {
  editor: boolean;
  children: React.ReactNode;
}) {
  return <EditorContext.Provider value={editor}>{children}</EditorContext.Provider>;
}

export function useEditor(): boolean {
  return useContext(EditorContext);
}
