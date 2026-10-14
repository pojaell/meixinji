// LI 子系统挂载自检 — 不在生产中使用,只是阶段性验证
// 在 Node 14+ 中创建 vm context 模拟 window + mock XXJ_DB(KV 内存版),
// 按 index.html 中顺序加载 CASE + LI 全部 8 个文件,验证:
//   1. 8 个全局对象挂载成功
//   2. 地点 CRUD 闭环
//   3. 邀请 set → 立即生效 → routine.current() 返回 source="invitation" → sweep 清过期 → 回落到 schedule
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const FILES = [
  "state-events.js",
  "state-holidays.js",
  "state-presets-chenzixi.js",
  "state-routine.js",
  "state-engine.js",
  "state-locations.js",
  "state-invitation.js",
  "state-location-ui.js"
];

// 内存版 KV(模拟 XXJ_DB 持久化层)
function makeMockDb() {
  const kv = {};
  return {
    getKv(key) { return kv[key]; },
    setKv(key, value) { kv[key] = value; },
    ready: Promise.resolve(),
    K: {
      LOCATIONS: "rp_locations_v1",
      INVITATIONS: "rp_invitations_v1",
      STATE_MACHINES: "rp_state_machines_v1",
      STATE_ROUTINES: "rp_state_routines_v1",
      STATE_LUNAR_FESTIVALS: "rp_state_lunar_festivals_v1"
    }
  };
}

const ctx = {
  window: {},
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Number, String, Boolean, Object, Array, RegExp,
  Error, TypeError, Set, Map, Promise, Symbol,
  navigator: { userAgent: "node-test" },
  document: {
    visibilityState: "visible",
    addEventListener: () => {},
    removeEventListener: () => {},
    createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, classList: { add: () => {}, remove: () => {}, toggle: () => {} }, addEventListener: () => {}, removeEventListener: () => {} }),
    body: { appendChild: () => {} },
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    head: { appendChild: () => {} }
  },
  CustomEvent: class {
    constructor(name, opts) {
      this.type = name;
      this.detail = (opts && opts.detail) || undefined;
    }
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  MutationObserver: class { observe() {} disconnect() {} },
  Promise
};
ctx.window = ctx;
ctx.XXJ_DB = makeMockDb();

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

const checks = [
  ["window.XXJ_STATE_EVENTS",       () => ctx.XXJ_STATE_EVENTS],
  ["window.XXJ_STATE_HOLIDAYS",     () => ctx.XXJ_STATE_HOLIDAYS],
  ["window.XXJ_STATE_PRESETS",      () => ctx.XXJ_STATE_PRESETS],
  ["window.XXJ_ROUTINE",            () => ctx.XXJ_ROUTINE],
  ["window.XXJ_STATE_ENGINE",       () => ctx.XXJ_STATE_ENGINE],
  ["window.XXJ_LOCATIONS",          () => ctx.XXJ_LOCATIONS],
  ["window.XXJ_INVITATION",         () => ctx.XXJ_INVITATION],
  ["window.XXJ_LOCATION_UI",        () => ctx.XXJ_LOCATION_UI],
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

// — 地点 CRUD 闭环 —
console.log("\n— 地点 CRUD 闭环 —");
const LOCS = ctx.XXJ_LOCATIONS;
const beforeCount = LOCS.list().length;
const chenfu = LOCS.add({
  name: "陈府",
  description: "陈家旧宅,堂主日常起居",
  defaultActivity: "与堂主对坐闲谈",
  tags: ["私宅"]
});
const jishi = LOCS.add({
  name: "镇上集市",
  description: "逢三六九开市",
  defaultActivity: "随人流逛摊",
  tags: ["公共", "陈家周边"]
});
console.log("add() 后 list().length = " + LOCS.list().length + " (期望 " + (beforeCount + 2) + ")");
if (LOCS.list().length !== beforeCount + 2) { ok = false; console.log("✗ add 后数量不对"); }
const got = LOCS.get(chenfu.id);
if (!got || got.name !== "陈府") { ok = false; console.log("✗ get(id) 失败"); }
else console.log("✓ get(id) → " + got.name);

const upd = LOCS.update(chenfu.id, { description: "陈家新宅" });
if (!upd || upd.description !== "陈家新宅") { ok = false; console.log("✗ update 失败"); }
else console.log("✓ update()");

const removed = LOCS.remove(jishi.id);
if (!removed || LOCS.list().length !== beforeCount + 1) { ok = false; console.log("✗ remove 失败"); }
else console.log("✓ remove()");

const tagList = LOCS.listByTag("私宅");
if (!Array.isArray(tagList) || !tagList.find(l => l.id === chenfu.id)) {
  ok = false; console.log("✗ listByTag 失败");
} else console.log("✓ listByTag('私宅') → " + tagList.length + " 条");

// — 邀请生命周期 —
console.log("\n— 邀请 set/active/sweep 闭环 —");
const INV = ctx.XXJ_INVITATION;
const ROUTINE = ctx.XXJ_ROUTINE;

// async 主块
(async function main() {
  // 把陈子奚加到 ROUTINE 才能跑 current()
  if (ROUTINE && typeof ROUTINE.load === "function") {
    await ROUTINE.load("chenzixi");
  }

  // set 一条邀请:2 小时
  const inv = INV.set("chenzixi", {
    locationId: chenfu.id,
    duration: 2 * 60 * 60 * 1000
  });
  if (!inv) {
    ok = false;
    console.log("✗ set() 失败");
  } else {
    console.log("✓ set() → expiresAt=" + new Date(inv.expiresAt).toISOString());

    const active = INV.active("chenzixi");
    if (!active || active.locationId !== chenfu.id) {
      ok = false;
      console.log("✗ active() 失败");
    } else {
      console.log("✓ active() → locationId=" + active.locationId);
    }

    // ROUTINE.current 应当返回 source="invitation"
    if (ROUTINE && typeof ROUTINE.current === "function") {
      const slot = ROUTINE.current("chenzixi");
      if (slot && slot.source === "invitation" && slot.location === "陈府") {
        console.log("✓ ROUTINE.current() 命中邀请 → " + slot.location + " / " + slot.activity);
      } else {
        ok = false;
        console.log("✗ ROUTINE.current() 未命中邀请,得到 " + JSON.stringify(slot));
      }
    }

    // 模拟过期 sweep:传未来时间戳
    const expired = INV.sweep(inv.expiresAt + 1000);
    if (expired.indexOf("chenzixi") >= 0) {
      console.log("✓ sweep() 清掉 " + JSON.stringify(expired));
    } else {
      ok = false;
      console.log("✗ sweep() 未清掉,得到 " + JSON.stringify(expired));
    }

    const afterSweep = INV.active("chenzixi");
    if (afterSweep === null) console.log("✓ sweep 后 active() = null");
    else { ok = false; console.log("✗ sweep 后 active() 仍返回 " + JSON.stringify(afterSweep)); }

    // 回到无邀请状态,ROUTINE.current 应回落 schedule
    if (ROUTINE && typeof ROUTINE.current === "function") {
      const slot2 = ROUTINE.current("chenzixi");
      if (slot2 && slot2.source !== "invitation") {
        console.log("✓ 邀请过期后,ROUTINE.current() 回落到 source='" + slot2.source + "'");
      } else {
        console.log("(信息) 邀请过期后 ROUTINE.current() = " + JSON.stringify(slot2));
      }
    }
  }

  // cancel 测试
  console.log("\n— cancel 测试 —");
  INV.set("chenzixi", { locationId: chenfu.id, duration: 60 * 60 * 1000 });
  const okCancel = INV.cancel("chenzixi");
  if (okCancel && INV.active("chenzixi") === null) {
    console.log("✓ cancel() 立即生效");
  } else {
    ok = false;
    console.log("✗ cancel() 失败");
  }

  // 边界:无效 duration
  console.log("\n— 边界:无效 duration 应返回 null —");
  const bad = INV.set("chenzixi", { locationId: chenfu.id, duration: 1000 });
  if (bad === null) console.log("✓ duration < 1min 被拒绝");
  else { ok = false; console.log("✗ duration < 1min 未拒绝"); }

  console.log("\n" + (ok ? "✓ 全部通过" : "✗ 有失败项,见上"));
  process.exit(ok ? 0 : 1);
})().catch(err => { console.log("MAIN ERROR: " + err.message); process.exit(1); });