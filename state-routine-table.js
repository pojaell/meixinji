/**
 * CASE · 角色作息表(可编辑表格)
 *
 * 暴露 window.XXJ_ROUTINE_TABLE.render(charId, schedule)
 *   - 渲染表格到 #char-routine-table
 *   - 每行字段:startHour / endHour / location / activity / busy / 主动
 *   - 编辑后(失焦)立即写回 CHAR_PERSONA_STORE.items[charId].routineSchedule
 *   - 底部 [+ 增加一段] 按钮
 *   - 每行有 [上移] [下移] [删除] 按钮
 */
(function () {
  if (window.XXJ_ROUTINE_TABLE && window.XXJ_ROUTINE_TABLE.__installed) return;

  const VALID_BUSY = ["asleep", "exercise", "treating", "resting", "focused", "leisure", "ritual"];

  /** 把 persona item 写回 IndexedDB(char-persona-store)。
   *  直接 setKv + 写 __routineScheduleUpdatedAt 时间戳,state-routine.js 默认路径会优先用这个 schedule。
   */
  function writeScheduleToPersona(charId, schedule) {
    if (!charId) return false;
    const D = window.XXJ_DB;
    if (!D) return false;
    const st = D.getKv(D.K.CHAR_PERSONA_STORE);
    if (!st || !Array.isArray(st.items)) return false;
    const item = st.items.find(x => x && String(x.id) === String(charId));
    if (!item) return false;
    item.routineSchedule = Array.isArray(schedule) ? schedule.map(s => ({
      startHour: Math.max(0, Math.min(23, Math.floor(Number(s.startHour) || 0))),
      endHour: Math.max(1, Math.min(24, Math.floor(Number(s.endHour) || 0))),
      location: String(s.location || "").trim().slice(0, 30),
      activity: String(s.activity || "").trim().slice(0, 60),
      busy: VALID_BUSY.includes(String(s.busy)) ? String(s.busy) : "leisure",
      moodShift: Math.max(-0.2, Math.min(0.2, Number(s.moodShift) || 0)),
      allowProactive: s.allowProactive === true ? true : (s.allowProactive === "busy" ? "busy" : false)
    })) : [];
    item.__routineScheduleUpdatedAt = Date.now();
    D.setKv(D.K.CHAR_PERSONA_STORE, st);
    return true;
  }

  /** 读当前表格里的所有行,返回 schedule array */
  function readFromTable(tableEl) {
    if (!tableEl) return [];
    const rows = tableEl.querySelectorAll("tr.char-routine-row");
    const out = [];
    rows.forEach(tr => {
      const get = (sel) => tr.querySelector(sel);
      const startHour = Math.max(0, Math.min(23, Math.floor(Number(get("[data-f=startHour]")?.value) || 0)));
      const endHour = Math.max(startHour + 1, Math.min(24, Math.floor(Number(get("[data-f=endHour]")?.value) || 0)));
      const location = String(get("[data-f=location]")?.value || "").trim().slice(0, 30);
      const activity = String(get("[data-f=activity]")?.value || "").trim().slice(0, 60);
      const busyVal = get("[data-f=busy]")?.value;
      const busy = VALID_BUSY.includes(busyVal) ? busyVal : "leisure";
      const allowProactiveRaw = get("[data-f=allowProactive]")?.value;
      const allowProactive = allowProactiveRaw === "true" ? true : (allowProactiveRaw === "busy" ? "busy" : false);
      out.push({ startHour, endHour, location, activity, busy, moodShift: 0, allowProactive });
    });
    return out;
  }

  /** 创建一行(tr + 单元格 + input/select) */
  function buildRow(row, idx) {
    const tr = document.createElement("tr");
    tr.className = "char-routine-row";
    tr.dataset.idx = String(idx);

    // startHour
    const tdStart = document.createElement("td");
    const inpStart = document.createElement("input");
    inpStart.type = "number";
    inpStart.min = "0";
    inpStart.max = "23";
    inpStart.dataset.f = "startHour";
    inpStart.value = String(row.startHour ?? 0);
    inpStart.className = "char-routine-cell-input char-routine-hour";
    inpStart.setAttribute("aria-label", "起始小时");
    tdStart.appendChild(inpStart);
    tr.appendChild(tdStart);

    // endHour
    const tdEnd = document.createElement("td");
    const inpEnd = document.createElement("input");
    inpEnd.type = "number";
    inpEnd.min = "1";
    inpEnd.max = "24";
    inpEnd.dataset.f = "endHour";
    inpEnd.value = String(row.endHour ?? 24);
    inpEnd.className = "char-routine-cell-input char-routine-hour";
    inpEnd.setAttribute("aria-label", "结束小时");
    tdEnd.appendChild(inpEnd);
    tr.appendChild(tdEnd);

    // location
    const tdLoc = document.createElement("td");
    const inpLoc = document.createElement("input");
    inpLoc.type = "text";
    inpLoc.dataset.f = "location";
    inpLoc.value = String(row.location || "");
    inpLoc.placeholder = "地点";
    inpLoc.maxLength = 30;
    inpLoc.className = "char-routine-cell-input";
    inpLoc.setAttribute("aria-label", "地点");
    tdLoc.appendChild(inpLoc);
    tr.appendChild(tdLoc);

    // activity
    const tdAct = document.createElement("td");
    const inpAct = document.createElement("input");
    inpAct.type = "text";
    inpAct.dataset.f = "activity";
    inpAct.value = String(row.activity || "");
    inpAct.placeholder = "活动";
    inpAct.maxLength = 60;
    inpAct.className = "char-routine-cell-input";
    inpAct.setAttribute("aria-label", "活动");
    tdAct.appendChild(inpAct);
    tr.appendChild(tdAct);

    // busy
    const tdBusy = document.createElement("td");
    const selBusy = document.createElement("select");
    selBusy.dataset.f = "busy";
    selBusy.className = "char-routine-cell-input char-routine-busy";
    selBusy.setAttribute("aria-label", "类型");
    for (const b of VALID_BUSY) {
      const o = document.createElement("option");
      o.value = b;
      o.textContent = b;
      if ((row.busy || "leisure") === b) o.selected = true;
      selBusy.appendChild(o);
    }
    tdBusy.appendChild(selBusy);
    tr.appendChild(tdBusy);

    // allowProactive
    const tdPro = document.createElement("td");
    const selPro = document.createElement("select");
    selPro.dataset.f = "allowProactive";
    selPro.className = "char-routine-cell-input char-routine-proactive";
    selPro.setAttribute("aria-label", "是否可主动搭话");
    const proOpts = [
      ["false", "否"],
      ["true", "是"],
      ["busy", "忙时也行"]
    ];
    const curPro = row.allowProactive === true ? "true" : (row.allowProactive === "busy" ? "busy" : "false");
    for (const [v, label] of proOpts) {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = label;
      if (v === curPro) o.selected = true;
      selPro.appendChild(o);
    }
    tdPro.appendChild(selPro);
    tr.appendChild(tdPro);

    // 操作列
    const tdOps = document.createElement("td");
    tdOps.className = "char-routine-ops";
    const btnUp = document.createElement("button");
    btnUp.type = "button";
    btnUp.className = "char-routine-op-btn";
    btnUp.textContent = "↑";
    btnUp.setAttribute("aria-label", "上移");
    btnUp.dataset.op = "up";
    const btnDown = document.createElement("button");
    btnDown.type = "button";
    btnDown.className = "char-routine-op-btn";
    btnDown.textContent = "↓";
    btnDown.setAttribute("aria-label", "下移");
    btnDown.dataset.op = "down";
    const btnDel = document.createElement("button");
    btnDel.type = "button";
    btnDel.className = "char-routine-op-btn char-routine-op-del";
    btnDel.textContent = "✕";
    btnDel.setAttribute("aria-label", "删除");
    btnDel.dataset.op = "del";
    tdOps.appendChild(btnUp);
    tdOps.appendChild(btnDown);
    tdOps.appendChild(btnDel);
    tr.appendChild(tdOps);

    return tr;
  }

  /** 渲染表头 */
  function buildHeader() {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    const headers = ["起", "止", "地点", "活动", "类型", "主动", ""];
    for (const h of headers) {
      const th = document.createElement("th");
      th.textContent = h;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    return thead;
  }

  /** 主入口:渲染/重新渲染 */
  let _currentCharId = null;
  function render(charId, schedule) {
    _currentCharId = charId;
    const container = document.getElementById("char-routine-table");
    const field = document.getElementById("char-routine-table-field");
    if (!container || !field) return;
    container.innerHTML = "";
    if (!charId || !Array.isArray(schedule) || !schedule.length) {
      field.hidden = true;
      return;
    }
    field.hidden = false;
    container.appendChild(buildHeader());
    const tbody = document.createElement("tbody");
    schedule.forEach((row, idx) => tbody.appendChild(buildRow(row, idx)));
    container.appendChild(tbody);
  }

  function getCurrentCharId() { return _currentCharId; }

  /** 改完任意单元格 → 写回 persona */
  function commitFromTable(tableEl) {
    if (!_currentCharId) return;
    const sched = readFromTable(tableEl);
    writeScheduleToPersona(_currentCharId, sched);
    // 触发 state-routine 重新加载 + LI 位置条 re-render
    if (window.XXJ_STATE_EVENTS && window.XXJ_STATE_EVENTS.emit) {
      window.XXJ_STATE_EVENTS.emit("rp-routine-changed", { charId: _currentCharId, source: "table-edit" });
    }
  }

  function bindTableEvents() {
    const tableEl = document.getElementById("char-routine-table");
    if (!tableEl || tableEl.dataset.bound === "1") return;
    // change 事件(失焦后触发)统一处理
    tableEl.addEventListener("change", (e) => {
      if (!e.target.matches("input,select")) return;
      const row = e.target.closest("tr.char-routine-row");
      if (!row) return;
      // startHour / endHour 自动校正:如果 endHour <= startHour,自动 + 1
      if (e.target.dataset.f === "startHour" || e.target.dataset.f === "endHour") {
        const sh = Math.max(0, Math.min(23, Math.floor(Number(row.querySelector("[data-f=startHour]").value) || 0)));
        const eh = Math.max(1, Math.min(24, Math.floor(Number(row.querySelector("[data-f=endHour]").value) || 0)));
        if (eh <= sh) {
          row.querySelector("[data-f=endHour]").value = String(sh + 1);
        }
      }
      commitFromTable(tableEl);
    });
    // 操作按钮
    tableEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button.char-routine-op-btn");
      if (!btn) return;
      const tr = btn.closest("tr.char-routine-row");
      if (!tr) return;
      const tbody = tableEl.querySelector("tbody");
      const op = btn.dataset.op;
      if (op === "up" && tr.previousElementSibling) {
        tbody.insertBefore(tr, tr.previousElementSibling);
      } else if (op === "down" && tr.nextElementSibling) {
        tbody.insertBefore(tr.nextElementSibling, tr);
      } else if (op === "del") {
        tr.remove();
        // 重新排 idx
        tbody.querySelectorAll("tr.char-routine-row").forEach((r, i) => r.dataset.idx = String(i));
      } else {
        return;
      }
      commitFromTable(tableEl);
    });
    tableEl.dataset.bound = "1";
  }

  function bindAddRow() {
    const btn = document.getElementById("char-routine-add-row");
    if (!btn || btn.dataset.bound === "1") return;
    btn.addEventListener("click", () => {
      if (!_currentCharId) return;
      const tableEl = document.getElementById("char-routine-table");
      const tbody = tableEl && tableEl.querySelector("tbody");
      if (!tbody) {
        // 表还没渲染,先 render
        const sched = writeScheduleToPersona(_currentCharId, []); // dummy
        return;
      }
      const last = tbody.querySelector("tr.char-routine-row:last-child");
      let newStart = 0;
      let newEnd = 1;
      if (last) {
        const sh = Number(last.querySelector("[data-f=startHour]").value) || 0;
        const eh = Number(last.querySelector("[data-f=endHour]").value) || 0;
        newStart = Math.min(24, eh);
        newEnd = Math.min(24, newStart + 1);
        if (newStart >= 24) { newStart = 23; newEnd = 24; }
      }
      const newRow = buildRow({ startHour: newStart, endHour: newEnd, location: "", activity: "", busy: "leisure", allowProactive: false }, tbody.children.length);
      tbody.appendChild(newRow);
      commitFromTable(tableEl);
    });
    btn.dataset.bound = "1";
  }

  function bindClearButton() {
    const btn = document.getElementById("char-routine-clear-btn");
    if (!btn || btn.dataset.bound === "1") return;
    btn.addEventListener("click", () => {
      if (!_currentCharId) return;
      writeScheduleToPersona(_currentCharId, []);
      render(_currentCharId, []);
      if (window.XXJ_STATE_EVENTS && window.XXJ_STATE_EVENTS.emit) {
        window.XXJ_STATE_EVENTS.emit("rp-routine-changed", { charId: _currentCharId, source: "user-clear" });
      }
    });
    btn.dataset.bound = "1";
  }

  function init() {
    bindTableEvents();
    bindAddRow();
    bindClearButton();
  }

  window.XXJ_ROUTINE_TABLE = {
    __installed: true,
    render,
    init,
    getCurrentCharId,
    writeScheduleToPersona,
    readFromTable
  };
})();
