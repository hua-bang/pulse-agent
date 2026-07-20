import type { IpcRenderer } from "electron";
import type { ArtifactCapabilitiesApi } from "../../shared/artifact-capabilities";

export const createArtifactCapabilitiesApi = (
  ipcRenderer: IpcRenderer,
): ArtifactCapabilitiesApi => ({
  invoke: (request) => ipcRenderer.invoke("artifact-capability:invoke", request),
});
