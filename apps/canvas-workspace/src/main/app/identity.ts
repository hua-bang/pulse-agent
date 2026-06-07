import { app } from "electron";

export const APP_NAME = "Pulse Canvas";

export function configureAppIdentity(): void {
  app.setName(APP_NAME);
  process.title = APP_NAME;
}

configureAppIdentity();
