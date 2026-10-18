import { resolve } from "path";
import { MAX_TOOL_OUTPUT_LENGTH } from "../config";

export const truncateOutput = (output: string): string => {
  if (output.length <= MAX_TOOL_OUTPUT_LENGTH) {
    return output;
  }

  // The marker is part of the budget too. Otherwise a capped read exceeds
  // the default offload threshold and reading an offload file offloads again.
  let removed = output.length - MAX_TOOL_OUTPUT_LENGTH;
  let marker: string;
  let retained: number;
  while (true) {
    marker = `\n\n... [truncated ${removed} characters] ...\n\n`;
    retained = MAX_TOOL_OUTPUT_LENGTH - marker.length;
    const nextRemoved = output.length - retained;
    if (nextRemoved === removed) break;
    removed = nextRemoved;
  }
  const head = Math.ceil(retained / 2);
  const tail = retained - head;
  return output.slice(0, head) + marker + output.slice(-tail);
};

const fileQueues = new Map<string, Promise<void>>();

/**
 * Run file read-modify-write work one at a time per path. Tool calls from one
 * model step run concurrently; without this, two edits of one file both read
 * the old content and the later write silently drops the earlier edit.
 */
export const withFileLock = async <T>(filePath: string, operation: () => Promise<T>): Promise<T> => {
  const key = resolve(filePath);
  const current = (fileQueues.get(key) ?? Promise.resolve()).then(operation);
  const settled = current.then(() => undefined, () => undefined);
  fileQueues.set(key, settled);
  try {
    return await current;
  } finally {
    if (fileQueues.get(key) === settled) fileQueues.delete(key);
  }
};
