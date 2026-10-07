import type {
  ChannelConfigStatus,
  SetFeishuConfigInput,
} from '../channel-config';

export type * from '../channel-config';

export interface ChannelConfigApi {
  status: () => Promise<{ ok: boolean; status?: ChannelConfigStatus; error?: string }>;
  setFeishu: (
    input: SetFeishuConfigInput,
  ) => Promise<{ ok: boolean; status?: ChannelConfigStatus; error?: string }>;
  clearFeishu: () => Promise<{ ok: boolean; status?: ChannelConfigStatus; error?: string }>;
  /** Relaunch the app so credential / flag changes take effect. */
  relaunch: () => Promise<{ ok: boolean; error?: string }>;
}
