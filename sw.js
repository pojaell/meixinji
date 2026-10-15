const CACHE_NAME = "xxj-pwa-v238";
const KEEPALIVE_PERIODIC_TAG = "xxj-keepalive";
const SCHEDULE_IDB = "xxj_sw_schedule";
const SCHEDULE_STORE = "due";
const GITHUB_BACKUP_SCHEDULE_ID = "github_backup_auto";

const PRECACHE_URLS = [
  "./index.html",
  "./oauth-bootstrap.js",
  "./style.css",
  "./db.js?v=314",
  "./inline-html.js?v=348",
  "./state-routine-table.js",
  "./media-blob.js?v=314",
  "./ringtones.js?v=314",
  "./voice-ringtone-picker.js?v=314",
  "./ai-api.js",
  "./auth.js?v=314",
  "./group.js?v=314",
  "./group.css?v=273",
  "./checkup.js?v=351",
  "./checkup-reverse.js?v=348",
  "./checkup.css?v=351",
  "./vendor/supabase.min.js",
  "./vendor/fflate.umd.js",
  "./manifest.webmanifest",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

async function precacheAll(cache) {
  await Promise.all(
    PRECACHE_URLS.map(async (url) => {
      try {
        const res = await fetch(url);
        if (res && res.status === 200 && res.type === "basic") await cache.put(url, res);
      } catch {
        /* 离线安装等：跳过 */
      }
    })
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => precacheAll(cache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  const isDocument = req.mode === "navigate" || (req.destination || "") === "document";
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const isBootScript =
    path.endsWith(".js") &&
    path !== "/sw.js" &&
    !path.endsWith("/sw.js");

  /* db / app 等须网络优先，避免旧缓存导致「修了仍丢数据」 */
  if (isBootScript) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  if (isDocument) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(req)
            .then((hit) => hit || caches.match("./index.html"))
        )
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => {
          if (hit) return hit;
          return new Response("", { status: 503, statusText: "Offline" });
        })
      )
  );
});

function absNotifyAsset(path) {
  const p = String(path || "").trim();
  if (!p) return absNotifyAsset("./icons/icon-192.png");
  if (
    p.startsWith("http://") ||
    p.startsWith("https://") ||
    p.startsWith("blob:") ||
    p.startsWith("data:")
  ) {
    return p;
  }
  try {
    const base = self.registration.scope || self.location.href;
    return new URL(p, base).href;
  } catch {
    return absNotifyAsset("./icons/icon-192.png");
  }
}

function showChatNotificationFromPayload(p) {
  const title = String(p.title || "没心机").trim() || "没心机";
  const body = String(p.body || "新消息").trim() || "新消息";
  const opts = {
    body,
    icon: absNotifyAsset(p.icon || "./icons/icon-192.png"),
    badge: absNotifyAsset("./icons/icon-maskable-512.png"),
    tag: p.tag || "xxj-" + Date.now(),
    data: p.data || {},
    silent: false,
    renotify: true
  };
  if (p.vibrate) opts.vibrate = [200, 100, 200];
  if (p.requireInteraction) opts.requireInteraction = true;
  return self.registration.showNotification(title, opts);
}

function openScheduleDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SCHEDULE_IDB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(SCHEDULE_STORE)) {
        db.createObjectStore(SCHEDULE_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function persistScheduleEntry(payload, delayMs) {
  const delay = Math.min(60000, Math.max(500, Number(delayMs) || 5000));
  const entry = {
    id: "s_" + Date.now(),
    kind: "notify",
    fireAt: Date.now() + delay,
    payload: payload || {}
  };
  return openScheduleDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SCHEDULE_STORE, "readwrite");
        tx.objectStore(SCHEDULE_STORE).put(entry);
        tx.oncomplete = () => {
          db.close();
          resolve(entry);
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}

function deleteScheduleEntry(id) {
  return openScheduleDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SCHEDULE_STORE, "readwrite");
        tx.objectStore(SCHEDULE_STORE).delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}

function persistGithubBackupSchedule(fireAt) {
  const at = Math.max(Date.now() + 60000, Number(fireAt) || Date.now() + 86400000);
  const entry = {
    id: GITHUB_BACKUP_SCHEDULE_ID,
    kind: "github_backup",
    fireAt: at,
    payload: {}
  };
  return openScheduleDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(SCHEDULE_STORE, "readwrite");
        tx.objectStore(SCHEDULE_STORE).put(entry);
        tx.oncomplete = () => {
          db.close();
          resolve(entry);
        };
        tx.onerror = () => reject(tx.error);
      })
  );
}

function clearGithubBackupSchedule() {
  return deleteScheduleEntry(GITHUB_BACKUP_SCHEDULE_ID).catch(() => {});
}

function wakeClientsForGithubBackup() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    let sent = 0;
    for (const client of clientList) {
      try {
        client.postMessage({ type: "AUTO_GITHUB_BACKUP", ts: Date.now() });
        sent++;
      } catch (_) {
        /* ignore */
      }
    }
    return sent;
  });
}

function flushDueGithubBackupSchedule() {
  const now = Date.now();
  return openScheduleDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(SCHEDULE_STORE, "readonly");
          const req = tx.objectStore(SCHEDULE_STORE).get(GITHUB_BACKUP_SCHEDULE_ID);
          req.onsuccess = () => resolve({ db, entry: req.result || null });
          req.onerror = () => reject(req.error);
        })
    )
    .then(({ db, entry }) => {
      db.close();
      if (!entry || entry.fireAt > now) return;
      return wakeClientsForGithubBackup().then((sent) => {
        if (sent > 0) return;
        const snooze = now + 6 * 60 * 60 * 1000;
        return persistGithubBackupSchedule(snooze).then(() =>
          showChatNotificationFromPayload({
            title: "没心机 · GitHub 备份",
            body: "定时备份已到点，请打开应用完成上传",
            tag: "xxj-github-backup-auto",
            data: { notifyKind: "backup" }
          })
        );
      });
    })
    .catch(() => {});
}

function flushDueScheduledNotifications() {
  const now = Date.now();
  return openScheduleDb()
    .then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(SCHEDULE_STORE, "readonly");
          const req = tx.objectStore(SCHEDULE_STORE).getAll();
          req.onsuccess = () => resolve({ db, rows: req.result || [] });
          req.onerror = () => reject(req.error);
        })
    )
    .then(({ db, rows }) => {
      const due = rows.filter(
        (e) => e && e.id !== GITHUB_BACKUP_SCHEDULE_ID && e.fireAt <= now
      );
      db.close();
      return Promise.all([
        flushDueGithubBackupSchedule(),
        ...due.map((entry) =>
          showChatNotificationFromPayload(entry.payload)
            .then(() => deleteScheduleEntry(entry.id))
            .catch(() => deleteScheduleEntry(entry.id))
        )
      ]);
    })
    .catch(() => {});
}

function scheduleChatNotificationInSw(payload, delayMs) {
  const delay = Math.min(60000, Math.max(500, Number(delayMs) || 5000));
  return persistScheduleEntry(payload, delayMs).then((entry) => {
    const entryId = entry.id;
    armSwFlushLoop();
    return new Promise((resolve) => {
      setTimeout(() => {
        showChatNotificationFromPayload(payload || {})
          .then(() => deleteScheduleEntry(entryId).then(resolve))
          .catch(() => flushDueScheduledNotifications().then(resolve));
      }, delay);
    });
  });
}

/** 页面 keepalive 停 ping 后约 90s 自动停，避免 SW 空转 */
let swFlushIntervalId = 0;
let swFlushStopTimerId = 0;

function armSwFlushLoop() {
  if (swFlushStopTimerId) clearTimeout(swFlushStopTimerId);
  swFlushStopTimerId = setTimeout(() => {
    if (swFlushIntervalId) clearInterval(swFlushIntervalId);
    swFlushIntervalId = 0;
    swFlushStopTimerId = 0;
  }, 90000);
  if (!swFlushIntervalId) {
    swFlushIntervalId = setInterval(() => {
      flushDueScheduledNotifications().catch(() => {});
    }, 3000);
  }
}

function armSwBackupFlushLoop() {
  armSwFlushLoop();
}

self.addEventListener("periodicsync", (event) => {
  if (event.tag !== KEEPALIVE_PERIODIC_TAG) return;
  const prom = self.clients
    .matchAll({ type: "window", includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        try {
          client.postMessage({ type: "PERIODIC_SYNC_TICK", ts: Date.now() });
        } catch (_) {}
      }
      return flushDueScheduledNotifications();
    });
  if (typeof event.waitUntil === "function") event.waitUntil(prom);
  else prom.catch(() => {});
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || !data.type) return;

  if (data.type === "keepalive-ping") {
    armSwFlushLoop();
    const prom = flushDueScheduledNotifications();
    if (typeof event.waitUntil === "function") event.waitUntil(prom);
    else prom.catch(() => {});
    return;
  }

  let prom = null;

  if (data.type === "SHOW_CHAT_NOTIFICATION") {
    prom = showChatNotificationFromPayload(data.payload || {});
  } else if (data.type === "SCHEDULE_CHAT_NOTIFICATION") {
    prom = scheduleChatNotificationInSw(data.payload || {}, data.delayMs);
  } else if (data.type === "SCHEDULE_GITHUB_BACKUP") {
    prom = persistGithubBackupSchedule(data.fireAt).then(() => armSwBackupFlushLoop());
  } else if (data.type === "CANCEL_GITHUB_BACKUP") {
    prom = clearGithubBackupSchedule();
  } else if (data.type === "GITHUB_BACKUP_RESCHEDULED") {
    prom = persistGithubBackupSchedule(data.fireAt).then(() => armSwBackupFlushLoop());
  }

  if (prom) {
    if (typeof event.waitUntil === "function") event.waitUntil(prom);
    else prom.catch(() => {});
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const targetUrl = "./index.html";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      const scope = self.registration.scope || "./";
      for (const client of clientList) {
        if (client.url && client.url.startsWith(scope) && "focus" in client) {
          client.postMessage({
            type: "NOTIFICATION_CLICK",
            maskId: data.maskId,
            threadId: data.threadId,
            charId: data.charId,
            notifyKind: data.notifyKind || "chat"
          });
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl).then((client) => {
          if (!client) return;
          return new Promise((resolve) => {
            setTimeout(() => {
              try {
                client.postMessage({
                  type: "NOTIFICATION_CLICK",
                  maskId: data.maskId,
                  threadId: data.threadId,
                  charId: data.charId,
                  notifyKind: data.notifyKind || "chat"
                });
              } catch (_) {}
              resolve();
            }, 600);
          });
        });
      }
    })
  );
});
