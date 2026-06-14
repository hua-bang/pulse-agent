export interface ShellApi {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
}
