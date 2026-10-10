import type {
  AppInfoResult,
  UpdateCheckResult,
} from '../app-info';

export type * from '../app-info';

export interface AppInfoApi {
  getInfo: () => Promise<AppInfoResult>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
}
