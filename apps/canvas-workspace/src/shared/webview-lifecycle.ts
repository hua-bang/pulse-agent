export type WebviewLifecycleState = 'active' | 'frozen';

export type WebviewLifecycleSkipReason =
  | 'destroyed'
  | 'audible'
  | 'devtools'
  | 'always-active';

export type SetWebviewLifecycleResult =
  | {
      ok: true;
      state: WebviewLifecycleState;
    }
  | {
      ok: false;
      /** Whether an unchanged caller state should try the request again. */
      retryable: boolean;
      skipped?: WebviewLifecycleSkipReason;
      error?: string;
    };
