/**
 * 大模型 / AI 接口（OpenAI 兼容）。
 * 配置与档案持久化走 IndexedDB（XXJ_DB）的 ai_profiles 表。
 */
(function () {
  const K = () => window.XXJ_DB?.K || {};
  const DEFAULT_BASE = "https://api.openai.com/v1";
  const DEFAULT_MODEL = "gpt-4o-mini";
  const DEFAULT_TEMPERATURE = 0.85;

  const KNOWN_API_BASE_SUFFIXES = [
    "/v1/images/generations",
    "/v1/chat/completions",
    "/v1/completions",
    "/v1/embeddings",
    "/v1/models",
    "/v4/images/generations",
    "/v4/chat/completions",
    "/v4/completions",
    "/v4/embeddings",
    "/v4/models",
    "/chat/completions",
    "/completions",
    "/embeddings",
    "/models",
    "/v1",
    "/v4"
  ];

  const MODEL_LIST_FETCH_TIMEOUT_MS = 30000;
  const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models";
  const ANTHROPIC_API_VERSION = "2023-06-01";
  const STREAM_CAP_KV = "rp_ai_stream_capability_v1";

  function normalizeTemperature(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_TEMPERATURE;
    return Math.min(2, Math.max(0, Math.round(n * 100) / 100));
  }

  function stripApiBaseSuffix(url) {
    let u = String(url || "").trim().replace(/\/+$/, "");
    if (!u) return "";
    for (const suffix of KNOWN_API_BASE_SUFFIXES) {
      if (u.length >= suffix.length && u.slice(-suffix.length).toLowerCase() === suffix.toLowerCase()) {
        u = u.slice(0, -suffix.length).replace(/\/+$/, "");
        break;
      }
    }
    return u;
  }

  /** 智谱等走 /v4，其余默认 /v1 */
  function getApiVersionSegment(root) {
    return /open\.bigmodel\.cn/i.test(root) ? "/v4" : "/v1";
  }

  function isAnthropicApiRoot(root) {
    return /anthropic\.com/i.test(String(root || ""));
  }

  /**
   * 还原为 OpenAI 兼容根地址（以 /v1 或 /v4 结尾），供 chat/completions 与 GET /models 共用。
   * @param {string} [url]
   */
  function resolveOpenAiV1Base(url) {
    const root = stripApiBaseSuffix(url);
    if (!root) return DEFAULT_BASE;
    const ver = getApiVersionSegment(root);
    if (new RegExp(`${ver}$`, "i").test(root)) return root;
    if (/\/v[14]$/i.test(root)) return root;
    return `${root}${ver}`;
  }

  /** 依次尝试的 models 列表地址（主路径 + 常见备用路径） */
  function getModelListFetchUrls(rawBaseUrl) {
    const trimmed = String(rawBaseUrl || "").trim() || DEFAULT_BASE;
    const root = stripApiBaseSuffix(trimmed);

    if (isAnthropicApiRoot(root)) {
      return [ANTHROPIC_MODELS_URL];
    }

    const versionBase = resolveOpenAiV1Base(trimmed);
    /** @type {string[]} */
    const urls = [`${versionBase}/models`, `${root}/models`, `${root}/v1/models`];
    if (/\/v1$/i.test(versionBase)) {
      urls.push(`${versionBase.slice(0, -3)}/models`);
    }
    return [...new Set(urls.filter(Boolean))];
  }

  function getModelListHeaders(url, apiKey) {
    if (isAnthropicApiRoot(url)) {
      return {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_API_VERSION
      };
    }
    return { Authorization: `Bearer ${apiKey}` };
  }

  function normalizeBase(url) {
    return resolveOpenAiV1Base(url);
  }

  /** @param {{ baseUrl?: string, model?: string }} [cfg] */
  function normalizeStreamCapCfg(cfg) {
    return {
      baseUrl: normalizeBase(cfg?.baseUrl || DEFAULT_BASE),
      model: (String(cfg?.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL)
    };
  }

  /** @param {{ baseUrl?: string, model?: string }} [cfg] */
  function streamCapCacheKey(cfg) {
    const n = normalizeStreamCapCfg(cfg);
    return `${n.baseUrl}\t${n.model}`;
  }

  /** @returns {Record<string, { status: "ok"|"bad", at: number }>} */
  function readStreamCapStore() {
    const db = window.XXJ_DB;
    if (!db) return {};
    const raw = db.getKv(STREAM_CAP_KV);
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      return /** @type {Record<string, { status: "ok"|"bad", at: number }>} */ (raw);
    }
    return {};
  }

  /** @param {Record<string, { status: "ok"|"bad", at: number }>} store */
  function writeStreamCapStore(store) {
    const db = window.XXJ_DB;
    if (!db) return;
    db.setKv(STREAM_CAP_KV, store && typeof store === "object" ? store : {});
  }

  /** @param {{ baseUrl?: string, model?: string }} [cfg] @returns {"unknown"|"ok"|"bad"} */
  function getStreamCapability(cfg) {
    const ent = readStreamCapStore()[streamCapCacheKey(cfg)];
    if (!ent || typeof ent !== "object") return "unknown";
    if (ent.status === "ok" || ent.status === "bad") return ent.status;
    return "unknown";
  }

  /** @param {{ baseUrl?: string, model?: string }} [cfg] @param {"ok"|"bad"} status */
  function setStreamCapability(cfg, status) {
    if (status !== "ok" && status !== "bad") return;
    const key = streamCapCacheKey(cfg);
    const store = readStreamCapStore();
    store[key] = { status, at: Date.now() };
    writeStreamCapStore(store);
  }

  /** @param {{ baseUrl?: string, model?: string }} [cfg] */
  function clearStreamCapabilityForConfig(cfg) {
    const key = streamCapCacheKey(cfg);
    const store = readStreamCapStore();
    if (!store[key]) return;
    delete store[key];
    writeStreamCapStore(store);
  }

  function clearAllStreamCapability() {
    writeStreamCapStore({});
  }

  /** @param {unknown} data */
  function completionJsonToStreamResult(data) {
    const root = data && typeof data === "object" ? /** @type {Record<string, unknown>} */ (data) : {};
    const ch0 =
      Array.isArray(root.choices) && root.choices[0] && typeof root.choices[0] === "object"
        ? /** @type {Record<string, unknown>} */ (root.choices[0])
        : null;
    /** @type {object | null} */
    let usage = root.usage && typeof root.usage === "object" ? /** @type {object} */ (root.usage) : null;
    if (!ch0) return { content: "", usage, finishReason: "" };
    let content = "";
    const msg = ch0.message && typeof ch0.message === "object" ? ch0.message : null;
    if (msg && typeof msg === "object") {
      const c = /** @type {Record<string, unknown>} */ (msg).content;
      if (typeof c === "string") content = c;
      else if (Array.isArray(c)) {
        const bits = [];
        for (const part of c) {
          if (!part || typeof part !== "object") continue;
          const p = /** @type {Record<string, unknown>} */ (part);
          const typ = String(p.type || "").toLowerCase();
          if (
            typ === "reasoning" ||
            typ === "thinking" ||
            typ === "reasoning_content" ||
            typ === "chain_of_thought" ||
            typ === "thought"
          ) {
            continue;
          }
          if (typ && typ !== "text" && typ !== "output_text") continue;
          if (typeof p.text === "string") bits.push(p.text);
          else if (typeof p.content === "string") bits.push(p.content);
        }
        content = bits.join("");
      }
    } else if (typeof ch0.text === "string") {
      content = ch0.text;
    }
    const finishReason = String(ch0.finish_reason || "stop").trim() || "stop";
    return { content: String(content || ""), usage, finishReason };
  }

  function getConfig() {
    const kv = K();
    const db = window.XXJ_DB;
    if (!db) {
      return {
        baseUrl: DEFAULT_BASE,
        apiKey: "",
        model: DEFAULT_MODEL,
        temperature: DEFAULT_TEMPERATURE
      };
    }
    return {
      baseUrl: normalizeBase(db.getKv(kv.AI_BASE) || DEFAULT_BASE),
      apiKey: String(db.getKv(kv.AI_KEY) || ""),
      model: (String(db.getKv(kv.AI_MODEL) || DEFAULT_MODEL).trim() || DEFAULT_MODEL),
      temperature: normalizeTemperature(db.getKv(kv.AI_TEMPERATURE))
    };
  }

  /**
   * @param {{ baseUrl?: string, apiKey?: string, model?: string, temperature?: number }} patch
   */
  function saveConfig(patch) {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return;
    if (patch.baseUrl != null || patch.model != null) {
      const prev = getConfig();
      const nextBase = patch.baseUrl != null ? normalizeBase(patch.baseUrl) : prev.baseUrl;
      const nextModel =
        patch.model != null
          ? String(patch.model).trim() || DEFAULT_MODEL
          : prev.model;
      if (prev.baseUrl !== nextBase || prev.model !== nextModel) {
        clearStreamCapabilityForConfig(prev);
      }
    }
    if (patch.baseUrl != null) db.setKv(kv.AI_BASE, normalizeBase(patch.baseUrl));
    if (patch.apiKey != null) {
      if (patch.apiKey === "") db.delKv(kv.AI_KEY);
      else db.setKv(kv.AI_KEY, String(patch.apiKey));
    }
    if (patch.model != null) {
      const m = String(patch.model).trim() || DEFAULT_MODEL;
      db.setKv(kv.AI_MODEL, m);
    }
    if (patch.temperature != null) {
      db.setKv(kv.AI_TEMPERATURE, normalizeTemperature(patch.temperature));
    }
  }

  function readProfiles() {
    return window.XXJ_DB ? window.XXJ_DB.profilesList() : [];
  }

  function getActiveProfileId() {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return "";
    return String(db.getKv(kv.AI_ACTIVE_PROFILE) || "");
  }

  function setActiveProfileId(id) {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return;
    if (id) db.setKv(kv.AI_ACTIVE_PROFILE, String(id));
    else db.delKv(kv.AI_ACTIVE_PROFILE);
  }

  function getMemoSummaryProfileId() {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return "";
    return String(db.getKv(kv.AI_MEMO_SUMMARY_PROFILE) || "").trim();
  }

  function setMemoSummaryProfileId(id) {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return;
    const s = String(id || "").trim();
    if (s) db.setKv(kv.AI_MEMO_SUMMARY_PROFILE, s);
    else db.delKv(kv.AI_MEMO_SUMMARY_PROFILE);
  }

  /** 未选专用档案时与主聊天 API 相同；否则用所选档案的 base / key / model / temperature */
  function getMemoSummaryCompletionConfig() {
    const memoId = getMemoSummaryProfileId();
    if (!memoId) return getConfig();
    const p = readProfiles().find((x) => x && x.id === memoId);
    if (!p) return getConfig();
    const t =
      p.temperature != null && Number.isFinite(Number(p.temperature))
        ? normalizeTemperature(p.temperature)
        : DEFAULT_TEMPERATURE;
    return {
      baseUrl: normalizeBase(p.baseUrl || DEFAULT_BASE),
      apiKey: String(p.apiKey || "").trim(),
      model: (String(p.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL),
      temperature: t
    };
  }

  function getTheaterProfileId() {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return "";
    return String(db.getKv(kv.AI_THEATER_PROFILE) || "").trim();
  }

  function setTheaterProfileId(id) {
    const db = window.XXJ_DB;
    const kv = K();
    if (!db) return;
    const s = String(id || "").trim();
    if (s) db.setKv(kv.AI_THEATER_PROFILE, s);
    else db.delKv(kv.AI_THEATER_PROFILE);
  }

  /** 未选专用档案时与主聊天 API 相同；否则用所选档案的 base / key / model / temperature */
  function getTheaterCompletionConfig() {
    const theaterId = getTheaterProfileId();
    if (!theaterId) return getConfig();
    const p = readProfiles().find((x) => x && x.id === theaterId);
    if (!p) return getConfig();
    const t =
      p.temperature != null && Number.isFinite(Number(p.temperature))
        ? normalizeTemperature(p.temperature)
        : DEFAULT_TEMPERATURE;
    return {
      baseUrl: normalizeBase(p.baseUrl || DEFAULT_BASE),
      apiKey: String(p.apiKey || "").trim(),
      model: (String(p.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL),
      temperature: t
    };
  }

  function upsertProfile(spec) {
    const db = window.XXJ_DB;
    if (!db) return "";
    const name = String(spec.name || "").trim() || "未命名配置";
    const baseUrl = normalizeBase(spec.baseUrl || DEFAULT_BASE);
    const model = String(spec.model || "").trim() || DEFAULT_MODEL;
    const key = spec.apiKey != null ? String(spec.apiKey) : undefined;

    if (spec.id) {
      const list = db.profilesList();
      const prev = list.find((p) => p.id === spec.id);
      if (prev) {
        const prevCap = normalizeStreamCapCfg({ baseUrl: prev.baseUrl, model: prev.model });
        const nextCap = normalizeStreamCapCfg({ baseUrl, model });
        if (prevCap.baseUrl !== nextCap.baseUrl || prevCap.model !== nextCap.model) {
          clearStreamCapabilityForConfig(prevCap);
        }
        const nextName =
          spec.name != null && String(spec.name).trim()
            ? String(spec.name).trim()
            : prev.name || "未命名配置";
        const patch = {
          id: spec.id,
          name: nextName,
          baseUrl,
          model,
          apiKey: key !== undefined ? key : prev.apiKey
        };
        if (spec.temperature != null && Number.isFinite(Number(spec.temperature))) {
          patch.temperature = normalizeTemperature(spec.temperature);
        } else if (prev.temperature != null && Number.isFinite(Number(prev.temperature))) {
          patch.temperature = prev.temperature;
        }
        db.profileUpsert(patch);
        return spec.id;
      }
    }
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p_${Date.now()}`;
    const createPatch = {
      id,
      name,
      baseUrl,
      model,
      apiKey: key !== undefined ? key : ""
    };
    if (spec.temperature != null && Number.isFinite(Number(spec.temperature))) {
      createPatch.temperature = normalizeTemperature(spec.temperature);
    }
    db.profileUpsert(createPatch);
    return id;
  }

  function deleteProfile(id) {
    const db = window.XXJ_DB;
    if (!db) return;
    db.profileDelete(id);
    if (getActiveProfileId() === id) setActiveProfileId("");
  }

  function applyProfile(id) {
    const p = readProfiles().find((x) => x.id === id);
    if (!p) return false;
    const t =
      p.temperature != null && Number.isFinite(Number(p.temperature))
        ? normalizeTemperature(p.temperature)
        : DEFAULT_TEMPERATURE;
    saveConfig({ baseUrl: p.baseUrl, model: p.model, temperature: t });
    if (p.apiKey && String(p.apiKey).trim()) {
      saveConfig({ apiKey: String(p.apiKey).trim() });
    }
    setActiveProfileId(id);
    return true;
  }

  function extractModelIdsFromListPayload(data) {
    if (data == null) return [];
    if (Array.isArray(data)) {
      return data
        .map((x) => {
          if (x == null) return "";
          if (typeof x === "string") return String(x).trim();
          return String(x.id || x.model || x.name || x.model_name || "").trim();
        })
        .filter(Boolean);
    }
    if (typeof data !== "object") return [];
    const root = /** @type {Record<string, unknown>} */ (data);
    /** @type {unknown[]} */
    let items = [];
    if (Array.isArray(root.data)) items = root.data;
    else if (root.data && typeof root.data === "object" && !Array.isArray(root.data)) {
      const inner = /** @type {Record<string, unknown>} */ (root.data);
      if (Array.isArray(inner.data)) items = inner.data;
      else if (Array.isArray(inner.list)) items = inner.list;
      else if (Array.isArray(inner.models)) items = inner.models;
    }
    if (!items.length && Array.isArray(root.models)) items = root.models;
    if (!items.length && Array.isArray(root.list)) items = root.list;
    if (!items.length && Array.isArray(root.result)) items = root.result;
    return items
      .map((x) => {
        if (x == null) return "";
        if (typeof x === "string") return String(x).trim();
        return String(x.id || x.model || x.name || x.model_name || "").trim();
      })
      .filter(Boolean);
  }

  async function fetchModelIdsFromUrl(url, apiKey) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), MODEL_LIST_FETCH_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        headers: getModelListHeaders(url, apiKey),
        signal: ctrl.signal
      });
    } catch (e) {
      if (e && typeof e === "object" && /** @type {{ name?: string }} */ (e).name === "AbortError") {
        throw new Error(`拉取超时（${MODEL_LIST_FETCH_TIMEOUT_MS / 1000}s）`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const rawText = await res.text();
    let data = {};
    if (rawText.trim()) {
      try {
        data = JSON.parse(rawText);
      } catch {
        const head = rawText.replace(/\s+/g, " ").slice(0, 80);
        throw new Error(`响应不是 JSON（${res.status}）：${head}`);
      }
    }
    if (!res.ok) {
      const msg =
        (data.error && (data.error.message || data.error)) || data.message || `HTTP ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    const ids = extractModelIdsFromListPayload(data);
    return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
  }

  async function listModels(override) {
    const rawBase = override?.baseUrl ?? getConfig().baseUrl;
    const apiKey = override?.apiKey ?? getConfig().apiKey;
    if (!apiKey) {
      throw new Error("需要 API Key 才能拉取模型列表");
    }
    const urls = getModelListFetchUrls(rawBase);
    /** @type {string[]} */
    const errors = [];
    for (const url of urls) {
      try {
        const ids = await fetchModelIdsFromUrl(url, apiKey);
        if (ids.length) return ids;
        errors.push(`${url}：返回 0 条模型`);
      } catch (e) {
        const msg = e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
        errors.push(`${url}：${msg}`);
      }
    }
    throw new Error(`未能拉取模型列表\n${errors.join("\n")}`);
  }

  /**
   * @param {Record<string, unknown>} body
   * @param {{ completionConfig?: { baseUrl?: string, apiKey?: string, model?: string, temperature?: number } }} [opts]
   */
  async function chatCompletions(body, opts) {
    const cfg =
      opts && opts.completionConfig && typeof opts.completionConfig === "object"
        ? opts.completionConfig
        : getConfig();
    const baseUrl = normalizeBase(cfg.baseUrl || DEFAULT_BASE);
    const apiKey = String(cfg.apiKey || "").trim();
    const model = (String(cfg.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL);
    const temperature = normalizeTemperature(cfg.temperature);
    if (!apiKey) {
      throw new Error("请先在设置里填写并保存 API Key");
    }
    const url = `${baseUrl}/chat/completions`;
    const payload = {
      model: body.model || model,
      temperature,
      ...body
    };
    const doFetch = async (p) => {
      const fetchOpts = {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(p)
      };
      if (opts && opts.signal) fetchOpts.signal = opts.signal;
      const res = await fetch(url, fetchOpts);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg =
          (data.error && (data.error.message || data.error)) || data.message || `HTTP ${res.status}`;
        const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
        err.__httpStatus = res.status;
        throw err;
      }
      return data;
    };

    try {
      return await doFetch(payload);
    } catch (e) {
      // 某些 OpenAI 兼容中转/本地模型不支持 response_format（JSON mode）。
      // 若带了 response_format 但失败，则自动去掉后重试一次，避免影响聊天。
      if (
        payload &&
        Object.prototype.hasOwnProperty.call(payload, "response_format") &&
        payload.response_format &&
        (e && typeof e.message === "string") &&
        /response_format|json|JSON mode|unsupported|not supported/i.test(e.message)
      ) {
        const retry = { ...payload };
        delete retry.response_format;
        return await doFetch(retry);
      }
      throw e;
    }
  }

  async function testPing() {
    const data = await chatCompletions({
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      max_tokens: 16
    });
    const text =
      data.choices?.[0]?.message?.content?.trim() ||
      data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      "";
    if (!text) throw new Error("无回复内容");
    return text;
  }

  /**
   * OpenAI 兼容 embeddings 接口。适配 OpenAI /v1/embeddings 与智谱 /v4/embeddings。
   * 传入 input 可以是字符串或字符串数组；返回第一个 embedding（input 是字符串时）。
   * @param {string | string[]} input
   * @param {{ completionConfig?: { baseUrl?: string, apiKey?: string, model?: string }, signal?: AbortSignal }} [opts]
   * @returns {Promise<number[]>} 第一个输入对应的向量数组
   */
  async function embeddings(input, opts) {
    const cfg =
      opts && opts.completionConfig && typeof opts.completionConfig === "object"
        ? opts.completionConfig
        : getConfig();
    const baseUrl = normalizeBase(cfg.baseUrl || DEFAULT_BASE);
    const apiKey = String(cfg.apiKey || "").trim();
    const model = (String(cfg.model || "").trim() || "embedding-2");
    if (!apiKey) {
      throw new Error("请先在设置里填写并保存 API Key");
    }
    const url = `${baseUrl}/embeddings`;
    const payload = {
      model,
      input: Array.isArray(input) ? input : String(input || "")
    };
    const fetchOpts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    };
    if (opts && opts.signal) fetchOpts.signal = opts.signal;
    const res = await fetch(url, fetchOpts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg =
        (data.error && (data.error.message || data.error)) || data.message || `HTTP ${res.status}`;
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.__httpStatus = res.status;
      throw err;
    }
    const vec = data && data.data && data.data[0] && data.data[0].embedding;
    if (!Array.isArray(vec)) {
      throw new Error("embedding 接口返回数据格式异常");
    }
    return vec;
  }

  /**
   * OpenAI 兼容 SSE 流式 chat/completions。
   * @param {Record<string, unknown>} body 须含 messages；stream 会被强制为 true
   * @param {{ signal?: AbortSignal, completionConfig?: object }} [opts]
   * @param {{ onDelta?: (delta: string, full: string) => void }} [handlers]
   * @returns {Promise<{ content: string, usage: object | null, finishReason: string }>}
   */
  async function chatCompletionsStream(body, opts, handlers) {
    const cfg =
      opts && opts.completionConfig && typeof opts.completionConfig === "object"
        ? opts.completionConfig
        : getConfig();
    const baseUrl = normalizeBase(cfg.baseUrl || DEFAULT_BASE);
    const apiKey = String(cfg.apiKey || "").trim();
    const model = (String(cfg.model || DEFAULT_MODEL).trim() || DEFAULT_MODEL);
    const temperature = normalizeTemperature(cfg.temperature);
    if (!apiKey) {
      throw new Error("请先在设置里填写并保存 API Key");
    }
    const url = `${baseUrl}/chat/completions`;
    const payload = {
      model: body.model || model,
      temperature,
      stream: true,
      ...body
    };
    delete payload.stream_options;
    payload.stream = true;

    const fetchOpts = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    };
    if (opts && opts.signal) fetchOpts.signal = opts.signal;

    const res = await fetch(url, fetchOpts);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const msg =
        (data.error && (data.error.message || data.error)) || data.message || `HTTP ${res.status}`;
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.__httpStatus = res.status;
      throw err;
    }
    const ct = String(res.headers.get("content-type") || "").toLowerCase();
    if (ct.includes("application/json") && !ct.includes("event-stream")) {
      const data = await res.json().catch(() => ({}));
      return completionJsonToStreamResult(data);
    }
    if (!res.body || typeof res.body.getReader !== "function") {
      throw new Error("当前环境不支持流式响应");
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";
    /** @type {object | null} */
    let usage = null;
    let finishReason = "";

    /** @param {string} data */
    const consumeSseData = (data) => {
      const s = String(data || "").trim();
      if (!s || s === "[DONE]") return;
      let json;
      try {
        json = JSON.parse(s);
      } catch {
        return;
      }
      if (json && typeof json === "object" && json.usage) usage = json.usage;
      const ch0 = json?.choices?.[0];
      if (!ch0) return;
      const fr = String(ch0.finish_reason || "").trim();
      if (fr) finishReason = fr;
      const deltaObj = ch0.delta && typeof ch0.delta === "object" ? ch0.delta : ch0.message;
      let delta = "";
      if (deltaObj && typeof deltaObj === "object") {
        const c = deltaObj.content;
        if (typeof c === "string") delta = c;
        else if (Array.isArray(c)) {
          const bits = [];
          for (const part of c) {
            if (!part || typeof part !== "object") continue;
            const p = /** @type {Record<string, unknown>} */ (part);
            const typ = String(p.type || "").toLowerCase();
            if (
              typ === "reasoning" ||
              typ === "thinking" ||
              typ === "reasoning_content" ||
              typ === "chain_of_thought" ||
              typ === "thought"
            ) {
              continue;
            }
            if (typ && typ !== "text" && typ !== "output_text") continue;
            if (typeof p.text === "string") bits.push(p.text);
            else if (typeof p.content === "string") bits.push(p.content);
          }
          delta = bits.join("");
        }
      } else if (typeof ch0.text === "string") {
        delta = ch0.text;
      }
      if (!delta) return;
      fullContent += delta;
      try {
        handlers?.onDelta?.(delta, fullContent, json);
      } catch (_) {
        /* ignore */
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() || "";
      for (const line of parts) {
        const trimmed = String(line || "").trim();
        if (!trimmed.startsWith("data:")) continue;
        consumeSseData(trimmed.slice(5).trim());
      }
    }
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) consumeSseData(trimmed.slice(5).trim());
    }
    if (!String(fullContent || "").trim()) {
      const leftover = buffer.trim();
      if (leftover.startsWith("{")) {
        try {
          const parsed = completionJsonToStreamResult(JSON.parse(leftover));
          if (String(parsed.content || "").trim()) return parsed;
        } catch (_) {
          /* ignore */
        }
      }
    }

    return { content: fullContent, usage, finishReason };
  }

  window.RP_AI = {
    DEFAULT_BASE,
    DEFAULT_MODEL,
    DEFAULT_TEMPERATURE,
    resolveOpenAiV1Base,
    getConfig,
    saveConfig,
    readProfiles,
    upsertProfile,
    deleteProfile,
    applyProfile,
    getActiveProfileId,
    setActiveProfileId,
    getMemoSummaryProfileId,
    setMemoSummaryProfileId,
    getMemoSummaryCompletionConfig,
    getTheaterProfileId,
    setTheaterProfileId,
    getTheaterCompletionConfig,
    listModels,
    chatCompletions,
    chatCompletionsStream,
    getStreamCapability,
    setStreamCapability,
    clearStreamCapabilityForConfig,
    clearAllStreamCapability,
    testPing,
    embeddings
  };
})();
