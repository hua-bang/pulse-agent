const __mfPromiseGlobalKey = "__mf_init__virtual:mf:__mfe_internal__pulse_canvas_demo_note__mf_v__runtimeInit__mf_v__.js__";
let __mfPromiseState = globalThis[__mfPromiseGlobalKey];
if (!__mfPromiseState) {
  let initResolve, initReject;
  const initPromise2 = new Promise((re, rj) => {
    initResolve = re;
    initReject = rj;
  });
  __mfPromiseState = globalThis[__mfPromiseGlobalKey] = {
    initPromise: initPromise2,
    initResolve,
    initReject
  };
}
const initPromise = __mfPromiseState.initPromise;
const __mfCacheGlobalKey = "__mf_module_cache__";
globalThis[__mfCacheGlobalKey] ||= { share: {}, remote: {} };
globalThis[__mfCacheGlobalKey].share ||= {};
globalThis[__mfCacheGlobalKey].remote ||= {};
const __mfModuleCache = globalThis[__mfCacheGlobalKey];
let __mf_default;
let __mf_32;
const __mfApplyHostProvidedExports = (exportModule2) => {
  exportModule2["Children"];
  exportModule2["Component"];
  exportModule2["Fragment"];
  exportModule2["Profiler"];
  exportModule2["PureComponent"];
  exportModule2["StrictMode"];
  exportModule2["Suspense"];
  exportModule2["__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"];
  exportModule2["act"];
  exportModule2["cloneElement"];
  exportModule2["createContext"];
  exportModule2["createElement"];
  exportModule2["createFactory"];
  exportModule2["createRef"];
  exportModule2["forwardRef"];
  exportModule2["isValidElement"];
  exportModule2["lazy"];
  exportModule2["memo"];
  exportModule2["startTransition"];
  exportModule2["unstable_act"];
  exportModule2["useCallback"];
  exportModule2["useContext"];
  exportModule2["useDebugValue"];
  exportModule2["useDeferredValue"];
  exportModule2["useEffect"];
  exportModule2["useId"];
  exportModule2["useImperativeHandle"];
  exportModule2["useInsertionEffect"];
  exportModule2["useLayoutEffect"];
  exportModule2["useMemo"];
  exportModule2["useReducer"];
  exportModule2["useRef"];
  __mf_32 = exportModule2["useState"];
  exportModule2["useSyncExternalStore"];
  exportModule2["useTransition"];
  exportModule2["version"];
  __mf_default = exportModule2.default ?? exportModule2;
};
let exportModule = __mfModuleCache.share["react"];
if (exportModule === void 0) {
  initPromise.then(() => {
    exportModule = __mfModuleCache.share["react"];
    if (exportModule === void 0) {
      throw new Error("[Module Federation] Shared module react was imported before federation bootstrap finished.");
    }
    __mfApplyHostProvidedExports(exportModule);
  });
} else {
  __mfApplyHostProvidedExports(exportModule);
}
export {
  __mf_default as _,
  __mf_32 as a
};
