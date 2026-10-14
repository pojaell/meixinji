/**
 * CASE · 状态机子系统(Character Autonomous State Engine)
 *
 * - 每个角色一份 `CharacterStateMachine`,持有:
 *     mood / energy / attention
 *     daily(日期、互动计数、主动计数等)
 *     proactiveEnabled / proactiveCooldownMs
 *     lastTickAt / lastProactiveAt
 *     milestones
 *
 * - 全局 `XXJ_STATE_ENGINE`:
 *     - loadOrCreate(charId)          注册或获取一个角色机器
 *     - bootstrap()                   启动时:枚举角色库 + 离线补登 + 首次 tick
 *     - start()                       启动 setInterval 60s + 监听 visibilitychange
 *     - notify(kind, charId, meta)    给 app.js 主动调用的入口
 *         - kind: "onUserMessage" | "onCharacterReply" | "onProactiveSent"
 *     - get(charId) / list() / snapshotAll()
 *     - setEnabled("routine" | "proactive", bool) / getEnabled()
 *
 * 主动行为:
 *   - 状态机 tick 末尾跑 shouldProactive(整合 routine.allowProactive/busy/仪式);
 *   - 命中即发 `rp-proactive-trigger` 事件(同步更新 lastProactiveAt + daily.proactiveSent);
 *   - app.js 或桌面 widget 监听该事件 → 走现有"桌面便签 / TTS"通道。
 *
 * 不引入新依赖:
 *   - 不接 LLM、不接 IndexedDB 新 store;
 *   - 持久化走现有 `XXJ_DB.getKv/setKv`(键名 K.STATE_MACHINES / K.STATE_ENABLED)。
 */
(function () {
  if (window.XXJ_STATE_ENGINE && window.XXJ_STATE_ENGINE.__installed) return;

  const EVT_NAME = {
    READY:        "rp-state-ready",
    TICK:         "rp-state-tick",
    STATE_CHANGED:"rp-state-changed",
    PROACTIVE:    "rp-proactive-trigger",
    ROUTINE_CHANGED: "rp-routine-changed",
    INSPECT:      "rp-state-inspect"
  };

  const STATE_EVENTS = window.XXJ_STATE_EVENTS;
  const HOLIDAYS = window.XXJ_STATE_HOLIDAYS;
  const ROUTINE = window.XXJ_ROUTINE;

  /** tick 周期 60s;离线补偿步长 5 分钟;离线补偿总上限 1 天 */
  const TICK_MS = 60 * 1000;
  const COMPENSATE_STEP_MS = 5 * 60 * 1000;
  const COMPENSATE_MAX_STEPS = 24 * 12;
  const PROACTIVE_DAILY_CAP = 3;

  /** 兜底键名(若 XXJ_DB.K 上没有) */
  const KEY_MACHINES = "rp_state_machines_v1";
  const KEY_ENABLED  = "rp_state_enabled_v1";
  const KEY_LUNAR    = "rp_state_lunar_festivals_v1";

  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, +n)); }
  function todayKey(date) {
    const d = date instanceof Date ? date : new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }
  function dbKey(candidate, fallback) {
    if (window.XXJ_DB && window.XXJ_DB.K && window.XXJ_DB.K[candidate]) {
      return window.XXJ_DB.K[candidate];
    }
    return fallback;
  }

  /** 默认一份"从未初始化"的状态机数据 */
  function defaults(charId) {
    return {
      characterId: charId,
      initialized: true,
      version: 1,
      mood: 0.0,        // -1..1,基线心情
      energy: 1.0,      // 0..1,精力
      attention: 0.5,   // 0..1,被关注度(影响主动行为阈值)
      daily: {
        date: todayKey(),
        interactions: 0,
        proactiveSent: 0,
        lastEncounterBrief: null
      },
      milestones: [],
      proactiveEnabled: true,
      proactiveCooldownMs: 2 * 60 * 60 * 1000, // 2h
      lastTickAt: 0,
      lastProactiveAt: 0,
      createdAt: Date.now()
    };
  }

  /**
   * CharacterStateMachine:每个角色一份。
   */
  class CharacterStateMachine {
    constructor(charId, data) {
      this.charId = String(charId || "");
      this.data = data || defaults(this.charId);
      // 运行时缓存(不入库)
      this.cache = {
        ritual: null,
        routineSlot: null
      };
      // 调试查看用,只读快照
      this._snapshot = () => JSON.parse(JSON.stringify(this.data));
    }

    snapshot() { return this._snapshot(); }

    isProactiveEnabled() { return !!this.data.proactiveEnabled; }
    setProactiveEnabled(b) {
      this.data.proactiveEnabled = !!b;
    }
    setProactiveCooldownMs(ms) {
      ms = +ms;
      if (!Number.isFinite(ms)) return;
      this.data.proactiveCooldownMs = Math.max(60 * 1000, ms);
    }

    /**
     * 跨日重置 daily 计数(自动调用,无需外部触发)
     */
    _rolloverIfNewDay(now) {
      const today = todayKey(now);
      if (!this.data.daily || this.data.daily.date !== today) {
        this.data.daily = {
          date: today,
          interactions: 0,
          proactiveSent: 0,
          lastEncounterBrief: null
        };
      }
    }

    /**
     * 应用基线衰减(每 tick 一次)
     */
    _applyBaseline(now) {
      const hour = now.getHours() + now.getMinutes() / 60;
      // 昼夜精力曲线
      let target;
      if (hour < 5) target = 0.2;
      else if (hour < 8) target = 0.6;
      else if (hour < 13) target = 0.9;
      else if (hour < 18) target = 0.7;
      else if (hour < 22) target = 0.5;
      else target = 0.3;
      this.data.energy = clamp(this.data.energy * 0.85 + target * 0.15, 0, 1);

      // mood 向 0 微回归(避免极端)
      this.data.mood = clamp(this.data.mood * 0.97, -1, 1);

      // attention 缓慢回落(模型不在线时回血需要)
      this.data.attention = clamp(this.data.attention * 0.95, 0, 1);

      this.data.lastTickAt = now.getTime();
    }

    /**
     * 应用 routine slot 的 moodShift + busy 注入(读 cache)
     */
    _applyRoutineFromCache() {
      const slot = this.cache.routineSlot;
      if (slot && typeof slot.moodShift === "number" && slot.moodShift !== 0) {
        this.data.mood = clamp(this.data.mood + slot.moodShift * 0.1, -1, 1);
      }
    }

    /**
     * 节气命中 → mood +0.05(温和加成)
     */
    _applyRitual(now) {
      if (!HOLIDAYS) return;
      const ritual = HOLIDAYS.getRitualForDate(now) || [];
      const solar = ritual.find(r => r.source === "solar");
      if (solar) {
        if (this.cache.ritual !== solar.kind) {
          this.cache.ritual = solar.kind;
          this.data.mood = clamp(this.data.mood + 0.05, -1, 1);
        }
      } else {
        this.cache.ritual = null;
      }
    }

    /**
     * tick 一次(主入口)
     */
    tick(now, steps) {
      now = now instanceof Date ? now : new Date();
      steps = Math.max(1, Number(steps) || 1);
      this._rolloverIfNewDay(now);
      for (let i = 0; i < steps; i++) {
        this._applyBaseline(now);
      }
      this._applyRitual(now);
      this._applyRoutineFromCache();
    }

    /**
     * 用户发送一条消息
     */
    onUserMessage(meta) {
      this._rolloverIfNewDay();
      this.data.daily.interactions += 1;
      this.data.attention = clamp(this.data.attention + 0.1, 0, 1);
      this.data.energy = clamp(this.data.energy + 0.05, 0, 1);
      if (meta && typeof meta.brief === "string") {
        this.data.daily.lastEncounterBrief = meta.brief.slice(0, 80);
      }
    }

    /**
     * 角色回复完成(主动给对方 message)
     */
    onCharacterReply(meta) {
      this._rolloverIfNewDay();
      const sentiment = (meta && typeof meta.sentiment === "number") ? meta.sentiment : 0.05;
      this.data.mood = clamp(this.data.mood + sentiment, -1, 1);
      this.data.attention = clamp(this.data.attention + 0.15, 0, 1);
    }

    /**
     * 主动行为发出(由引擎自己调用,无需外部告知)
     */
    onProactiveSent() {
      this._rolloverIfNewDay();
      this.data.lastProactiveAt = Date.now();
      this.data.daily.proactiveSent += 1;
      this.data.attention = clamp(this.data.attention + 0.05, 0, 1);
    }

    /** 标记重要事件(留口子) */
    addMilestone(kind, text) {
      if (!Array.isArray(this.data.milestones)) this.data.milestones = [];
      this.data.milestones.push({ ts: Date.now(), kind: String(kind || "misc"), text: String(text || "") });
      if (this.data.milestones.length > 200) {
        this.data.milestones.splice(0, this.data.milestones.length - 200);
      }
    }
  }

  /* ============================================================
     全局引擎:engines map + tick 调度 + 主动行为判定
     ============================================================ */

  /** charId → CharacterStateMachine */
  const engines = new Map();
  let tickerHandle = 0;
  let lastTickRealTs = 0;
  let bootstrapDone = false;

  async function waitDbReady() {
    if (window.XXJ_DB && window.XXJ_DB.ready) await window.XXJ_DB.ready;
  }

  function getBundle(read) {
    const key = dbKey("STATE_MACHINES", KEY_MACHINES);
    const cur = (window.XXJ_DB && window.XXJ_DB.getKv) ? window.XXJ_DB.getKv(key) : null;
    return cur && typeof cur === "object" ? cur : { v: 1, byCharacter: {} };
  }

  function putBundle(bundle) {
    if (!window.XXJ_DB || typeof window.XXJ_DB.setKv !== "function") return;
    const key = dbKey("STATE_MACHINES", KEY_MACHINES);
    window.XXJ_DB.setKv(key, bundle);
  }

  /** 合并 raw 与 defaults,保证每个字段都有 */
  function mergeMachine(charId, raw) {
    const def = defaults(charId);
    if (!raw || typeof raw !== "object") return def;
    const merged = { ...def, ...raw };
    merged.daily = { ...def.daily, ...(raw.daily || {}) };
    merged.milestones = Array.isArray(raw.milestones) ? raw.milestones.slice() : [];
    return merged;
  }

  /** 加载或创建一个角色机器 */
  async function loadOrCreate(charId) {
    if (!charId) return null;
    if (engines.has(charId)) return engines.get(charId);
    await waitDbReady();
    const bundle = getBundle(true);
    const raw = bundle.byCharacter && bundle.byCharacter[charId];
    const data = mergeMachine(charId, raw);
    const machine = new CharacterStateMachine(charId, data);
    engines.set(charId, machine);
    persistDebounced(machine);
    return machine;
  }

  /** 节流持久化:写但不每 tick 都写 */
  const saveTimers = new Map();
  function persistDebounced(machine) {
    if (!machine) return;
    if (saveTimers.has(machine.charId)) return;
    const t = setTimeout(() => {
      saveTimers.delete(machine.charId);
      const bundle = getBundle(true);
      if (!bundle.byCharacter) bundle.byCharacter = {};
      bundle.v = 1;
      bundle.byCharacter[machine.charId] = machine.snapshot();
      putBundle(bundle);
    }, 1200);
    saveTimers.set(machine.charId, t);
  }

  /** 强制立即持久化(用于切页 / 卸载) */
  function persistNow() {
    if (!window.XXJ_DB || typeof window.XXJ_DB.setKv !== "function") return;
    const bundle = getBundle(true);
    if (!bundle.byCharacter) bundle.byCharacter = {};
    bundle.v = 1;
    for (const machine of engines.values()) {
      bundle.byCharacter[machine.charId] = machine.snapshot();
    }
    putBundle(bundle);
  }

  /** tick 所有机器 + 评估主动行为 */
  function tickAll(now, steps) {
    now = now instanceof Date ? now : new Date();
    for (const machine of engines.values()) {
      machine.tick(now, steps);
      persistDebounced(machine);
    }
    evaluateProactiveAll(now);
    if (STATE_EVENTS) {
      STATE_EVENTS.emit(EVT_NAME.TICK, { at: now.getTime(), count: engines.size });
    }
  }

  /**
   * 是否应主动:综合 state + routine slot + 用户在线猜测
   * (用户在聊天界面时,XXJ_STATE_ENGINE 只看 window.__xxjUserOnline 标记)
   */
  function shouldProactive(machine, now) {
    const s = machine.data;
    if (!s.proactiveEnabled) return false;
    const hour = now.getHours();
    if (hour >= 0 && hour < 6) return false; // 子时静默
    // 冷却 + 当日上限
    if ((s.daily && s.daily.proactiveSent || 0) >= PROACTIVE_DAILY_CAP) return false;
    if (Date.now() - (s.lastProactiveAt || 0) < (s.proactiveCooldownMs || 0)) return false;
    if (s.attention > 0.4) return false;        // 用户最近常在 → 不打扰
    const slot = machine.cache.routineSlot;
    if (slot && slot.busy === "asleep") return false;
    if (slot && slot.allowProactive === false) return false;
    if (slot && slot.allowProactive === "busy" && window.__xxjUserOnline === true) return false;
    // 节气加成
    if (machine.cache.ritual && Math.random() < 0.6) return true;
    // 心情好精力高 → 有兴致
    if (s.mood > 0.3 && s.energy > 0.5) return true;
    return false;
  }

  function evaluateProactiveAll(now) {
    now = now instanceof Date ? now : new Date();
    for (const machine of engines.values()) {
      if (!shouldProactive(machine, now)) continue;
      try {
        machine.onProactiveSent();
        persistDebounced(machine);
        if (STATE_EVENTS) {
          STATE_EVENTS.emit(EVT_NAME.PROACTIVE, {
            charId: machine.charId,
            slot: machine.cache.routineSlot,
            state: machine.snapshot(),
            ritual: machine.cache.ritual,
            at: now.getTime()
          });
        }
      } catch (e) {
        console.warn("[CASE] proactive trigger failed", machine.charId, e);
      }
    }
  }

  /** 离线 gap 补偿估算(返回 steps) */
  function compensateSteps(prevTs) {
    if (!prevTs || prevTs <= 0) return 0;
    const gap = Date.now() - prevTs;
    if (gap <= 0) return 0;
    const steps = Math.floor(gap / COMPENSATE_STEP_MS);
    return Math.min(steps, COMPENSATE_MAX_STEPS);
  }

  function maxLastTickTs() {
    let maxLast = 0;
    for (const m of engines.values()) {
      if ((m.data.lastTickAt || 0) > maxLast) maxLast = m.data.lastTickAt;
    }
    return maxLast;
  }

  function setRoutineSlotForAll() {
    if (!ROUTINE) return;
    const now = new Date();
    /* LI · 过期清涤：每分钟 sweep 一次,过期邀请自动清后,下面 ROUTINE.current()
     * 拿到的不再是 invitation source,会自然回落到原 schedule。 */
    if (window.XXJ_INVITATION && typeof window.XXJ_INVITATION.sweep === "function") {
      try { window.XXJ_INVITATION.sweep(now.getTime()); } catch (_) { /* ignore */ }
    }
    for (const machine of engines.values()) {
      const slot = ROUTINE.current(machine.charId, now);
      machine.cache.routineSlot = slot;
    }
  }

  /** bootstrap:枚举已有角色,生成对应机器,然后跑一次 tick;调用一次即可。 */
  async function bootstrap() {
    if (bootstrapDone) return;
    await waitDbReady();
  
    // db.js 把 KV (角色库 / 世界书 / 头像/装机 等) 放在 KV_LAZY_AT_BOOT,
    // 是后台异步灌入 memKv 的;XXJ_DB.ready resolve 时仅 priority/decor 完成,
    // 但角色库可能还没到位。若这里直接 getKv,会拿到 undefined、ids 为空。
    // 在其他 KV 就绪事件才列举，避免时机坑。
    if (window.__xxjOtherKvReady !== true) {
      await new Promise((resolve) => {
        if (window.__xxjOtherKvReady === true) return resolve();
        let done = false;
        const onReady = () => {
          if (done) return;
          done = true;
          window.removeEventListener("xxj-db-other-ready", onReady);
          resolve();
        };
        window.addEventListener("xxj-db-other-ready", onReady, { once: true });
        // 兑底 15s:不论如何都继续，避免长挂或主机较冷启动时卡住。
        setTimeout(onReady, 15000);
      });
    }
  
    // 1. 找到所有已知角色 id(从 CHAR_PERSONA_STORE.items 与 inbox.threads)
    const ids = new Set();

    try {
      const personas = (window.XXJ_DB.getKv && window.XXJ_DB.getKv(dbKey("CHAR_PERSONA_STORE", "rp_char_persona_store_v2"))) || null;
      if (personas && Array.isArray(personas.items)) {
        for (const it of personas.items) {
          if (it && it.id) ids.add(String(it.id));
        }
      }
    } catch (_) { /* ignore */ }

    try {
      const inbox = (window.XXJ_DB.getKv && window.XXJ_DB.getKv(dbKey("CHAT_INBOX_STORE", "rp_chat_inbox_v1"))) || null;
      if (inbox && inbox.byMask) {
        for (const bucket of Object.values(inbox.byMask)) {
          if (bucket && Array.isArray(bucket.threads)) {
            for (const t of bucket.threads) {
              if (t && t.charId) ids.add(String(t.charId));
            }
          }
        }
      }
    } catch (_) { /* ignore */ }

    // 2. 每个 id 加载 routine,再建 engine
    for (const id of ids) {
      if (ROUTINE) await ROUTINE.load(id);
      await loadOrCreate(id);
    }

    // 3. 给所有引擎设置今日 routine slot 缓存
    setRoutineSlotForAll();

    // 4. 离线补登
    const sinceTs = maxLastTickTs();
    const steps = compensateSteps(sinceTs);
    if (steps > 0) tickAll(new Date(), steps);
    else tickAll(new Date(), 1);

    bootstrapDone = true;
    if (STATE_EVENTS) {
      STATE_EVENTS.emit(EVT_NAME.READY, {
        count: engines.size,
        characters: Array.from(engines.keys())
      });
    }
  }

  /** 启动 tick 循环 */
  function start() {
    if (tickerHandle) return;
    lastTickRealTs = Date.now();
    bootstrap().catch((e) => console.warn("[CASE] bootstrap failed:", e));

    tickerHandle = setInterval(() => {
      const realNow = Date.now();
      const elapsed = Math.max(0, realNow - lastTickRealTs);
      const steps = Math.max(1, Math.floor(elapsed / TICK_MS));
      lastTickRealTs = realNow;
      setRoutineSlotForAll();
      tickAll(new Date(realNow), steps);
    }, TICK_MS);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") {
          const sinceTs = maxLastTickTs();
          const steps = Math.min(compensateSteps(sinceTs), 60);
          if (steps > 0) {
            setRoutineSlotForAll();
            tickAll(new Date(), steps);
          }
        }
      }, { passive: true });
    }

    // 卸载前落盘
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => {
        persistNow();
      }, { passive: true });
      window.addEventListener("beforeunload", () => {
        persistNow();
      }, { passive: true });
    }
  }

  /** 一次性 hook(给 app.js 直接调用) */
  function notify(kind, charId, meta) {
    const machine = engines.get(charId);
    if (!machine) return false;
    if (kind === "onUserMessage") machine.onUserMessage(meta);
    else if (kind === "onCharacterReply") machine.onCharacterReply(meta);
    else if (kind === "onProactiveSent") machine.onProactiveSent();
    else return false;
    persistDebounced(machine);
    if (STATE_EVENTS) {
      STATE_EVENTS.emit(EVT_NAME.STATE_CHANGED, {
        charId,
        kind,
        machine: machine.snapshot()
      });
    }
    return true;
  }

  function get(charId) {
    return engines.get(charId) || null;
  }
  function list() {
    return Array.from(engines.values());
  }
  function snapshotAll() {
    const out = {};
    for (const m of engines.values()) out[m.charId] = m.snapshot();
    return out;
  }

  /** 动态将一个角色加入引擎(用于跨服、新建场景等) */
  async function register(charId) {
    if (ROUTINE) await ROUTINE.load(charId);
    const machine = await loadOrCreate(charId);
    setRoutineSlotForAll();
    return machine;
  }

  /** 全局开关(写 db.js KV,持久化),并把 proactive 状态应用到所有机器 */
  function setEnabled(kind, b) {
    const key = dbKey("STATE_ENABLED", KEY_ENABLED);
    const cur = (window.XXJ_DB && window.XXJ_DB.getKv)
      ? (window.XXJ_DB.getKv(key) || { v: 1, routineEnabled: true, proactiveEnabled: true })
      : { v: 1, routineEnabled: true, proactiveEnabled: true };
    const next = { v: 1, ...cur };
    if (kind === "routine") next.routineEnabled = !!b;
    else if (kind === "proactive") next.proactiveEnabled = !!b;
    else return;
    if (window.XXJ_DB && window.XXJ_DB.setKv) window.XXJ_DB.setKv(key, next);

    if (kind === "proactive") {
      for (const m of engines.values()) m.setProactiveEnabled(next.proactiveEnabled);
    }
    if (kind === "routine") {
      // 切换 routineEnabled 不需重启引擎,tick 时已通过 routine.isEnabled() 判定
    }
  }

  function getEnabled() {
    const key = dbKey("STATE_ENABLED", KEY_ENABLED);
    const cur = (window.XXJ_DB && window.XXJ_DB.getKv)
      ? window.XXJ_DB.getKv(key)
      : null;
    return {
      routineEnabled: !!(!cur || cur.routineEnabled !== false),
      proactiveEnabled: !!(!cur || cur.proactiveEnabled !== false)
    };
  }

  /* ============================================================
     对外
     ============================================================ */

  window.XXJ_STATE_ENGINE = {
    CharacterStateMachine,
    EVT_NAME,
    loadOrCreate,
    register,
    bootstrap,
    start,
    notify,
    get,
    list,
    snapshotAll,
    setEnabled,
    getEnabled,
    tickAll,
    persistNow,
    __installed: true
  };

  /* 自启:在 db.js ready 后,自动 start() 一次(由 index.html 注入位置保证 db 已载) */
  if (window.XXJ_DB && typeof window.XXJ_DB.ready !== "undefined") {
    window.XXJ_DB.ready.then(() => {
      try { start(); } catch (e) { console.warn("[CASE] start failed:", e); }
    }).catch((e) => console.warn("[CASE] wait DB ready:", e));
  }

  /* ============================================================
     动态 wrap XXJ_DB.persistChatInboxNow
     目的:在不改动 app.js / db.js 源码的前提下,抓住「聊天消息写盘」时机,
     自动判断 user / assistant 方向并推进状态机。
     风险面:仅添加函数包装;主体调用仍走原始函函;promise 后检测、不影响主流程。
     ============================================================ */
  (function patchChatPersist() {
    const DB = window.XXJ_DB;
    if (!DB || typeof DB.persistChatInboxNow !== "function") return;
    if (DB.persistChatInboxNow.__xxjStateWired) return;
    const orig = DB.persistChatInboxNow.bind(DB);
    const lastByThread = Object.create(null);

    function detectDelta() {
      try {
        if (!window.XXJ_DB || typeof window.XXJ_DB.getKv !== "function") return;
        const KEY = (DB.K && DB.K.CHAT_INBOX_STORE) || "rp_chat_inbox_v1";
        const inbox = window.XXJ_DB.getKv(KEY);
        if (!inbox || !inbox.byMask) return;
        for (const [maskId, bucket] of Object.entries(inbox.byMask)) {
          if (!bucket || !Array.isArray(bucket.threads)) continue;
          for (const t of bucket.threads) {
            const tId = String(t.id || "");
            if (!tId) continue;
            const tk = String(maskId) + "\x1f" + tId;
            const msgs = Array.isArray(t.messages) ? t.messages : [];
            const lastIdx = msgs.length - 1;
            if (lastIdx < 0) continue;
            const prev = lastByThread[tk];
            if (prev && prev.idx >= lastIdx) {
              lastByThread[tk] = { idx: lastIdx };
              continue;
            }
            if (prev && prev.idx < lastIdx) {
              for (let i = prev.idx + 1; i <= lastIdx; i++) {
                const m = msgs[i];
                if (!m) continue;
                const role = m.role || (m.sender === "assistant" ? "assistant" : (m.sender === "user" ? "user" : null));
                const charId = String(t.charId || "");
                if (!charId) continue;
                if (role === "user") {
                  notify("onUserMessage", charId, {
                    brief: typeof m.content === "string" ? m.content.slice(0, 30) : "",
                    threadId: tId
                  });
                } else if (role === "assistant") {
                  notify("onCharacterReply", charId, { sentiment: 0.05, threadId: tId });
                }
              }
            } else if (!prev) {
              // 首次观察,只补记不报警;避免来当下重启后补路径波动
            }
            lastByThread[tk] = { idx: lastIdx };
          }
        }
      } catch (err) {
        console.warn("[CASE] chat persist delta detect failed:", err);
      }
    }

    const wrapped = function patchedPersistChatInboxNow() {
      const promise = orig.apply(this, arguments);
      try {
        Promise.resolve(promise).then(detectDelta).catch(() => {});
      } catch (_) { /* ignore */ }
      return promise;
    };
    wrapped.__xxjStateWired = true;
    DB.persistChatInboxNow = wrapped;

    // 初始时扫一轮(避免补记错判)
    if (DB.ready) DB.ready.then(() => setTimeout(detectDelta, 0));
  })();
})();
