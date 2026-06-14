export interface AppInfoResult {
  ok: boolean;
  version?: string;
  updateManifestUrl?: string;
  downloadUrl?: string;
  error?: string;
}

export interface UpdateManifestSummary {
  version: string;
  releasedAt?: string;
  downloadUrl: string;
  notes?:
    | string
    | {
        zh?: string;
        en?: string;
      };
}

export type UpdateCheckResult =
  | {
      ok: true;
      currentVersion: string;
      updateAvailable: boolean;
      latest: UpdateManifestSummary;
    }
  | {
      ok: false;
      currentVersion?: string;
      error?: string;
    };
