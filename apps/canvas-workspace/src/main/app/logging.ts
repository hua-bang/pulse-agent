import { app, ipcMain } from "electron";
import { promises as fs } from "fs";
import { join } from "path";

export type WriteLog = (
  level: string,
  message: string,
  details?: string
) => Promise<void>;

export interface MainLogger {
  writeLog: WriteLog;
}

export function createMainLogger(): MainLogger {
  const logDir = join(app.getPath("userData"), "logs");
  const logFile = join(logDir, "app.log");

  const writeLog: WriteLog = async (level, message, details) => {
    const timestamp = new Date().toISOString();
    const line = details
      ? `[${timestamp}] [${level}] ${message}\n${details}\n`
      : `[${timestamp}] [${level}] ${message}\n`;

    try {
      await fs.mkdir(logDir, { recursive: true });
      await fs.appendFile(logFile, line);
    } catch (error) {
      console.error("Failed to write log", error);
    }
  };

  return { writeLog };
}

export function setupRendererLogIpc(writeLog: WriteLog): void {
  ipcMain.on(
    "app:log",
    (
      _event,
      payload: { level?: string; message?: string; details?: string } | undefined
    ) => {
      const level = payload?.level ?? "renderer";
      const message = payload?.message ?? "log";
      const details = payload?.details;
      void writeLog(level, message, details);
    }
  );
}

export function setupFatalErrorLogging(writeLog: WriteLog): void {
  process.on("uncaughtException", (error) => {
    console.error("Main uncaughtException", error);
    const details = error instanceof Error
      ? String(error.stack ?? error)
      : String(error);
    void writeLog("main", "uncaughtException", details);
  });

  process.on("unhandledRejection", (reason) => {
    console.error("Main unhandledRejection", reason);
    void writeLog("main", "unhandledRejection", String(reason));
  });
}
