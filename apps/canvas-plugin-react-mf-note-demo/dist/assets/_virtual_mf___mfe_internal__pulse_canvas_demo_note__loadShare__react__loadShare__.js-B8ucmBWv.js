function _mergeNamespaces(n2, m) {
  for (var i = 0; i < m.length; i++) {
    const e = m[i];
    if (typeof e !== "string" && !Array.isArray(e)) {
      for (const k in e) {
        if (k !== "default" && !(k in n2)) {
          const d = Object.getOwnPropertyDescriptor(e, k);
          if (d) {
            Object.defineProperty(n2, k, d.get ? d : {
              enumerable: true,
              get: () => e[k]
            });
          }
        }
      }
    }
  }
  return Object.freeze(Object.defineProperty(n2, Symbol.toStringTag, { value: "Module" }));
}
function getDefaultExportFromCjs(x2) {
  return x2 && x2.__esModule && Object.prototype.hasOwnProperty.call(x2, "default") ? x2["default"] : x2;
}
var react = { exports: {} };
var react_production_min = {};
/**
 * @license React
 * react.production.min.js
 *
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */
var l = Symbol.for("react.element"), n = Symbol.for("react.portal"), p = Symbol.for("react.fragment"), q = Symbol.for("react.strict_mode"), r = Symbol.for("react.profiler"), t = Symbol.for("react.provider"), u = Symbol.for("react.context"), v = Symbol.for("react.forward_ref"), w = Symbol.for("react.suspense"), x = Symbol.for("react.memo"), y = Symbol.for("react.lazy"), z = Symbol.iterator;
function A(a) {
  if (null === a || "object" !== typeof a) return null;
  a = z && a[z] || a["@@iterator"];
  return "function" === typeof a ? a : null;
}
var B = { isMounted: function() {
  return false;
}, enqueueForceUpdate: function() {
}, enqueueReplaceState: function() {
}, enqueueSetState: function() {
} }, C = Object.assign, D = {};
function E(a, b, e) {
  this.props = a;
  this.context = b;
  this.refs = D;
  this.updater = e || B;
}
E.prototype.isReactComponent = {};
E.prototype.setState = function(a, b) {
  if ("object" !== typeof a && "function" !== typeof a && null != a) throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.");
  this.updater.enqueueSetState(this, a, b, "setState");
};
E.prototype.forceUpdate = function(a) {
  this.updater.enqueueForceUpdate(this, a, "forceUpdate");
};
function F() {
}
F.prototype = E.prototype;
function G(a, b, e) {
  this.props = a;
  this.context = b;
  this.refs = D;
  this.updater = e || B;
}
var H = G.prototype = new F();
H.constructor = G;
C(H, E.prototype);
H.isPureReactComponent = true;
var I = Array.isArray, J = Object.prototype.hasOwnProperty, K = { current: null }, L = { key: true, ref: true, __self: true, __source: true };
function M(a, b, e) {
  var d, c = {}, k = null, h = null;
  if (null != b) for (d in void 0 !== b.ref && (h = b.ref), void 0 !== b.key && (k = "" + b.key), b) J.call(b, d) && !L.hasOwnProperty(d) && (c[d] = b[d]);
  var g = arguments.length - 2;
  if (1 === g) c.children = e;
  else if (1 < g) {
    for (var f = Array(g), m = 0; m < g; m++) f[m] = arguments[m + 2];
    c.children = f;
  }
  if (a && a.defaultProps) for (d in g = a.defaultProps, g) void 0 === c[d] && (c[d] = g[d]);
  return { $$typeof: l, type: a, key: k, ref: h, props: c, _owner: K.current };
}
function N(a, b) {
  return { $$typeof: l, type: a.type, key: b, ref: a.ref, props: a.props, _owner: a._owner };
}
function O(a) {
  return "object" === typeof a && null !== a && a.$$typeof === l;
}
function escape(a) {
  var b = { "=": "=0", ":": "=2" };
  return "$" + a.replace(/[=:]/g, function(a2) {
    return b[a2];
  });
}
var P = /\/+/g;
function Q(a, b) {
  return "object" === typeof a && null !== a && null != a.key ? escape("" + a.key) : b.toString(36);
}
function R(a, b, e, d, c) {
  var k = typeof a;
  if ("undefined" === k || "boolean" === k) a = null;
  var h = false;
  if (null === a) h = true;
  else switch (k) {
    case "string":
    case "number":
      h = true;
      break;
    case "object":
      switch (a.$$typeof) {
        case l:
        case n:
          h = true;
      }
  }
  if (h) return h = a, c = c(h), a = "" === d ? "." + Q(h, 0) : d, I(c) ? (e = "", null != a && (e = a.replace(P, "$&/") + "/"), R(c, b, e, "", function(a2) {
    return a2;
  })) : null != c && (O(c) && (c = N(c, e + (!c.key || h && h.key === c.key ? "" : ("" + c.key).replace(P, "$&/") + "/") + a)), b.push(c)), 1;
  h = 0;
  d = "" === d ? "." : d + ":";
  if (I(a)) for (var g = 0; g < a.length; g++) {
    k = a[g];
    var f = d + Q(k, g);
    h += R(k, b, e, f, c);
  }
  else if (f = A(a), "function" === typeof f) for (a = f.call(a), g = 0; !(k = a.next()).done; ) k = k.value, f = d + Q(k, g++), h += R(k, b, e, f, c);
  else if ("object" === k) throw b = String(a), Error("Objects are not valid as a React child (found: " + ("[object Object]" === b ? "object with keys {" + Object.keys(a).join(", ") + "}" : b) + "). If you meant to render a collection of children, use an array instead.");
  return h;
}
function S(a, b, e) {
  if (null == a) return a;
  var d = [], c = 0;
  R(a, d, "", "", function(a2) {
    return b.call(e, a2, c++);
  });
  return d;
}
function T(a) {
  if (-1 === a._status) {
    var b = a._result;
    b = b();
    b.then(function(b2) {
      if (0 === a._status || -1 === a._status) a._status = 1, a._result = b2;
    }, function(b2) {
      if (0 === a._status || -1 === a._status) a._status = 2, a._result = b2;
    });
    -1 === a._status && (a._status = 0, a._result = b);
  }
  if (1 === a._status) return a._result.default;
  throw a._result;
}
var U = { current: null }, V = { transition: null }, W = { ReactCurrentDispatcher: U, ReactCurrentBatchConfig: V, ReactCurrentOwner: K };
function X() {
  throw Error("act(...) is not supported in production builds of React.");
}
react_production_min.Children = { map: S, forEach: function(a, b, e) {
  S(a, function() {
    b.apply(this, arguments);
  }, e);
}, count: function(a) {
  var b = 0;
  S(a, function() {
    b++;
  });
  return b;
}, toArray: function(a) {
  return S(a, function(a2) {
    return a2;
  }) || [];
}, only: function(a) {
  if (!O(a)) throw Error("React.Children.only expected to receive a single React element child.");
  return a;
} };
react_production_min.Component = E;
react_production_min.Fragment = p;
react_production_min.Profiler = r;
react_production_min.PureComponent = G;
react_production_min.StrictMode = q;
react_production_min.Suspense = w;
react_production_min.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = W;
react_production_min.act = X;
react_production_min.cloneElement = function(a, b, e) {
  if (null === a || void 0 === a) throw Error("React.cloneElement(...): The argument must be a React element, but you passed " + a + ".");
  var d = C({}, a.props), c = a.key, k = a.ref, h = a._owner;
  if (null != b) {
    void 0 !== b.ref && (k = b.ref, h = K.current);
    void 0 !== b.key && (c = "" + b.key);
    if (a.type && a.type.defaultProps) var g = a.type.defaultProps;
    for (f in b) J.call(b, f) && !L.hasOwnProperty(f) && (d[f] = void 0 === b[f] && void 0 !== g ? g[f] : b[f]);
  }
  var f = arguments.length - 2;
  if (1 === f) d.children = e;
  else if (1 < f) {
    g = Array(f);
    for (var m = 0; m < f; m++) g[m] = arguments[m + 2];
    d.children = g;
  }
  return { $$typeof: l, type: a.type, key: c, ref: k, props: d, _owner: h };
};
react_production_min.createContext = function(a) {
  a = { $$typeof: u, _currentValue: a, _currentValue2: a, _threadCount: 0, Provider: null, Consumer: null, _defaultValue: null, _globalName: null };
  a.Provider = { $$typeof: t, _context: a };
  return a.Consumer = a;
};
react_production_min.createElement = M;
react_production_min.createFactory = function(a) {
  var b = M.bind(null, a);
  b.type = a;
  return b;
};
react_production_min.createRef = function() {
  return { current: null };
};
react_production_min.forwardRef = function(a) {
  return { $$typeof: v, render: a };
};
react_production_min.isValidElement = O;
react_production_min.lazy = function(a) {
  return { $$typeof: y, _payload: { _status: -1, _result: a }, _init: T };
};
react_production_min.memo = function(a, b) {
  return { $$typeof: x, type: a, compare: void 0 === b ? null : b };
};
react_production_min.startTransition = function(a) {
  var b = V.transition;
  V.transition = {};
  try {
    a();
  } finally {
    V.transition = b;
  }
};
react_production_min.unstable_act = X;
react_production_min.useCallback = function(a, b) {
  return U.current.useCallback(a, b);
};
react_production_min.useContext = function(a) {
  return U.current.useContext(a);
};
react_production_min.useDebugValue = function() {
};
react_production_min.useDeferredValue = function(a) {
  return U.current.useDeferredValue(a);
};
react_production_min.useEffect = function(a, b) {
  return U.current.useEffect(a, b);
};
react_production_min.useId = function() {
  return U.current.useId();
};
react_production_min.useImperativeHandle = function(a, b, e) {
  return U.current.useImperativeHandle(a, b, e);
};
react_production_min.useInsertionEffect = function(a, b) {
  return U.current.useInsertionEffect(a, b);
};
react_production_min.useLayoutEffect = function(a, b) {
  return U.current.useLayoutEffect(a, b);
};
react_production_min.useMemo = function(a, b) {
  return U.current.useMemo(a, b);
};
react_production_min.useReducer = function(a, b, e) {
  return U.current.useReducer(a, b, e);
};
react_production_min.useRef = function(a) {
  return U.current.useRef(a);
};
react_production_min.useState = function(a) {
  return U.current.useState(a);
};
react_production_min.useSyncExternalStore = function(a, b, e) {
  return U.current.useSyncExternalStore(a, b, e);
};
react_production_min.useTransition = function() {
  return U.current.useTransition();
};
react_production_min.version = "18.3.1";
{
  react.exports = react_production_min;
}
var reactExports = react.exports;
const index = /* @__PURE__ */ getDefaultExportFromCjs(reactExports);
const __mfPrebuildNamespace = /* @__PURE__ */ _mergeNamespaces({
  __proto__: null,
  default: index
}, [reactExports]);
const __mfPrebuildExports = __mfPrebuildNamespace;
const __mf_0$1 = __mfPrebuildExports["Children"];
const __mf_1$1 = __mfPrebuildExports["Component"];
const __mf_2$1 = __mfPrebuildExports["Fragment"];
const __mf_3$1 = __mfPrebuildExports["Profiler"];
const __mf_4$1 = __mfPrebuildExports["PureComponent"];
const __mf_5$1 = __mfPrebuildExports["StrictMode"];
const __mf_6$1 = __mfPrebuildExports["Suspense"];
const __mf_7$1 = __mfPrebuildExports["__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED"];
const __mf_8$1 = __mfPrebuildExports["act"];
const __mf_9$1 = __mfPrebuildExports["cloneElement"];
const __mf_10$1 = __mfPrebuildExports["createContext"];
const __mf_11$1 = __mfPrebuildExports["createElement"];
const __mf_12$1 = __mfPrebuildExports["createFactory"];
const __mf_13$1 = __mfPrebuildExports["createRef"];
const __mf_14$1 = __mfPrebuildExports["forwardRef"];
const __mf_15$1 = __mfPrebuildExports["isValidElement"];
const __mf_16$1 = __mfPrebuildExports["lazy"];
const __mf_17$1 = __mfPrebuildExports["memo"];
const __mf_18$1 = __mfPrebuildExports["startTransition"];
const __mf_19$1 = __mfPrebuildExports["unstable_act"];
const __mf_20$1 = __mfPrebuildExports["useCallback"];
const __mf_21$1 = __mfPrebuildExports["useContext"];
const __mf_22$1 = __mfPrebuildExports["useDebugValue"];
const __mf_23$1 = __mfPrebuildExports["useDeferredValue"];
const __mf_24$1 = __mfPrebuildExports["useEffect"];
const __mf_25$1 = __mfPrebuildExports["useId"];
const __mf_26$1 = __mfPrebuildExports["useImperativeHandle"];
const __mf_27$1 = __mfPrebuildExports["useInsertionEffect"];
const __mf_28$1 = __mfPrebuildExports["useLayoutEffect"];
const __mf_29$1 = __mfPrebuildExports["useMemo"];
const __mf_30$1 = __mfPrebuildExports["useReducer"];
const __mf_31$1 = __mfPrebuildExports["useRef"];
const __mf_32$1 = __mfPrebuildExports["useState"];
const __mf_33$1 = __mfPrebuildExports["useSyncExternalStore"];
const __mf_34$1 = __mfPrebuildExports["useTransition"];
const __mf_35$1 = __mfPrebuildExports["version"];
const __mfLocalShare = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  Children: __mf_0$1,
  Component: __mf_1$1,
  Fragment: __mf_2$1,
  Profiler: __mf_3$1,
  PureComponent: __mf_4$1,
  StrictMode: __mf_5$1,
  Suspense: __mf_6$1,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: __mf_7$1,
  act: __mf_8$1,
  cloneElement: __mf_9$1,
  createContext: __mf_10$1,
  createElement: __mf_11$1,
  createFactory: __mf_12$1,
  createRef: __mf_13$1,
  default: __mfPrebuildExports,
  forwardRef: __mf_14$1,
  isValidElement: __mf_15$1,
  lazy: __mf_16$1,
  memo: __mf_17$1,
  startTransition: __mf_18$1,
  unstable_act: __mf_19$1,
  useCallback: __mf_20$1,
  useContext: __mf_21$1,
  useDebugValue: __mf_22$1,
  useDeferredValue: __mf_23$1,
  useEffect: __mf_24$1,
  useId: __mf_25$1,
  useImperativeHandle: __mf_26$1,
  useInsertionEffect: __mf_27$1,
  useLayoutEffect: __mf_28$1,
  useMemo: __mf_29$1,
  useReducer: __mf_30$1,
  useRef: __mf_31$1,
  useState: __mf_32$1,
  useSyncExternalStore: __mf_33$1,
  useTransition: __mf_34$1,
  version: __mf_35$1
}, Symbol.toStringTag, { value: "Module" }));
const __mfCacheGlobalKey = "__mf_module_cache__";
globalThis[__mfCacheGlobalKey] ||= { share: {}, remote: {} };
globalThis[__mfCacheGlobalKey].share ||= {};
globalThis[__mfCacheGlobalKey].remote ||= {};
const __mfModuleCache = globalThis[__mfCacheGlobalKey];
const __mfNormalizeShareModule = (mod) => {
  let current = mod;
  for (let i = 0; i < 5; i++) {
    const defaultExport = current == null ? void 0 : current.default;
    if (!defaultExport || typeof defaultExport !== "object") break;
    const namedValues = Object.keys(current).filter((key) => key !== "default").map((key) => current[key]);
    if (namedValues.length > 0 && namedValues.some((value) => value !== void 0)) break;
    current = defaultExport;
  }
  return current;
};
let exportModule = __mfModuleCache.share["react"];
if (exportModule === void 0) {
  exportModule = __mfNormalizeShareModule(__mfLocalShare);
  __mfModuleCache.share["react"] = exportModule;
}
const __mfDefaultExport = (() => {
  let current = exportModule;
  for (let i = 0; i < 5; i++) {
    const defaultExport = current == null ? void 0 : current.default;
    if (!defaultExport || typeof defaultExport !== "object") return defaultExport ?? current;
    current = defaultExport;
  }
  return current;
})();
const { Children: __mf_0, Component: __mf_1, Fragment: __mf_2, Profiler: __mf_3, PureComponent: __mf_4, StrictMode: __mf_5, Suspense: __mf_6, __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: __mf_7, act: __mf_8, cloneElement: __mf_9, createContext: __mf_10, createElement: __mf_11, createFactory: __mf_12, createRef: __mf_13, forwardRef: __mf_14, isValidElement: __mf_15, lazy: __mf_16, memo: __mf_17, startTransition: __mf_18, unstable_act: __mf_19, useCallback: __mf_20, useContext: __mf_21, useDebugValue: __mf_22, useDeferredValue: __mf_23, useEffect: __mf_24, useId: __mf_25, useImperativeHandle: __mf_26, useInsertionEffect: __mf_27, useLayoutEffect: __mf_28, useMemo: __mf_29, useReducer: __mf_30, useRef: __mf_31, useState: __mf_32, useSyncExternalStore: __mf_33, useTransition: __mf_34, version: __mf_35 } = exportModule;
const __moduleExports = exportModule;
const _virtual_mf___mfe_internal__pulse_canvas_demo_note__loadShare__react__loadShare__ = /* @__PURE__ */ _mergeNamespaces({
  __proto__: null,
  Children: __mf_0,
  Component: __mf_1,
  Fragment: __mf_2,
  Profiler: __mf_3,
  PureComponent: __mf_4,
  StrictMode: __mf_5,
  Suspense: __mf_6,
  __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED: __mf_7,
  act: __mf_8,
  cloneElement: __mf_9,
  createContext: __mf_10,
  createElement: __mf_11,
  createFactory: __mf_12,
  createRef: __mf_13,
  default: __mfDefaultExport,
  forwardRef: __mf_14,
  isValidElement: __mf_15,
  lazy: __mf_16,
  memo: __mf_17,
  startTransition: __mf_18,
  unstable_act: __mf_19,
  useCallback: __mf_20,
  useContext: __mf_21,
  useDebugValue: __mf_22,
  useDeferredValue: __mf_23,
  useEffect: __mf_24,
  useId: __mf_25,
  useImperativeHandle: __mf_26,
  useInsertionEffect: __mf_27,
  useLayoutEffect: __mf_28,
  useMemo: __mf_29,
  useReducer: __mf_30,
  useRef: __mf_31,
  useState: __mf_32,
  useSyncExternalStore: __mf_33,
  useTransition: __mf_34,
  version: __mf_35
}, [__moduleExports]);
export {
  _virtual_mf___mfe_internal__pulse_canvas_demo_note__loadShare__react__loadShare__ as _,
  __mfPrebuildNamespace as a,
  __mfDefaultExport as b,
  __mf_32 as c,
  __mf_29 as d,
  __mfLocalShare as e
};
