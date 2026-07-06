const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname, resolve } = require('node:path');

const urlArgIndex = process.argv.findIndex((arg) => /^https?:\/\//.test(arg));
const inputUrl = urlArgIndex >= 0 ? process.argv[urlArgIndex] : undefined;
const outputPathArg = urlArgIndex >= 0 ? process.argv[urlArgIndex + 1] : undefined;
const url = inputUrl || 'https://jasperhu.art/apps/canvas-perf/';
const outputPath = resolve(outputPathArg || 'apps/canvas-workspace/perf/out/dashboard.png');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function main() {
  await app.whenReady();

  const width = 1440;
  const win = new BrowserWindow({
    width,
    height: 1200,
    show: false,
    webPreferences: {
      backgroundThrottling: false,
    },
  });

  await win.loadURL(url);
  await sleep(800);

  const pageHeight = await win.webContents.executeJavaScript(
    'Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)',
  );
  const height = Math.max(900, Math.min(Number(pageHeight) || 1200, 3200));
  win.setContentSize(width, height);
  await sleep(300);

  const image = await win.webContents.capturePage();
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, image.toPNG());

  console.log(JSON.stringify({
    ok: true,
    url,
    outputPath,
    mimeType: 'image/png',
    width,
    height,
  }));

  app.quit();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  app.exit(1);
});
