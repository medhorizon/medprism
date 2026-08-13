export {};

declare global {
  interface Window {
    medprismDesktop?: {
      isDesktop: true;
      platform: string;
      projects: {
        getItem(key: string): string | null;
        setItem(key: string, value: string): void;
        removeItem(key: string): void;
        openFolder(id: string): Promise<{ ok: boolean; error?: string }>;
      };
      compile: {
        run(request: {
          jobId?: string;
          files: Record<string, string>;
          mainFile: string;
          projectRevision?: string;
          synctex?: boolean;
        }): Promise<{
          ok: boolean;
          jobId: string;
          clientJobId?: string;
          code: string;
          log: string;
          pdfBase64?: string;
          synctexBase64?: string;
          error?: string;
          projectRevision?: string;
        }>;
        cancel(jobId: string): Promise<{ ok: boolean; error?: string }>;
        isAvailable(): Promise<boolean>;
        exportWord(request: {
          jobId?: string;
          files: Record<string, string>;
          mainFile: string;
        }): Promise<{
          ok: boolean;
          jobId?: string;
          code?: string;
          log?: string;
          docxBase64?: string;
          error?: string;
        }>;
        importWord(request: {
          docxBase64: string;
          jobId?: string;
        }): Promise<{
          ok: boolean;
          jobId?: string;
          code?: string;
          log?: string;
          markdown?: string;
          error?: string;
        }>;
      };
    };
  }
}
