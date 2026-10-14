/**
 * LI · 位置条 + 邀请弹层(开源版可选子系统)
 *
 * 嵌入密谈界面顶部,在 topbar 之后、chat-body-stack 之前。
 * 风格严格沿用原界面 chat-identity-top + chat-live-pill + chip.ghost,
 * 不引入新色板、不引入新字体,只用 var(--*) 变量。
 *
 * DOM 钩子:#chat-screen > .settings-inner
 * 插入位置:.settings-inner 内,topbar.chat-screen-topbar 之后,
 *          .chat-body-stack 之前(成为 inner 的第 2 个子元素)。
 *
 * 数据源:
 *   - XXJ_ROUTINE.current(charId)
 *   - XXJ_LOCATIONS.list() / add
 *   - XXJ_INVITATION.set / cancel / active
 *   - XXJ_STATE_PRESETS[charId].name
 *
 * 实时刷新:
 *   - rp-routine-changed
 *   - rp-invitation-set / cleared / expired
 *   - rp-locations-changed
 */
(function () {
  if (window.XXJ_LOCATION_UI && window.XXJ_LOCATION_UI.__installed) return;

  const STATE_EVENTS = window.XXJ_STATE_EVENTS;
  const ROUTINE = window.XXJ_ROUTINE;
  const LOCATIONS = window.XXJ_LOCATIONS;
  const INVITATION = window.XXJ_INVITATION;

  const CSS_ID = "xxj-loc-ui-style";
  const BAR_ID = "xxj-loc-bar";
  const MODAL_ID = "xxj-loc-modal";

  /** 默认显示哪一个 charId 的位置?(首个 loaded;UI 后续可加切换) */
  function currentCharId() {
    if (!ROUTINE || typeof ROUTINE.listLoadedIds !== "function") return null;
    const ids = ROUTINE.listLoadedIds();
    return ids[0] || null;
  }

  function getCharDisplayName(charId) {
    if (!charId) return "角色";

    // 1. STATE_PRESETS(slug 预设,如 "chenzixi")
    try {
      const preset = (window.XXJ_STATE_PRESETS || {})[charId];
      if (preset && preset.name) return String(preset.name).trim();
    } catch { /* ignore */ }

    // 2. CHAR_PERSONA_STORE(UUID 实际角色)— 绝大多数情况
    try {
      const D = window.XXJ_DB;
      if (D && D.getKv && D.K && D.K.CHAR_PERSONA_STORE) {
        const store = D.getKv(D.K.CHAR_PERSONA_STORE);
        if (store && Array.isArray(store.items)) {
          const hit = store.items.find(x => x && String(x.id) === String(charId));
          if (hit) {
            const dn = String(hit.displayName || hit.name || "").trim();
            if (dn) return dn;
          }
        }
      }
    } catch { /* ignore */ }

    // 3. 兑底:UUID 不要再让弹层标题被一堆字符挤变形
    const s = String(charId);
    if (s.length > 12 && /^[0-9a-f-]+$/i.test(s)) {
      return "这位";
    }
    return s;
  }

  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    const style = document.createElement("style");
    style.id = CSS_ID;
    style.textContent = `
/* LI · 位置条 — 严格沿用 chat-identity-top / chat-live-pill / chip.ghost 风格 */
.xxj-loc-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0 16px 14px;
  padding: 10px 14px;
  background: var(--bg-card, #f5efe4);
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  border-radius: 14px;
  font-size: 12px;
  color: var(--text-main, #2a2a2a);
  box-shadow: var(--shadow-card, 0 1px 2px rgba(0,0,0,0.04));
}
.xxj-loc-bar.is-empty { opacity: 0.7; font-style: italic; }

/* 左侧圆点(品牌色,粉色) */
.xxj-loc-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: #ff6a8a;
  box-shadow: 0 0 0 0 rgba(255,106,138,0.5);
  animation: xxj-loc-pulse 2.4s ease-out infinite;
  flex: 0 0 auto;
}
@keyframes xxj-loc-pulse {
  0% { box-shadow: 0 0 0 0 rgba(255,106,138,0.45); }
  70% { box-shadow: 0 0 0 8px rgba(255,106,138,0); }
  100% { box-shadow: 0 0 0 0 rgba(255,106,138,0); }
}

/* 左侧信息块:middle area */
.xxj-loc-info {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  overflow: hidden;
  white-space: nowrap;
}
.xxj-loc-info-name {
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-main, #2a2a2a);
}
.xxj-loc-info-sep { color: var(--text-sub, #8a8a8a); padding: 0 2px; }
.xxj-loc-info-place {
  color: var(--text-main, #2a2a2a);
  font-weight: 500;
}
.xxj-loc-info-act {
  color: var(--text-sub, #8a8a8a);
  overflow: hidden; text-overflow: ellipsis;
}
.xxj-loc-info-act::before { content: " · "; opacity: 0.5; }

/* 右侧 INVITED 状态徽章 — 严格仿 chat-live-pill */
.xxj-loc-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px 4px 7px;
  border-radius: 999px;
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  background: var(--bg-device, #fff);
  font-family: "Space Mono", monospace;
  font-size: 0.42rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-sub, #8a8a8a);
  flex: 0 0 auto;
}
.xxj-loc-pill-dot {
  display: inline-block;
  width: 6px; height: 6px; border-radius: 50%;
  background: #e89b4a;  /* 老版本邀请中提示的暖色 */
  box-shadow: 0 0 0 0 rgba(232,155,74,0.45);
  animation: xxj-loc-pill-pulse 2.2s ease-out infinite;
}
@keyframes xxj-loc-pill-pulse {
  0% { box-shadow: 0 0 0 0 rgba(232,155,74,0.45); }
  70% { box-shadow: 0 0 0 6px rgba(232,155,74,0); }
  100% { box-shadow: 0 0 0 0 rgba(232,155,74,0); }
}

/* 右侧「邀请他…」按钮 — 严格仿 chip.ghost chip-xs */
.xxj-loc-invite {
  flex: 0 0 auto;
  padding: 6px 10px;
  font-size: 0.45rem;
  font-family: "Space Mono", monospace;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-main, #2a2a2a);
  background: var(--bg-card, #f5efe4);
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  border-radius: 999px;
  cursor: pointer;
  white-space: nowrap;
}
.xxj-loc-invite:hover {
  background: var(--text-main, #2a2a2a);
  color: var(--bg-device, #fff);
  border-color: var(--text-main, #2a2a2a);
}

/* ============== 邀请弹层 ============== */
.xxj-loc-modal-mask {
  position: fixed; inset: 0;
  background: rgba(20,18,16,0.45);
  z-index: 9999;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.xxj-loc-modal {
  background: var(--bg-card, #f5efe4);
  color: var(--text-main, #2a2a2a);
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  border-radius: 16px;
  padding: 0;
  width: 400px; max-width: 100%;
  max-height: 82vh;
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: 0 16px 48px rgba(0,0,0,0.22);
}
.xxj-loc-modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--line, rgba(0,0,0,0.08));
  background: var(--bg-card, #f5efe4);
  flex: 0 0 auto;
}
.xxj-loc-modal-head h3 {
  margin: 0; font-size: 14px; font-weight: 600;
  display: flex; align-items: center; gap: 7px;
  font-family: inherit;
}
.xxj-loc-modal-head h3 .xo-mark {
  width: 8px; height: 8px; border-radius: 50%; background: #ff6a8a;
}
.xxj-loc-modal-back {
  background: transparent;
  border: none;
  color: var(--text-sub, #8a8a8a);
  cursor: pointer;
  font-size: 12px;
  padding: 4px 8px;
  border-radius: 6px;
  font-family: "Space Mono", monospace;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}
.xxj-loc-modal-back:hover { background: rgba(0,0,0,0.05); color: var(--text-main, #2a2a2a); }
.xxj-loc-modal-x {
  background: transparent;
  border: none;
  color: var(--text-sub, #8a8a8a);
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 4px 10px;
  border-radius: 6px;
  font-family: inherit;
  margin-left: auto;
}
.xxj-loc-modal-x:hover { background: rgba(0,0,0,0.05); color: var(--text-main, #2a2a2a); }
.xxj-loc-modal-section-label {
  font-family: "Space Mono", monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-sub, #8a8a8a);
  font-weight: 700;
  margin: 10px 0 6px;
}
.xxj-loc-modal-section-label:first-child { margin-top: 0; }
.xxj-loc-modal-body {
  padding: 14px 18px;
  overflow-y: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.xxj-loc-modal-foot {
  padding: 12px 18px;
  border-top: 1px solid var(--line, rgba(0,0,0,0.08));
  display: flex; gap: 8px; justify-content: space-between;
  background: var(--bg-card, #f5efe4);
  flex: 0 0 auto;
}
.xxj-loc-modal-foot .xxj-loc-foot-left,
.xxj-loc-modal-foot .xxj-loc-foot-right { display: flex; gap: 8px; }
.xxj-loc-modal-list {
  display: flex; flex-direction: column; gap: 6px;
  max-height: 36vh; overflow-y: auto; margin-bottom: 14px;
}
.xxj-loc-modal-item {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  background: transparent;
  color: inherit;
  font: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.xxj-loc-modal-item:hover {
  background: rgba(255,106,138,0.06);
  border-color: rgba(255,106,138,0.30);
}
.xxj-loc-modal-item.active {
  background: rgba(255,106,138,0.10);
  border-color: rgba(255,106,138,0.45);
  box-shadow: inset 3px 0 0 #ff6a8a;
}
.xxj-loc-modal-item-title { font-weight: 600; font-size: 13px; }
.xxj-loc-modal-item-desc { font-size: 11px; color: var(--text-sub, #8a8a8a); }
.xxj-loc-modal-form {
  display: flex; flex-direction: column; gap: 10px;
}
.xxj-loc-modal-form label {
  font-size: 10px; color: var(--text-sub, #8a8a8a);
  text-transform: uppercase; letter-spacing: 0.14em;
  font-family: "Space Mono", monospace;
  font-weight: 700;
  margin-top: 2px;
}
.xxj-loc-modal-form input,
.xxj-loc-modal-form textarea {
  background: var(--bg-device, #fff);
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  color: inherit; padding: 9px 11px; border-radius: 8px;
  font: inherit;
  font-size: 13px;
  transition: border-color 0.15s;
}
.xxj-loc-modal-form input:focus,
.xxj-loc-modal-form textarea:focus {
  outline: none;
  border-color: rgba(255,106,138,0.50);
  background: var(--bg-device, #fff);
}
.xxj-loc-modal-form textarea { resize: vertical; min-height: 60px; }
.xxj-loc-modal-active-info {
  font-size: 11px; padding: 10px 12px;
  background: rgba(232,155,74,0.10);
  border: 1px solid rgba(232,155,74,0.30);
  border-radius: 10px;
  margin-bottom: 12px;
  color: var(--text-main, #2a2a2a);
  display: flex; align-items: center; gap: 8px;
}
.xxj-loc-modal-active-info::before {
  content: ""; width: 6px; height: 6px; border-radius: 50%;
  background: #e89b4a;
  flex: 0 0 auto;
}
.xxj-loc-modal-row {
  display: flex; gap: 10px; align-items: center;
  margin-bottom: 4px; font-size: 12px;
}
.xxj-loc-modal-row:last-child { margin-bottom: 0; }
.xxj-loc-modal-row label {
  font-size: 10px;color:var(--text-sub, #8a8a8a);
  text-transform:uppercase;letter-spacing:0.14em;
  font-family:"Space Mono", monospace; font-weight: 700;
}
.xxj-loc-modal-row select {
  flex: 1; background: var(--bg-device, #fff);
  color: inherit; padding: 8px 10px;
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  border-radius: 8px; font: inherit;
  font-size: 13px;
}
.xxj-loc-modal-actions button,
.xxj-loc-modal-foot button {
  padding: 8px 14px; border-radius: 999px;
  border: 1px solid var(--line, rgba(0,0,0,0.10));
  background: var(--bg-device, #fff);
  color: inherit; font: inherit; cursor: pointer;
  font-family: "Space Mono", monospace;
  font-size: 0.45rem; letter-spacing: 0.12em; text-transform: uppercase;
  font-weight: 600;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.xxj-loc-modal-actions button:hover,
.xxj-loc-modal-foot button:hover {
  background: rgba(0,0,0,0.04);
}
.xxj-loc-modal-actions .primary,
.xxj-loc-modal-foot button.primary {
  background: var(--text-main, #2a2a2a);
  color: var(--bg-device, #fff);
  border-color: var(--text-main, #2a2a2a);
}
.xxj-loc-modal-actions .primary:hover,
.xxj-loc-modal-foot button.primary:hover {
  background: #000;
  filter: brightness(1.1);
}
.xxj-loc-modal-actions .danger {
  color: #c0392b;
  border-color: rgba(192,57,43,0.40);
}
.xxj-loc-modal-actions button:disabled,
.xxj-loc-modal-foot button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.xxj-loc-modal-empty {
  font-size: 12px; color: var(--text-sub, #8a8a8a);
  padding: 24px 12px; text-align: center;
  border: 1px dashed var(--line, rgba(0,0,0,0.20));
  border-radius: 10px;
  background: rgba(0,0,0,0.02);
}
`;
    document.head.appendChild(style);
  }

  function makeBar() {
    const bar = document.createElement("div");
    bar.id = BAR_ID;
    bar.className = "xxj-loc-bar";
    bar.innerHTML = `
      <span class="xxj-loc-dot" aria-hidden="true"></span>
      <div class="xxj-loc-info">
        <span class="xxj-loc-info-name">…</span>
        <span class="xxj-loc-info-sep">·</span>
        <span class="xxj-loc-info-place"></span>
        <span class="xxj-loc-info-act"></span>
      </div>
      <span class="xxj-loc-pill" style="display:none" aria-label="邀请状态">
        <span class="xxj-loc-pill-dot"></span><span class="xxj-loc-pill-text">邀请中</span>
      </span>
      <button type="button" class="xxj-loc-invite">邀请他…</button>
    `;
    bar.querySelector(".xxj-loc-invite").addEventListener("click", () => openModal());
    return bar;
  }

  /**
   * 插入位置:.settings-inner 内,topbar 之后、chat-body-stack 之前。
   * 如果 chat-body-stack 不存在,回退到 inner 末尾(在 topbar 之后仍成立)。
   */
  function ensureBar() {
    let bar = document.getElementById(BAR_ID);
    if (bar) return bar;
    const chatScreen = document.getElementById("chat-screen");
    if (!chatScreen) return null;
    const inner = chatScreen.querySelector(".settings-inner") || chatScreen;
    const topbar = inner.querySelector(".settings-topbar.chat-screen-topbar");
    const bodyStack = inner.querySelector(".chat-body-stack");
    bar = makeBar();
    if (topbar) {
      // 插到 topbar 之后:若 topbar 的 nextSibling 是 bodyStack,就放在 topbar 之后(bodyStack 之前)
      // 否则直接插到 topbar 之后
      if (topbar.nextSibling === bodyStack) {
        inner.insertBefore(bar, bodyStack);
      } else if (topbar.nextSibling) {
        inner.insertBefore(bar, topbar.nextSibling);
      } else {
        topbar.parentNode.insertBefore(bar, topbar.nextSibling);
      }
    } else if (bodyStack) {
      inner.insertBefore(bar, bodyStack);
    } else {
      inner.prepend(bar);
    }
    return bar;
  }

  function render() {
    const bar = ensureBar();
    if (!bar) return;
    const charId = currentCharId();
    const nameEl = bar.querySelector(".xxj-loc-info-name");
    const placeEl = bar.querySelector(".xxj-loc-info-place");
    const actEl = bar.querySelector(".xxj-loc-info-act");
    const pill = bar.querySelector(".xxj-loc-pill");
    const pillText = bar.querySelector(".xxj-loc-pill-text");
    if (!charId) {
      bar.classList.add("is-empty");
      nameEl.textContent = "尚未加载角色 routine";
      placeEl.textContent = "—";
      actEl.textContent = "";
      pill.style.display = "none";
      return;
    }
    bar.classList.remove("is-empty");
    const slot = ROUTINE.current(charId, new Date());
    const name = getCharDisplayName(charId);
    nameEl.textContent = name;
    if (slot) {
      placeEl.textContent = `在 ${slot.location || "未定位"}`;
      actEl.textContent = slot.activity || "";
      if (slot.source === "invitation") {
        pillText.textContent = "邀请中";
        pill.style.display = "";
      } else if (slot.source === "override") {
        pillText.textContent = slot.overrideName || "节气";
        pill.style.display = "";
      } else {
        pill.style.display = "none";
      }
    } else {
      placeEl.textContent = "在 未定";
      actEl.textContent = "";
      pill.style.display = "none";
    }
  }

  /* ============== 邀请弹层 ============== */
  let modalState = {
    selectedId: null,
    durationMs: 2 * 60 * 60 * 1000,
    view: "list",                          // "list" | "form"
    formDraft: { name: "", description: "", defaultActivity: "" }
  };
  
  function resetModalState() {
    modalState.selectedId = null;
    modalState.durationMs = 2 * 60 * 60 * 1000;
    modalState.view = "list";
    modalState.formDraft = { name: "", description: "", defaultActivity: "" };
  }
  
  function openModal() {
    if (document.getElementById(MODAL_ID)) return;
    const charId = currentCharId();
    if (!charId) {
      alert("尚未加载任何角色 routine，无法邀请。");
      return;
    }
    if (LOCATIONS && typeof LOCATIONS.seedIfEmpty === "function") {
      LOCATIONS.seedIfEmpty(4);
    }
    resetModalState();
  
    const mask = document.createElement("div");
    mask.id = MODAL_ID;
    mask.className = "xxj-loc-modal-mask";
    mask.addEventListener("click", (e) => { if (e.target === mask) closeModal(); });
    const modal = document.createElement("div");
    modal.className = "xxj-loc-modal";
    modal.innerHTML = renderModalInner(charId);
    mask.appendChild(modal);
    document.body.appendChild(mask);
    bindModalEvents(charId);
  }

  function closeModal() {
    const m = document.getElementById(MODAL_ID);
    if (m && m.parentNode) m.parentNode.removeChild(m);
  }

  /**
   * 邀请成功后的"角色主动打招呼"占位实现（待与用户确认行为边界后实装）。
   * 当前默认 no-op，避免重复弹 UI 干扰使用。
   * @param {string} charId
   * @param {string} locationId
   * @param {number} durationMs
   */
  async function triggerInviteReply(charId, locationId, durationMs) {
    try {
      // 1. 防御检查：API、模块、邀请地点都在吗？
      const RP_AI = window.RP_AI;
      const DB = window.XXJ_DB;
      if (!RP_AI || typeof RP_AI.chatCompletions !== "function") return null;
      const loc = LOCATIONS && typeof LOCATIONS.get === "function" ? LOCATIONS.get(locationId) : null;
      if (!loc) return null;

      // 2. 取数据：角色人设 + 当前 routine + 用户人设
      const preset = (window.XXJ_STATE_PRESETS || {})[charId] || {};
      const slot = ROUTINE && typeof ROUTINE.current === "function"
        ? ROUTINE.current(charId, new Date()) : null;
      const charName = getCharDisplayName(charId);

      let userLabel = "对方";
      if (DB && DB.K && DB.getKv) {
        try {
          const usermask = DB.getKv(DB.K.USER_MASK_STORE);
          if (usermask && typeof usermask === "object") {
            const aid = String(usermask.activeId || "").trim();
            const items = Array.isArray(usermask.items) ? usermask.items : [];
            const active = items.find(x => x && x.id === aid);
            const dn = active && String(active.displayName || "").trim();
            if (dn) userLabel = dn;
          }
        } catch { /* 忽略 */ }
      }

      // 3. 拼 system prompt：人物 + 当前状态 + 邀请点信息 + 输出要求
      const busyNice = ({
        asleep:   "沉睡中、不易被唤起",
        treating: "正在坐诊、不方便被打扰",
        resting:  "刚在午歇",
        exercise: "正在习武/活动",
        focused:  "正在专注做事",
        leisure:  "得空、可以随口答应",
        ritual:   "正在行礼"
      })[slot?.busy] || "有空";
      const lines = [
        `你是「${charName}」——正在与「${userLabel}」密谈中。`,
        preset.identity ? `【身份】${String(preset.identity).slice(0, 240)}` : "",
        preset.personality ? `【性格】${String(preset.personality).slice(0, 240)}` : "",
        preset.communication ? `【说话风格】${String(preset.communication).slice(0, 240)}` : "",
        slot ? `【此刻】你在「${slot.location || "未定"}」· 正在「${slot.activity || ""}」· ${busyNice}` : "",
        `【邀请】${userLabel} 邀请你前往「${loc.name}」。`,
        loc.description ? `【地点说明】${loc.description}` : "",
        loc.defaultActivity ? `【约定活动】${loc.defaultActivity}` : "",
        `【任务】请用 1-2 句话、自然简短地回应这次邀请。必须体现你当前的真实状态（如果忙就说明情况，如果闲着就一口答应）。不要解释你是 AI、不要列举上面的字段、不要重复用户名字。`
      ].filter(Boolean);
      const system = lines.join("\n");

      // 4. 调 LLM（短句、低 token）
      let data;
      try {
        data = await RP_AI.chatCompletions(
          {
            messages: [
              { role: "system", content: system },
              { role: "user", content: "请回应这次邀请。" }
            ],
            max_tokens: 180,
            temperature: 0.85
          },
          { completionConfig: { tag: "li-invite-reply" } }
        );
      } catch (e) {
        console.warn("[LI] invite-reply LLM call failed:", e);
        data = null;
      }

      // 5. 提取回复文本
      let reply = "";
      try {
        const ch0 = data && data.choices && data.choices[0];
        if (ch0 && typeof ch0.text === "string") reply = ch0.text.trim();
        else if (ch0 && ch0.message && typeof ch0.message.content === "string") reply = String(ch0.message.content).trim();
        else if (typeof data?.output_text === "string") reply = data.output_text.trim();
        else if (typeof data?.text === "string") reply = data.text.trim();
      } catch { /* 忽略 */ }
      reply = String(reply || "").trim();

      // 6. 拿到当前激活 thread
      let maskId = "", threadId = "";
      if (DB && DB.K && DB.getKv) {
        try {
          const ref = DB.getKv(DB.K.CHAT_ACTIVE_THREAD);
          if (ref && typeof ref === "object") {
            maskId = String(ref.maskId || "").trim();
            threadId = String(ref.threadId || "").trim();
          }
        } catch { /* 忽略 */ }
      }
      if (!maskId || !threadId) {
        // 没有打开的密谈 → 邀请设置成功但不写消息
        if (!reply) alert("邀请已发出。\nAI 未回话（可能未填 API Key / 模型无回复）。");
        else alert("邀请已发出。\n请先打开与该角色的密谈，再让 AI 回话。");
        return reply || null;
      }

      // 7. push 聊天记录（成功或失败都走这里）
      const at = Date.now();
      const entry = reply
        ? { role: "assistant", content: reply.slice(0, 4000), at }
        : { role: "assistant", content: "（邀请已发出，角色未回话）", at, _liEmpty: true };
      const ok = window.appendChatLogEntryForMaskThread && window.appendChatLogEntryForMaskThread(maskId, threadId, entry);
      if (ok && typeof window.refreshChatMessages === "function") {
        window.refreshChatMessages();
      }
      return reply || null;
    } catch (err) {
      console.warn("[LI] triggerInviteReply crashed:", err);
      return null;
    }
  }

  function renderModalInner(charId) {
    const list = (LOCATIONS && typeof LOCATIONS.list === "function") ? LOCATIONS.list() : [];
    const activeInv = (INVITATION && typeof INVITATION.active === "function") ? INVITATION.active(charId) : null;
    const name = getCharDisplayName(charId);
    const inForm = modalState.view === "form";

    const head = inForm ? renderHeadForm(name) : renderHeadList(name);
    const body = inForm ? renderBodyForm() : renderBodyList(charId, list, activeInv);
    const foot = inForm ? renderFootForm() : renderFootList(charId, list, activeInv);

    return head + body + foot;
  }

  /* ---------------- head ---------------- */
  function renderHeadList(name) {
    return `
      <div class="xxj-loc-modal-head">
        <h3><span class="xo-mark"></span>邀请「${escapeHtml(name)}」前往…</h3>
        <button type="button" class="xxj-loc-modal-x" data-action="close" aria-label="关闭">×</button>
      </div>`;
  }

  function renderHeadForm(name) {
    return `
      <div class="xxj-loc-modal-head">
        <button type="button" class="xxj-loc-modal-back" data-action="back" aria-label="返回">← 返回</button>
        <h3><span class="xo-mark"></span>新建地点</h3>
        <button type="button" class="xxj-loc-modal-x" data-action="close" aria-label="关闭">×</button>
      </div>`;
  }

  /* ---------------- body ---------------- */
  function renderBodyList(charId, list, activeInv) {
    const activeInfo = activeInv ? `
      <div class="xxj-loc-modal-active-info">
        <strong>当前邀请中</strong>·${formatRemain(activeInv.expiresAt)} 后到期。
      </div>` : "";

    const itemsHtml = list.length === 0
      ? `<div class="xxj-loc-modal-empty">还没有地点。点下方「+ 新建地点」开始。</div>`
      : list.map(x => `
        <button type="button" class="xxj-loc-modal-item" data-loc-id="${escapeHtml(x.id)}">
          <span class="xxj-loc-modal-item-title">${escapeHtml(x.name)}</span>
          ${(x.description || x.defaultActivity) ? `<span class="xxj-loc-modal-item-desc">${escapeHtml(x.description || x.defaultActivity)}</span>` : ""}
        </button>
      `).join("");

    return `
      <div class="xxj-loc-modal-body">
        ${activeInfo}
        <div class="xxj-loc-modal-section-label">选择地点</div>
        <div class="xxj-loc-modal-list">${itemsHtml}</div>
        <div class="xxj-loc-modal-section-label">持续时间</div>
        <div class="xxj-loc-modal-row">
          <select id="xxj-loc-duration">
            <option value="3600000">1 小时</option>
            <option value="7200000" selected>2 小时</option>
            <option value="14400000">4 小时</option>
          </select>
        </div>
      </div>`;
  }

  function renderBodyForm() {
    const d = modalState.formDraft;
    return `
      <div class="xxj-loc-modal-body">
        <div class="xxj-loc-modal-form">
          <label>地点名</label>
          <input type="text" id="xxj-loc-form-name" placeholder="如：陈府" maxlength="40" value="${escapeHtml(d.name)}">
          <label>说明（可选，一句话）</label>
          <textarea id="xxj-loc-form-desc" rows="2" maxlength="200" placeholder="如：陈家旧宅，堂主日常起居">${escapeHtml(d.description)}</textarea>
          <label>邀请到此地的默认活动</label>
          <input type="text" id="xxj-loc-form-act" placeholder="如：与堂主对坐闲谈" maxlength="60" value="${escapeHtml(d.defaultActivity)}">
        </div>
      </div>`;
  }

  /* ---------------- foot ---------------- */
  function renderFootList(charId, list, activeInv) {
    const hasList = list.length > 0;
    return `
      <div class="xxj-loc-modal-foot">
        <div class="xxj-loc-foot-left">
          <button type="button" data-action="new">+ 新建地点</button>
          ${activeInv ? `<button type="button" class="danger" data-action="cancel-inv">取消现有邀请</button>` : ""}
        </div>
        <div class="xxj-loc-foot-right">
          <button type="button" data-action="close">关闭</button>
          <button type="button" class="primary" data-action="confirm" ${hasList ? "" : "disabled"}>确认邀请</button>
        </div>
      </div>`;
  }

  function renderFootForm() {
    return `
      <div class="xxj-loc-modal-foot">
        <div class="xxj-loc-foot-left"></div>
        <div class="xxj-loc-foot-right">
          <button type="button" data-action="form-cancel">取消</button>
          <button type="button" class="primary" data-action="form-save">保存</button>
        </div>
      </div>`;
  }

  function bindModalEvents(charId) {
    const modal = document.querySelector("#" + MODAL_ID + " .xxj-loc-modal");
    if (!modal) return;
    modal.addEventListener("click", (e) => {
      const t = e.target.closest("[data-action], .xxj-loc-modal-item");
      if (!t) return;
      const action = t.getAttribute("data-action");

      if (t.classList.contains("xxj-loc-modal-item")) {
        modal.querySelectorAll(".xxj-loc-modal-item").forEach(b => b.classList.remove("active"));
        t.classList.add("active");
        modalState.selectedId = t.getAttribute("data-loc-id");
        return;
      }

      if (action === "close") { closeModal(); return; }
      if (action === "cancel-inv") {
        if (INVITATION && INVITATION.cancel(charId)) {
          closeModal();
          render();
        }
        return;
      }
      if (action === "new") {
        modalState.view = "form";
        refreshModal(charId);
        return;
      }
      if (action === "back" || action === "form-cancel") {
        modalState.view = "list";
        refreshModal(charId);
        return;
      }
      if (action === "form-save") {
        const name = (modal.querySelector("#xxj-loc-form-name").value || "").trim();
        const desc = (modal.querySelector("#xxj-loc-form-desc").value || "").trim();
        const act  = (modal.querySelector("#xxj-loc-form-act").value || "").trim();
        if (!name) { alert("地点名不能为空"); return; }
        const item = LOCATIONS.add({ name, description: desc, defaultActivity: act });
        modalState.view = "list";
        modalState.selectedId = item ? item.id : null;
        refreshModal(charId);
        return;
      }
      if (action === "confirm") {
        if (!modalState.selectedId) { alert("请先选一个地点"); return; }
        const dur = +modal.querySelector("#xxj-loc-duration").value || 2 * 60 * 60 * 1000;
        const locId = modalState.selectedId;
        if (INVITATION && typeof INVITATION.set === "function") {
          INVITATION.set(charId, { locationId: locId, duration: dur });
        }
        closeModal();
        render();
        // 邀请成功后，触发角色主动发一条打招呼消息
        triggerInviteReply(charId, locId, dur).catch((err) => {
          console.warn("[LI] triggerInviteReply failed:", err);
        });
        return;
      }
    });
  }

  function refreshModal(charId) {
    const modal = document.querySelector("#" + MODAL_ID + " .xxj-loc-modal");
    if (!modal) return;
    modal.innerHTML = renderModalInner(charId);
  }

  function formatRemain(expiresAt) {
    const ms = (expiresAt || 0) - Date.now();
    if (ms <= 0) return "已过期";
    const min = Math.floor(ms / 60000);
    if (min < 60) return `${min} 分钟`;
    const h = Math.floor(min / 60);
    return `${h} 小时 ${min % 60} 分`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function tryMount() {
    if (!document.getElementById(BAR_ID)) {
      ensureBar();
      render();
    }
  }

  function startObserver() {
    if (typeof MutationObserver === "undefined") return;
    const obs = new MutationObserver(() => {
      const cs = document.getElementById("chat-screen");
      if (!cs) return;
      if (!document.getElementById(BAR_ID)) {
        ensureBar();
        render();
      }
    });
    obs.observe(document.body, { childList: true, subtree: false });
  }

  function bindEvents() {
    if (!STATE_EVENTS) return;
    STATE_EVENTS.on("rp-routine-changed", render);
    STATE_EVENTS.on("rp-invitation-set", render);
    STATE_EVENTS.on("rp-invitation-cleared", render);
    STATE_EVENTS.on("rp-invitation-expired", render);
    STATE_EVENTS.on("rp-locations-changed", () => { render(); });
  }

  function init() {
    injectCss();
    tryMount();
    startObserver();
    bindEvents();
    if (window.XXJ_DB && window.XXJ_DB.ready) {
      window.XXJ_DB.ready.then(() => {
        setTimeout(() => { tryMount(); render(); }, 800);
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  window.XXJ_LOCATION_UI = {
    render,
    openModal,
    closeModal,
    __installed: true
  };
})();