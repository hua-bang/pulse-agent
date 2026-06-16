
const __mfCacheGlobalKey = "__mf_module_cache__";
globalThis[__mfCacheGlobalKey] ||= { share: {}, remote: {} };
globalThis[__mfCacheGlobalKey].share ||= {};
globalThis[__mfCacheGlobalKey].remote ||= {};
const __mfModuleCache = globalThis[__mfCacheGlobalKey];

const __mfImport = (src) =>
  globalThis.System && typeof globalThis.System.import === 'function'
    ? globalThis.System.import(src)
    : import(src);


(async () => {
  const __mfHostInit = await __mfImport("./hostInit-D1tfyVlN.js");
  await __mfHostInit.__tla;
  const { initHost } = __mfHostInit;
  await initHost();
})().then(() => __mfImport("./index-Crj5ecVP.js"));
