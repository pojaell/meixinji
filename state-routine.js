/**
 * CASE · 日常/作息子系统
 *
 * 数据:
 *   window.XXJ_STATE_DB.getKv(K.STATE_ROUTINES) 形如:
 *     { v:1, byCharacter: { [charId]: { characterId, routineEnabled, schedule, overrides, history, meta } } }
 *
 * 角色预设回退:
 *   若 IndexedDB 无 charId,自动使用 window.XXJ_STATE_PRESETS[charId];
 *   仍未匹配 → 使用窗口 XXJ_STATE_PRESETS["__default__"]。
 *
 * 对外 API:
 *   - load(charId) → CharacterRoutine(从 IndexedDB 或预设)
 *   - save(routine) → 写回(强制覆盖)
 *   - current(charId, date?) → { location, activity, busy, moodShift, allowProactive, hour, source, overrideName }
 *   - atHour(charId, hour)  → 同上结构(支持任意小时查询)
 *   - today(charId) → 24 段(slot | null)数组
 *   - predictNextBreakpoint(charId, date?) → { atHour, location, activity } | null
 *   - recordEncounter(charId, { location, activity, note })  写入 history
 *   - currentText(charId, date?)  给 UI 用的短句
 *   - buildPromptHint(charId, date?)  给 chat 注入的 hint 文本
 *   - ensureForAll(characters[])  为一批角色预加载
 *   - defaultForCharacter(charId)  只读预设拷贝,不入库
 *   - matchSlot(routine, hour, ritual[], festivals[])  纯函数,便于测试
 */
(function () {
  if (window.XXJ_ROUTINE && window.XXJ_ROUTINE.__installed) return;

  const STATE_EVENTS = window.XXJ_STATE_EVENTS;
  const HOLIDAYS = window.XXJ_STATE_HOLIDAYS;

  const KEY_ROUTINES = "rp_state_routines_v1";
  const KEY_ENABLED  = "rp_state_enabled_v1";

  function clampHour(h) { return Math.max(0, Math.min(23, Math.floor(Number(h) || 0))); }

  /** 当前数字小时(本地时区,0..23,允许小数但本接口内只取整) */
  function hourOf(date) {
    if (!(date instanceof Date)) date = new Date();
    return date.getHours();
  }

  /**
   * 给定 schedule 与 hour,返回命中的 slot 或 null。
   * 命中规则:hour ∈ [startHour, endHour)。
   */
  function findInSchedule(schedule, hour) {
    if (!Array.isArray(schedule) || schedule.length === 0) return null;
    const h = clampHour(hour);
    for (const s of schedule) {
      const start = +s.startHour, end = +s.endHour;
      if (Number.isFinite(start) && Number.isFinite(end) && h >= start && h < end) {
        return s;
      }
    }
    // 兜底:若端点不正交(比如结束小于开始),退回到第一个
    return schedule[0] || null;
  }

  /**
   * 给定 override 与 hour,返回命中的 slot 或 null。
   */
  function pickFromReplace(replace, hour) {
    return findInSchedule(replace, hour);
  }

  /**
   * 主匹配:overrides(按 matchRitual/matchFestival)优先,否则基础 schedule。
   * @param {object} routine
   * @param {number} hour
   * @param {Array<{kind:string,source:string}>} rituals  当日节气列表
   * @param {Array<{kind:string,source:string}>} festivals 当日节日列表
   */
  function matchSlot(routine, hour, rituals, festivals) {
    if (!routine) return null;
    const overrides = Array.isArray(routine.overrides) ? routine.overrides : [];
    const ritualsArr = Array.isArray(rituals) ? rituals : (rituals ? [rituals] : []);
    const festivalsArr = Array.isArray(festivals) ? festivals : (festivals ? [festivals] : []);

    for (const ov of overrides) {
      let hit = false;
      if (ov.matchRitual && ritualsArr.some(r => r && r.kind === ov.matchRitual)) hit = true;
      if (!hit && ov.matchFestival && festivalsArr.some(f => f && f.kind === ov.matchFestival)) hit = true;
      if (!hit) continue;
      const slot = pickFromReplace(ov.replace, hour);
      if (slot) {
        return {
          startHour: +slot.startHour,
          endHour:   +slot.endHour,
          location:  slot.location || "",
          activity:  slot.activity || "",
          busy:      slot.busy || "leisure",
          moodShift: typeof slot.moodShift === "number" ? slot.moodShift : 0,
          allowProactive: slot.allowProactive,
          source: "override",
          overrideName: ov.name || "(节气/节日覆盖)"
        };
      }
    }
    const slot = findInSchedule(routine.schedule, hour);
    if (!slot) return null;
    return {
      startHour: +slot.startHour,
      endHour:   +slot.endHour,
      location:  slot.location || "",
      activity:  slot.activity || "",
      busy:      slot.busy || "leisure",
      moodShift: typeof slot.moodShift === "number" ? slot.moodShift : 0,
      allowProactive: slot.allowProactive,
      source: "schedule",
      overrideName: null
    };
  }

  /**
   * CharacterRoutine 实例:持有 data + 一些辅助访问。
   * routine.charId = id;routine.data = { characterId, schedule, overrides, history, meta, routineEnabled }。
   */
  class CharacterRoutine {
    constructor(charId, data) {
      this.charId = String(charId || "");
      this.data = data || {
        characterId: this.charId,
        routineEnabled: true,
        schedule: [],
        overrides: [],
        history: [],
        meta: { schemaVersion: 1, source: "memory" }
      };
      this.initializedAt = 0;
    }
    isEnabled() { return !!this.data.routineEnabled; }
    setEnabled(b) {
      this.data.routineEnabled = !!b;
      this._bump("routineEnabled");
    }
    setSchedule(schedule) {
      this.data.schedule = Array.isArray(schedule) ? schedule.slice() : [];
      this._bump("schedule");
    }
    setOverrides(overrides) {
      this.data.overrides = Array.isArray(overrides) ? overrides.slice() : [];
      this._bump("overrides");
    }
    recordEncounter(meta) {
      if (!meta || typeof meta !== "object") return;
      if (!Array.isArray(this.data.history)) this.data.history = [];
      this.data.history.push({
        ts: Date.now(),
        location: meta.location || "",
        activity: meta.activity || "",
        note: meta.note || ""
      });
      if (this.data.history.length > 200) {
        this.data.history.splice(0, this.data.history.length - 200);
      }
      this._bump("history");
    }
    _bump(reason) {
      if (!this.data.meta) this.data.meta = {};
      this.data.meta.lastEditAt = Date.now();
      this.data.meta.lastEditReason = reason;
    }

    /**
     * 当前 slot(自动融合当日 ritual;LI · 邀请优先级)
     */
    current(date) {
      const when = date instanceof Date ? date : new Date();

      /* LI · 邀请优先级:有 active 邀请时,直接返回邀请地 slot,
       * 覆盖 schedule / 节气 override。
       * 走这一路:buildPromptHint / setRoutineSlotForAll / current() 都自动命中。 */
      if (this.charId &&
          window.XXJ_INVITATION && typeof window.XXJ_INVITATION.active === "function") {
        const inv = window.XXJ_INVITATION.active(this.charId);
        if (inv) {
          const LOCS = window.XXJ_LOCATIONS;
          const loc = (LOCS && typeof LOCS.get === "function") ? LOCS.get(inv.locationId) : null;
          if (loc) {
            return {
              startHour: when.getHours(),
              endHour: 24,
              location: loc.name,
              activity: loc.defaultActivity || "随你安排",
              busy: "leisure",
              moodShift: 0,
              allowProactive: true,
              source: "invitation",
              overrideName: null,
              invitation: inv,
              at: when.getTime(),
              hour: when.getHours()
            };
          }
        }
      }

      const allRitual = (HOLIDAYS && typeof HOLIDAYS.getRitualForDate === "function")
        ? HOLIDAYS.getRitualForDate(when) : [];
      const solar = allRitual.filter(r => r.source === "solar");
      const festivals = allRitual.filter(r => r.source === "fixed" || r.source === "lunar");
      const slot = matchSlot(this.data, hourOf(when), solar, festivals);
      if (!slot) return null;
      return { ...slot, at: when.getTime(), hour: hourOf(when) };
    }

    /**
     * 指定小时(本地整数 0..23)的 slot;不做 ritual 覆盖查询(传空数组)。
     */
    atHour(hour) {
      const h = clampHour(hour);
      // 用一份干净的 ritual(可由上层决定是否传)
      const slot = matchSlot(this.data, h, [], []);
      if (!slot) return null;
      return { ...slot, hour: h };
    }

    /**
     * 完整 24 段 schedule 视图(每日使用,不考虑具体日期)。
     */
    today() {
      const out = [];
      for (let h = 0; h < 24; h++) out.push(this.atHour(h));
      return out;
    }

    /**
     * 下一段切换点(自当前小时起),含 location/activity。
     * @returns { atHour, location, activity } | null
     */
    predictNextBreakpoint(date) {
      const startHour = hourOf(date || new Date());
      const today = this.today();
      for (let h = startHour + 1; h < today.length; h++) {
        const s = today[h];
        const prev = today[h - 1];
        if (!s) continue;
        if (!prev || prev.location !== s.location || prev.activity !== s.activity) {
          return { atHour: h, location: s.location, activity: s.activity };
        }
      }
      return null;
    }
  }

  /** 内存缓存:charId → CharacterRoutine */
  const registry = new Map();

  /** 兼容性 hook,给 state-engine.js 直接查(internal use only) */
  function __internalGet(charId) {
    return registry.get(charId) || null;
  }

  function persistenceReady() {
    if (window.XXJ_DB && window.XXJ_DB.ready) return window.XXJ_DB.ready;
    return Promise.resolve();
  }

  /** 查找 schedule 数据源(返回 { schedule, overrides, routineEnabled, meta })。
   * 查找顺序:
   *   1. persona.routineSchedule (新: 直接挂 persona 上的作息数组)
   *   2. persona.routinePreset  → XXJ_STATE_PRESETS[slug] 命中
   *   3. presets[charId] 直命中 (边缘场景)
   *   4. presets["__default__"] 兜底
   * 都没有 → 返回 null
   */
  function defaultForCharacter(charId) {
    const presets = window.XXJ_STATE_PRESETS || {};
    let personaItem = null;
    try {
      const D = window.XXJ_DB;
      if (D && D.getKv && D.K && D.K.CHAR_PERSONA_STORE && charId) {
        const st = D.getKv(D.K.CHAR_PERSONA_STORE);
        if (st && Array.isArray(st.items)) {
          personaItem = st.items.find(x => x && String(x.id) === String(charId)) || null;
        }
      }
    } catch { /* ignore */ }

    // 1. persona.routineSchedule 优先(新机制,用户自写或 LLM 生成的)
    if (personaItem && Array.isArray(personaItem.routineSchedule) && personaItem.routineSchedule.length) {
      try {
        return {
          characterId: charId,
          routineEnabled: true,
          schedule: personaItem.routineSchedule.map(x => ({ ...x })),
          overrides: [],
          history: [],
          meta: {
            source: "persona://routineSchedule",
            presetKey: "",
            schemaVersion: 1,
            updatedAt: Number(personaItem.__routineScheduleUpdatedAt) || 0
          }
        };
      } catch (e) {
        console.warn("[CASE] defaultForCharacter persona.routineSchedule deepcopy failed:", e);
      }
    }

    // 2. persona.routinePreset → XXJ_STATE_PRESETS[slug](旧机制,向下兼容)
    let presetKey = "";
    if (personaItem && personaItem.routinePreset) {
      const slug = String(personaItem.routinePreset).trim();
      if (slug && presets[slug]) presetKey = slug;
    }
    if (!presetKey && charId && presets[charId]) presetKey = String(charId);
    if (!presetKey && presets["__default__"]) presetKey = "__default__";
    const preset = presetKey ? presets[presetKey] : null;
    if (!preset) return null;
    try {
      return {
        characterId: charId,
        routineEnabled: !!preset.routineEnabled,
        schedule: Array.isArray(preset.schedule) ? preset.schedule.map(x => ({ ...x })) : [],
        overrides: Array.isArray(preset.overrides) ? preset.overrides.map(o => ({
          ...o,
          replace: Array.isArray(o.replace) ? o.replace.map(x => ({ ...x })) : []
        })) : [],
        history: [],
        meta: {
          ...(preset.meta || {}),
          source: "preset://" + presetKey,
          presetKey,
          schemaVersion: 1
        }
      };
    } catch (e) {
      console.warn("[CASE] defaultForCharacter deepcopy failed:", e);
      return null;
    }
  }

  /** 读取整包(若 K 不在 window.XXJ_DB 中,使用本地 fallback 常量;MVP 阶段无 schema 升级) */
  function readBundle() {
    if (!window.XXJ_DB || typeof window.XXJ_DB.getKv !== "function") return { v: 1, byCharacter: {} };
    const key = (window.XXJ_DB.K && window.XXJ_DB.K.STATE_ROUTINES) || KEY_ROUTINES;
    const cur = window.XXJ_DB.getKv(key);
    return cur && typeof cur === "object" ? cur : { v: 1, byCharacter: {} };
  }

  function writeBundle(bundle) {
    if (!window.XXJ_DB || typeof window.XXJ_DB.setKv !== "function") return;
    const key = (window.XXJ_DB.K && window.XXJ_DB.K.STATE_ROUTINES) || KEY_ROUTINES;
    window.XXJ_DB.setKv(key, bundle);
  }

  /** 异步加载;首次调用需要 await XXJ_DB.ready。 */
  async function load(charId) {
    if (!charId) return null;
    if (registry.has(charId)) return registry.get(charId);
    await persistenceReady();
    const bundle = readBundle();
    let raw = bundle.byCharacter && bundle.byCharacter[charId];
    let data;
    let source;
    if (raw && typeof raw === "object") {
      data = raw;
      source = raw.meta && raw.meta.source || "idb";
    } else {
      data = defaultForCharacter(charId);
      source = data && data.meta && data.meta.source;
      if (!data) {
        // 实在没预设时构造一个空壳(后续用户可编辑填充)
        data = {
          characterId: charId,
          routineEnabled: false,
          schedule: [],
          overrides: [],
          history: [],
          meta: { schemaVersion: 1, source: "empty" }
        };
        source = "empty";
      }
    }
    const routine = new CharacterRoutine(charId, data);
    routine.initializedAt = Date.now();
    registry.set(charId, routine);
    if (STATE_EVENTS) {
      STATE_EVENTS.emit(STATE_EVENTS.EVT.ROUTINE_CHANGED, {
        charId,
        source,
        routine
      });
    }
    return routine;
  }

  /** 落盘;30 秒内多次 save 节流到一次。 */
  function save(routine) {
    if (!routine || !routine.charId) return Promise.resolve();
    return Promise.resolve().then(async () => {
      await persistenceReady();
      const bundle = readBundle();
      if (!bundle.byCharacter) bundle.byCharacter = {};
      bundle.v = 1;
      bundle.byCharacter[routine.charId] = {
        ...routine.data,
        meta: {
          ...(routine.data.meta || {}),
          lastSavedAt: Date.now()
        }
      };
      writeBundle(bundle);
      if (STATE_EVENTS) {
        STATE_EVENTS.emit(STATE_EVENTS.EVT.ROUTINE_CHANGED, { charId: routine.charId, routine });
      }
    });
  }

  /**
   * 外部入口:把某角色的作息覆写为指定 schedule,
   * 并保证 LI·位置条 / CASE·调度走在同一份新数据上。
   * 为什么要这个函数:registry 里缓存了 CharacterRoutine,
   * 默认途径 load() 会是「命中缓存直接返回」不再调用 defaultForCharacter,
   * 所以只写 persona.routineSchedule 不能让 LI 拿到新表。
   * 这里会顺手:
   *   1. 清掉该 charId 的缓存
   *   2. 重新走 defaultForCharacter / STATE_ROUTINES (新加载,会拿到 persona.routineSchedule)
   *   3. setSchedule 覆写
   *   4. save 落盘到 STATE_ROUTINES bundle (LI·位置条读这边)
   *   5. emit RoutineChanged 通知订阅者
   * 不传 opts.preserveEnabled:true 时会连 routineEnabled 一起开。
   * @param {string} charId
   * @param {Array<{startHour:number,endHour:number,location:string,activity:string,busy?:string,moodShift?:number,allowProactive?:(boolean|'busy')}>} schedule
   * @param {{ source?: string }} [opts]
   */
  async function applyExternalSchedule(charId, schedule, opts) {
    if (!charId) return false;
    const list = Array.isArray(schedule) ? schedule : [];
    // 1) 失效缓存
    try {
      if (registry && typeof registry.delete === "function") registry.delete(String(charId));
    } catch (err) {
      console.warn("[CASE] applyExternalSchedule invalidate failed:", err);
    }
    // 2) 重新加载(会重新走 defaultForCharacter 拿到 persona.routineSchedule / 旧 STATE_ROUTINES)
    let routine = null;
    try {
      routine = await load(charId);
    } catch (err) {
      console.warn("[CASE] applyExternalSchedule load failed:", err);
      return false;
    }
    if (!routine || typeof routine.setSchedule !== "function") return false;
    // 3) 用新 schedule 覆写
    routine.setSchedule(list);
    routine.setEnabled(true);
    // 4) 落盘到 STATE_ROUTINES(byCharacter[charId])
    try {
      await save(routine);
    } catch (err) {
      console.warn("[CASE] applyExternalSchedule save failed:", err);
    }
    // 5) 补发一次事件(让订阅者 - LI·位置条 / invite - 重新从 registry 读最新 schedule)
    if (STATE_EVENTS) {
      STATE_EVENTS.emit(STATE_EVENTS.EVT.ROUTINE_CHANGED, {
        charId,
        source: (opts && opts.source) || "external-schedule",
        routine
      });
    }
    return true;
  }

  /** 为一批角色预加载(常用启动路径) */
  async function ensureForAll(characters) {
    const list = Array.isArray(characters) ? characters : [];
    const out = [];
    for (const ch of list) {
      const id = (ch && (ch.id || ch.characterId)) || null;
      if (!id) continue;
      await load(id);
      out.push(id);
    }
    return out;
  }

  function listLoadedIds() {
    return Array.from(registry.keys());
  }

  function current(charId, date) {
    const r = registry.get(charId);
    return r ? r.current(date) : null;
  }

  function atHour(charId, hour) {
    const r = registry.get(charId);
    return r ? r.atHour(hour) : null;
  }

  function today(charId) {
    const r = registry.get(charId);
    return r ? r.today() : [];
  }

  function predictNextBreakpoint(charId, date) {
    const r = registry.get(charId);
    return r ? r.predictNextBreakpoint(date) : null;
  }

  function recordEncounter(charId, meta) {
    const r = registry.get(charId);
    if (!r) return null;
    r.recordEncounter(meta);
    save(r);
    return r;
  }

  function currentText(charId, date) {
    const slot = current(charId, date);
    if (!slot) return null;
    if (slot.activity && slot.location) return `${slot.location} · ${slot.activity}`;
    return slot.activity || slot.location || "";
  }

  /**
   * 给 chat 注入的简短 hint 行;空 routine / 未启用 → 返回空串。
   */
  function buildPromptHint(charId, date) {
    const r = registry.get(charId);
    if (!r || !r.isEnabled()) return "";
    const slot = r.current(date);
    if (!slot) return "";
    const hour = hourOf(date);
    const tenure = hour < 5 ? "深夜" :
                    hour < 11 ? "上午" :
                    hour < 13 ? "午时" :
                    hour < 18 ? "下午" :
                    hour < 22 ? "傍晚" : "入夜";
    const niceBusy = ({
      asleep:   "沉睡",
      treating: "坐诊",
      resting:  "午歇",
      exercise: "习武/活动",
      focused:  "专注中",
      leisure:  "闲处",
      ritual:   "正行祭礼"
    })[slot.busy] || slot.busy || "在";
    let line = `[CASE 本时] ${tenure} · 身处:${slot.location} · 正在:${slot.activity}(${niceBusy})`;
    if (slot.source === "override" && slot.overrideName) {
      line += ` · 触发覆盖:${slot.overrideName}`;
    }
    return line;
  }

  window.XXJ_ROUTINE = {
    CharacterRoutine,
    matchSlot,
    load, save,
    applyExternalSchedule,
    current, atHour, today, predictNextBreakpoint,
    recordEncounter,
    currentText,
    buildPromptHint,
    ensureForAll,
    listLoadedIds,
    defaultForCharacter,
    __internalGet,
    __installed: true
  };
})();
