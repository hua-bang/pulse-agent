import type {
  AppInfoResult,
  AppMenuCommand,
  UpdateCheckResult,
} from '../app-info';

export type * from '../app-info';

export interface AppInfoApi {
  getInfo: () => Promise<AppInfoResult>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  /** Runs `callback` for each native menu command; returns an unsubscribe. */
  onMenuCommand: (callback: (command: AppMenuCommand) => void) => () => void;
}
