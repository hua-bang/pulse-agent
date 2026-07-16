// Re-export the default-browser contract from the runtime-neutral shared
// module so renderer consumers import it through the types barrel like every
// other domain. Source of truth: src/shared/default-browser.ts.
export type * from '../../../shared/default-browser';
