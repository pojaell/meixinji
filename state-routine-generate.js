/**
 * CASE · 自动作息生成器
 *
 * 给定角色 persona(CHAR_PERSONA_STORE.items[i]),调用 LLM 推断这个角色
 * 一天 24 小时的作息安排,返回 schedule JSON 数组。
 *
 * 输出形态与 state-routine.js 的 preset.schedule 一致,便于:
 *   - 直接 routine.setSchedule(genResult.schedule) + routine.save()
 *   - 或者填回 persona 自定义字段
 *
 * 设计要点:
 *   - 不修改 routine 内部,只输出 JSON
 *   - LLM 输出严格 JSON(无 markdown 包裹)
 *   - 校验:时段连续、至少 1 段 asleep、至少 1 段 allowProactive:true
 *   - 失败/格式错误 → 返回 null(调用方按"保持原 schedule"处理)
 */
(function () {
  if (window.XXJ_ROUTINE_GEN && window.XXJ_ROUTINE_GEN.__installed) return;

  const VALID_BUSY = new Set(["asleep", "exercise", "treating", "resting", "focused", "leisure", "ritual"]);

  /** 把 persona 字段拼成 LLM 能看懂的描述文本(不泄露敏感信息) */
  function personaToDescription(p) {
    if (!p || typeof p !== "object") return "(空人设)";
    const lines = [];
    const name = String(p.displayName || "").trim();
    if (name) lines.push("【角色名】" + name);
    const alias = String(p.aliases || "").trim();
    if (alias) lines.push("【别名】" + alias);
    const tags = String(p.tags || "").trim();
    if (tags) lines.push("【标签】" + tags);
    const summary = String(p.summary || "").trim();
    if (summary) lines.push("【简介】" + summary.slice(0, 800));
    const voice = String(p.voice || "").trim();
    if (voice) lines.push("【说话风格】" + voice.slice(0, 400));
    const relations = String(p.npcRelations || "").trim();
    if (relations) lines.push("【角色关系】" + relations.slice(0, 400));
    const dialogueLang = String(p.dialogueLang || "").trim();
    if (dialogueLang) lines.push("【常用语言】" + dialogueLang);
    return lines.length ? lines.join("\n") : "(空人设)";
  }

  /** 构造 prompt。persona + 可选 preset hint(已有 preset 时让 LLM 参考风格) */
  function buildPrompt(persona, opts) {
    const desc = personaToDescription(persona);
    const presetHint = (opts && opts.presetHint && typeof opts.presetHint === "object") ? opts.presetHint : null;
    let hintBlock = "";
    if (presetHint) {
      hintBlock = "\n\n【风格参考(可改,不必照抄)】\n";
      if (presetHint.label) hintBlock += "标签: " + presetHint.label + "\n";
      if (Array.isArray(presetHint.schedule) && presetHint.schedule.length) {
        hintBlock += "时段示例:\n";
        for (const s of presetHint.schedule.slice(0, 6)) {
          hintBlock += `  ${s.startHour}-${s.endHour}时 ${s.location || ""} / ${s.activity || ""}\n`;
        }
      }
    }
    return [
      "你是「日常作息分析师」。根据下面给出的人设,推断这个角色一天 24 小时的作息安排。",
      "",
      desc,
      hintBlock,
      "",
      "【输出要求】",
      "1. 严格 JSON 数组(不要 Markdown 包裹、不要任何额外解释)",
      "2. 8~12 段;时段连续覆盖 0~24(最后一段 endHour 必须 = 24)",
      "3. 每段字段:",
      "   - startHour: 0~23 整数",
      "   - endHour: 1~24 整数(必须 > startHour)",
      "   - location: 简短地点(2~12 字)",
      "   - activity: 简短活动描述(2~20 字)",
      "   - busy ∈ {asleep, exercise, treating, resting, focused, leisure, ritual}",
      "   - moodShift: -0.20 ~ +0.20 数字",
      "   - allowProactive: true / false / \"busy\"",
      "4. 至少 1 段 busy:\"asleep\"(睡觉)",
      "5. 至少 1 段 allowProactive:true(可主动找你搭话)",
      "6. location / activity 严格匹配角色世界观(古风/现代/仙侠/校园 …)",
      "",
      "只输出 JSON,不要任何其它文字。"
    ].join("\n");
  }

  /** 从 LLM 响应里抠出 JSON 数组(允许包在 markdown code block / 杂谈前后缀里) */
  function extractJson(text) {
    if (!text) return null;
    let s = String(text).trim();
    // 去掉 markdown 包裹
    const fence = s.match(/```(?:json)?\s*([\s\S]+?)\s*```/i);
    if (fence) s = fence[1].trim();
    // 找到第一个 [ 和最后一个 ] 之间的部分
    const lb = s.indexOf("[");
    const rb = s.lastIndexOf("]");
    if (lb < 0 || rb < 0 || rb <= lb) return null;
    return s.slice(lb, rb + 1);
  }

  /** 容错解析:LLM 写的 json 偶尔会有尾随逗号、单引号之类,清掉再 parse */
  function tryParseJsonLoose(text) {
    if (!text) return null;
    let s = String(text).trim();
    // 先尝试严格 parse
    try { return JSON.parse(s); } catch (_) { /* fallthrough */ }
    // 清掉 ,] 或 ,} 的尾随逗号
    s = s.replace(/,\s*([}\]])/g, "$1");
    // 单引号 -> 双引号(只在非转义引号场景下),简单覆盖大多数 LLM 失误
    if (!s.includes('"') && s.includes("'")) {
      s = s.replace(/'/g, '"');
    }
    try { return JSON.parse(s); } catch (_) { /* fallthrough */ }
    return null;
  }

  /** 校验 + 规范化 schedule */
  function normalizeSchedule(raw, opts) {
    if (!Array.isArray(raw)) return null;
    const out = [];
    for (const it of raw) {
      if (!it || typeof it !== "object") continue;
      const startHour = Math.max(0, Math.min(23, Math.floor(Number(it.startHour) || 0)));
      const endHourRaw = Math.floor(Number(it.endHour) || 0);
      const endHour = Math.max(startHour + 1, Math.min(24, endHourRaw || (startHour + 1)));
      const location = String(it.location || "").trim().slice(0, 30);
      const activity = String(it.activity || "").trim().slice(0, 60);
      const busy = VALID_BUSY.has(String(it.busy || "").trim()) ? String(it.busy).trim() : "leisure";
      const moodShift = Math.max(-0.2, Math.min(0.2, Number(it.moodShift) || 0));
      let allowProactive = false;
      if (it.allowProactive === true) allowProactive = true;
      else if (it.allowProactive === "busy") allowProactive = "busy";
      out.push({ startHour, endHour, location, activity, busy, moodShift, allowProactive });
    }
    if (!out.length) return null;

    // 时段连续覆盖检查:如果不是从 0 开始,补一段
    if (out[0].startHour > 0) {
      out.unshift({ startHour: 0, endHour: out[0].startHour, location: "未定", activity: "未排", busy: "leisure", moodShift: 0, allowProactive: false });
    }
    // 中间缝隙填补
    for (let i = 1; i < out.length; i++) {
      if (out[i].startHour > out[i - 1].endHour) {
        out.splice(i, 0, {
          startHour: out[i - 1].endHour, endHour: out[i].startHour,
          location: "未定", activity: "未排", busy: "leisure", moodShift: 0, allowProactive: false
        });
        i++;
      } else if (out[i].startHour < out[i - 1].endHour) {
        // 重叠:把上一段的 endHour 截短
        out[i - 1].endHour = out[i].startHour;
      }
    }
    // 最后一段必须到 24
    const last = out[out.length - 1];
    if (last.endHour < 24) {
      if (last.endHour < last.startHour + 1) last.endHour = last.startHour + 1;
      if (last.endHour < 24) {
        out.push({ startHour: last.endHour, endHour: 24, location: "未定", activity: "未排", busy: "leisure", moodShift: 0, allowProactive: false });
      } else {
        last.endHour = 24;
      }
    }

    // 至少 1 段 asleep
    if (!out.some(s => s.busy === "asleep")) {
      // 把夜间段强行标 asleep (22~7)
      const asleepSlot = out.find(s => (s.startHour >= 22 || s.startHour < 7));
      if (asleepSlot) asleepSlot.busy = "asleep";
      else out[0].busy = "asleep";
    }
    // 至少 1 段 allowProactive: true
    if (!out.some(s => s.allowProactive === true)) {
      out[Math.floor(out.length / 2)].allowProactive = true;
    }

    return out;
  }

  /**
   * 主入口。给定 persona,调 LLM 生成 schedule。
   * @param {object} persona CHAR_PERSONA_STORE.items[i] 这一项
   * @param {object} opts
   *   - presetHint: optional {label, schedule} — 已有 preset 时参考风格
   *   - completionConfig: 透传给 RP_AI.chatCompletions 的 config
   * @returns {Promise<{schedule: object[], meta: object} | null>}
   */

  /**
   * 构造 chatCompletions 的 completionConfig。
   *  - 调用方显式传了 -> 用调用方的(尊重 override)
   *  - 调用方没传 -> 用 RP_AI.getConfig() 拿全量(baseUrl/apiKey/model/temperature),
   *    然后只覆盖 routine-gen 自己需要的字段(max_tokens/temperature)
   *  - 都没有 -> 退到 { tag: "routine-gen" } 让 chatCompletions 自己 fallback
   */
  function buildCompletionConfig(opts) {
    if (opts && opts.completionConfig && typeof opts.completionConfig === "object") {
      return opts.completionConfig;
    }
    try {
      const RP_AI = window.RP_AI;
      const base = RP_AI && typeof RP_AI.getConfig === "function" ? RP_AI.getConfig() : null;
      if (base && base.apiKey) {
        return {
          baseUrl: base.baseUrl,
          apiKey: base.apiKey,
          model: base.model,
          temperature: 0.6,
          tag: "routine-gen"
        };
      }
    } catch { /* ignore */ }
    return { tag: "routine-gen" };
  }

  async function generateFromPersona(persona, opts) {
    if (!persona || typeof persona !== "object") return null;
    const RP_AI = window.RP_AI;
    if (!RP_AI || typeof RP_AI.chatCompletions !== "function") {
      console.warn("[ROUTINE_GEN] RP_AI.chatCompletions 不可用");
      return null;
    }
    const prompt = buildPrompt(persona, opts || {});
    let data;
    try {
      data = await RP_AI.chatCompletions(
        {
          messages: [
            { role: "system", content: "你是日常作息分析师。严格输出 JSON 数组,不要 Markdown、不要解释。完整输出所有时段(8-12 段)。" },
            { role: "user", content: prompt }
          ],
          max_tokens: 2500,
          temperature: 0.6
        },
        {
          completionConfig: buildCompletionConfig(opts)
        }
      );
    } catch (e) {
      console.warn("[ROUTINE_GEN] LLM call failed:", e);
      return { ok: false, reason: "llm-call-failed", error: String(e && e.message || e) };
    }

    // 提取文本
    let rawText = "";
    try {
      const ch0 = data && data.choices && data.choices[0];
      if (ch0 && typeof ch0.text === "string") rawText = ch0.text;
      else if (ch0 && ch0.message && typeof ch0.message.content === "string") rawText = ch0.message.content;
      else if (typeof data?.output_text === "string") rawText = data.output_text;
      else if (typeof data?.text === "string") rawText = data.text;
    } catch { /* ignore */ }
    rawText = String(rawText || "").trim();
    if (!rawText) return { ok: false, reason: "empty-response", raw: "" };

    const jsonText = extractJson(rawText);
    if (!jsonText) {
      console.warn("[ROUTINE_GEN] 找不到 JSON:", rawText.slice(0, 200));
      return { ok: false, reason: "no-json-array", raw: rawText.slice(0, 240) };
    }
    let parsed = tryParseJsonLoose(jsonText);
    if (!parsed) {
      // 退一步:如果整段能 parse,可能是 array 嵌套在 object 里 — 找它里面的数组
      const objTry = tryParseJsonLoose(rawText);
      if (Array.isArray(objTry)) {
        parsed = objTry;
      } else if (objTry && typeof objTry === "object") {
        // 取第一个数组字段
        for (const k of Object.keys(objTry)) {
          if (Array.isArray(objTry[k])) { parsed = objTry[k]; break; }
        }
      }
    }
    if (!parsed) {
      console.warn("[ROUTINE_GEN] JSON parse failed:", jsonText.slice(0, 200));
      return { ok: false, reason: "json-parse-failed", raw: jsonText.slice(0, 240) };
    }
    const schedule = normalizeSchedule(parsed);
    if (!schedule) return { ok: false, reason: "normalize-empty", raw: jsonText.slice(0, 240) };

    return {
      ok: true,
      schedule,
      overrides: [],
      meta: {
        source: "llm-generated",
        generatedAt: Date.now(),
        personaSig: String(persona.id || "").slice(0, 8),
        model: (opts && opts.completionConfig && opts.completionConfig.tag) || "routine-gen"
      }
    };
  }

  /**
   * 把生成结果应用到 routine。
   * 行为:
   *   1. routine.setSchedule(result.schedule)
   *   2. routine.setOverrides([])
   *   3. await routine.save()
   *   4. 返回是否成功
   */
  async function applyToRoutine(routine, genResult) {
    if (!routine || !genResult) return false;
    try {
      if (Array.isArray(genResult.schedule)) routine.setSchedule(genResult.schedule);
      if (Array.isArray(genResult.overrides)) routine.setOverrides(genResult.overrides);
      if (typeof routine.save === "function") {
        await routine.save();
      }
      return true;
    } catch (e) {
      console.warn("[ROUTINE_GEN] applyToRoutine failed:", e);
      return false;
    }
  }

  window.XXJ_ROUTINE_GEN = {
    __installed: true,
    generateFromPersona,
    applyToRoutine,
    buildPrompt,
    normalizeSchedule,
    personaToDescription
  };
})();