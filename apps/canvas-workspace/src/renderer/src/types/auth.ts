// Re-export the auth contract from the runtime-neutral shared module so
// renderer consumers import it through the types barrel.
// Source of truth: src/shared/auth.ts.
export type * from '../../../shared/auth';
