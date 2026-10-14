/**
 * 小心机桌面 · IndexedDB：kv 键值表 + ai_profiles 配置行，库名与表结构均为本项目专用。
 * - kv: { key, value } 通用键值，value 可为任意 structured-cloneable
 * - chat_thread_msgs: 旧版分表（仅启动迁移读回 inbox 内联，新数据不再写入）
 * - ai_profiles: { id, name, baseUrl, model, apiKey, temperature?, updatedAt } 多条 AI 配置档案
 * 主控面具 / 角色人设（kv 表，IndexedDB 库名见 DB_NAME）：
 *   - K.USER_MASK、K.CHAR_PERSONA：与「当前选中」同步的扁平对象，供旧逻辑与 prompt 读取。
 *   - K.USER_MASK_STORE：{ v:2, activeId, items:[{ id, displayName?, avatar?, persona?, summary?, voice?, boundaries?, region?（CN/TW/HK/JP/KR/US/UK 或空；密谈「时间感知」开时用于 holidays 地区调休，与小心机一致） }, …] }，条数不限。
 *   - K.CHAR_PERSONA_STORE：{ v:2, activeId, items:[{ id, …角色字段含 avatar、dialogueLang?（常用对白语言）、npcRelations?、openings?:string[]（开场白，首条主开场） }, …] }，条数不限。
 *   - K.CHAT_INBOX_STORE：{ v:1, byMask:{ [maskId]: { threads:[{ id, charId, messages, updatedAt, kind?, groupTitle?, scenePrompt?, charThreadNote?（主控对本密谈角色的私有备忘，进系统提示）, charThreadMemorySummaries?:[{ id, at, text }]（记忆摘要时间线）, charThreadEmotionalMemories?:[{ id, at, text }]（遗留字段；已不再注入提示，情绪并入记忆摘要）, charThreadMemoryRolled?（早期摘要 AI 压缩档）, charThreadRemarkName?（列表/顶栏/心声等展示名 ≤32 字，不进系统提示称呼）, charRemarkForUser?（角色对本密谈主控的私人昵称 ≤32 字，仅界面与 prompt 提示，不改面具 displayName）, charRemarkForUserReason?（改备注时的内心动机，可选）, threadUiCssPresetId?（卷宗绑定的全局 CSS 预设 id，与 K.CHAT_THREAD_UI_CSS_PRESETS 对应）, worldBookVolumeId?, worldBookVolumeIds?, offlineWorldBookVolumeIds?（晤面追加局部 ≤8，叠加在 worldBookVolumeIds 之上，仅当面注入；全局卷仍自动注入）, heartVoiceEnabled?, charTranslationEnabled?, charTranslationTone?, charTranslationTargetLang?, groupTranslationEnabled?（群聊外语成员对照翻译）, groupTranslationTone?, groupTranslationTargetLang?, offlineDmProseStyle? offlineDmLength?（short / medium / long / xlarge 超长）offlineDmCharPov? offlineDmUserPov?（first/second/third）offlineDmPov?（旧快捷 mixed_narrator|immersive_you）offlineDmProseStyleText? offlineDmLengthText? offlineDmPovText?（与上组同时进系统提示；可与快捷叠用或单靠自定义；参见全局预设键 CHAT_OFFLINE_DM_PROSE_PRESETS）, chatHeroBgImage?, chatHeroBgFullBleed?（true 且已设 chatHeroBgImage 时顶部头像背后背景贴边）, chatBodyBgImage?（消息区列表背景 · data URL）, chatMessagesBgFullBleed?（true 且已设 chatBodyBgImage 时消息区背景四向贴边铺满列表区）, chatImageRefDataUrl?（密谈生图参考图 data URL）, chatThreadCharImagePrompt?（本密谈角色外貌生图 tag/提示词，优先于从人设 tags 推断；推荐 NovelAI 英文 tag）, chatThreadImageStylePresetId? / chatThreadImageStylePromptCustom?（会话风格后缀）, chatThreadImageEveryRound?（true 时每轮对方主回复后尝试会话生图；仍须全局启用生图且已填 Key；无 charImageCaption 时用气泡首段或心声作画面描述）, … }], moments:[…] } } }；messages 中 assistant 可有可选 heartVoice 与扩展心声字段 hvState（对应模型 JSON innerState：偏此刻在做什么/姿势/穿着）/ hvMood / hvDesire / hvAffinity / hvAffectionDesc，以及可选 translation（与 content 同为 ||| 分段对齐）；charTranslationEnabled===true 时本轮要求 JSON lineTranslations；charTranslationTone 为 literal|colloquial；heartVoiceEnabled===false 时关闭心声手记（默认开）；notice kind char_remark_user 为角色改主控备注的系统提示；各 chat*BgImage 为可选 data URL 背景。
 *   - K.CHAT_ACTIVE_THREAD：{ maskId, threadId } 当前打开的密谈线程（与面具一致）。
 *   - K.CHAT_LOG：旧版单线消息；首次读 inbox 时会迁入对应面具后删除。
 *   - K.USER_MASK_LIBRARY：旧版三槽，首次读新 store 时会迁移后不再依赖。
 *   - K.WORLD_BOOK_STORE：{ v:2, volumes:[{ id, title, scope?: "local"|"global"（默认 local；global 表示任意密谈发消息都注入该卷已启用条目，无需密谈绑定）, entries:[{ id, title, content, keywords?, enabled? }] }] }；旧版 v1 items 会在首次读取时迁入 v2（持久化；是否注入 prompt 另接）。
 *   - K.IMAGE_GEN_CONFIG：全局生图（与聊天 API 分键；provider 含 openai / novelai / custom；NovelAI 时 baseUrl 为可选 CORS 反代根，与小心机 proxyUrl 语义一致），见 app 内 readImageGenConfig。
 *   - K.IMAGE_GEN_PRESETS：生图预设列表（含服务商/Base/模型/尺寸/提示词、NovelAI 采样项与本机保存的 API Key，与本设备 IndexedDB 同源）。
 *   - K.CHAT_THREAD_UI_CSS_PRESETS：密谈聊天页自定义 CSS 预设列表 { id, name, css }[]（全局面板，可多套命名）。
 *   - K.CHAT_OFFLINE_DM_PROSE_PRESETS：线下文风全局预设 { id, name, offlineDmProseStyle?, offlineDmLength?, offlineDmCharPov?, offlineDmUserPov?, offlineDmPov?, offlineDmProseStyleText?, offlineDmLengthText?, offlineDmPovText?, updatedAt? }[]（线下抽屉下拉套用；与密谈存盘字段同形）。
 *   - K.GLOBAL_UI_TYPO：全局界面字体 { v:1, rootSizePx?, linkUrl?, fontStack?, faceFamily?, faceSrcUrl?, faceSrcDataUrl? }（装扮页；rootSizePx 约 12–22）。
 *   - K.GLOBAL_UI_TYPO_PRESETS：全局字体命名预设 { id, name, linkUrl?, fontStack?, faceFamily?, faceSrcUrl?, faceSrcDataUrl?, rootSizePx? }[]（装扮 · 存为预设）。
 *   - K.GLOBAL_CHAT_SURFACE_CSS：全局密谈主界面覆盖 CSS { v:1, css }（装扮页；与每密谈「绑定预设」叠加，密谈层后加载）。
 *   - K.DESKTOP_APP_ICONS：主屏应用图标 { v:1, byApp:{ [data-app]: … } }（仅 `#app-grid`）。
 *   - K.DESKTOP_DOCK_APP_ICONS：Dock 图标 { v:1, byApp:{ … } }（仅底栏；未设置的 app 沿用主屏同名片图标）。
 *   - K.DESKTOP_HERO_CARD_BG：桌面顶部时钟大卡背景图 { v:1, src?: data:image/… 或 https URL }（装扮页；`.hero-card` 背景，文字仍在上层）。
 *   - K.DESKTOP_WALLPAPER_BG：主屏整面墙纸 { v:1, src?: data:image/… 或 https URL }（`.phone .wallpaper`；未设置时沿用 Palette 渐变套）。
 *   - K.DESKTOP_APP_TILE_BGS：主屏应用格底图 { v:1, byApp:{ [data-app]: data:image/… 或 https } }（仅 `#app-grid` 内按钮；Dock 不含）。
 *   - K.DESKTOP_APP_TOWER_BG：`#app-grid` 应用塔容器整体铺底 { v:1, src?: … }（叠在默认卡片底色之上）。
 *   - K.DESKTOP_DOCK_BG：底部 Dock 胶囊 `.dock-plate` 铺底 { v:1, src?: … }。
 * AI 多份 API 配置在独立表 ai_profiles，条数不限。
 * 首次打开时从 localStorage 迁移同名键，再读写在 DB，避免散落 LS。
 */
(function () {
  const DB_NAME = "xxjDesktop";
  const DB_VERSION = 4;

  const CHAT_THREAD_MSGS_STORE = "chat_thread_msgs";
  const CHAT_MSGS_SPLIT_MARK = "split";

  const K = {
    PHOTOS: "rp_polaroid_photos_v1",
    HERO_NOTE: "rp_hero_note_v1",
    SCENE_PROMPT: "rp_scene_prompt_v1",
    THEME_DARK: "rp_desktop_dark",
    TOKEN: "rp_auth_token_v1",
    /** Supabase 会话 JSON：access_token / refresh_token */
    SUPABASE_SESSION: "rp_supabase_session_v1",
    /** SillyTavern 卡导入：本机解锁后写入 "1" */
    FEATURE_ST_TAVERN_IMPORT: "rp_feature_st_tavern_import_v1",
    AI_BASE: "rp_ai_openai_base",
    AI_KEY: "rp_ai_api_key",
    AI_MODEL: "rp_ai_model",
    AI_TEMPERATURE: "rp_ai_temperature",
    AI_ACTIVE_PROFILE: "rp_ai_active_profile_id",
    /** 记忆摘要 AI：可选，值为 ai_profiles 的 id；空则沿用当前聊天主 API（KV 表单） */
    AI_MEMO_SUMMARY_PROFILE: "rp_ai_memo_summary_profile_id",
    /** 记忆摘要自动化默认（按面具）：{ v:1, byMask:{ [maskId]: { memoAutoSummaryEveryUser?, memoAutoMergeEverySummaries? } } } */
    CHAT_MEMO_AUTOMATION_DEFAULT: "rp_chat_memo_automation_default_v1",
    /** 小剧场 AI：可选，值为 ai_profiles 的 id；空则沿用当前聊天主 API */
    AI_THEATER_PROFILE: "rp_ai_theater_profile_id",
    /** 小剧场全局默认启用 preset id 列表（最多 3 个）：string[] */
    THEATER_DEFAULT_ENABLED: "rp_theater_default_enabled_v1",
    /** 小剧场生成方式：`separate`（默认，聊天后单独请求）| `merged`（并入聊天 JSON 的 theaterSnaps） */
    THEATER_GEN_MODE: "rp_theater_gen_mode_v1",
    /** 小剧场间隔（轮）：并入聊天时控制完整说明注入；单独请求时控制是否发起小剧场 API（0=每轮） */
    THEATER_PROMPT_MIN_GAP: "rp_theater_prompt_min_gap_v1",
    CHAR_PERSONA: "rp_char_persona_v1",
    USER_MASK: "rp_user_mask_v1",
    /** @deprecated 迁移用旧三槽；新数据用 USER_MASK_STORE */
    USER_MASK_LIBRARY: "rp_user_mask_library_v1",
    USER_MASK_STORE: "rp_user_mask_store_v2",
    CHAR_PERSONA_STORE: "rp_char_persona_store_v2",
    CHAT_LOG: "rp_chat_messages_v1",
    CHAT_INBOX_STORE: "rp_chat_inbox_v1",
    CHAT_ACTIVE_THREAD: "rp_chat_active_thread_v1",
    /** “我的”页（按主控面具隔离）的本地数据 */
    MY_STORE: "rp_my_store_v1",
    /** 论坛（按主控面具隔离）：{ v:1, byMask:{ [maskId]: { forumHandle?, sectors, activeSectorId, posts, conversations, readTimestamps, seeded? } } } */
    FORUM_STORE: "rp_forum_store_v1",
    /** 论坛刷帖/续聊 API（可与密谈主 API 分键） */
    FORUM_AI_CONFIG: "rp_forum_ai_config_v1",
    /** 关系网 AI 整理 API（可与密谈主 API 分键） */
    RELATION_AI_CONFIG: "rp_relation_ai_config_v1",
    /** 关系网 char↔char 后台互动（按面具） */
    RELATION_BG_STORE: "rp_relation_bg_v1",
    /** 表情包（按主控面具隔离） */
    STICKER_STORE: "rp_sticker_store_v1",
    /** MiniMax TTS（全局） */
    MINIMAX_TTS_CONFIG: "rp_minimax_tts_config_v1",
    /** 桌面 Palette 套序号 0..n-1（键名沿用 v1；旧版线性墙纸槽大数字会在首次应用时折叠） */
    DESKTOP_STYLE_SLOT: "rp_desktop_style_slot_v1",
    WORLD_BOOK_STORE: "rp_world_book_store_v1",
    /** 生图（OpenAI Images 兼容等），与聊天 API 分键 */
    IMAGE_GEN_CONFIG: "rp_image_gen_config_v1",
    /** 生图预设（不含 Key），见 app readImageGenPresets */
    IMAGE_GEN_PRESETS: "rp_image_gen_presets_v1",
    /** 密谈聊天页自定义 CSS 预设（全局列表）：{ id, name, css }[] */
    CHAT_THREAD_UI_CSS_PRESETS: "rp_chat_thread_ui_css_presets_v1",
    /** 晤面页自定义 CSS 预设（全局列表）：{ id, name, css }[] */
    CHAT_OFFLINE_THREAD_UI_CSS_PRESETS: "rp_chat_offline_thread_ui_css_presets_v1",
    /** 线下文风全局预设（快捷三项 + 主控自定义三段）：{ id, name, … }[] */
    CHAT_OFFLINE_DM_PROSE_PRESETS: "rp_chat_offline_dm_prose_presets_v1",
    /** 小剧场自定义预设（内置只读在 app；此处存用户预设）：{ id, name, kind, instruction?, htmlShell?, updatedAt? }[] */
    THEATER_PRESETS: "rp_theater_presets_v1",
    /** 全局界面字体与根字号（装扮） */
    GLOBAL_UI_TYPO: "rp_global_ui_typo_v1",
    /** 全局字体命名预设列表（装扮） */
    GLOBAL_UI_TYPO_PRESETS: "rp_global_ui_typo_presets_v1",
    /** 装扮 · 全局密谈主界面 CSS（#chat-screen） */
    GLOBAL_CHAT_SURFACE_CSS: "rp_global_chat_surface_css_v1",
    /** 装扮 · 全局晤面界面 CSS（#chat-offline-screen） */
    GLOBAL_CHAT_OFFLINE_SURFACE_CSS: "rp_global_chat_offline_surface_css_v1",
    /** 装扮 · 主屏应用图标（#app-grid） */
    DESKTOP_APP_ICONS: "rp_desktop_app_icons_v1",
    /** 装扮 · Dock 应用图标（底栏；未写则回退主屏） */
    DESKTOP_DOCK_APP_ICONS: "rp_desktop_dock_app_icons_v1",
    /** 装扮 · 首页时钟大卡（.hero-card）背景图 */
    DESKTOP_HERO_CARD_BG: "rp_desktop_hero_card_bg_v1",
    /** 装扮 · 主屏整面墙纸（.phone .wallpaper） */
    DESKTOP_WALLPAPER_BG: "rp_desktop_wallpaper_bg_v1",
    DESKTOP_APP_TILE_BGS: "rp_desktop_app_tile_bgs_v1",
    DESKTOP_APP_TOWER_BG: "rp_desktop_app_tower_bg_v1",
    DESKTOP_DOCK_BG: "rp_desktop_dock_bg_v1",
    /** 查岗（与 checkup.js 一致） */
    CHECKUP_CASES: "CHECKUP_CASES_V1",
    CHECKUP_REVERSE_SNOOP_LAST: "CHECKUP_REVERSE_SNOOP_LAST_V1",
    /** CASE · 状态机全集: { v:1, byCharacter: { [characterId]: machineData } } */
    STATE_MACHINES: "rp_state_machines_v1",
    /** CASE · 日常场景全集: { v:1, byCharacter: { [characterId]: routineData } } */
    STATE_ROUTINES: "rp_state_routines_v1",
    /** CASE · 全局开关: { v:1, routineEnabled?:true, proactiveEnabled?:true } */
    STATE_ENABLED: "rp_state_enabled_v1",
    /** CASE · 农历节日年度映射(用户可写): { v:1, byYear:{ [yyyy]:{ "正月初一":"YYYY-MM-DD", ... } } } */
    STATE_LUNAR_FESTIVALS: "rp_state_lunar_festivals_v1",
    /** LI · 地点库(用户自建): [{ id, name, description, defaultActivity, tags, ... }] */
    LOCATIONS: "rp_locations_v1",
    /** LI · 邀请(临时拉角色去某地): { v:1, byCharacter:{ [charId]: Invitation } } */
    INVITATIONS: "rp_invitations_v1",
    /** 漫游（与 roam.js 一致） */
    ROAM_STATE: "ROAM_STATE_V1",
    /** 主线 · 命运卡牌（与 roleplay.js 一致） */
    ROLEPLAY_SCRIPT_LIBRARY: "rp_roleplay_script_library_v1",
    ROLEPLAY_SAVES: "rp_roleplay_saves_v1",
    ROLEPLAY_ENDINGS: "rp_roleplay_endings_v1",
    /** 设置 · 全局自定义思维链（旧版单键，读取时作三场景兜底） */
    GLOBAL_THINKING_CHAIN: "rp_global_thinking_chain_v1",
    /** 设置 · 分场景自定义思维链（留空则用内置；旧版单键仅作读取兜底） */
    GLOBAL_THINKING_CHAIN_IM: "rp_global_thinking_chain_im_v1",
    GLOBAL_THINKING_CHAIN_OFFLINE: "rp_global_thinking_chain_offline_v1",
    GLOBAL_THINKING_CHAIN_GROUP: "rp_global_thinking_chain_group_v1",
    /** 设置 · 即时密谈多泡打字节奏：R | S | off；缺省 R */
    CHAT_IM_HUMAN_PACE: "rp_chat_im_human_pace_v1",
    /** 设置 · 聊天提示词套装：original（原套）| thick（版本2）| v3（版本3）；密谈可覆盖 */
    GLOBAL_PROMPT_PACK: "rp_global_prompt_pack_v1",
    /** 备份 · GitHub 云端（PAT / 仓库 / 远程路径，含 token） */
    BACKUP_CLOUD_GITHUB: "rp_backup_cloud_github_v1"
  };

  const LS_PROFILES_LEGACY = "rp_ai_profiles_v1";

  const MIGRATE_KV_KEYS = [
    K.PHOTOS,
    K.HERO_NOTE,
    K.SCENE_PROMPT,
    K.THEME_DARK,
    K.TOKEN,
    K.SUPABASE_SESSION,
    K.FEATURE_ST_TAVERN_IMPORT,
    K.AI_BASE,
    K.AI_KEY,
    K.AI_MODEL,
    K.AI_TEMPERATURE,
    K.AI_ACTIVE_PROFILE,
    K.AI_MEMO_SUMMARY_PROFILE,
    K.CHAT_MEMO_AUTOMATION_DEFAULT,
    K.AI_THEATER_PROFILE,
    K.THEATER_DEFAULT_ENABLED,
    K.THEATER_GEN_MODE,
    K.THEATER_PROMPT_MIN_GAP,
    K.CHAR_PERSONA,
    K.USER_MASK,
    K.USER_MASK_LIBRARY,
    K.USER_MASK_STORE,
    K.CHAR_PERSONA_STORE,
    K.CHAT_LOG,
    K.CHAT_INBOX_STORE,
    K.CHAT_ACTIVE_THREAD,
    K.MY_STORE,
    K.FORUM_STORE,
    K.FORUM_AI_CONFIG,
    K.RELATION_AI_CONFIG,
    K.RELATION_BG_STORE,
    K.STICKER_STORE,
    K.MINIMAX_TTS_CONFIG,
    K.DESKTOP_STYLE_SLOT,
    K.WORLD_BOOK_STORE,
    K.IMAGE_GEN_CONFIG,
    K.IMAGE_GEN_PRESETS,
    K.CHAT_THREAD_UI_CSS_PRESETS,
    K.CHAT_OFFLINE_THREAD_UI_CSS_PRESETS,
    K.CHAT_OFFLINE_DM_PROSE_PRESETS,
    K.THEATER_PRESETS,
    K.GLOBAL_UI_TYPO,
    K.GLOBAL_UI_TYPO_PRESETS,
    K.GLOBAL_CHAT_SURFACE_CSS,
    K.GLOBAL_CHAT_OFFLINE_SURFACE_CSS,
    K.DESKTOP_APP_ICONS,
    K.DESKTOP_DOCK_APP_ICONS,
    K.DESKTOP_HERO_CARD_BG,
    K.DESKTOP_WALLPAPER_BG,
    K.DESKTOP_APP_TILE_BGS,
    K.DESKTOP_APP_TOWER_BG,
    K.DESKTOP_DOCK_BG,
    K.CHECKUP_CASES,
    K.CHECKUP_REVERSE_SNOOP_LAST,
    K.ROAM_STATE,
    K.ROLEPLAY_SCRIPT_LIBRARY,
    K.ROLEPLAY_SAVES,
    K.ROLEPLAY_ENDINGS,
    K.GLOBAL_THINKING_CHAIN,
    K.GLOBAL_THINKING_CHAIN_IM,
    K.GLOBAL_THINKING_CHAIN_OFFLINE,
    K.GLOBAL_THINKING_CHAIN_GROUP,
    K.CHAT_IM_HUMAN_PACE,
    K.GLOBAL_PROMPT_PACK,
    K.BACKUP_CLOUD_GITHUB
  ];

  /** 导入全量覆盖时保留（登录态） */
  const AUTH_KEEP_KEYS = new Set([K.TOKEN, K.SUPABASE_SESSION]);
  /** 用户改动能落盘：除登录与密谈 inbox（inbox 走 persistChatInboxNow）外，setKv 即写 IndexedDB */
  const STORE_KV_KEYS = new Set(
    MIGRATE_KV_KEYS.filter((k) => !AUTH_KEEP_KEYS.has(k) && k !== K.CHAT_INBOX_STORE)
  );

  function isIosWebKit() {
    const ua = navigator.userAgent || "";
    return (
      /iPhone|iPod|iPad/i.test(ua) ||
      (typeof navigator.platform === "string" &&
        navigator.platform === "MacIntel" &&
        navigator.maxTouchPoints > 1)
    );
  }

  /** @type {IDBDatabase|null} */
  let db = null;
  const memKv = Object.create(null);
  /** @type {Array<{id:string,name:string,baseUrl:string,model:string,apiKey:string,temperature?:number,updatedAt:number}>} */
  let memProfiles = [];
  let isReady = false;

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const idb = e.target.result;
        if (!idb.objectStoreNames.contains("kv")) {
          idb.createObjectStore("kv", { keyPath: "key" });
        }
        if (!idb.objectStoreNames.contains("ai_profiles")) {
          idb.createObjectStore("ai_profiles", { keyPath: "id" });
        }
        if (!idb.objectStoreNames.contains("media_blobs")) {
          idb.createObjectStore("media_blobs", { keyPath: "id" });
        }
        if (!idb.objectStoreNames.contains("minimax_tts_cache")) {
          idb.createObjectStore("minimax_tts_cache", { keyPath: "cacheKey" });
        }
        if (!idb.objectStoreNames.contains(CHAT_THREAD_MSGS_STORE)) {
          idb.createObjectStore(CHAT_THREAD_MSGS_STORE, { keyPath: "threadKey" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  function idbKvGet(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
      req.onerror = () => reject(req.error);
    });
  }

  /** 仅判断键是否存在，避免 migrate 时反序列化巨型 CHAT_INBOX 等 */
  function idbKvHas(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const req = tx.objectStore("kv").getKey(key);
      req.onsuccess = () => resolve(req.result !== undefined);
      req.onerror = () => reject(req.error);
    });
  }

  function idbKvPut(key, value) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbKvDel(key) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 只枚举键，避免 getAll 时反序列化巨型 CHAT_INBOX_STORE */
  function idbKvKeyList() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readonly");
      const store = tx.objectStore("kv");
      const keys = [];
      const req = store.openKeyCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return resolve(keys);
        keys.push(cursor.key);
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** 先亮桌面：主题/套色/便签，不含外链图（装扮图单独一批） */
  const KV_BOOT_PRIORITY = new Set([
    K.THEME_DARK,
    K.HERO_NOTE,
    K.DESKTOP_STYLE_SLOT,
    K.TOKEN,
    K.SUPABASE_SESSION,
    K.SCENE_PROMPT,
    K.PHOTOS
  ]);

  /** 不阻塞 ready / 桌面装扮；后台再载入 */
  const KV_LAZY_AT_BOOT = new Set([
    K.CHAR_PERSONA,
    K.USER_MASK,
    K.USER_MASK_LIBRARY,
    K.USER_MASK_STORE,
    K.CHAR_PERSONA_STORE,
    K.CHAT_LOG,
    K.CHAT_ACTIVE_THREAD,
    K.MY_STORE,
    K.FORUM_STORE,
    K.FORUM_AI_CONFIG,
    K.RELATION_AI_CONFIG,
    K.RELATION_BG_STORE,
    K.STICKER_STORE,
    K.MINIMAX_TTS_CONFIG,
    K.WORLD_BOOK_STORE,
    K.IMAGE_GEN_CONFIG,
    K.IMAGE_GEN_PRESETS,
    K.CHAT_THREAD_UI_CSS_PRESETS,
    K.CHAT_OFFLINE_DM_PROSE_PRESETS,
    K.GLOBAL_CHAT_SURFACE_CSS,
    K.AI_BASE,
    K.AI_KEY,
    K.AI_MODEL,
    K.AI_TEMPERATURE,
    K.AI_ACTIVE_PROFILE,
    K.AI_MEMO_SUMMARY_PROFILE,
    K.CHAT_MEMO_AUTOMATION_DEFAULT,
    K.AI_THEATER_PROFILE,
    K.THEATER_DEFAULT_ENABLED,
    K.THEATER_GEN_MODE,
    K.THEATER_PROMPT_MIN_GAP,
    K.FEATURE_ST_TAVERN_IMPORT,
    K.CHECKUP_CASES,
    K.CHECKUP_REVERSE_SNOOP_LAST
  ]);

  /** 墙纸/图标等（含 https 链接装扮） */
  const KV_DECOR_KEYS = new Set([
    K.DESKTOP_APP_ICONS,
    K.DESKTOP_DOCK_APP_ICONS,
    K.DESKTOP_HERO_CARD_BG,
    K.DESKTOP_WALLPAPER_BG,
    K.DESKTOP_APP_TILE_BGS,
    K.DESKTOP_APP_TOWER_BG,
    K.DESKTOP_DOCK_BG,
    K.GLOBAL_UI_TYPO
  ]);

  /** 先出桌面主视觉，其余装扮键后台续载 */
  const KV_DECOR_FAST = new Set([
    K.DESKTOP_WALLPAPER_BG,
    K.DESKTOP_HERO_CARD_BG,
    K.DESKTOP_APP_ICONS,
    K.DESKTOP_DOCK_APP_ICONS
  ]);

  function threadMessageCountEntry(t) {
    if (!t || typeof t !== "object") return 0;
    if (Array.isArray(t.messages) && t.messages.length > 0) return t.messages.length;
    if (t.messagesStore === CHAT_MSGS_SPLIT_MARK) {
      const mc = Number(t.messageCount);
      return Number.isFinite(mc) && mc > 0 ? Math.floor(mc) : 0;
    }
    if (Array.isArray(t.messages)) return 0;
    return 0;
  }

  function inboxStoreMessageCount(store) {
    if (!store || typeof store !== "object" || !store.byMask || typeof store.byMask !== "object") {
      return 0;
    }
    let n = 0;
    for (const b of Object.values(store.byMask)) {
      if (!b || !Array.isArray(b.threads)) continue;
      for (const t of b.threads) {
        n += threadMessageCountEntry(t);
      }
    }
    return n;
  }

  function chatThreadKey(maskId, threadId) {
    return String(maskId || "").trim() + "\x1f" + String(threadId || "").trim();
  }

  function idbChatMsgsGet(threadKey) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve(undefined);
      const tx = db.transaction(CHAT_THREAD_MSGS_STORE, "readonly");
      const req = tx.objectStore(CHAT_THREAD_MSGS_STORE).get(String(threadKey));
      req.onsuccess = () => resolve(req.result || undefined);
      req.onerror = () => reject(req.error);
    });
  }

  function idbChatMsgsPut(row) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("IndexedDB not open"));
      const tx = db.transaction(CHAT_THREAD_MSGS_STORE, "readwrite");
      tx.objectStore(CHAT_THREAD_MSGS_STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbChatMsgsDelete(threadKey) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(CHAT_THREAD_MSGS_STORE, "readwrite");
      tx.objectStore(CHAT_THREAD_MSGS_STORE).delete(String(threadKey));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbChatMsgsClear() {
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHAT_THREAD_MSGS_STORE, "readwrite");
      tx.objectStore(CHAT_THREAD_MSGS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function chatMsgsGet(maskId, threadId) {
    const threadKey = chatThreadKey(maskId, threadId);
    return idbChatMsgsGet(threadKey);
  }

  /**
   * 从最新消息向历史分页（offset=0 为最近一页）。
   * @returns {Promise<{ messages: object[], total: number, hasMore: boolean, offset: number, limit: number }>}
   */
  async function chatMsgsGetPage(maskId, threadId, offset, limit) {
    const lim = Math.max(1, Math.min(5000, Number(limit) || 50));
    const off = Math.max(0, Number(offset) || 0);
    const row = await chatMsgsGet(maskId, threadId);
    const all = row && Array.isArray(row.messages) ? row.messages : [];
    const total = all.length;
    const end = total - off;
    const start = Math.max(0, end - lim);
    return {
      messages: all.slice(start, end),
      total,
      hasMore: start > 0,
      offset: off,
      limit: lim
    };
  }

  async function chatMsgsPut(maskId, threadId, messages, updatedAt) {
    const mid = String(maskId || "").trim();
    const tid = String(threadId || "").trim();
    if (!mid || !tid) return;
    const list = Array.isArray(messages) ? messages : [];
    const threadKey = chatThreadKey(mid, tid);
    await idbChatMsgsPut({
      threadKey,
      maskId: mid,
      threadId: tid,
      messages: list,
      count: list.length,
      updatedAt: typeof updatedAt === "number" ? updatedAt : Date.now()
    });
  }

  async function chatMsgsDelete(maskId, threadId) {
    const threadKey = chatThreadKey(maskId, threadId);
    await idbChatMsgsDelete(threadKey);
  }

  /**
   * 落盘：messages 与密谈元数据同对象内联写入 inbox KV（不再外置 chat_thread_msgs）。
   * @param {object} inbox
   */
  async function prepareInboxForIdbPersist(inbox) {
    return inbox;
  }

  /**
   * 一次性：旧版分表 messagesStore=split 并回 thread.messages（读 chat_thread_msgs），再内联落盘。
   * @param {object} inbox
   */
  async function migrateSplitThreadsToInlineInbox(inbox) {
    if (!inbox || typeof inbox !== "object" || !inbox.byMask || !db) return inbox;
    let changed = false;
    for (const [mk, bucket] of Object.entries(inbox.byMask)) {
      if (!bucket || !Array.isArray(bucket.threads)) continue;
      for (const th of bucket.threads) {
        if (!th || typeof th !== "object") continue;
        if (th.messagesStore !== CHAT_MSGS_SPLIT_MARK) {
          if (Array.isArray(th.messages)) th.messageCount = th.messages.length;
          continue;
        }
        if (Array.isArray(th.messages) && th.messages.length > 0) {
          th.messageCount = th.messages.length;
          delete th.messagesStore;
          changed = true;
          continue;
        }
        try {
          const row = await chatMsgsGet(mk, th.id);
          th.messages = row && Array.isArray(row.messages) ? row.messages.slice() : [];
          th.messageCount = th.messages.length;
        } catch (err) {
          console.warn("XXJ_DB migrateSplitThreadsToInline failed:", mk, th.id, err);
          th.messages = [];
          th.messageCount = 0;
        }
        delete th.messagesStore;
        changed = true;
      }
    }
    if (changed) {
      try {
        await idbKvPut(K.CHAT_INBOX_STORE, inbox);
      } catch (err) {
        console.warn("XXJ_DB migrateSplitThreadsToInline persist failed:", err);
      }
    }
    return inbox;
  }

  /**
   * 备份导出：把分表消息并回 inbox 副本（ZIP 仍用单文件 chats 模块）。
   * @param {object} inbox
   */
  async function hydrateInboxThreadMessagesForExport(inbox) {
    if (!inbox || typeof inbox !== "object" || !inbox.byMask || !db) return inbox;
    const out = JSON.parse(JSON.stringify(inbox));
    for (const [mk, bucket] of Object.entries(out.byMask || {})) {
      if (!bucket || !Array.isArray(bucket.threads)) continue;
      for (const th of bucket.threads) {
        if (!th || typeof th !== "object") continue;
        if (th.messagesStore !== CHAT_MSGS_SPLIT_MARK) continue;
        if (Array.isArray(th.messages) && th.messages.length > 0) continue;
        try {
          const row = await chatMsgsGet(mk, th.id);
          if (row && Array.isArray(row.messages) && row.messages.length) {
            th.messages = row.messages;
            th.messageCount = row.messages.length;
          } else {
            th.messages = [];
            th.messageCount = 0;
          }
          delete th.messagesStore;
        } catch (err) {
          console.warn("XXJ_DB hydrateInboxThreadMessagesForExport failed:", mk, th.id, err);
        }
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    return out;
  }

  /** 粗略比较 KV 条目「谁更完整」，用于 LS / IDB / 内存择优（防空数据盖库） */
  function kvStoreRichness(key, value) {
    if (value === undefined || value === null) return 0;
    if (key === K.CHAT_INBOX_STORE) return inboxStoreMessageCount(value);
    if (key === K.USER_MASK_STORE || key === K.CHAR_PERSONA_STORE) {
      return Array.isArray(value.items) ? value.items.length : 0;
    }
    if (key === K.WORLD_BOOK_STORE) {
      return Array.isArray(value.volumes) ? value.volumes.length : 0;
    }
    if (key === K.STICKER_STORE && value.byMask && typeof value.byMask === "object") {
      let n = 0;
      for (const b of Object.values(value.byMask)) {
        if (b && Array.isArray(b.items)) n += b.items.length;
      }
      return n;
    }
    if (key === K.MY_STORE && value.byMask && typeof value.byMask === "object") {
      return Object.keys(value.byMask).length;
    }
    if (key === K.PHOTOS) return Array.isArray(value) ? value.length : 0;
    if (typeof value === "string") return value.length > 0 ? value.length : 0;
    if (typeof value === "object") {
      try {
        return JSON.stringify(value).length;
      } catch {
        return 1;
      }
    }
    return 1;
  }

  async function hydrateKvKeys(keys) {
    const toLoad = keys.filter((k) => k !== K.CHAT_INBOX_STORE);
    if (!toLoad.length) return;
    await Promise.all(
      toLoad.map(async (key) => {
        if (Object.prototype.hasOwnProperty.call(memKv, key)) return;
        let value = await idbKvGet(key);
        if (value === undefined) {
          const lsRaw = localStorage.getItem(key);
          if (lsRaw !== null) {
            value = parseLsValue(key, lsRaw);
            if (db && value !== undefined) await idbKvPut(key, value);
          }
        } else {
          tryBackupKvToLocalStorage(key, value);
        }
        if (value !== undefined) memKv[key] = value;
      })
    );
  }

  async function hydrateKvKeysChunked(keys, chunkSize) {
    const list = keys.filter((k) => k !== K.CHAT_INBOX_STORE);
    const step = Math.max(1, chunkSize || 4);
    for (let i = 0; i < list.length; i += step) {
      await hydrateKvKeys(list.slice(i, i + step));
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  /** @returns {{ decor: string[], lazy: string[] }} */
  async function hydrateKvExceptInbox() {
    const keys = await idbKvKeyList();
    const priority = [];
    const decor = [];
    const lazy = [];
    for (const k of keys) {
      if (k === K.CHAT_INBOX_STORE) continue;
      if (KV_LAZY_AT_BOOT.has(k)) {
        lazy.push(k);
        continue;
      }
      if (KV_BOOT_PRIORITY.has(k)) priority.push(k);
      else if (KV_DECOR_KEYS.has(k)) decor.push(k);
      else lazy.push(k);
    }
    await hydrateKvKeys(priority);
    try {
      window.dispatchEvent(new CustomEvent("xxj-photos-ready"));
    } catch (_) {
      /* ignore */
    }
    return { decor, lazy };
  }

  /** iOS：大包/导入后勿与 app.js 解析同时灌 slow decor + lazy KV，等主包就绪后再续载 */
  function scheduleIosDeferredHydrate(run) {
    if (!isIosWebKit()) {
      run();
      return;
    }
    const go = () => {
      try {
        run();
      } catch (err) {
        console.warn("XXJ_DB ios deferred hydrate failed:", err);
      }
    };
    if (window.__xxjAppInteractive) {
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(go, { timeout: 5000 });
      } else {
        setTimeout(go, 400);
      }
      return;
    }
    window.addEventListener(
      "xxj-app-interactive",
      () => {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(go, { timeout: 5000 });
        } else {
          setTimeout(go, 400);
        }
      },
      { once: true }
    );
  }

  async function hydrateKvDecorAndRest(decorKeys, lazyKeys) {
    const fast = [];
    const slow = [];
    for (const k of decorKeys || []) {
      if (KV_DECOR_FAST.has(k)) fast.push(k);
      else slow.push(k);
    }
    if (fast.length && db) {
      await hydrateKvKeysChunked(fast, 2);
    }
    window.__xxjDecorKvReady = true;
    try {
      window.dispatchEvent(new CustomEvent("xxj-db-decor-ready"));
    } catch (_) {
      /* ignore */
    }
    const finishRest = async () => {
      if (slow.length && db) {
        await hydrateKvKeysChunked(slow, 2);
      }
      window.__xxjKvRestReady = true;
      try {
        window.dispatchEvent(new CustomEvent("xxj-db-kv-rest-ready"));
      } catch (_) {
        /* ignore */
      }
      const fireOtherKvReady = () => {
        window.__xxjOtherKvReady = true;
        try {
          window.dispatchEvent(new CustomEvent("xxj-db-other-ready"));
        } catch (_) {
          /* ignore */
        }
      };
      if (lazyKeys?.length && db) {
        await hydrateKvKeysChunked(lazyKeys, isIosWebKit() ? 2 : 4);
        fireOtherKvReady();
      } else {
        fireOtherKvReady();
      }
    };
    if (isIosWebKit() && (slow.length || (lazyKeys && lazyKeys.length))) {
      scheduleIosDeferredHydrate(() => {
        void finishRest();
      });
    } else {
      await finishRest();
    }
  }

  function idbProfilesGetAll() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ai_profiles", "readonly");
      const req = tx.objectStore("ai_profiles").getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  function idbProfilePut(row) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ai_profiles", "readwrite");
      tx.objectStore("ai_profiles").put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbProfileDel(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ai_profiles", "readwrite");
      tx.objectStore("ai_profiles").delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbProfilesClear() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("ai_profiles", "readwrite");
      tx.objectStore("ai_profiles").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbMediaPut(id, blob, mime) {
    return new Promise((resolve, reject) => {
      const row = {
        id: String(id),
        blob,
        mime: String(mime || (blob && blob.type) || "image/jpeg"),
        at: Date.now()
      };
      const tx = db.transaction("media_blobs", "readwrite");
      tx.objectStore("media_blobs").put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbMediaGet(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("media_blobs", "readonly");
      const req = tx.objectStore("media_blobs").get(String(id));
      req.onsuccess = () => {
        const row = req.result;
        resolve(row && row.blob instanceof Blob ? row.blob : undefined);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function idbMediaClear() {
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("media_blobs", "readwrite");
      tx.objectStore("media_blobs").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const MINIMAX_TTS_CACHE_STORE = "minimax_tts_cache";
  const MINIMAX_TTS_CACHE_DEFAULT_MAX_BYTES = 40 * 1024 * 1024;

  function idbMinimaxTtsListMeta() {
    return new Promise((resolve, reject) => {
      if (!db) return resolve([]);
      const tx = db.transaction(MINIMAX_TTS_CACHE_STORE, "readonly");
      const store = tx.objectStore(MINIMAX_TTS_CACHE_STORE);
      const rows = [];
      const req = store.openCursor();
      req.onsuccess = (e) => {
        const cursor = e.target.result;
        if (!cursor) return resolve(rows);
        const v = cursor.value;
        rows.push({
          cacheKey: String(v.cacheKey || ""),
          bytes: Number(v.bytes) || 0,
          at: Number(v.at) || 0
        });
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
    });
  }

  function idbMinimaxTtsGet(cacheKey) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve(undefined);
      const tx = db.transaction(MINIMAX_TTS_CACHE_STORE, "readonly");
      const req = tx.objectStore(MINIMAX_TTS_CACHE_STORE).get(String(cacheKey));
      req.onsuccess = () => {
        const row = req.result;
        resolve(row && row.blob instanceof Blob ? row.blob : undefined);
      };
      req.onerror = () => reject(req.error);
    });
  }

  function idbMinimaxTtsPut(cacheKey, blob) {
    return new Promise((resolve, reject) => {
      if (!db) return reject(new Error("IndexedDB not open"));
      const b = blob instanceof Blob ? blob : new Blob([blob], { type: "audio/mpeg" });
      const row = {
        cacheKey: String(cacheKey),
        blob: b,
        bytes: b.size || 0,
        at: Date.now()
      };
      const tx = db.transaction(MINIMAX_TTS_CACHE_STORE, "readwrite");
      tx.objectStore(MINIMAX_TTS_CACHE_STORE).put(row);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function idbMinimaxTtsDelete(cacheKey) {
    return new Promise((resolve, reject) => {
      if (!db) return resolve();
      const tx = db.transaction(MINIMAX_TTS_CACHE_STORE, "readwrite");
      tx.objectStore(MINIMAX_TTS_CACHE_STORE).delete(String(cacheKey));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbMinimaxTtsClear() {
    if (!db) return;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MINIMAX_TTS_CACHE_STORE, "readwrite");
      tx.objectStore(MINIMAX_TTS_CACHE_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function minimaxTtsCachePut(cacheKey, blob) {
    await idbMinimaxTtsPut(cacheKey, blob);
    const capB = MINIMAX_TTS_CACHE_DEFAULT_MAX_BYTES;
    const rows = await idbMinimaxTtsListMeta();
    rows.sort((a, b) => a.at - b.at);
    let total = rows.reduce((s, r) => s + r.bytes, 0);
    for (const r of rows) {
      if (total <= capB) break;
      await idbMinimaxTtsDelete(r.cacheKey);
      total -= r.bytes;
    }
  }

  async function minimaxTtsCacheStats() {
    const rows = await idbMinimaxTtsListMeta();
    const bytes = rows.reduce((s, r) => s + r.bytes, 0);
    return { count: rows.length, bytes };
  }

  /** @param {Blob} blob @param {string} [mime] */
  async function putMediaBlob(blob, mime) {
    if (!db) throw new Error("IndexedDB not open");
    const b =
      blob instanceof Blob ? blob : new Blob([blob], { type: mime || "image/jpeg" });
    const id =
      "mb_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 11);
    await idbMediaPut(id, b, b.type || mime);
    return id;
  }

  async function getMediaBlob(id) {
    if (!db) return undefined;
    return idbMediaGet(id);
  }

  function idbKvClear() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction("kv", "readwrite");
      tx.objectStore("kv").clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  function parseLsValue(key, raw) {
    if (key === K.PHOTOS) {
      try {
        const p = JSON.parse(raw);
        return Array.isArray(p) ? p : [];
      } catch {
        return [];
      }
    }
    if (key === K.CHAR_PERSONA || key === K.USER_MASK) {
      try {
        const o = JSON.parse(raw);
        return o && typeof o === "object" ? o : {};
      } catch {
        return {};
      }
    }
    if (
      key === K.USER_MASK_LIBRARY ||
      key === K.USER_MASK_STORE ||
      key === K.CHAR_PERSONA_STORE ||
      key === K.CHAT_INBOX_STORE ||
      key === K.CHAT_ACTIVE_THREAD ||
      key === K.WORLD_BOOK_STORE ||
      key === K.STICKER_STORE
    ) {
      try {
        const o = JSON.parse(raw);
        return o && typeof o === "object" ? o : undefined;
      } catch {
        return undefined;
      }
    }
    if (key === K.CHAT_LOG) {
      try {
        const o = JSON.parse(raw);
        return Array.isArray(o) ? o : undefined;
      } catch {
        return undefined;
      }
    }
    if (
      key === K.IMAGE_GEN_CONFIG ||
      key === K.FORUM_AI_CONFIG ||
      key === K.RELATION_AI_CONFIG ||
      key === K.RELATION_BG_STORE ||
      key === K.IMAGE_GEN_PRESETS ||
      key === K.GLOBAL_UI_TYPO ||
      key === K.GLOBAL_CHAT_SURFACE_CSS ||
      key === K.DESKTOP_APP_ICONS ||
      key === K.DESKTOP_DOCK_APP_ICONS ||
      key === K.DESKTOP_HERO_CARD_BG ||
      key === K.DESKTOP_WALLPAPER_BG ||
      key === K.DESKTOP_APP_TILE_BGS ||
      key === K.DESKTOP_APP_TOWER_BG ||
      key === K.DESKTOP_DOCK_BG
    ) {
      try {
        const o = JSON.parse(raw);
        return o && typeof o === "object" ? o : undefined;
      } catch {
        return undefined;
      }
    }
    if (
      key === K.CHAT_THREAD_UI_CSS_PRESETS ||
      key === K.CHAT_OFFLINE_DM_PROSE_PRESETS ||
      key === K.THEATER_PRESETS ||
      key === K.GLOBAL_UI_TYPO_PRESETS
    ) {
      try {
        const o = JSON.parse(raw);
        return Array.isArray(o) ? o : undefined;
      } catch {
        return undefined;
      }
    }
    if (key === K.SUPABASE_SESSION) {
      try {
        let o = JSON.parse(raw);
        if (typeof o === "string") o = JSON.parse(o);
        return o && typeof o === "object" ? o : undefined;
      } catch {
        return undefined;
      }
    }
    if (
      key === K.TOKEN ||
      key === K.HERO_NOTE ||
      key === K.SCENE_PROMPT ||
      key === K.THEME_DARK ||
      key === K.GLOBAL_THINKING_CHAIN ||
      key === K.GLOBAL_THINKING_CHAIN_IM ||
      key === K.GLOBAL_THINKING_CHAIN_OFFLINE ||
      key === K.GLOBAL_THINKING_CHAIN_GROUP ||
      key === K.CHAT_IM_HUMAN_PACE ||
      key === K.GLOBAL_PROMPT_PACK
    ) {
      const s = String(raw);
      if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        try {
          const inner = JSON.parse(s);
          if (typeof inner === "string") return inner;
        } catch {
          /* legacy double-encoded backup */
        }
      }
      return s;
    }
    return raw;
  }

  async function migrateFromLocalStorage() {
    const ios = isIosWebKit();
    await Promise.all(
      MIGRATE_KV_KEYS.map(async (key) => {
        if (ios && (key === K.CHAT_INBOX_STORE || KV_LAZY_AT_BOOT.has(key))) return;
        const raw = localStorage.getItem(key);
        if (raw === null) return;
        const lsValue = parseLsValue(key, raw);
        if (lsValue === undefined) return;
        const inIdb = await idbKvHas(key);
        if (!inIdb) {
          await idbKvPut(key, lsValue);
          return;
        }
        /* 仅以「IDB 无此键」时从 LS 迁入；不用条数/体积择优，否则删除后会被旧 LS 复活 */
      })
    );

    const rows = await idbProfilesGetAll();
    if (rows.length === 0) {
      const legacy = localStorage.getItem(LS_PROFILES_LEGACY);
      if (legacy) {
        try {
          const arr = JSON.parse(legacy);
          if (Array.isArray(arr)) {
            const now = Date.now();
            for (const p of arr) {
              if (!p || !p.id) continue;
              await idbProfilePut({
                id: String(p.id),
                name: String(p.name || "未命名配置"),
                baseUrl: String(p.baseUrl || ""),
                model: String(p.model || ""),
                apiKey: String(p.apiKey || ""),
                updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : now
              });
            }
          }
        } catch {
          /* ignore */
        }
        localStorage.removeItem(LS_PROFILES_LEGACY);
      }
    }
  }

  async function hydrateProfiles() {
    const rows = await idbProfilesGetAll();
    memProfiles = rows
      .filter((r) => r && r.id)
      .map((r) => {
        const t = Number(r.temperature);
        const row = {
          id: String(r.id),
          name: String(r.name || ""),
          baseUrl: String(r.baseUrl || ""),
          model: String(r.model || ""),
          apiKey: String(r.apiKey || ""),
          updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0
        };
        if (Number.isFinite(t)) row.temperature = Math.min(2, Math.max(0, Math.round(t * 100) / 100));
        return row;
      });
  }

  let resolveInboxReady;
  let inboxHydrated = false;
  /** @type {Promise<void>|null} */
  let inboxLoadPromise = null;
  let kvPersistChain = Promise.resolve();
  let profilesPersistChain = Promise.resolve();
  const inboxReadyPromise = new Promise((resolve) => {
    resolveInboxReady = resolve;
  });

  /** 丢弃队列里尚未执行的 put（导入/紧急落盘后调用，避免旧空 inbox 覆盖新数据） */
  function resetKvPersistChain() {
    kvPersistChain = Promise.resolve();
  }

  const KV_LS_BACKUP_MAX_BYTES = 4_000_000;
  const AUTH_PERSIST_KEYS = new Set([K.TOKEN, K.SUPABASE_SESSION]);
  /** 短文本配置：立即写 IndexedDB + 明文 LS，避免刷新前 debounce 丢失 */
  const IMMEDIATE_KV_KEYS = new Set([
    K.HERO_NOTE,
    K.SCENE_PROMPT,
    K.THEME_DARK,
    K.GLOBAL_THINKING_CHAIN,
    K.GLOBAL_THINKING_CHAIN_IM,
    K.GLOBAL_THINKING_CHAIN_OFFLINE,
    K.GLOBAL_THINKING_CHAIN_GROUP,
    K.CHAT_IM_HUMAN_PACE,
    K.GLOBAL_PROMPT_PACK
  ]);
  let flushAllKvTimer = 0;
  let flushAllKvInFlight = null;

  function tryBackupKvToLocalStorage(key, value) {
    if (!MIGRATE_KV_KEYS.includes(key)) return;
    /* 密谈/桌面装扮过大，不写 LS（避免 JSON.stringify 占双倍内存） */
    if (key === K.CHAT_INBOX_STORE || KV_DECOR_KEYS.has(key)) return;
    if (value === undefined || value === null) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      let blob;
      if (typeof value === "string") {
        blob = value;
      } else {
        blob = JSON.stringify(value);
      }
      if (blob.length > KV_LS_BACKUP_MAX_BYTES) {
        /* 过大不写 LS，并清掉旧 LS，避免刷新后「择优」把刚导入的 IDB 盖回旧数据 */
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        return;
      }
      localStorage.setItem(key, blob);
    } catch {
      /* quota / private mode */
    }
  }

  /** 将全部 memKv 与 ai_profiles 写入 IndexedDB（刷新前必须完成） */
  async function flushAllKvNow(opts) {
    if (!db) return;
    const force = Boolean(opts && opts.force);
    resetKvPersistChain();
    const keys = Object.keys(memKv);
    for (const key of keys) {
      const val = memKv[key];
      /* 仅密谈 inbox 防空写入盖掉满库；人设/表情/世界书等删除后条数变少，必须信内存 */
      if (!force && key === K.CHAT_INBOX_STORE) {
        let idbVal;
        try {
          idbVal = await idbKvGet(key);
        } catch {
          idbVal = undefined;
        }
        const memR = kvStoreRichness(key, val);
        const idbR = kvStoreRichness(key, idbVal);
        if (memR < idbR && idbVal !== undefined) {
          memKv[key] = idbVal;
          continue;
        }
      }
      let valToPut = val;
      if (key === K.CHAT_INBOX_STORE && val && typeof val === "object") {
        try {
          valToPut = await prepareInboxForIdbPersist(val, { force: true });
        } catch (err) {
          console.warn("XXJ_DB flushAllKvNow prepareInboxForIdbPersist failed:", err);
        }
      }
      await idbKvPut(key, valToPut);
      tryBackupKvToLocalStorage(key, val);
    }
    const keepProfileIds = new Set(memProfiles.map((p) => p.id));
    const idbProfileRows = await idbProfilesGetAll();
    for (const row of idbProfileRows) {
      if (row && row.id && !keepProfileIds.has(row.id)) {
        await idbProfileDel(row.id);
      }
    }
    for (const row of memProfiles) {
      await idbProfilePut(row);
    }
  }

  function scheduleFlushAllKv(delayMs) {
    if (!db || !isReady) return;
    if (flushAllKvTimer) clearTimeout(flushAllKvTimer);
    flushAllKvTimer = setTimeout(() => {
      flushAllKvTimer = 0;
      flushAllKvInFlight = flushAllKvNow().catch((err) => {
        console.warn("XXJ_DB flushAllKvNow failed:", err);
      });
    }, typeof delayMs === "number" ? delayMs : 300);
  }

  /** 导入后清掉指定键的 LS 备份，避免「择优」用旧 LS 盖掉刚写入的 IndexedDB / 内存 */
  function purgeLsKvBackups(keys) {
    const list =
      keys && keys.length
        ? keys.filter((k) => MIGRATE_KV_KEYS.includes(k))
        : MIGRATE_KV_KEYS.slice();
    for (const key of list) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }

  function enqueueKvDel(key) {
    kvPersistChain = kvPersistChain.then(() => idbKvDel(key)).catch((err) => {
      console.warn("XXJ_DB kv delete failed:", key, err);
    });
  }

  function finishInboxHydrate(inboxValue) {
    const key = K.CHAT_INBOX_STORE;
    const hadMem = Object.prototype.hasOwnProperty.call(memKv, key);
    const memVal = hadMem ? memKv[key] : undefined;
    const memN = inboxStoreMessageCount(memVal);
    const idbN = inboxStoreMessageCount(inboxValue);
    if (!hadMem) {
      if (inboxValue !== undefined) memKv[key] = inboxValue;
    } else if (memN === 0 && idbN > 0) {
      /* 仅内存为空时从 IndexedDB 恢复；mem 有内容时以 mem 为准（含删密谈/删消息） */
      memKv[key] = inboxValue;
    }
    /* mem 条数少于 IDB 时仍保留 mem，避免刷新把已删聊天记录复活 */
    inboxHydrated = true;
    try {
      window.dispatchEvent(new CustomEvent("xxj-db-inbox-ready"));
    } catch (_) {}
    resolveInboxReady();
  }

  async function hydrateInboxLazy() {
    try {
      let inboxValue = await idbKvGet(K.CHAT_INBOX_STORE);
      if (inboxValue === undefined) {
        const lsRaw = localStorage.getItem(K.CHAT_INBOX_STORE);
        if (lsRaw) {
          const lsValue = parseLsValue(K.CHAT_INBOX_STORE, lsRaw);
          if (lsValue !== undefined) {
            inboxValue = lsValue;
            if (db) await idbKvPut(K.CHAT_INBOX_STORE, lsValue);
          }
        }
      }
      if (inboxValue !== undefined) {
        inboxValue = await migrateSplitThreadsToInlineInbox(inboxValue);
      }
      finishInboxHydrate(inboxValue);
    } catch (err) {
      console.warn("XXJ_DB inbox lazy load failed:", err);
      finishInboxHydrate(undefined);
    }
  }

  async function ensureInboxHydrated() {
    if (inboxHydrated) return;
    if (!inboxLoadPromise) {
      inboxLoadPromise = hydrateInboxLazy().catch((err) => {
        inboxLoadPromise = null;
        throw err;
      });
    }
    return inboxLoadPromise;
  }

  function signalBootSplashDataReady() {
    try {
      if (typeof window.__xxjBootSplashTryArm === "function") {
        window.__xxjBootSplashTryArm();
      }
    } catch (_) {
      /* ignore */
    }
  }

  const readyPromise = (async () => {
    try {
      if (window.__xxjOAuthBootstrap) {
        try {
          await window.__xxjOAuthBootstrap;
        } catch (err) {
          console.warn("[xxj-db] oauth bootstrap wait failed:", err);
        }
      }
      db = await openDb();
      await migrateFromLocalStorage();
      if (window.__xxjOAuthBootstrapOk) {
        for (const key of AUTH_KEEP_KEYS) {
          const raw = localStorage.getItem(key);
          if (raw === null) continue;
          const lsValue = parseLsValue(key, raw);
          if (lsValue === undefined) continue;
          memKv[key] = lsValue;
          await idbKvPut(key, lsValue);
        }
      }
      const { decor, lazy } = await hydrateKvExceptInbox();
      await hydrateProfiles();
      await hydrateInboxLazy();
      isReady = true;
      signalBootSplashDataReady();
      void hydrateKvDecorAndRest(decor, lazy);
    } catch (err) {
      console.error("XXJ_DB init failed, fallback localStorage:", err);
      db = null;
      for (const key of MIGRATE_KV_KEYS) {
        const raw = localStorage.getItem(key);
        if (raw === null) continue;
        const v = parseLsValue(key, raw);
        if (v !== undefined) memKv[key] = v;
      }
      inboxHydrated = true;
      resolveInboxReady();
      isReady = true;
    }
    return true;
  })();

  function getKv(key) {
    if (Object.prototype.hasOwnProperty.call(memKv, key)) return memKv[key];
    if (isIosWebKit() && key === K.CHAT_INBOX_STORE && !inboxHydrated) return undefined;
    const s = localStorage.getItem(key);
    if (s === null) return undefined;
    return parseLsValue(key, s);
  }

  /** 仅更新内存 KV，不排队 IndexedDB（密谈 fast 写入后由 persistChatInboxNow 落盘） */
  function setMemKv(key, value) {
    memKv[key] = value;
  }

  function setKv(key, value) {
    memKv[key] = value;
    if (db && isReady) {
      tryBackupKvToLocalStorage(key, value);
      if (AUTH_PERSIST_KEYS.has(key)) {
        flushAllKvInFlight = flushAllKvNow().catch((err) => {
          console.warn("XXJ_DB auth kv persist failed:", err);
        });
      } else if (IMMEDIATE_KV_KEYS.has(key) || STORE_KV_KEYS.has(key)) {
        void idbKvPut(key, value)
          .then(() => tryBackupKvToLocalStorage(key, value))
          .catch((err) => {
            console.warn("XXJ_DB kv persist failed:", key, err);
          });
      } else {
        scheduleFlushAllKv();
      }
    } else {
      if (
        key === K.PHOTOS ||
        key === K.CHAR_PERSONA ||
        key === K.USER_MASK ||
        key === K.USER_MASK_LIBRARY ||
        key === K.USER_MASK_STORE ||
        key === K.CHAR_PERSONA_STORE ||
        key === K.CHAT_LOG ||
        key === K.CHAT_INBOX_STORE ||
        key === K.CHAT_ACTIVE_THREAD ||
        key === K.WORLD_BOOK_STORE ||
        key === K.IMAGE_GEN_CONFIG ||
      key === K.FORUM_AI_CONFIG ||
      key === K.RELATION_AI_CONFIG ||
      key === K.RELATION_BG_STORE ||
        key === K.IMAGE_GEN_PRESETS ||
        key === K.CHAT_THREAD_UI_CSS_PRESETS ||
        key === K.CHAT_OFFLINE_DM_PROSE_PRESETS ||
        key === K.THEATER_PRESETS ||
        key === K.GLOBAL_UI_TYPO ||
        key === K.GLOBAL_UI_TYPO_PRESETS ||
        key === K.GLOBAL_CHAT_SURFACE_CSS ||
        key === K.DESKTOP_APP_ICONS ||
        key === K.DESKTOP_DOCK_APP_ICONS ||
        key === K.DESKTOP_HERO_CARD_BG ||
        key === K.DESKTOP_WALLPAPER_BG ||
        key === K.DESKTOP_APP_TILE_BGS ||
        key === K.DESKTOP_APP_TOWER_BG ||
        key === K.DESKTOP_DOCK_BG
      ) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch {
          /* ignore */
        }
      } else if (value === undefined || value === null) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, String(value));
      }
    }
  }

  function delKv(key) {
    delete memKv[key];
    if (db && isReady) {
      tryBackupKvToLocalStorage(key, undefined);
      const delP = idbKvDel(key).catch((err) => {
        console.warn("XXJ_DB kv delete failed:", key, err);
      });
      if (AUTH_PERSIST_KEYS.has(key)) {
        flushAllKvInFlight = delP;
      } else {
        kvPersistChain = delP;
      }
    }
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  /** 导入前同步删除若干 KV（避免 delKv 异步队列未清完又写入新包） */
  async function clearKvKeysNow(keys) {
    const list = Array.isArray(keys) ? keys : [];
    resetKvPersistChain();
    for (const key of list) {
      if (!key) continue;
      delete memKv[key];
      tryBackupKvToLocalStorage(key, undefined);
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
      if (db) {
        try {
          await idbKvDel(key);
        } catch (err) {
          console.warn("XXJ_DB clearKvKeysNow failed:", key, err);
        }
      }
    }
  }

  async function clearProfilesNow() {
    memProfiles = [];
    if (db) {
      try {
        await idbProfilesClear();
      } catch (err) {
        console.warn("XXJ_DB clearProfilesNow failed:", err);
      }
    }
  }

  /** ZIP 全量恢复：清空除登录外的本机数据，再写入包内内容 */
  async function clearAppDataForImport() {
    const keys = MIGRATE_KV_KEYS.filter((k) => !AUTH_KEEP_KEYS.has(k));
    await clearKvKeysNow(keys);
    await clearProfilesNow();
    await idbMediaClear();
    await idbMinimaxTtsClear();
    await idbChatMsgsClear();
    for (const key of MIGRATE_KV_KEYS) {
      if (AUTH_KEEP_KEYS.has(key)) continue;
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }

  function profilesList() {
    return memProfiles.slice();
  }

  function normalizeProfileRow(spec, updatedAt) {
    const row = {
      id: String(spec.id),
      name: String(spec.name || ""),
      baseUrl: String(spec.baseUrl || ""),
      model: String(spec.model || ""),
      apiKey: spec.apiKey != null ? String(spec.apiKey) : "",
      updatedAt: typeof updatedAt === "number" ? updatedAt : Date.now()
    };
    const tSpec = Number(spec.temperature);
    if (Number.isFinite(tSpec)) {
      row.temperature = Math.min(2, Math.max(0, Math.round(tSpec * 100) / 100));
    }
    return row;
  }

  function profileUpsert(spec) {
    const row = normalizeProfileRow(spec, Date.now());
    const i = memProfiles.findIndex((p) => p.id === row.id);
    if (i >= 0) memProfiles[i] = row;
    else memProfiles.push(row);
    if (db && isReady) {
      void idbProfilePut(row).catch((err) => {
        console.warn("XXJ_DB profile persist failed:", err);
      });
    }
    return row.id;
  }

  /** ZIP 导入：以包内列表全量替换 API 档案 */
  function profilesReplaceAll(rows) {
    const list = Array.isArray(rows) ? rows : [];
    memProfiles = list
      .filter((r) => r && r.id)
      .map((r) =>
        normalizeProfileRow(
          r,
          typeof r.updatedAt === "number" ? r.updatedAt : Date.now()
        )
      );
    if (db && isReady) {
      scheduleFlushAllKv();
    }
  }

  function profileDelete(id) {
    memProfiles = memProfiles.filter((p) => p.id !== id);
    if (db && isReady) {
      void idbProfileDel(id).catch((err) => {
        console.warn("XXJ_DB profile delete failed:", err);
      });
    }
  }

  function sweepLocalStorage() {
    for (const key of MIGRATE_KV_KEYS) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
    try {
      localStorage.removeItem(LS_PROFILES_LEGACY);
    } catch {
      /* ignore */
    }
  }

  async function clearAll() {
    for (const k of Object.keys(memKv)) delete memKv[k];
    memProfiles = [];
    sweepLocalStorage();
    if (db) {
      await idbKvClear();
      await idbProfilesClear();
      await idbMediaClear();
      await idbMinimaxTtsClear();
      await idbChatMsgsClear();
    }
  }

  /** iOS 导入等：inbox 已落 IndexedDB，释放 memKv 峰值，下次打开密谈再 lazy hydrate */
  function releaseInboxFromMemoryAfterIdbWrite() {
    delete memKv[K.CHAT_INBOX_STORE];
    inboxHydrated = false;
    inboxLoadPromise = null;
  }

  /**
   * 导入/恢复后：立即写入 inbox（不依赖异步队列），并标记已灌入。
   * @param {object} inboxValue
   * @param {{ force?: boolean, deferMemKv?: boolean, fast?: boolean, dirtyThreadKey?: string }} [opts]
   *   force：导入等场景允许覆盖（仍禁止空盖满）
   *   deferMemKv：仅写 IndexedDB 不进 memKv（默认关闭，仅极端导入场景）
   *   fast：跳过全量媒体外置；dirtyThreadKey 保留兼容旧调用
   */
  async function persistChatInboxNow(inboxValue, opts) {
    if (!db) throw new Error("IndexedDB not open");
    const force = Boolean(opts && opts.force);
    const fast = Boolean(opts && opts.fast && !force);
    const deferMem = Boolean(opts && opts.deferMemKv && isIosWebKit());
    const nextN = inboxStoreMessageCount(inboxValue);
    let idbValue;
    let idbN = 0;
    try {
      idbValue = await idbKvGet(K.CHAT_INBOX_STORE);
      idbN = inboxStoreMessageCount(idbValue);
    } catch {
      /* ignore */
    }
    if (!force && nextN === 0 && idbN > 0) {
      console.warn("XXJ_DB: refused persistChatInboxNow of empty inbox over IndexedDB data");
      if (idbValue !== undefined) memKv[K.CHAT_INBOX_STORE] = idbValue;
      inboxHydrated = true;
      return;
    }
    if (
      !fast &&
      window.XXJ_MEDIA &&
      typeof window.XXJ_MEDIA.externalizeChatInboxMedia === "function"
    ) {
      try {
        await window.XXJ_MEDIA.externalizeChatInboxMedia(inboxValue);
      } catch (err) {
        console.warn("XXJ_DB: externalizeChatInboxMedia failed", err);
      }
    }
    let inboxForIdb = inboxValue;
    try {
      inboxForIdb = await prepareInboxForIdbPersist(inboxValue, {
        force,
        dirtyThreadKey: opts && opts.dirtyThreadKey
      });
    } catch (err) {
      console.warn("XXJ_DB: prepareInboxForIdbPersist failed, fallback inline inbox", err);
      inboxForIdb = inboxValue;
    }
    await idbKvPut(K.CHAT_INBOX_STORE, inboxForIdb);
    resetKvPersistChain();
    if (deferMem) {
      releaseInboxFromMemoryAfterIdbWrite();
      return;
    }
    memKv[K.CHAT_INBOX_STORE] = inboxValue;
    tryBackupKvToLocalStorage(K.CHAT_INBOX_STORE, inboxValue);
    inboxHydrated = true;
  }

  async function readInboxFromIdb() {
    if (!db) return undefined;
    return idbKvGet(K.CHAT_INBOX_STORE);
  }

  /** 启动 lazy 灌入完成前，从 IndexedDB 直读指定 KV（避免 app 侧误判无数据并写空覆盖） */
  async function readKvFromIdb(key) {
    if (!db || !key) return undefined;
    return idbKvGet(key);
  }

  window.XXJ_DB = {
    DB_NAME,
    K,
    get ready() {
      return readyPromise;
    },
    /** 密谈 inbox 已从 IndexedDB 灌入 memKv（与 ready 同步完成） */
    get inboxReady() {
      return inboxReadyPromise;
    },
    ensureInboxHydrated,
    get isInboxHydrated() {
      return inboxHydrated;
    },
    get isReady() {
      return isReady;
    },
    isIosWebKit,
    getKv,
    setKv,
    setMemKv,
    delKv,
    clearKvKeysNow,
    clearProfilesNow,
    clearAppDataForImport,
    /** 等待 KV 写入 IndexedDB 完成（导入/刷新前宜 await） */
    flushAllPersist() {
      return flushAllKvInFlight || flushAllKvNow();
    },
    flushAllKvNow,
    purgeLsKvBackups,
    resetKvPersistChain,
    persistChatInboxNow,
    readInboxFromIdb,
    readKvFromIdb,
    releaseInboxFromMemory: releaseInboxFromMemoryAfterIdbWrite,
    putMediaBlob,
    getMediaBlob,
    clearMediaBlobs: idbMediaClear,
    minimaxTtsCacheGet: idbMinimaxTtsGet,
    minimaxTtsCachePut,
    minimaxTtsCacheClear: idbMinimaxTtsClear,
    minimaxTtsCacheStats,
    MINIMAX_TTS_CACHE_DEFAULT_MAX_BYTES,
    CHAT_MSGS_SPLIT_MARK,
    chatThreadKey,
    chatMsgsGet,
    chatMsgsGetPage,
    chatMsgsPut,
    chatMsgsDelete,
    hydrateInboxThreadMessagesForExport,
    inboxStoreMessageCount,
    profilesList,
    profileUpsert,
    profilesReplaceAll,
    profileDelete,
    clearAll
  };
})();

/** 开屏 + 注入 app.js（原 boot.js，合并进 db.js 以减少请求） */
(function () {
  const ASSET_V = "363";
  const MAIN_APP = "app.js?v=" + ASSET_V;
  const INLINE_HTML_MODULE = "inline-html.js?v=" + ASSET_V;
  const GROUP_MODULE = "group.js?v=" + ASSET_V;
  const CHECKUP_MODULE = "checkup.js?v=351";
  const CHECKUP_REVERSE_MODULE = "checkup-reverse.js?v=348";
  const ROAM_MODULE = "roam.js?v=49";
  const FORUM_MODULE = "forum.js?v=47";
  const RELATION_MODULE = "relation.js?v=23";
  const RELATION_INTERACT_MODULE = "relation-interact.js?v=19";
  const RELATION_AI_MODULE = "relation-ai.js?v=2";
  const ROLEPLAY_MODULE = "roleplay.js?v=16";
  const PRECHAIN = [
    "media-blob.js?v=" + ASSET_V,
    "ai-api.js?v=" + ASSET_V,
    "auth.js?v=" + ASSET_V,
    "ringtones.js?v=" + ASSET_V,
    "voice-ringtone-picker.js?v=" + ASSET_V
  ];
  const FFLATE_LOCAL = "vendor/fflate.umd.js";
  const SUPABASE_LOCAL = "vendor/supabase.min.js";
  const SUPABASE_CDN =
    "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js";
  const WALLS_PER_PALETTE = 3;
  const HERO_NOTE_DEFAULT = "天天开心，万事顺意。";

  function makePhoneWallpapers(a, b, c) {
    return [
      `linear-gradient(160deg, rgba(255,255,255,0.35), transparent 55%), linear-gradient(330deg, rgba(${a},0.12), transparent 50%), var(--bg-device)`,
      `linear-gradient(150deg, rgba(255,255,255,0.22), transparent 50%), linear-gradient(330deg, rgba(${b},0.14), transparent 52%), var(--bg-device)`,
      `linear-gradient(160deg, rgba(255,255,255,0.28), transparent 58%), linear-gradient(320deg, rgba(${c},0.15), transparent 52%), var(--bg-device)`
    ];
  }

  const BOOT_PALETTES = [
    {
      walls: makePhoneWallpapers("88, 120, 255", "170, 205, 255", "58, 92, 137"),
      light: { "--accent": "#3a5c89", "--tint-rgb": "58, 92, 137", "--blush-rgb": "180, 205, 255" },
      dark: { "--accent": "#87a4d0", "--tint-rgb": "135, 164, 208", "--blush-rgb": "165, 185, 235" }
    },
    {
      walls: makePhoneWallpapers("150, 110, 240", "205, 195, 255", "98, 62, 168"),
      light: { "--accent": "#6e4dbd", "--tint-rgb": "98, 62, 168", "--blush-rgb": "210, 200, 255" },
      dark: { "--accent": "#a990e8", "--tint-rgb": "168, 150, 230", "--blush-rgb": "175, 180, 240" }
    },
    {
      walls: makePhoneWallpapers("50, 160, 130", "190, 235, 200", "28, 100, 82"),
      light: { "--accent": "#1f7a61", "--tint-rgb": "34, 120, 95", "--blush-rgb": "170, 215, 175" },
      dark: { "--accent": "#5cba9a", "--tint-rgb": "110, 200, 175", "--blush-rgb": "140, 195, 165" }
    },
    {
      walls: makePhoneWallpapers("240, 200, 215", "255, 222, 232", "190, 150, 168"),
      light: { "--accent": "#b8889e", "--tint-rgb": "178, 138, 158", "--blush-rgb": "255, 220, 232" },
      dark: { "--accent": "#d9b4c8", "--tint-rgb": "200, 168, 188", "--blush-rgb": "235, 205, 218" }
    },
    {
      walls: makePhoneWallpapers("115, 125, 145", "195, 200, 212", "72, 82, 98"),
      light: { "--accent": "#4a5468", "--tint-rgb": "72, 82, 98", "--blush-rgb": "175, 182, 198" },
      dark: { "--accent": "#9aa4b8", "--tint-rgb": "130, 140, 158", "--blush-rgb": "175, 182, 198" }
    },
    {
      walls: makePhoneWallpapers("255, 234, 120", "255, 248, 200", "195, 155, 35"),
      light: { "--accent": "#b8920a", "--tint-rgb": "165, 132, 28", "--blush-rgb": "255, 228, 140" },
      dark: { "--accent": "#edd56a", "--tint-rgb": "210, 175, 55", "--blush-rgb": "255, 215, 120" }
    }
  ];

  function setProgress(pct) {
    if (isBootSplashVisible()) {
      setBootSplashProgress(pct, "");
      return;
    }
    const bar = document.getElementById("app-load-bar-fill");
    const wrap = document.getElementById("app-load-bar");
    if (bar) bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    if (wrap) wrap.hidden = false;
  }

  function hideProgress() {
    const wrap = document.getElementById("app-load-bar");
    if (wrap) {
      wrap.hidden = true;
      const bar = document.getElementById("app-load-bar-fill");
      if (bar) bar.style.width = "0%";
    }
    document.documentElement.classList.remove("xxj-main-loading");
  }

  function isBootSplashVisible() {
    const root = document.getElementById("boot-splash");
    return !!(root?.isConnected && !root.classList.contains("boot-splash--out"));
  }

  function setBootSplashProgress(pct, label) {
    if (!isBootSplashVisible()) return;
    const fill = document.getElementById("boot-splash-load-fill");
    const lab = document.getElementById("boot-splash-load-label");
    const wrap = document.getElementById("boot-splash-load");
    if (wrap) {
      wrap.hidden = false;
      wrap.setAttribute("aria-hidden", "false");
    }
    if (fill) fill.style.width = Math.min(100, Math.max(4, pct)) + "%";
    if (lab && label) lab.textContent = label;
  }

  function bootSplashGateReady() {
    const D = window.XXJ_DB;
    if (!D || !D.isReady) return false;
    if (!isDesktopShellReady()) return false;
    if (isMobileIos()) return !!window.__xxjAppInteractive;
    if (!window.__xxjDecorKvReady) return false;
    if (!window.__xxjAppInteractive) return false;
    return typeof openSettings === "function";
  }

  let bootSplashArmPollTimer = 0;
  function scheduleBootSplashArmCheck() {
    if (window.__xxjBootSplashArmed) return;
    window.clearTimeout(bootSplashArmPollTimer);
    bootSplashArmPollTimer = window.setTimeout(() => {
      bootSplashArmPollTimer = 0;
      if (window.__xxjBootSplashArmed) return;
      const D = window.XXJ_DB;
      if (!D || !D.isReady) {
        setBootSplashProgress(12, "正在连接本地库…");
        scheduleBootSplashArmCheck();
        return;
      }
      if (!isDesktopShellReady()) {
        setBootSplashProgress(16, "正在准备界面…");
        scheduleBootSplashArmCheck();
        return;
      }
      if (isMobileIos()) {
        setBootSplashProgress(55, "数据已就绪");
      } else if (!window.__xxjDecorKvReady) {
        setBootSplashProgress(32, "正在读取桌面装扮…");
        scheduleBootSplashArmCheck();
        return;
      } else {
        applyBootShellPaint();
        if (!window.__xxjAppInteractive) {
          setBootSplashProgress(68, "正在加载应用…");
          scheduleBootSplashArmCheck();
          return;
        }
        if (typeof openSettings !== "function") {
          setBootSplashProgress(82, "正在整理桌面…");
          scheduleBootSplashArmCheck();
          return;
        }
        setBootSplashProgress(96, "即将完成…");
      }
      if (!bootSplashGateReady()) {
        scheduleBootSplashArmCheck();
        return;
      }
      applyBootShellPaint();
      setBootSplashProgress(100, "可以进入了");
      if (typeof window.__xxjBootSplashTryArm === "function") {
        window.__xxjBootSplashTryArm();
      }
    }, 60);
  }

  window.__xxjBootSplashGateReady = bootSplashGateReady;
  window.__xxjBootSplashSetBootProgress = setBootSplashProgress;
  window.__xxjBootSplashScheduleArmCheck = scheduleBootSplashArmCheck;

  function hasSupabaseSdk() {
    const g = globalThis.supabase;
    return !!(g && typeof g.createClient === "function");
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="' + src + '"]');
      if (existing) {
        if (existing.dataset.xxjLoaded === "1") {
          resolve();
          return;
        }
        const done = () => {
          existing.dataset.xxjLoaded = "1";
          resolve();
        };
        existing.addEventListener("load", done, { once: true });
        existing.addEventListener("error", () => reject(new Error("load failed: " + src)), {
          once: true
        });
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = () => {
        s.dataset.xxjLoaded = "1";
        resolve();
      };
      s.onerror = () => reject(new Error("load failed: " + src));
      document.body.appendChild(s);
    });
  }

  const LAZY_VENDOR_SCRIPTS = [
    "https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js",
    "https://cdn.jsdelivr.net/npm/lunar-javascript@1.6.12/lunar.js",
    "holidays.js",
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"
  ];

  function scheduleLazyVendorScripts() {
    setTimeout(() => {
      for (const src of LAZY_VENDOR_SCRIPTS) {
        if (document.querySelector('script[src="' + src + '"]')) continue;
        const s = document.createElement("script");
        s.src = src;
        s.async = true;
        document.body.appendChild(s);
      }
    }, 320);
  }

  function bootCssBgUrl(s) {
    return "url('" + String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "')";
  }

  function readBootPaletteIndex(D) {
    const raw = D.getKv(D.K.DESKTOP_STYLE_SLOT);
    const n = Number(raw);
    const len = BOOT_PALETTES.length;
    if (!Number.isFinite(n) || n < 0) return 0;
    if (n >= len) return Math.floor(n / WALLS_PER_PALETTE) % len;
    return n % len;
  }

  function readKvImageSrc(D, key) {
    const raw = D.getKv(key);
    if (!raw || typeof raw !== "object") return "";
    const s = String(raw.src || "").trim();
    if (s.startsWith("data:image/") || s.startsWith("https://") || s.startsWith("http://")) return s;
    return "";
  }

  function readKvIconByApp(D, key) {
    const raw = D.getKv(key);
    if (!raw || typeof raw !== "object") return {};
    const by = raw.byApp;
    if (!by || typeof by !== "object") return {};
    const out = Object.create(null);
    for (const [k, v] of Object.entries(by)) {
      const s = String(v || "").trim();
      if (s.startsWith("data:image/") || s.startsWith("https://") || s.startsWith("http://")) {
        out[String(k)] = s;
      }
    }
    return out;
  }

  function decorOverlay(layer) {
    const dark = document.body.classList.contains("dark");
    if (layer === "tower" || layer === "dock") {
      return dark
        ? "linear-gradient(160deg, rgba(0,0,0,0.38) 0%, rgba(0,0,0,0.16) 45%, rgba(0,0,0,0.36) 100%)"
        : "linear-gradient(160deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.12) 40%, rgba(0,0,0,0.08) 100%)";
    }
    return dark
      ? "linear-gradient(180deg, rgba(0,0,0,0.52) 0%, rgba(0,0,0,0.28) 48%, rgba(0,0,0,0.46) 100%)"
      : "linear-gradient(180deg, rgba(255,255,255,0.48) 0%, rgba(255,255,255,0.1) 42%, rgba(0,0,0,0.14) 100%)";
  }

  function applyBootPaletteShell() {
    const D = window.XXJ_DB;
    if (!D || !D.isReady) return;
    const pal = BOOT_PALETTES[readBootPaletteIndex(D)];
    const dark = document.body.classList.contains("dark");
    const vars = dark ? pal.dark : pal.light;
    for (const [key, val] of Object.entries(vars)) {
      document.documentElement.style.setProperty(key, val);
    }
    const wallEl = document.getElementById("desktop-wallpaper");
    if (!wallEl) return;
    const custom = readKvImageSrc(D, D.K.DESKTOP_WALLPAPER_BG);
    if (custom) {
      const overlay = dark
        ? "linear-gradient(180deg, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.06) 42%, rgba(0,0,0,0.24) 100%)"
        : "linear-gradient(180deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.05) 36%, rgba(0,0,0,0.075) 100%)";
      wallEl.style.background = `${overlay}, ${bootCssBgUrl(custom)} center/cover no-repeat`;
    } else {
      wallEl.style.background = pal.walls[0];
    }
  }

  function applyBootDecorShell() {
    const D = window.XXJ_DB;
    if (!D || !D.isReady) return;
    applyBootPaletteShell();
    const hero = document.getElementById("desktop-hero-card");
    const heroSrc = readKvImageSrc(D, D.K.DESKTOP_HERO_CARD_BG);
    if (hero) {
      if (heroSrc) {
        hero.classList.add("has-custom-hero-bg");
        hero.style.backgroundImage = bootCssBgUrl(heroSrc);
      } else {
        hero.classList.remove("has-custom-hero-bg");
        hero.style.backgroundImage = "";
      }
    }
    const note = document.getElementById("hero-note");
    if (note) {
      const saved = D.getKv(D.K.HERO_NOTE);
      note.textContent =
        saved && String(saved).trim() ? String(saved).trim() : HERO_NOTE_DEFAULT;
    }
    const homeBy = readKvIconByApp(D, D.K.DESKTOP_APP_ICONS);
    const dockBy = readKvIconByApp(D, D.K.DESKTOP_DOCK_APP_ICONS);
    const paintIcon = (btn, src) => {
      if (!(btn instanceof HTMLElement) || !src) return;
      let img = btn.querySelector(":scope > img.home-app-icon");
      const ic = btn.querySelector(":scope > i.ph");
      if (!img) {
        img = document.createElement("img");
        img.className = "home-app-icon";
        img.alt = "";
        img.loading = "eager";
        img.decoding = "async";
        img.referrerPolicy = "no-referrer";
        img.onerror = () => {
          img.remove();
          btn.classList.remove("has-home-app-icon");
        };
        if (ic) btn.insertBefore(img, ic);
        else btn.appendChild(img);
      }
      if (String(img.getAttribute("src") || "") !== src) img.src = src;
      btn.classList.add("has-home-app-icon");
    };
    document.querySelectorAll("#app-grid [data-app]").forEach((btn) => {
      const app = btn instanceof HTMLElement ? btn.dataset.app : "";
      if (app && homeBy[app]) paintIcon(btn, String(homeBy[app]));
    });
    document.querySelectorAll(".dock-stack footer.dock [data-app]").forEach((btn) => {
      const app = btn instanceof HTMLElement ? btn.dataset.app : "";
      const src = (app && (dockBy[app] || homeBy[app])) || "";
      if (src) paintIcon(btn, String(src));
    });
  }

  function applyBootTileAndDockShell() {
    const D = window.XXJ_DB;
    if (!D || !D.isReady) return;
    const tiles = readKvIconByApp(D, D.K.DESKTOP_APP_TILE_BGS);
    const tileOverlay = decorOverlay("tile");
    document.querySelectorAll("#app-grid [data-app]").forEach((btn) => {
      if (!(btn instanceof HTMLElement)) return;
      const app = btn.dataset.app;
      const src = app ? tiles[app] : "";
      if (src) {
        btn.classList.add("has-custom-app-tile-bg");
        btn.style.background = `${tileOverlay}, ${bootCssBgUrl(src)} center/cover no-repeat`;
      }
    });
    const towerSrc = readKvImageSrc(D, D.K.DESKTOP_APP_TOWER_BG);
    const grid = document.getElementById("app-grid");
    if (grid && towerSrc) {
      grid.classList.add("has-custom-app-tower-bg");
      grid.style.backgroundImage = `${decorOverlay("tower")}, ${bootCssBgUrl(towerSrc)}`;
      grid.style.backgroundSize = "cover";
      grid.style.backgroundPosition = "center";
    }
    const dockSrc = readKvImageSrc(D, D.K.DESKTOP_DOCK_BG);
    const dockPlate = document.getElementById("desktop-dock-plate");
    if (dockPlate && dockSrc) {
      dockPlate.style.backgroundImage = `${decorOverlay("dock")}, ${bootCssBgUrl(dockSrc)}`;
      dockPlate.style.backgroundSize = "cover";
      dockPlate.style.backgroundPosition = "center";
    }
  }

  function applyBootPolaroids() {
    const D = window.XXJ_DB;
    if (!D || !D.isReady || !D.K) return;
    const raw = D.getKv(D.K.PHOTOS);
    const photos = Array.isArray(raw) ? raw : [];
    document.querySelectorAll(".polaroid-card").forEach((card, index) => {
      const img = card.querySelector("img");
      if (!img) return;
      const src = String(photos[index] || "").trim();
      if (src && String(img.getAttribute("src") || "") !== src) {
        img.loading = "eager";
        img.decoding = "async";
        img.src = src;
      }
      card.classList.toggle("is-empty", !src);
    });
  }

  function refreshBootDesktopDecor() {
    applyBootDecorShell();
    applyBootTileAndDockShell();
    applyBootPolaroids();
    if (typeof applyDesktopAppIcons === "function") applyDesktopAppIcons();
    if (typeof applyDesktopAppTileBackgrounds === "function") applyDesktopAppTileBackgrounds();
    if (typeof applyDesktopAppTowerBackground === "function") applyDesktopAppTowerBackground();
    if (typeof applyDesktopDockBackground === "function") applyDesktopDockBackground();
  }

  function isDesktopShellReady() {
    return !!(document.getElementById("app-grid") && document.getElementById("phone"));
  }

  function awaitPhoneInDom() {
    if (isDesktopShellReady()) return Promise.resolve();
    return new Promise((resolve) => {
      const tryResolve = () => {
        if (isDesktopShellReady()) resolve();
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", tryResolve, { once: true });
      } else {
        const id = window.setInterval(() => {
          if (isDesktopShellReady()) {
            window.clearInterval(id);
            resolve();
          }
        }, 20);
      }
    });
  }

  function isMobileIos() {
    const D = window.XXJ_DB;
    if (D && typeof D.isIosWebKit === "function") return D.isIosWebKit();
    const ua = navigator.userAgent || "";
    return /iPhone|iPod|iPad/i.test(ua);
  }

  function allowMainBundle() {
    window.__xxjMainBundleAllowed = true;
  }

  function ensureMainScriptsScheduled() {
    if (window.__xxjMainScriptsScheduled) return;
    if (!window.__xxjMainBundleAllowed) return;
    if (!isDesktopShellReady()) {
      document.addEventListener("DOMContentLoaded", ensureMainScriptsScheduled, { once: true });
      return;
    }
    window.__xxjMainScriptsScheduled = true;
    void (async () => {
      try {
        await loadScript(PRECHAIN[0]);
        await loadScript(PRECHAIN[1]);
        await loadScript(PRECHAIN[3]);
        await loadScript(PRECHAIN[4]);
        await loadScript(FFLATE_LOCAL);
        await loadScript(MAIN_APP);
        await loadScript(INLINE_HTML_MODULE);
        await loadScript(GROUP_MODULE);
        await loadScript(RELATION_MODULE);
        await loadScript(RELATION_INTERACT_MODULE);
        await loadScript(RELATION_AI_MODULE);
        await loadScript(CHECKUP_MODULE);
        await loadScript(CHECKUP_REVERSE_MODULE);
        await loadScript(ROAM_MODULE);
        await loadScript(FORUM_MODULE);
        await loadScript(ROLEPLAY_MODULE);
      } catch (err) {
        console.warn("[xxj-load] main script chain failed", err);
      }
    })();
  }

  async function ensureSupabaseSdkLoaded() {
    if (hasSupabaseSdk()) return;
    for (const src of [SUPABASE_LOCAL, SUPABASE_CDN]) {
      try {
        await loadScript(src);
      } catch {
        /* try next */
      }
      if (hasSupabaseSdk()) return;
    }
    for (let i = 0; i < 40 && !hasSupabaseSdk(); i++) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (!hasSupabaseSdk()) throw new Error("supabase sdk unavailable");
  }

  function flushPendingAppAction() {
    const pending = window.__xxjPendingAppAction;
    if (typeof pending !== "function") return;
    window.__xxjPendingAppAction = null;
    try {
      pending();
    } catch (err) {
      console.warn("[xxj-load] pending app action failed", err);
    }
  }

  async function loadMainApp(opts) {
    const showUi = opts && opts.showUi === true;
    ensureMainScriptsScheduled();
    if (window.__xxjMainLoadPromise) {
      if (showUi) document.documentElement.classList.add("xxj-main-loading");
      try {
        await window.__xxjMainLoadPromise;
        flushPendingAppAction();
      } finally {
        if (showUi) hideProgress();
      }
      return window.__xxjMainLoadPromise;
    }
    window.__xxjMainLoadPromise = (async () => {
      if (window.__xxjMainScriptsStarted) return;
      window.__xxjMainScriptsStarted = true;
      await awaitPhoneInDom();
      ensureMainScriptsScheduled();
      if (showUi) {
        document.documentElement.classList.add("xxj-main-loading");
        setProgress(10);
      }
      try {
        try {
          if (isBootSplashVisible()) setBootSplashProgress(72, "正在加载应用…");
          await loadScript(PRECHAIN[0]);
          if (isBootSplashVisible()) setBootSplashProgress(76, "正在加载应用…");
          else if (showUi) setProgress(14);
          await loadScript(PRECHAIN[1]);
          if (isBootSplashVisible()) setBootSplashProgress(78, "正在加载应用…");
          else if (showUi) setProgress(16);
          await loadScript(PRECHAIN[3]);
          if (isBootSplashVisible()) setBootSplashProgress(80, "正在加载应用…");
          else if (showUi) setProgress(18);
          await loadScript(PRECHAIN[4]);
          if (isBootSplashVisible()) setBootSplashProgress(82, "正在加载应用…");
          else if (showUi) setProgress(19);
          await loadScript(FFLATE_LOCAL);
          if (isBootSplashVisible()) setBootSplashProgress(84, "正在加载应用…");
          else if (showUi) setProgress(20);
          await loadScript(MAIN_APP);
          await loadScript(INLINE_HTML_MODULE);
          await loadScript(GROUP_MODULE);
          await loadScript(RELATION_MODULE);
          await loadScript(RELATION_INTERACT_MODULE);
          await loadScript(RELATION_AI_MODULE);
          await loadScript(CHECKUP_MODULE);
          await loadScript(CHECKUP_REVERSE_MODULE);
          await loadScript(ROAM_MODULE);
          await loadScript(FORUM_MODULE);
          await loadScript(ROLEPLAY_MODULE);
          if (isBootSplashVisible()) setBootSplashProgress(90, "正在整理桌面…");
          else if (showUi) setProgress(70);
        } catch (err) {
          console.error("[xxj-load] main app load failed", err);
        }
        if (typeof window.__xxjMarkAppInteractive === "function") {
          window.__xxjMarkAppInteractive();
        } else if (!window.__xxjAppInteractive) {
          window.__xxjAppInteractive = true;
          document.documentElement.classList.remove("xxj-awaiting-app");
        }
        scheduleLazyVendorScripts();
        flushPendingAppAction();
        if (isBootSplashVisible()) {
          setBootSplashProgress(96, "即将完成…");
          scheduleBootSplashArmCheck();
        } else if (showUi) setProgress(82);
        void (async () => {
          try {
            await ensureSupabaseSdkLoaded();
            await loadScript(PRECHAIN[2]);
          } catch (err) {
            console.warn("[xxj-load] auth chain failed", err);
          }
        })();
        if (showUi) setProgress(100);
      } finally {
        if (showUi) hideProgress();
      }
    })();
    return window.__xxjMainLoadPromise;
  }

  function preloadMainApp() {
    allowMainBundle();
    ensureMainScriptsScheduled();
    void loadMainApp();
  }

  window.__xxjScheduleMainApp = function () {
    allowMainBundle();
    ensureMainScriptsScheduled();
    void loadMainApp({ showUi: true });
  };

  function markBootSplashDataReady() {
    applyBootPolaroids();
    scheduleBootSplashArmCheck();
  }

  function applyBootShellPaint() {
    const D = window.XXJ_DB;
    if (!D || !D.isReady) return false;
    const raw = D.getKv(D.K.THEME_DARK);
    const isDark = raw === "1" || raw === 1 || raw === true;
    document.body.classList.toggle("dark", isDark);
    const now = new Date();
    const timeText =
      String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const t1 = document.getElementById("time-now");
    const t2 = document.getElementById("hero-time");
    if (t1) t1.textContent = timeText;
    if (t2) t2.textContent = timeText;
    const themeBtn = document.getElementById("theme-toggle");
    if (themeBtn) themeBtn.textContent = isDark ? "Day" : "Night";
    applyBootPaletteShell();
    if (window.__xxjDecorKvReady) applyBootDecorShell();
    else {
      const note = document.getElementById("hero-note");
      if (note) {
        const saved = D.getKv(D.K.HERO_NOTE);
        note.textContent =
          saved && String(saved).trim() ? String(saved).trim() : HERO_NOTE_DEFAULT;
      }
    }
    applyBootPolaroids();
    return true;
  }

  window.__xxjApplyBootShellPaint = applyBootShellPaint;

  window.addEventListener("xxj-photos-ready", () => {
    applyBootPolaroids();
    if (typeof renderPolaroids === "function") renderPolaroids();
  });
  window.addEventListener("xxj-db-decor-ready", () => {
    refreshBootDesktopDecor();
    scheduleBootSplashArmCheck();
  });
  window.addEventListener("xxj-db-kv-rest-ready", () => {
    refreshBootDesktopDecor();
  });
  window.addEventListener("xxj-app-interactive", () => {
    scheduleBootSplashArmCheck();
  });

  window.__xxjBootSplashDismiss = function () {
    const core = window.__xxjBootSplashDismissCore;
    if (typeof core !== "function") return;
    if (!window.__xxjBootSplashArmed) return;
    applyBootShellPaint();
    document.documentElement.classList.remove("xxj-boot-data-pending");
    scheduleLazyVendorScripts();
    allowMainBundle();
    core();
    ensureMainScriptsScheduled();
    if (!window.__xxjAppInteractive) {
      void loadMainApp({ showUi: true });
    } else {
      hideProgress();
    }
  };

  window.__xxjMarkAppInteractive = function () {
    window.__xxjAppInteractive = true;
    try {
      window.dispatchEvent(new CustomEvent("xxj-app-interactive"));
    } catch (_) {
      /* ignore */
    }
    document.documentElement.classList.remove("xxj-awaiting-app");
    scheduleLazyVendorScripts();
    scheduleBootSplashArmCheck();
    flushPendingAppAction();
  };

  setBootSplashProgress(8, "正在启动…");
  document.documentElement.classList.add("xxj-boot-data-pending");

  const D = window.XXJ_DB;
  if (!D || !D.ready) {
    markBootSplashDataReady();
  } else {
    void Promise.resolve(D.ready)
      .then(() => {
        markBootSplashDataReady();
        applyBootShellPaint();
      })
      .catch(markBootSplashDataReady);
  }

  function hasOAuthReturnInUrl() {
    try {
      if (window.__xxjOAuthBootstrap) return true;
      if (document.documentElement.classList.contains("xxj-oauth-return")) return true;
      if (sessionStorage.getItem("xxj_oauth_code_v1")) return true;
      const q = new URLSearchParams(window.location.search);
      if (q.has("code") || q.has("error")) return true;
      const hashRaw = String(window.location.hash || "").replace(/^#/, "");
      return /(?:^|&)(code|access_token|error)=/.test(hashRaw);
    } catch {
      return false;
    }
  }

  window.__xxjHasOAuthReturnInUrl = hasOAuthReturnInUrl;

  async function ensureAuthChainEarlyForOAuth() {
    if (!hasOAuthReturnInUrl()) return;
    try {
      if (window.__xxjOAuthBootstrap) {
        try {
          await window.__xxjOAuthBootstrap;
        } catch (_) {
          /* auth.js 会再处理 */
        }
      }
      const D = window.XXJ_DB;
      if (D?.ready) await Promise.resolve(D.ready);
      await ensureSupabaseSdkLoaded();
      await loadScript(PRECHAIN[2]);
      if (window.__xxjAuthBootPromise) {
        await window.__xxjAuthBootPromise;
      }
    } catch (err) {
      console.warn("[xxj-load] oauth early auth failed", err);
    }
  }

  void Promise.resolve(D && D.ready)
    .then(async () => {
      if (hasOAuthReturnInUrl()) {
        await ensureAuthChainEarlyForOAuth();
      }
      allowMainBundle();
      if (isMobileIos()) {
        /* iOS：开屏期间后台预载 app.js，仍不预载 inbox；避免点「进入」瞬间与 KV 续载叠峰值 */
        setTimeout(() => preloadMainApp(), 320);
      } else {
        preloadMainApp();
      }
    })
    .catch(() => {});

  const ROUTES = {
    设置: "settings",
    设定: "settings",
    我的: "my",
    人设: "char",
    角色库: "char",
    聊天: "chat",
    消息: "chat",
    表情包: "sticker",
    表情: "sticker",
    贴纸: "sticker",
    世界书: "worldbook",
    主线: "roleplay",
    论坛: "forum",
    剧本库: "roleplayLibrary"
  };

  function stubToast(text) {
    const t = document.getElementById("toast");
    if (!t) return;
    t.textContent = text;
    t.classList.add("show");
    window.clearTimeout(stubToast.timer);
    stubToast.timer = window.setTimeout(() => t.classList.remove("show"), 1400);
  }

  let forumReadyPromise = null;

  async function ensureForumReady() {
    if (typeof openForumScreen === "function") return true;
    allowMainBundle();
    ensureMainScriptsScheduled();
    if (!forumReadyPromise) {
      forumReadyPromise = (async () => {
        try {
          if (window.__xxjMainLoadPromise) await window.__xxjMainLoadPromise;
          else await loadMainApp({ showUi: false });
          if (typeof openForumScreen !== "function") await loadScript(FORUM_MODULE);
          return typeof openForumScreen === "function";
        } catch (err) {
          console.warn("[xxj-load] forum module failed", err);
          forumReadyPromise = null;
          return false;
        }
      })();
    }
    return await forumReadyPromise;
  }

  async function openForumRoute() {
    document.getElementById("drawer")?.classList.remove("open");
    const ok = await ensureForumReady();
    if (ok && typeof openForumScreen === "function") openForumScreen();
    else stubToast("论坛加载失败，请稍后再试");
  }

  function runRoute(kind) {
    switch (kind) {
      case "settings":
        if (typeof openSettings === "function") openSettings();
        break;
      case "my":
        if (typeof openMyScreen === "function") openMyScreen();
        break;
      case "char":
        if (typeof openCharScreen === "function") openCharScreen();
        break;
      case "chat":
        if (typeof openChatListScreen === "function") openChatListScreen();
        break;
      case "sticker":
        if (typeof openStickerScreen === "function") openStickerScreen("manage");
        break;
      case "worldbook":
        if (typeof openWorldBookScreen === "function") openWorldBookScreen();
        break;
      case "roleplay":
        if (typeof openRoleplayScreen === "function") openRoleplayScreen();
        break;
      case "roleplayLibrary":
        if (typeof openRoleplayScriptLibrary === "function") openRoleplayScriptLibrary();
        break;
      case "forum":
        void openForumRoute();
        break;
      default:
        break;
    }
  }

  function queueRoute(kind) {
    allowMainBundle();
    window.__xxjPendingAppAction = () => runRoute(kind);
    ensureMainScriptsScheduled();
    if (window.__xxjAppInteractive && isMainAppHandlersReady()) {
      if (kind === "forum" && typeof openForumScreen !== "function") {
        void openForumRoute();
        return;
      }
      flushPendingAppAction();
      return;
    }
    void loadMainApp({ showUi: true });
  }

  window.setTimeout(() => {
    const root = document.getElementById("boot-splash");
    if (
      root?.isConnected &&
      !root.classList.contains("boot-splash--out") &&
      typeof window.__xxjBootSplashDismiss === "function"
    ) {
      window.__xxjBootSplashDismiss();
    }
  }, 120000);

  function isMainAppHandlersReady() {
    return (
      typeof openChatListScreen === "function" &&
      typeof openWorldBookScreen === "function" &&
      typeof openSettings === "function"
    );
  }

  document.body.addEventListener(
    "click",
    (e) => {
      const hit = e.target.closest(
        "#app-grid [data-app], .dock-stack footer.dock [data-app], #drawer .drawer-item, .dock-btn"
      );
      if (!hit) return;
      const name = String(hit.dataset.app || "").trim();
      const kind = ROUTES[name];
      if (window.__xxjAppInteractive && isMainAppHandlersReady()) {
        if (kind) {
          e.preventDefault();
          e.stopPropagation();
          runRoute(kind);
        }
        return;
      }
      if (kind) {
        e.preventDefault();
        e.stopPropagation();
        queueRoute(kind);
        return;
      }
      if (!window.__xxjMainLoadPromise) {
        e.preventDefault();
        e.stopPropagation();
        stubToast("稍候，正在打开…");
        allowMainBundle();
        ensureMainScriptsScheduled();
        void loadMainApp({ showUi: true });
      }
    },
    true
  );
})();
