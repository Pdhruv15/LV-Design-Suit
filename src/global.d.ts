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
        /** Moves the project to the trash (kept 30 days). */
        delete: (file: string) => Promise<boolean>;
        trashList?: () => Promise<import('./model/projectStore').TrashedProject[]>;
        restore?: (trashFile: string) => Promise<string>;
        emptyTrash?: () => Promise<number>;
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
      /** Opens generated DXF sheets in the installed OpenCADStudio desktop application. */
      openCadStudio?: {
        status: () => Promise<{ installed: boolean; connected: boolean; version?: string }>;
        openDxf: (files: { name: string; content: string }[]) => Promise<{ files: string[]; connected: boolean; version?: string; linked?: number }>;
        /** Boards and feeders tagged in the drawing open in OpenCADStudio ("feeder:<id>", "board:<id>"), with their object counts. */
        linked?: () => Promise<{ tag: string; objects: number }[]>;
        /** Redraws, in the drawing open in OpenCADStudio, only the boards, feeders and sheet furniture that changed (first sheet). */
        update?: (files: { name: string; content: string }[]) => Promise<{ changed: string[]; added: string[]; removed: string[]; unchanged: number }>;
        /** Asks for a floor plan (DWG / DXF) and opens it in the live OpenCADStudio window; null if cancelled. */
        openPlan?: () => Promise<{ file: string; version?: string } | null>;
        /** Blocks placed in the drawing active in OpenCADStudio, with their attribute values. */
        blocks?: () => Promise<import('./model/cadLoads').CadBlock[]>;
        /** Cable routes linked to feeders on the active drawing, measured in drawing units, with its INSUNITS code. */
        routes?: () => Promise<{ units?: number; routes: { feederId: string; length: number; pieces: number }[] }>;
        /** Links the curves selected in OpenCADStudio to a feeder's route; '' unlinks them. */
        linkSelection?: (feederId: string) => Promise<{ linked: number; skipped: number }>;
        /** What the active floor plan says about board locations, in drawing units, with its INSUNITS code. */
        plan?: () => Promise<import('./model/cadPlaces').CadPlan>;
        /** Marks the objects selected in OpenCADStudio as a board's symbol; '' unlinks them. */
        placeSelection?: (boardId: string) => Promise<{ linked: number }>;
        /** Tray runs and linked cable routes on the active drawing, as paths in drawing units. */
        trays?: () => Promise<import('./model/cadTrays').CadTrayPlan>;
        /** Links the curves selected in OpenCADStudio to a tray route by name; '' unlinks them. */
        traySelection?: (name: string) => Promise<{ linked: number; skipped: number }>;
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
