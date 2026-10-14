// CASE 子系统挂载自检 — 不在生产中使用,只是阶段性验证
// 在 Node 14+ 中创建 vm context 模拟 window,按 index.html 中顺序加载 5 个 CASE 文件,
// 确认 IIFE 副作用挂载的关键接口名都存在;不跑 IndexedDB 实际读写。
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "state-events.js",
  "state-holidays.js",
  "state-presets-chenzixi.js",
  "state-routine.js",
  "state-engine.js"
];

const ctx = {
  window: {},
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Number, String, Boolean, Object, Array, RegExp,
  Error, TypeError, Set, Map, Promise, Symbol,
  navigator: { userAgent: "node-test" },
  document: { visibilityState: "visible", addEventListener: () => {} },
  CustomEvent: class {
    constructor(name, opts) {
      this.type = name;
      this.detail = (opts && opts.detail) || undefined;
    }
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  Promise
};
ctx.window = ctx; // 简化为全局就是 window

vm.createContext(ctx);

let ok = true;
for (const f of FILES) {
  const p = path.join(ROOT, f);
  const src = fs.readFileSync(p, "utf8");
  try {
    vm.runInContext(src, ctx, { filename: f });
    console.log("OK    " + f);
  } catch (e) {
    ok = false;
    console.log("FAIL  " + f + "  ->  " + e.message);
  }
}

// IIFE 通常把"this"作为 window,这里在 vm 中 this 指向 ctx —— 我们的代码大部分用 window.XXX,
// 也有小段查 top-level this(window 默认在浏览器)。已通过。

const checks = [
  ["window.XXJ_STATE_EVENTS",       () => ctx.XXJ_STATE_EVENTS],
  ["window.XXJ_STATE_HOLIDAYS",     () => ctx.XXJ_STATE_HOLIDAYS],
  ["window.XXJ_STATE_PRESETS",      () => ctx.XXJ_STATE_PRESETS],
  ["window.XXJ_STATE_PRESETS['chenzixi']", () => ctx.XXJ_STATE_PRESETS && ctx.XXJ_STATE_PRESETS.chenzixi],
  ["window.XXJ_STATE_PRESETS['__default__']", () => ctx.XXJ_STATE_PRESETS && ctx.XXJ_STATE_PRESETS["__default__"]],
  ["window.XXJ_ROUTINE",            () => ctx.XXJ_ROUTINE],
  ["window.XXJ_STATE_ENGINE",       () => ctx.XXJ_STATE_ENGINE],
];

console.log("\n— 接口可见性检查 —");
for (const [name, fn] of checks) {
  const v = fn();
  if (v) {
    console.log("✓ " + name);
  } else {
    ok = false;
    console.log("✗ " + name + "  (未挂载)");
  }
}

// 进一步:实测节气判定
if (ctx.XXJ_STATE_HOLIDAYS) {
  const d = new Date(2026, 9, 8); // 10-08, 寒露区段内
  const ritual = ctx.XXJ_STATE_HOLIDAYS.getRitualForDate(d);
  console.log("\n— 10-08 节气判定(应为寒露) —");
  console.log(JSON.stringify(ritual));
}

// 实测 routine.matchSlot 在没有 ROUTINE.engine 下的纯函数行为
if (ctx.XXJ_ROUTINE && ctx.XXJ_STATE_PRESETS && ctx.XXJ_STATE_PRESETS.chenzixi) {
  const matched = ctx.XXJ_ROUTINE.matchSlot(
    ctx.XXJ_STATE_PRESETS.chenzixi,
    14, // 下午两点
    [{ kind: "节气·寒露", source: "solar" }], // 模拟有寒露,看是否会先 hit override
    []
  );
  console.log("\n— 14点+寒露 应走基础 schedule(因为 override.startHour=7-10) —");
  console.log(JSON.stringify(matched));
  // 寒露 + 8点应命中 override
  const m2 = ctx.XXJ_ROUTINE.matchSlot(
    ctx.XXJ_STATE_PRESETS.chenzixi,
    8,
    [{ kind: "节气·寒露", source: "solar" }],
    []
  );
  console.log("— 8点+寒露 应命中 override 后院桂树下 —");
  console.log(JSON.stringify(m2));
}

console.log("\n" + (ok ? "✓ 全部通过" : "✗ 有失败项,见上"));
process.exit(ok ? 0 : 1);
