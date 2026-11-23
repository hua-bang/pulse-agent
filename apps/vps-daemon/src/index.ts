import { homedir } from 'node:os';
import { join } from 'node:path';
import { startVpsDaemon } from './server.js';

async function main() {
  const token = process.env.PULSE_VPS_TOKEN?.trim();
  if (!token) {
    console.error('[vps-daemon] PULSE_VPS_TOKEN environment variable is required.');
    process.exit(1);
  }

  const host = process.env.PULSE_VPS_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.PULSE_VPS_PORT || 4770);
  const dataDir =
    process.env.PULSE_VPS_DATA_DIR?.trim() || join(homedir(), '.pulse-coder', 'canvas');
  const workDir = process.env.PULSE_VPS_WORKDIR?.trim() || homedir();

  const daemon = await startVpsDaemon({
    host,
    port,
    token,
    dataDir,
    workDir,
    writeRuntimeDescriptor: true,
  });
  console.log(`[vps-daemon] listening on ${daemon.url}`);
  console.log(`[vps-daemon] dataDir=${dataDir} workDir=${workDir}`);

  const shutdown = async (signal: string) => {
    console.log(`[vps-daemon] received ${signal}, shutting down...`);
    await daemon.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

void main();
