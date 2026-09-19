import { createCli } from './cli';
import { isStorageError } from '@pulse-coder/storage';
import { errorOutput } from './output';

createCli().parseAsync(process.argv).catch((err: Error) => {
  errorOutput(err.message, { code: isStorageError(err) ? err.code : 'error' });
});
