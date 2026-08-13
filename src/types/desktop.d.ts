export {};

declare global {
  interface Window {
    medprismDesktop?: {
      isDesktop: true;
      platform: string;
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
      };
    };
  }
}
