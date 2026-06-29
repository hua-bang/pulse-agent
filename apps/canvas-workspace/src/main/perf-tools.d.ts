// Build-time constant injected by electron.vite.config.ts (main + renderer).
// True in dev builds, false in production builds (overridable with
// PULSE_PERF_TOOLS=1). Gates the optional perf plugin + startup marks so they
// are stripped from packaged apps.
declare const __PERF_TOOLS__: boolean;
