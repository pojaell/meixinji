/**
 * CASE · 角色 routine 出厂预设集
 *
 * - 每个角色 id 都可在 window.XXJ_STATE_PRESETS[id] 取到一份默认 routine 配置;
 * - 用户在 IndexedDB 中写过自定义 byCharacter 后,以用户数据为准,本预设仅作空兜底。
 * - 新增角色不需要写代码,可以直接复用 `__default__`(通用节奏)。
 *
 * 设计原则:
 *  - 时段按角色气质(郎主/CEO/猫娘…)切分,有节律感而非整点机械;
 *  - `busy` 用于过滤主动行为 + 提示角色当前专注度;
 *  - `allowProactive` 三态(`true | false | "busy"`)表达"会被打扰/不会被打扰/忙碌降频"。
 *  - 节气/节日覆盖以 routine override 形式给出,匹配规则见 state-routine.js。
 */
(function () {
  if (!window.XXJ_STATE_PRESETS) window.XXJ_STATE_PRESETS = {};
  window.XXJ_STATE_PRESETS.__installed = true;

  // ============================================================
  // 玉山君·陈子奚(杭州回春堂郎主,古风医家)
  // ============================================================
  window.XXJ_STATE_PRESETS["chenzixi"] = {
    routineEnabled: true,
    schedule: [
      { startHour: 0,  endHour: 5,  location: "回春堂·后院卧房", activity: "沉睡",                    busy: "asleep",    moodShift: -0.05, allowProactive: false },
      { startHour: 5,  endHour: 7,  location: "后院",            activity: "晨起练拳、煎水洗漱",   busy: "exercise",  moodShift: +0.05, allowProactive: false },
      { startHour: 7,  endHour: 11, location: "回春堂·前院正厅", activity: "坐诊替乡邻开方",       busy: "treating",  moodShift: +0.05, allowProactive: "busy" },
      { startHour: 11, endHour: 13, location: "后院偏厅",         activity: "午饭,短暂午歇",         busy: "resting",   moodShift: 0,     allowProactive: false },
      { startHour: 13, endHour: 17, location: "前厅或出诊路上",    activity: "看诊 / 出诊",           busy: "treating",  moodShift: +0.05, allowProactive: "busy" },
      { startHour: 17, endHour: 19, location: "后院",            activity: "习武或沿河散步",       busy: "exercise",  moodShift: +0.05, allowProactive: true },
      { startHour: 19, endHour: 22, location: "书房",            activity: "灯下读医案、写信",     busy: "focused",   moodShift: 0,     allowProactive: true },
      { startHour: 22, endHour: 24, location: "回春堂·后院卧房", activity: "将睡未睡、扇子落膝",   busy: "asleep",    moodShift: -0.1,  allowProactive: false }
    ],
    overrides: [
      {
        name: "寒露·后院赏桂",
        matchRitual: "节气·寒露",
        replace: [
          { startHour: 7,  endHour: 10, location: "回春堂·后院桂树下", activity: "早起品茶赏桂",     busy: "leisure", moodShift: +0.10, allowProactive: true },
          { startHour: 13, endHour: 17, location: "前厅",            activity: "下午仍坐诊",         busy: "treating", moodShift: +0.05, allowProactive: "busy" }
        ]
      },
      {
        name: "清明·祭兄长",
        matchRitual: "节气·清明",
        replace: [
          { startHour: 8,  endHour: 12, location: "兄长坟前",        activity: "祭扫,焚香洒酒",     busy: "ritual",  moodShift: -0.15, allowProactive: false },
          { startHour: 13, endHour: 17, location: "回春堂·书房",     activity: "独坐写信",           busy: "focused", moodShift: -0.05, allowProactive: false }
        ]
      },
      {
        name: "端午·施药",
        matchFestival: "节日·端午",
        replace: [
          { startHour: 7,  endHour: 13, location: "回春堂·前院",     activity: "施药、挂艾草",       busy: "treating", moodShift: +0.05, allowProactive: "busy" }
        ]
      },
      {
        name: "重阳·登高",
        matchFestival: "节日·重阳",
        replace: [
          { startHour: 9,  endHour: 16, location: "吴山 / 南高峰",  activity: "登高望远、佩茱萸", busy: "leisure", moodShift: +0.10, allowProactive: true }
        ]
      },
      {
        name: "中秋·后院赏月",
        matchFestival: "节日·中秋",
        replace: [
          { startHour: 19, endHour: 23, location: "回春堂·后院",   activity: "设席赏月、备糕点", busy: "leisure", moodShift: +0.10, allowProactive: true }
        ]
      }
    ],
    meta: {
      source: "preset://chenzixi",
      schemaVersion: 1,
      label: "玉山君·陈子奚(杭州回春堂)"
    }
  };

  // ============================================================
  // 通用 fallback(任何未预设的角色沿用此节奏,可在 UI 上改)
  // ============================================================
  window.XXJ_STATE_PRESETS["__default__"] = {
    routineEnabled: true,
    schedule: [
      { startHour: 0,  endHour: 7,  location: "卧房",   activity: "沉睡 / 起床梳洗", busy: "asleep",   moodShift: -0.05, allowProactive: false },
      { startHour: 7,  endHour: 12, location: "工作区", activity: "上午忙碌",       busy: "treating", moodShift: +0.05, allowProactive: "busy" },
      { startHour: 12, endHour: 14, location: "用餐区", activity: "午餐 + 午歇",     busy: "resting",  moodShift: 0,     allowProactive: false },
      { startHour: 14, endHour: 18, location: "工作区", activity: "下午忙碌",       busy: "treating", moodShift: +0.05, allowProactive: "busy" },
      { startHour: 18, endHour: 22, location: "休闲区", activity: "散步、阅读",     busy: "leisure",  moodShift: +0.05, allowProactive: true },
      { startHour: 22, endHour: 24, location: "卧房",   activity: "将睡未睡",       busy: "asleep",   moodShift: -0.1,  allowProactive: false }
    ],
    overrides: [],
    meta: {
      source: "preset://__default__",
      schemaVersion: 1,
      label: "通用日常"
    }
  };
})();
