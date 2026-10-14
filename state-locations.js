/**
 * LI · 地点库(CASE · 角色位置与邀请子系统)
 *
 * 地点数据由使用者自建并可自由编辑;LI 子系统本身不预设任何具体地点,
 * 但提供一个"占位初值"(从 XXJ_STATE_PRESETS 里抓取已有 schedule.location),
 * 用户可在 UI 上一键增删改。
 *
 * 数据形态:
 *   window.XXJ_DB.setKv(K.LOCATIONS, list)
 *   K.LOCATIONS = "rp_locations_v1"
 *   list = [{ id, name, description, defaultActivity, tags, createdAt, updatedAt }, ...]
 *
 * 对外 API(window.XXJ_LOCATIONS):
 *   - list()                           当前地点列表
 *   - get(id)                          单个地点
 *   - add({ name, description, defaultActivity, tags }) → 新地点对象
 *   - update(id, patch)                部分更新
 *   - remove(id)                       删除
 *   - seedIfEmpty()                    若库空,从预设 schedule 抓 4 个占位
 *   - importFromPreset(charId)         从某角色 routine 抓地点入库存
 *   - listByTag(tag)                   按 tag 筛选
 *   - on(event, cb) / off(event, cb)   事件订阅(走 XXJ_STATE_EVENTS)
 *
 * 设计原则:
 *   - 不假设任何具体地点(陈府/回春堂都不是硬编码;仅做示例)
 *   - 数据完全用户控制,LI 模块只做 CRUD
 *   - 持久化:每次写后落盘(KV);无 debounce(地点数据少)
 */
(function () {
  if (window.XXJ_LOCATIONS && window.XXJ_LOCATIONS.__installed) return;

  const STATE_EVENTS = window.XXJ_STATE_EVENTS;

  const KEY_LOCATIONS = "rp_locations_v1";

  function dbKey(candidate, fallback) {
    if (window.XXJ_DB && window.XXJ_DB.K && window.XXJ_DB.K[candidate]) {
      return window.XXJ_DB.K[candidate];
    }
    return fallback;
  }

  function nowTs() { return Date.now(); }

  function shortId() {
    return "loc_" + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);
  }

  function readBundle() {
    if (!window.XXJ_DB || typeof window.XXJ_DB.getKv !== "function") return [];
    const key = dbKey("LOCATIONS", KEY_LOCATIONS);
    const cur = window.XXJ_DB.getKv(key);
    return Array.isArray(cur) ? cur : [];
  }

  function writeBundle(list) {
    if (!window.XXJ_DB || typeof window.XXJ_DB.setKv !== "function") return;
    const key = dbKey("LOCATIONS", KEY_LOCATIONS);
    window.XXJ_DB.setKv(key, Array.isArray(list) ? list : []);
  }

  function emit(name, detail) {
    if (STATE_EVENTS && typeof STATE_EVENTS.emit === "function") {
      STATE_EVENTS.emit(name, detail || {});
    }
  }

  function normalizeTags(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map(s => String(s || "").trim()).filter(Boolean);
    }
    if (typeof input === "string") {
      return input.split(/[,，、;；\s]+/).map(s => s.trim()).filter(Boolean);
    }
    return [];
  }

  function list() {
    return readBundle().slice();
  }

  function get(id) {
    if (!id) return null;
    const list = readBundle();
    return list.find(x => x && x.id === id) || null;
  }

  function add(input) {
    if (!input || typeof input !== "object") return null;
    const name = String(input.name || "").trim();
    if (!name) return null;
    const ts = nowTs();
    const item = {
      id: shortId(),
      name: name,
      description: String(input.description || "").trim().slice(0, 500),
      defaultActivity: String(input.defaultActivity || "").trim().slice(0, 200),
      tags: normalizeTags(input.tags),
      createdAt: ts,
      updatedAt: ts
    };
    const list = readBundle();
    list.push(item);
    writeBundle(list);
    emit("rp-location-added", { location: item });
    emit("rp-locations-changed", { reason: "add", location: item });
    return item;
  }

  function update(id, patch) {
    if (!id || !patch || typeof patch !== "object") return null;
    const list = readBundle();
    const idx = list.findIndex(x => x && x.id === id);
    if (idx < 0) return null;
    const cur = list[idx];
    const next = { ...cur };
    if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim();
    if (typeof patch.description === "string") next.description = patch.description.trim().slice(0, 500);
    if (typeof patch.defaultActivity === "string") next.defaultActivity = patch.defaultActivity.trim().slice(0, 200);
    if ("tags" in patch) next.tags = normalizeTags(patch.tags);
    next.updatedAt = nowTs();
    list[idx] = next;
    writeBundle(list);
    emit("rp-location-updated", { location: next });
    emit("rp-locations-changed", { reason: "update", location: next });
    return next;
  }

  function remove(id) {
    if (!id) return false;
    const list = readBundle();
    const idx = list.findIndex(x => x && x.id === id);
    if (idx < 0) return false;
    const removed = list[idx];
    list.splice(idx, 1);
    writeBundle(list);
    emit("rp-location-removed", { location: removed });
    emit("rp-locations-changed", { reason: "remove", location: removed });
    return true;
  }

  function listByTag(tag) {
    if (!tag) return list();
    const t = String(tag).trim();
    return list().filter(x => Array.isArray(x.tags) && x.tags.includes(t));
  }

  /**
   * 若地点库为空,从 XXJ_STATE_PRESETS 抓最多 N 个 location 作占位初值。
   * 不会覆盖已存在数据;只补全。
   */
  function seedIfEmpty(maxCount) {
    const cur = readBundle();
    if (cur.length > 0) return 0;
    const fromPreset = collectLocationsFromPresets();
    const cap = Number.isFinite(maxCount) ? Math.max(1, maxCount) : 6;
    let added = 0;
    for (const item of fromPreset.slice(0, cap)) {
      cur.push({ ...item, id: shortId(), createdAt: nowTs(), updatedAt: nowTs() });
      added++;
    }
    if (added > 0) {
      writeBundle(cur);
      emit("rp-locations-changed", { reason: "seed", count: added });
    }
    return added;
  }

  function collectLocationsFromPresets() {
    const presets = window.XXJ_STATE_PRESETS || {};
    const out = [];
    const seen = new Set();
    for (const preset of Object.values(presets)) {
      if (!preset || !Array.isArray(preset.schedule)) continue;
      for (const s of preset.schedule) {
        const loc = s && s.location;
        if (!loc || seen.has(loc)) continue;
        seen.add(loc);
        out.push({
          name: loc,
          description: (s.activity ? s.activity + "。" : "（无说明）").slice(0, 200),
          defaultActivity: s.activity || "在此处小憩",
          tags: []
        });
      }
    }
    return out;
  }

  /**
   * 从某个 charId 的 preset / routine 中抓地点(去重),入库存;返回新增条数。
   */
  function importFromPreset(charId) {
    if (!charId) return 0;
    const preset = (window.XXJ_STATE_PRESETS || {})[charId] || (window.XXJ_STATE_PRESETS || {})["__default__"];
    if (!preset) return 0;
    const cur = readBundle();
    const before = cur.length;
    const seen = new Set(cur.map(x => x.name));
    if (Array.isArray(preset.schedule)) {
      for (const s of preset.schedule) {
        const loc = s && s.location;
        if (!loc || seen.has(loc)) continue;
        seen.add(loc);
        cur.push({
          id: shortId(),
          name: loc,
          description: (s.activity ? s.activity + "。" : "").slice(0, 200),
          defaultActivity: s.activity || "在此处小憩",
          tags: [],
          createdAt: nowTs(),
          updatedAt: nowTs()
        });
      }
    }
    const added = cur.length - before;
    if (added > 0) {
      writeBundle(cur);
      emit("rp-locations-changed", { reason: "import", count: added, charId });
    }
    return added;
  }

  function on(event, cb) {
    if (!STATE_EVENTS || typeof STATE_EVENTS.on !== "function") return () => {};
    return STATE_EVENTS.on(event, cb);
  }
  function off(event, cb) {
    if (!STATE_EVENTS || typeof STATE_EVENTS.off !== "function") return;
    STATE_EVENTS.off(event, cb);
  }

  window.XXJ_LOCATIONS = {
    list, get, add, update, remove,
    listByTag,
    seedIfEmpty, importFromPreset,
    on, off,
    __installed: true
  };
})();
