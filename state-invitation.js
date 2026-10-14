/**
 * LI · 邀请子系统(角色位置与邀请)
 *
 * 把"用户邀请角色临时前往某地"作为可持续状态(几小时)记入引擎。
 * XXJ_ROUTINE.current(charId) 在拉取 slot 时优先看这里,有邀请就直接覆盖。
 *
 * 数据形态:
 *   window.XXJ_DB.setKv(K.INVITATIONS, { byCharacter: { charId: Invitation } })
 *   K.INVITATIONS = "rp_invitations_v1"
 *   Invitation = {
 *     charId, locationId, startedAt, expiresAt, duration, createdBy, createdAt
 *   }
 *
 * 对外 API(window.XXJ_INVITATION):
 *   - set(charId, { locationId, duration, createdBy })   创建/覆盖邀请
 *   - cancel(charId)                                     主动取消
 *   - active(charId)                                     返回 active 邀请或 null
 *   - all()                                              全部 active 邀请
 *   - sweep(now?)                                        清过期;返回清掉的数量
 *   - clear(charId)                                      与 cancel 同义
 *   - on(event, cb) / off(event, cb)
 *
 * 事件:
 *   - rp-invitation-set         (新建或更新)
 *   - rp-invitation-cleared     (用户主动取消)
 *   - rp-invitation-expired     (sweep 清理过期)
 *
 * 设计:
 *   - 一个 charId 同一时间最多一个 active 邀请;set() 直接覆盖
 *   - duration 单位 ms,UI 暴露 1h / 2h / 4h 三个选项
 *   - 持久化:每次写后落盘
 *   - sweep() 跑在 state-engine.js tick 里(每分钟)
 */
(function () {
  if (window.XXJ_INVITATION && window.XXJ_INVITATION.__installed) return;

  const STATE_EVENTS = window.XXJ_STATE_EVENTS;

  const KEY_INVITATIONS = "rp_invitations_v1";

  function dbKey(candidate, fallback) {
    if (window.XXJ_DB && window.XXJ_DB.K && window.XXJ_DB.K[candidate]) {
      return window.XXJ_DB.K[candidate];
    }
    return fallback;
  }

  function nowTs() { return Date.now(); }

  function readBundle() {
    if (!window.XXJ_DB || typeof window.XXJ_DB.getKv !== "function") {
      return { v: 1, byCharacter: {} };
    }
    const key = dbKey("INVITATIONS", KEY_INVITATIONS);
    const cur = window.XXJ_DB.getKv(key);
    if (cur && typeof cur === "object" && cur.byCharacter) return cur;
    return { v: 1, byCharacter: {} };
  }

  function writeBundle(bundle) {
    if (!window.XXJ_DB || typeof window.XXJ_DB.setKv !== "function") return;
    const key = dbKey("INVITATIONS", KEY_INVITATIONS);
    window.XXJ_DB.setKv(key, bundle);
  }

  function emit(name, detail) {
    if (STATE_EVENTS && typeof STATE_EVENTS.emit === "function") {
      STATE_EVENTS.emit(name, detail || {});
    }
  }

  /**
   * 创建或覆盖某角色的邀请。duration 单位 ms。
   * 校验 locationId 存在(若 XXJ_LOCATIONS 可用);否则接受(便于未加载 LI 时也能写)。
   */
  function set(charId, opts) {
    if (!charId) return null;
    if (!opts || typeof opts !== "object") return null;
    const locationId = String(opts.locationId || "").trim();
    if (!locationId) return null;
    const duration = +opts.duration;
    if (!Number.isFinite(duration) || duration < 60 * 1000) return null;
    const ts = nowTs();
    const inv = {
      charId: String(charId),
      locationId: locationId,
      startedAt: ts,
      expiresAt: ts + duration,
      duration: duration,
      createdBy: String(opts.createdBy || "user"),
      createdAt: ts
    };
    const bundle = readBundle();
    bundle.byCharacter[String(charId)] = inv;
    bundle.v = 1;
    writeBundle(bundle);
    emit("rp-invitation-set", { invitation: inv });
    return inv;
  }

  function cancel(charId) {
    if (!charId) return false;
    const bundle = readBundle();
    if (!bundle.byCharacter[String(charId)]) return false;
    delete bundle.byCharacter[String(charId)];
    writeBundle(bundle);
    emit("rp-invitation-cleared", { charId: String(charId) });
    return true;
  }

  function clear(charId) { return cancel(charId); }

  function active(charId) {
    if (!charId) return null;
    const bundle = readBundle();
    const inv = bundle.byCharacter[String(charId)];
    if (!inv) return null;
    if (!Number.isFinite(inv.expiresAt) || inv.expiresAt <= nowTs()) {
      // 已过期,顺手清掉
      delete bundle.byCharacter[String(charId)];
      writeBundle(bundle);
      return null;
    }
    return inv;
  }

  function all() {
    const bundle = readBundle();
    const ts = nowTs();
    const out = {};
    let dirty = false;
    for (const [cid, inv] of Object.entries(bundle.byCharacter || {})) {
      if (inv && Number.isFinite(inv.expiresAt) && inv.expiresAt > ts) {
        out[cid] = inv;
      } else {
        dirty = true;
        delete bundle.byCharacter[cid];
      }
    }
    if (dirty) writeBundle(bundle);
    return out;
  }

  /**
   * 清理过期邀请;返回被清理的 charId 列表。
   * state-engine.js tick 会每分钟调一次。
   */
  function sweep(now) {
    const ts = Number.isFinite(now) ? now : nowTs();
    const bundle = readBundle();
    const expired = [];
    for (const [cid, inv] of Object.entries(bundle.byCharacter || {})) {
      if (inv && Number.isFinite(inv.expiresAt) && inv.expiresAt <= ts) {
        expired.push(cid);
        delete bundle.byCharacter[cid];
      }
    }
    if (expired.length > 0) {
      writeBundle(bundle);
      for (const cid of expired) {
        emit("rp-invitation-expired", { charId: cid });
      }
    }
    return expired;
  }

  function on(event, cb) {
    if (!STATE_EVENTS || typeof STATE_EVENTS.on !== "function") return () => {};
    return STATE_EVENTS.on(event, cb);
  }
  function off(event, cb) {
    if (!STATE_EVENTS || typeof STATE_EVENTS.off !== "function") return;
    STATE_EVENTS.off(event, cb);
  }

  window.XXJ_INVITATION = {
    set, cancel, clear, active, all, sweep,
    on, off,
    __installed: true
  };
})();
