import type {
  ExperimentalFeatureDef,
  ToolingInstallStatus,
} from '../../../shared/experimental-features';

export type {
  ExperimentalFeatureDef,
  ToolingInstallStatus,
} from '../../../shared/experimental-features';

export interface ExperimentalApi {
  list: () => Promise<{
    ok: boolean;
    features?: ExperimentalFeatureDef[];
    values?: Record<string, boolean>;
    path?: string;
    error?: string;
  }>;
  set: (id: string, enabled: boolean) =>
    Promise<{ ok: boolean; values?: Record<string, boolean>; error?: string }>;
  reset: () => Promise<{ ok: boolean; values?: Record<string, boolean>; error?: string }>;
  reloadWindow: () => Promise<{ ok: boolean; error?: string }>;
  /** Subscribe to background tooling-install results. Returns an unsubscribe fn. */
  onToolingStatus: (cb: (status: ToolingInstallStatus) => void) => () => void;
}
