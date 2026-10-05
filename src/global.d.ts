/// <reference types="vite/client" />
export {};

declare global {
  /** App version, e.g. "1.2" (from package.json; raised with each release). */
  const __APP_VERSION__: string;
  interface Window {
    lvds: {
      settings: {
        get: () => Promise<{ projectsFolder: string; databaseFolder?: string; pythonPath?: string }>;
        chooseProjectsFolder: () => Promise<{ projectsFolder: string; databaseFolder?: string; pythonPath?: string }>;
        chooseDatabaseFolder: (reset?: boolean) => Promise<{ projectsFolder: string; databaseFolder?: string; pythonPath?: string }>;
        choosePython: () => Promise<{ projectsFolder: string; databaseFolder?: string; pythonPath?: string }>;
      };
      projects: {
        list: () => Promise<import('./model/projectStore').ProjectMeta[]>;
        load: (file: string) => Promise<import('./types').Project>;
        /** The project and the stamp of the file it was read from (missing in older desktop builds). */
        read?: (file: string) => Promise<{ project: import('./types').Project; stamp: import('./model/saveSafety').FileStamp | null }>;
        stat?: (file: string) => Promise<import('./model/saveSafety').FileStamp | null>;
        /** With `expected` (what the file was when opened or last saved) a changed file is a conflict, not overwritten, unless `force`. */
        save: (file: string | undefined, data: import('./types').Project, expected?: import('./model/saveSafety').FileStamp, force?: boolean) => Promise<{ file: string; stamp?: import('./model/saveSafety').FileStamp | null; conflict?: boolean; disk?: import('./model/saveSafety').FileStamp | null }>;
        delete: (file: string) => Promise<boolean>;
        pick: () => Promise<{ file?: string; data?: unknown; from?: string } | null>;
      };
      /** Recovery copy of unsaved work (missing in older desktop builds). */
      recovery?: {
        write: (r: import('./model/projectStore').Recovery) => Promise<boolean>;
        read: () => Promise<import('./model/projectStore').Recovery | null>;
        /** One recovery copy per project, newest first (missing in older desktop builds). */
        readAll?: () => Promise<import('./model/projectStore').Recovery[]>;
        clear: (projectId?: string) => Promise<boolean>;
      };
      database: {
        init: (seeds: Record<string, unknown[][]>) => Promise<import('./database/database').RawDatabase & { created: string[] }>;
        read: () => Promise<import('./database/database').RawDatabase>;
        /** Opens a workbook in Excel (or the folder when file is omitted). */
        open: (file?: string) => Promise<string>;
        onChange: (cb: (data: import('./database/database').RawDatabase) => void) => () => void;
        write: (bookId: string, rows: Record<string, string | number>[]) => Promise<{ file: string }>;
        readLibrary: () => Promise<Record<string, unknown>>;
        writeLibrary: (data: Record<string, unknown>) => Promise<boolean>;
      };
      engines: {
        probe: () => Promise<import('./engines/types').EngineProbe | { error: string }>;
        run: (request: { engine: string; project: import('./types').Project; dss?: string }) => Promise<import('./engines/types').StudyResults | { error: string }>;
      };
      files: {
        /** Shows a save dialog and writes the text; resolves to the saved path, or null if cancelled. */
        saveText: (opts: { defaultName: string; content: string; filterName: string; extensions: string[] }) => Promise<string | null>;
        /** Shows a save dialog and writes the bytes; resolves to the saved path, or null if cancelled. Missing in older desktop builds. */
        saveBinary?: (opts: { defaultName: string; bytes: Uint8Array; filterName: string; extensions: string[] }) => Promise<string | null>;
        /** Shows a save dialog and renders the HTML to an A4 landscape PDF; resolves to the saved path, or null if cancelled. */
        /** Renders HTML to PDF bytes without a dialog (to merge parts). Missing in older desktop builds. */
        pdfBytes?: (opts: { html: string; pageSize?: 'A4' | 'A3' | 'A2' | 'A1'; landscape?: boolean; cssPages?: boolean }) => Promise<Uint8Array>;
        savePdf: (opts: { defaultName: string; html: string; pageSize?: 'A4' | 'A3' | 'A2' | 'A1'; landscape?: boolean; cssPages?: boolean }) => Promise<string | null>;
      };
    };
  }
}
