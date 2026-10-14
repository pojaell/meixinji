const fs = require("fs");
const p = "d:/AI/meixinji-temp/app.js";
const raw = fs.readFileSync(p, "utf8");
const lines = raw.split("\n");
for (let i = 21210; i < Math.min(21230, lines.length); i++) {
  const txt = lines[i];
  const tail = JSON.stringify(txt.charCodeAt(txt.length - 1));
  console.log((i + 1) + " tail=" + tail + " body=" + JSON.stringify(txt));
}
