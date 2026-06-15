
    export type RemoteKeys = 'REMOTE_ALIAS_IDENTIFIER/plugin';
    type PackageType<T> = T extends 'REMOTE_ALIAS_IDENTIFIER/plugin' ? typeof import('REMOTE_ALIAS_IDENTIFIER/plugin') :any;