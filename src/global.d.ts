export {};

declare global {
  interface Window {
    lvds: {
      settings: {
        get: () => Promise<{ projectsFolder: string }>;
        chooseProjectsFolder: () => Promise<{ projectsFolder: string }>;
      };
      projects: {
        list: () => Promise<{ file: string; name: string; updatedAt: number }[]>;
        load: (file: string) => Promise<import('./types').Project>;
        save: (file: string | undefined, data: import('./types').Project) => Promise<{ file: string }>;
        delete: (file: string) => Promise<boolean>;
      };
      files: {
        /** Shows a save dialog and writes the text; resolves to the saved path, or null if cancelled. */
        saveText: (opts: { defaultName: string; content: string; filterName: string; extensions: string[] }) => Promise<string | null>;
      };
    };
  }
}
