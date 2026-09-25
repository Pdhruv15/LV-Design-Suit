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
    };
  }
}
