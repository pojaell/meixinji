"""一次性重写 state-location-ui.js 的弹层结构(list/form 双视图 + 主动发消息 stub)。"""
import re
import sys
from pathlib import Path

TARGET = Path(r"d:\AI\meixinji-temp\state-location-ui.js")
src = TARGET.read_text(encoding="utf-8")

# 1. 替换 renderModalInner 整段
RENDER_OLD_RE = re.compile(
    r"  function renderModalInner\(charId\) \{.*?^  \}",
    re.MULTILINE | re.DOTALL,
)
RENDER_NEW = """  function renderModalInner(charId) {
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
  }"""

m = RENDER_OLD_RE.search(src)
if not m:
    print("RENDER_OLD not found", file=sys.stderr)
    sys.exit(1)
src = src[:m.start()] + RENDER_NEW + src[m.end():]

# 2. 替换 bindModalEvents 整段(包含 confirm 触发 triggerInviteReply)
BIND_OLD_RE = re.compile(
    r"  function bindModalEvents\(charId\) \{.*?^  \}",
    re.MULTILINE | re.DOTALL,
)
BIND_NEW = """  function bindModalEvents(charId) {
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
  }"""

m = BIND_OLD_RE.search(src)
if not m:
    print("BIND_OLD not found", file=sys.stderr)
    sys.exit(1)
src = src[:m.start()] + BIND_NEW + src[m.end():]

# 3. 在 closeModal 后插入 triggerInviteReply 占位实现
HOOK_OLD_RE = re.compile(
    r"  function closeModal\(\) \{[\s\S]*?^  \}",
    re.MULTILINE,
)
HOOK_NEW = """  function closeModal() {
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
    // 占位：等待用户确认"发消息"的边界后再实现。
    // 设计目标：拼 prompt（角色人设 + 当前 routine + 邀请目的地 + 用户人设）
    //          → 调 ai.chatCompletions(payload)
    //          → 把回复 push 到该密谈的消息流里
    return null;
  }"""

m = HOOK_OLD_RE.search(src)
if not m:
    print("HOOK_OLD not found", file=sys.stderr)
    sys.exit(1)
src = src[:m.start()] + HOOK_NEW + src[m.end():]

TARGET.write_text(src, encoding="utf-8")
print("OK")
