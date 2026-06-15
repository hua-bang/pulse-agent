import { _ as __vitePreload } from "./preload-helper-CmrIWoG2.js";
const importMap = {
  "react": async () => {
    let pkg = await __vitePreload(() => import("./_virtual_mf___mfe_internal__pulse_canvas_demo_note__loadShare__react__loadShare__.js-B8ucmBWv.js").then((n) => n.e), true ? [] : void 0);
    return pkg;
  }
};
const usedShared = {
  "react": {
    name: "react",
    version: "18.3.1",
    scope: ["default"],
    loaded: false,
    from: "pulse_canvas_demo_note",
    async get() {
      usedShared["react"].loaded = true;
      const { "react": pkgDynamicImport } = importMap;
      const res = await pkgDynamicImport();
      const exportModule = { ...res };
      Object.defineProperty(exportModule, "__esModule", {
        value: true,
        enumerable: false
      });
      return function() {
        return exportModule;
      };
    },
    shareConfig: {
      singleton: true,
      requiredVersion: "^18.3.1"
    }
  }
};
const usedRemotes = [];
export {
  usedRemotes,
  usedShared
};
