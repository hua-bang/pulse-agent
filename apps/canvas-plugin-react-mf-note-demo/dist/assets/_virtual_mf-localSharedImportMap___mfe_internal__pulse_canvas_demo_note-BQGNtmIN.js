import "./preload-helper-CmrIWoG2.js";
const usedShared = {
  "react": {
    name: "react",
    version: "18.3.1",
    scope: ["default"],
    loaded: false,
    from: "pulse_canvas_demo_note",
    async get() {
      {
        throw new Error(`[Module Federation] Shared module '${"react"}' must be provided by host`);
      }
    },
    shareConfig: {
      singleton: true,
      requiredVersion: "*",
      import: false
    }
  }
};
const usedRemotes = [];
export {
  usedRemotes,
  usedShared
};
