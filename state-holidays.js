/**
 * CASE · 节气 / 节日 → ritual modifier
 * 不依赖 XXJ_HOLIDAYS;独立提供"今日是否有特殊 ritual"。
 * 二十四节气近似日期范围(±1 天内浮动即可,日常不需要精确到小时)。
 *
 * 设计取舍:
 *  - 节气日用"MM-DD 区间"近似;支持任意年份查询。
 *  - 农历节日(春节、端午、中秋、重阳、腊八等)需要农历支持;
 *    此处只列接口形状,不内置精确计算;具体年农历数据可由用户在 db 中
 *    写入 lunarFestivals 字段(STATE_HOLIDAYS_LUNAR_KV)覆盖默认空白表。
 *  - 与 XXJ_HOLIDAYS(法定假日)不冲突:
 *      · XXJ_HOLIDAYS 负责:法定假日、调休、节日名英文;
 *      · XXJ_STATE_HOLIDAYS 负责:节气与民俗节气覆盖(routine override 触发)。
 */
(function () {
  if (window.XXJ_STATE_HOLIDAYS && window.XXJ_STATE_HOLIDAYS.__installed) return;

  /** 二十四节气近似日期(任意年份命中即算) */
  const SOLAR_TERMS = [
    { name: "立春", from: "02-03", to: "02-05" },
    { name: "雨水", from: "02-18", to: "02-20" },
    { name: "惊蛰", from: "03-05", to: "03-07" },
    { name: "春分", from: "03-20", to: "03-22" },
    { name: "清明", from: "04-04", to: "04-06" },
    { name: "谷雨", from: "04-19", to: "04-21" },
    { name: "立夏", from: "05-05", to: "05-07" },
    { name: "小满", from: "05-20", to: "05-22" },
    { name: "芒种", from: "06-05", to: "06-07" },
    { name: "夏至", from: "06-21", to: "06-22" },
    { name: "小暑", from: "07-06", to: "07-08" },
    { name: "大暑", from: "07-22", to: "07-24" },
    { name: "立秋", from: "08-07", to: "08-09" },
    { name: "处暑", from: "08-22", to: "08-24" },
    { name: "白露", from: "09-07", to: "09-09" },
    { name: "秋分", from: "09-22", to: "09-24" },
    { name: "寒露", from: "10-08", to: "10-09" },
    { name: "霜降", from: "10-23", to: "10-24" },
    { name: "立冬", from: "11-07", to: "11-08" },
    { name: "小雪", from: "11-22", to: "11-23" },
    { name: "大雪", from: "12-06", to: "12-08" },
    { name: "冬至", from: "12-21", to: "12-23" },
    { name: "小寒", from: "01-05", to: "01-07" },
    { name: "大寒", from: "01-20", to: "01-21" }
  ];

  /** 公历固定节日(可被 routine.matchFestival 命中) */
  const FIXED_FESTIVALS = [
    { name: "元旦",      from: "01-01", to: "01-01", kind: "festival" },
    { name: "妇女节",    from: "03-08", to: "03-08", kind: "festival" },
    { name: "植树节",    from: "03-12", to: "03-12", kind: "festival" },
    { name: "劳动节",    from: "05-01", to: "05-01", kind: "festival" },
    { name: "青年节",    from: "05-04", to: "05-04", kind: "festival" },
    { name: "儿童节",    from: "06-01", to: "06-01", kind: "festival" },
    { name: "建党节",    from: "07-01", to: "07-01", kind: "festival" },
    { name: "建军节",    from: "08-01", to: "08-01", kind: "festival" },
    { name: "教师节",    from: "09-10", to: "09-10", kind: "festival" },
    { name: "国庆节",    from: "10-01", to: "10-01", kind: "festival" },
    { name: "情人节",    from: "02-14", to: "02-14", kind: "festival" },
    { name: "圣诞节",    from: "12-25", to: "12-25", kind: "festival" }
  ];

  /** 农历节日描述(仅声明,不内置计算;数据由用户在 db 里覆盖) */
  const LUNAR_FESTIVAL_HOOKS = [
    { name: "春节",  lunar: "正月初一" },
    { name: "元宵",  lunar: "正月十五" },
    { name: "端午",  lunar: "五月初五" },
    { name: "七夕",  lunar: "七月初七" },
    { name: "中元",  lunar: "七月十五" },
    { name: "中秋",  lunar: "八月十五" },
    { name: "重阳",  lunar: "九月初九" },
    { name: "腊八",  lunar: "腊月初八" },
    { name: "小年",  lunar: "腊月二十三" }
  ];

  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function mmddOf(date) { return pad(date.getMonth() + 1) + "-" + pad(date.getDate()); }
  function within(mmdd, from, to) {
    if (from === to) return mmdd === from;
    return mmdd >= from && mmdd <= to;
  }

  /** 当日是否有节气(公历) */
  function getSolarRitual(date) {
    if (!(date instanceof Date)) date = new Date();
    const md = mmddOf(date);
    for (const t of SOLAR_TERMS) {
      if (within(md, t.from, t.to)) {
        return {
          kind: "节气·" + t.name,
          source: "solar",
          raw: t.name,
          at: date.getTime()
        };
      }
    }
    return null;
  }

  /** 当日公历固定节日 */
  function getFixedFestivals(date) {
    if (!(date instanceof Date)) date = new Date();
    const md = mmddOf(date);
    const hits = FIXED_FESTIVALS.filter(f => within(md, f.from, f.to));
    return hits.map(h => ({
      kind: "节日·" + h.name,
      source: "fixed",
      raw: h.name,
      at: date.getTime()
    }));
  }

  /**
   * 农历节日(可选,需要用户在 IndexedDB 配置 KEY.STATE_LUNAR_FESTIVALS):
   *   { v: 1, byYear: { "2026": { "正月初一": "2026-02-17", ... } } }
   * - 若未配置,返回 []。
   */
  function getLunarFestivals(date) {
    if (!(date instanceof Date)) date = new Date();
    const KEY = (window.XXJ_DB && window.XXJ_DB.K && window.XXJ_DB.K.STATE_LUNAR_FESTIVALS)
      || "rp_state_lunar_festivals_v1";
    const bundle = (window.XXJ_DB && window.XXJ_DB.getKv)
      ? window.XXJ_DB.getKv(KEY)
      : null;
    if (!bundle || !bundle.byYear) return [];
    const y = String(date.getFullYear());
    const yearMap = bundle.byYear[y];
    if (!yearMap) return [];
    const mmdd = mmddOf(date);
    const out = [];
    for (const hook of LUNAR_FESTIVAL_HOOKS) {
      const ymd = yearMap[hook.lunar];
      if (!ymd) continue;
      const [_, m, d] = ymd.split("-");
      const cur = pad(+m) + "-" + pad(+d);
      if (cur === mmdd) {
        out.push({
          kind: "节日·" + hook.name,
          source: "lunar",
          raw: hook.name,
          at: date.getTime()
        });
      }
    }
    return out;
  }

  /**
   * 主体接口:返回当日所有 ritual 命中(节气最多 1 个,节日若干)
   */
  function getRitualForDate(date) {
    if (!(date instanceof Date)) date = new Date();
    const out = [];
    const sr = getSolarRitual(date);
    if (sr) out.push(sr);
    out.push(...getFixedFestivals(date));
    out.push(...getLunarFestivals(date));
    return out;
  }

  /**
   * 仅为节气(已弃用别名,向下兼容)
   */
  function getRitual(date) {
    const sr = getSolarRitual(date);
    return sr ? [sr] : [];
  }

  window.XXJ_STATE_HOLIDAYS = {
    SOLAR_TERMS,
    FIXED_FESTIVALS,
    LUNAR_FESTIVAL_HOOKS,
    getRitualForDate,
    getSolarRitual,
    getFixedFestivals,
    getLunarFestivals,
    getRitual,
    __installed: true
  };
})();
