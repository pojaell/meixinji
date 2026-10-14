/**
 * CASE · 事件总线
 * 单例,window.XXJ_STATE_EVENTS 暴露。
 * 提供 on/off/emit 三方法;事件名见 EVT 常量。
 * 同时通过 CustomEvent("rp-state-*") / ("xxj-state-*") 兼容 window 广播。
 */
(function () {
  if (window.XXJ_STATE_EVENTS && window.XXJ_STATE_EVENTS.__installed) return;

  /** CASE 自有事件名(对外广播遵循 "rp-*" 已有约定) */
  const EVT = Object.freeze({
    READY:           "rp-state-ready",
    TICK:            "rp-state-tick",
    STATE_CHANGED:   "rp-state-changed",
    PROACTIVE:       "rp-proactive-trigger",
    ROUTINE_CHANGED: "rp-routine-changed",
    INSPECT:         "rp-state-inspect"
  });

  /** 监听器表;name -> Set<Function> */
  const listeners = new Map();

  function on(name, cb) {
    if (!name || typeof cb !== "function") return () => {};
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(cb);
    return () => off(name, cb);
  }

  function off(name, cb) {
    const set = listeners.get(name);
    if (set) set.delete(cb);
  }

  function emit(name, detail) {
    const set = listeners.get(name);
    if (set) {
      for (const cb of set) {
        try {
          cb(detail);
        } catch (err) {
          console.warn("[CASE] listener err for", name, err);
        }
      }
    }
    try {
      window.dispatchEvent(new CustomEvent(name, { detail }));
    } catch (_) {
      /* ignore */
    }
  }

  /** 一次性订阅 */
  function once(name, cb) {
    const offFn = on(name, (detail) => {
      try { cb(detail); } finally { offFn(); }
    });
    return offFn;
  }

  window.XXJ_STATE_EVENTS = {
    EVT,
    on,
    off,
    once,
    emit,
    __installed: true
  };
})();
