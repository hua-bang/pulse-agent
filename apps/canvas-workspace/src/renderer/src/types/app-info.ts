import type {
  AppInfoResult,
  UpdateCheckResult,
} from '../../../shared/app-info';

export type * from '../../../shared/app-info';

export interface AppInfoApi {
  getInfo: () => Promise<AppInfoResult>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
}
