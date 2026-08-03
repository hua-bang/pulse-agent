/**
 * Ambient module for `typebox` as imported by the shipped pi extension
 * (`resources/pi-extension/pulse-canvas.ts`). At pi runtime the specifier
 * resolves from pi's own dependency tree; our typecheck only needs a loose
 * shape because the extension file enters the TS program through its tests.
 */
declare module 'typebox' {
  export const Type: {
    Object: (properties: Record<string, unknown>) => unknown;
    Optional: (schema: unknown) => unknown;
    String: (options?: Record<string, unknown>) => unknown;
    Integer: (options?: Record<string, unknown>) => unknown;
    Union: (schemas: unknown[]) => unknown;
    Literal: (value: string | number | boolean) => unknown;
  };
}
