import { truncateCodemodeText } from './output.js';

/** Trusted Node bootstrap. Model code is evaluated only inside QuickJS. */
export const CODEMODE_WORKER_SOURCE = String.raw`
const { parentPort, workerData } = require('node:worker_threads');
const { newQuickJSWASMModuleFromVariant } = require(workerData.modulePath);
const variant = require(workerData.variantPath).default;
const truncateText = ${truncateCodemodeText.toString()};

async function main() {
  const QuickJS = await newQuickJSWASMModuleFromVariant({
    ...variant,
    // Resolve the CJS loader explicitly; the variant's dynamic import picks ESM.
    importModuleLoader: async () => require(workerData.loaderPath),
  });
  const vm = QuickJS.newContext();
  vm.runtime.setMemoryLimit(workerData.memoryLimitBytes);
  vm.runtime.setMaxStackSize(512 * 1024);
  vm.runtime.setInterruptHandler(() => Date.now() >= workerData.deadline);
  const pending = new Map();
  let nextId = 0;
  let outputChars = 0;
  let outputTruncated = false;
  let finished = false;
  let promiseHandle;
  const errorText = value => typeof value === 'string' ? value : JSON.stringify(value);
  const fail = error => {
    if (finished) return;
    finished = true;
    let message = String(error);
    if (message.startsWith('ReferenceError:')) {
      const tool = workerData.catalog.find(item => message.includes("'" + item.name + "' is not defined"));
      if (tool) message += '; tools are only available on tools: use await tools[' + JSON.stringify(tool.name) + '](args)';
    }
    parentPort.postMessage({ type: 'done', ok: false, error: message });
  };
  const bridge = vm.newFunction('callTool', (name, args) => {
    if (++nextId > workerData.maxCalls) throw new Error('Codemode tool call limit exceeded');
    const chars = vm.getProp(args, 'length').consume(handle => vm.getNumber(handle));
    if (chars > workerData.maxToolArgumentBytes) throw new Error('Codemode tool argument limit exceeded');
    const json = vm.getString(args);
    if (Buffer.byteLength(json, 'utf8') > workerData.maxToolArgumentBytes) throw new Error('Codemode tool argument limit exceeded');
    const deferred = vm.newPromise();
    pending.set(nextId, deferred);
    parentPort.postMessage({ type: 'call', id: nextId, name: vm.getString(name), args: json });
    return deferred.handle;
  });
  const output = vm.newFunction('output', value => {
    const chars = vm.getProp(value, 'length').consume(handle => vm.getNumber(handle));
    if (chars === 0) return vm.undefined;
    const remaining = workerData.maxOutputChars - outputChars;
    if (remaining === 0) {
      if (!outputTruncated) parentPort.postMessage({ type: 'output-truncated' });
      outputTruncated = true;
      return vm.undefined;
    }
    const text = truncateText(vm.getString(value), remaining);
    outputChars += text.length;
    const truncated = chars > remaining;
    outputTruncated ||= truncated;
    parentPort.postMessage({ type: 'output', text, truncated });
    return vm.undefined;
  });
  vm.setProp(vm.global, '__bridge', bridge);
  vm.setProp(vm.global, '__output', output);
  bridge.dispose();
  output.dispose();
  const setup = vm.evalCode('(() => {' +
    'const call = __bridge, emit = __output, stringify = JSON.stringify, parse = JSON.parse;' +
    'delete globalThis.__bridge; delete globalThis.__output;' +
    'const catalog = ' + JSON.stringify(workerData.catalog) + '.map(item => ({...item,callExpression: "tools[" + JSON.stringify(item.name) + "]"}));' +
    'const tools = Object.create(null);' +
    'for (const item of catalog) tools[item.name] = async args => parse(await call(item.name, stringify(args)));' +
    'globalThis.tools = Object.freeze(tools);' +
    'globalThis.ALL_TOOLS = Object.freeze(catalog.map(item => Object.freeze({name:item.name,description:item.description,callExpression:item.callExpression})));' +
    'globalThis.describeTools = names => names.map(name => {' +
      'const item = catalog.find(item => item.name === name);' +
      'if (!item) throw new Error("Unknown or unavailable tool: " + name);' +
      'return parse(stringify(item));' +
    '});' +
    'globalThis.text = value => emit(typeof value === "string" ? value : stringify(value));' +
    '})()');
  vm.unwrapResult(setup).dispose();

  const pump = () => {
    if (finished) return;
    try {
      while (vm.runtime.hasPendingJob()) {
        const job = vm.runtime.executePendingJobs(1);
        if (job.error) {
          const error = errorText(vm.dump(job.error));
          job.error.dispose();
          throw new Error(error);
        }
      }
      if (promiseHandle) {
        const state = vm.getPromiseState(promiseHandle);
        if (state.type === 'pending' && pending.size === 0) fail('Script is waiting without a pending tool call');
        if (state.type === 'fulfilled') state.value.dispose();
        if (state.type === 'rejected') state.error.dispose();
      }
    } catch (error) {
      fail(error);
    }
  };
  parentPort.on('message', message => {
    if (finished || message.type !== 'result') return;
    const deferred = pending.get(message.id);
    if (!deferred) return;
    pending.delete(message.id);
    const handle = message.ok ? vm.newString(message.json) : vm.newError(message.error);
    if (message.ok) deferred.resolve(handle);
    else deferred.reject(handle);
    handle.dispose();
    deferred.dispose();
    pump();
  });
  try {
    // Capture serialization before model code can modify guest globals.
    const evaluation = vm.evalCode('(async () => { const stringify = JSON.stringify;' +
      'const value = await (async () => {\n' + workerData.code + '\n})();' +
      'return value === undefined ? undefined : stringify(value); })()', 'codemode.js');
    promiseHandle = vm.unwrapResult(evaluation);
    const settled = vm.resolvePromise(promiseHandle);
    pump();
    const result = await settled;
    if (finished) {
      if (result.value) result.value.dispose();
      if (result.error) result.error.dispose();
      return;
    }
    const handle = vm.unwrapResult(result);
    if (vm.typeof(handle) === 'string') {
      const chars = vm.getProp(handle, 'length').consume(value => vm.getNumber(value));
      if (chars > workerData.maxOutputChars) {
        handle.dispose();
        throw new Error('Codemode output limit exceeded');
      }
    }
    const json = vm.dump(handle);
    handle.dispose();
    if (json !== undefined && (typeof json !== 'string' || json.length > workerData.maxOutputChars)) {
      throw new Error('Codemode output limit exceeded');
    }
    finished = true;
    parentPort.postMessage({ type: 'done', ok: true, json });
  } catch (error) {
    fail(error);
  } finally {
    finished = true;
    parentPort.removeAllListeners('message');
    for (const deferred of pending.values()) deferred.dispose();
    if (promiseHandle && promiseHandle.alive) promiseHandle.dispose();
    vm.dispose();
  }
}
main().catch(error => parentPort.postMessage({ type: 'done', ok: false, error: String(error) }));
`;
