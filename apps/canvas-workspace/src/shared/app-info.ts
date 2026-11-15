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

/**
 * Commands the native application menu sends to the focused window on
 * `APP_MENU_COMMAND_CHANNEL`. Each one runs an existing renderer handler.
 */
export type AppMenuCommand =
  | 'open-settings'
  | 'new-workspace'
  | 'shortcuts-help'
  | 'command-palette'
  | 'toggle-sidebar'
  | 'toggle-panels'
  | 'toggle-chat-page';

export const APP_MENU_COMMAND_CHANNEL = 'app:menu-command';
