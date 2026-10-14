# 没心机

桌面风格的 **角色扮演 / 聊天 PWA**：主屏应用、密谈 IM、晤面、论坛、关系网、世界书、生图与语音等。  
**对话与档案数据保存在浏览器本机**（IndexedDB），需自行配置大模型 API Key（仅存本设备）。

本仓库为 **开源版**：可直接使用主功能；**不含云账号登录**（QQ / Discord / 激活码等仅正式版提供）。

**作者：Ruiya**

---

## 许可与二改

本项目采用 **[GNU AGPL-3.0](LICENSE)**。

- 你可以使用、修改、再发布本软件。
- **任何修改版、衍生版、基于本代码提供在线服务的版本，都必须以相同许可证开源**，并向用户提供对应源代码（AGPL 第 13 条等对网络服务有要求）。
- 若不同意上述义务，请勿分发或公开部署修改后的版本。

---

## 快速开始

### 1. 获取代码

在 GitHub 仓库页点击 **Code**，复制 HTTPS 地址后：

```bash
git clone <仓库 HTTPS 地址>
cd meixinji
```

### 2. 生成开源版入口脚本（首次必做）

仓库内不含正式版登录文件。在项目根目录执行：

```powershell
.\scripts\setup-public.ps1
```

会生成 `auth.js`、`oauth-bootstrap.js`（本地模式，无云登录）。

### 3. 运行

- 用任意 **静态服务器** 打开本目录（不要只靠 `file://` 打开，以免 PWA / 模块异常）。
- 浏览器访问 `index.html`。
- 在设置中填写你的 **OpenAI 兼容 API**（或其它已支持的接口）后即可使用。

**部署示例**：GitHub Pages、Cloudflare Pages、Vercel 静态托管等，发布目录即本项目根目录（无 `dist` 构建步骤）。  
若对外提供可访问的部署实例，请遵守 AGPL 提供源代码获取方式。

---

## 开源版与正式版

| | 开源版（本仓库） | 正式版 |
|--|------------------|--------|
| 密谈 / 角色 / 论坛等 | ✅ | ✅ |
| 云账号登录 | ❌ | ✅ |
| ST 验证卡导入解锁 | ❌ | ✅（需登录） |

---

## 角色自主状态与场景引擎(CASE · 开源版可选)

本仓库在角色侧提供一个可选子系统:**CASE**(Character Autonomous State & Scene Engine),让角色从「被动 IM」变成「会在自己时段生活」的伙伴。代码全部以同一份 AGPL-3.0 发布,不引入新 npm 依赖,不调用外网 LLM 做状态推理。

**由两块并列的子模块组成**

| 子模块 | 决定 | 例子 |
|--------|------|------|
| 状态机(`state-engine.js`) | 角色内在状态:mood / energy / attention | "他今日心绪好些,有兴致说几句" |
| 日常场景(`state-routine.js`) | 角色按时辰的位置与活动 | "他此刻在回春堂前院坐诊" |

**新增脚本**(位于项目根,`db.js` 之后按顺序加载)

- `state-events.js`            事件总线(`rp-state-*` 自有事件)
- `state-holidays.js`          二十四节气判定 + 公历/农历节日 hook
- `state-presets-chenzixi.js`  陈子奚出厂预设 + `__default__` 通用 fallback
- `state-routine.js`           每个角色的「作息 / 位置 / 专注」查询
- `state-engine.js`            状态机引擎 + 60s tick + chat 事件动态 patch

**数据存放**(复用现有 `kv` 表,不动数据库 schema;不升级 IndexedDB 版本)

| K 常量 | 键名 | 内容 |
|--------|------|------|
| `K.STATE_MACHINES` | `rp_state_machines_v1` | `{ v:1, byCharacter: { [id]: machineData } }` |
| `K.STATE_ROUTINES` | `rp_state_routines_v1` | `{ v:1, byCharacter: { [id]: routineData } }` |
| `K.STATE_ENABLED` | `rp_state_enabled_v1` | `{ v:1, routineEnabled?, proactiveEnabled? }` |
| `K.STATE_LUNAR_FESTIVALS` | `rp_state_lunar_festivals_v1` | 农历节日年度映射(可选) |

**控制台快查 /调试**

```js
// 看当前节奏
XXJ_ROUTINE.current("chenzixi")           // { location, activity, busy, moodShift, ... }
XXJ_ROUTINE.buildPromptHint("chenzixi")    // 给 chat 注入用的一行提示

// 看/改状态机
XXJ_STATE_ENGINE.snapshotAll()            // 所有角色机器快照
XXJ_STATE_ENGINE.notify("onUserMessage", "chenzixi", { brief: "打了个招呼" })
XXJ_STATE_ENGINE.setEnabled("proactive", false) // 关闭主动行为
XXJ_STATE_ENGINE.setEnabled("routine", false)   // 关闭日常场景

// 订阅事件
XXJ_STATE_EVENTS.on(XXJ_STATE_EVENTS.EVT.PROACTIVE, (e) => {
  console.log("主动行为", e.detail);
});
```

**设计原则(有几个不做)**

- ❌ 不接 LLM 推断状态(纯本地规则,定时 + 互动计数 + 仪式)
- ❌ 不动 `app.js` / 不动 `relation.js` / 不动 `forum.js` / 不动 `holidays.js`
- ❌ 不升 IndexedDB 版本
- ❌ 不引入新 npm 包
- 仅:在 `db.js` 的 `K` 里追加 4 个常量、在 `XXJ_DB.persistChatInboxNow` 上加动态包装

**陈子奚出厂预设摘要**(在 `state-presets-chenzixi.js` 可改)

| 时段 | 位置 | 做什么 | 忙 |
|-----|-----|-------|------|
| 0–5  | 回春堂·后院卧房 | 沉睡 | asleep |
| 5–7  | 后院 | 晨起练拳 | exercise |
| 7–11 | 回春堂·前院正厅 | 坐诊 | treating |
| 11–13| 后院偏厅 | 午饭 + 午歇 | resting |
| 13–17| 前厅或出诊路上 | 看诊 / 出诊 | treating |
| 17–19| 后院 | 习武或沿河散步 | exercise |
| 19–22| 书房 | 灯下读医案、写信 | focused |
| 22–24| 回春堂·后院卧房 | 将睡未睡 | asleep |

节气/节日覆盖:寒露·后院赏桂、清明·祭兄长、端午·施药、重阳·登高、中秋·赏月。

---

## 角色位置与邀请子系统(LI · 开源版可选)

CASE 让角色有了「内在状态」和「按 schedule 在某地做某事」的内在时间;**LI(Location & Invitation)** 则把这些状态从不可见的 prompt 注入,升级成 **密谈顶部可见 + 用户可邀请互动** 的可视化能力。

> 你可以在「陈府 / 回春堂 / 其他区域」之间邀请陈子奚前往某地,持续几小时;prompt 注入 / routine slot / 时间线全部同步更新,过期自动恢复原 schedule。

### 子模块

| 文件 | 职责 |
|------|------|
| `state-locations.js` | 地点 CRUD(`list / get / add / update / remove`),`rp_locations_v1` 持久化,事件总线 |
| `state-invitation.js` | 邀请管理(`set / cancel / active / sweep`),`rp_invitations_v1` 持久化,过期事件 |
| `state-location-ui.js` | 密谈顶部位置条 + 「邀请他…」弹层(纯 HTML/CSS,无新依赖) |

### 数据模型

**Location**(地点)
```js
{
  id: "loc_xxx",                  // 短 id,系统生成
  name: "陈府",                     // 显示名
  description: "陈家旧宅...",        // 1-2 句场景描述
  defaultActivity: "与堂主对坐...",  // 邀请到此地点时的活动描述
  tags: ["私宅", "陈家"],           // 标签,可作筛选
  createdAt: 1762923600000,
  updatedAt: 1762923600000
}
```

**Invitation**(邀请)
```js
{
  charId: "chenzixi",
  locationId: "loc_xxx",
  startedAt: 1762923600000,         // ms
  expiresAt: 1762930800000,         // ms
  duration: 7200000,                // ms
  createdBy: "user",
  createdAt: 1762923600000
}
```

### 新增 K 常量(`db.js`)

| Key | 用途 |
|-----|------|
| `K.LOCATIONS` (`rp_locations_v1`) | 地点列表 |
| `K.INVITATIONS` (`rp_invitations_v1`) | 邀请字典 |

### UI 钩子

密谈顶部 `header.chat-screen-topbar` 之前自动插入:

```
📍 陈子奚 · 在 回春堂·前院正厅 · 正在坐诊替乡邻开方   [邀请他…]
```

点「邀请他…」弹出选择层:

- 列出所有自建地点
- 「+ 新建地点」子表单(name / description / defaultActivity / tags)
- 时长选择:1 / 2 / 4 小时
- 「确认」→ `XXJ_INVITATION.set(charId, { locationId, duration })`
- 若已有 active 邀请,显示「取消现有邀请」按钮

### 关键流程

1. 用户在密谈顶部看到「📍 陈子奚 在 回春堂·前院正厅 · 正在坐诊替乡邻开方」
2. 点「邀请他…」→ 弹层列出地点 + 新建入口
3. 选「陈府」+「2 小时」→ 立即:
   - 位置条刷新成「📍 陈子奚 在 陈府 · 正在与堂主对坐闲谈家事」
   - `XXJ_ROUTINE.current("chenzixi")` 返回 `source: "invitation"`
   - 下次 chat 时,prompt 末尾自动出现 `📍 邀请中 · 身处:[陈府] · 正在:[与堂主对坐闲谈家事]`
4. 2 小时后(`XXJ_STATE_ENGINE` tick)→ `sweep()` 清理 → 位置条恢复原 schedule
5. 邀请未到期时点「邀请他…」可看到「取消现有邀请」按钮

### 控制台示例

```js
// 列出现有地点
XXJ_LOCATIONS.list();

// 新建一个地点
XXJ_LOCATIONS.add({
  name: "镇上集市",
  description: "回春堂以南三里,逢三六九开市。",
  defaultActivity: "随人流逛摊,偶尔帮人诊脉开方",
  tags: ["公共", "陈家周边"]
});

// 邀请陈子奚去镇上集市,2 小时
const loc = XXJ_LOCATIONS.list().find(l => l.name === "镇上集市");
XXJ_INVITATION.set("chenzixi", { locationId: loc.id, duration: 2 * 60 * 60 * 1000 });

// 查 active 邀请
XXJ_INVITATION.active("chenzixi");
// → { charId:"chenzixi", locationId:"loc_xxx", startedAt:..., expiresAt:..., duration:7200000, ... }

// 取消
XXJ_INVITATION.cancel("chenzixi");

// 查 routine 当前 slot
XXJ_ROUTINE.current("chenzixi");
// → { location:"镇上集市", activity:"随人流逛摊...", source:"invitation", expiresAt:... }
```

### 设计原则

- **可见才好玩。** CASE 让角色有了「内在时间」;LI 让这个时间对用户也可见、可打断、可重排。
- **临时覆盖,不污染底色。** 邀请只持续几小时,过期自动回到原 schedule,不会改写 preset。
- **可自由发挥。** 地点由用户自建,系统不预设任何具体地点,只给占位种子。
- **实时同步。** 位置条 / prompt / routine slot 三处一致;事件总线驱动刷新。

### 不在本期范围(留口子)

- 区域地图视图(简笔地图)
- NPC 主动邀请(不请自来)
- 邀请历史 / 行程回顾
- 群组场景下多个角色同时邀请

---

## 开发与安全

- 发布前可运行：`node scripts/check-publish.js --staged`
- **切勿**将含 Supabase 配置、真实 `auth.js`、`.env` 等提交到公开仓库。
