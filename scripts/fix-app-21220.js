/* 一次性修复:app.js line 21220 周围 6 行是「一字面正则被错误地
 * 拆成 6 行 + 漏 4 处 \n」,导致 SyntaxError。
 * 合并为单行字面 \n 字符。
 *
 * 文件整篇是 CRLF 编码;raw.split("\n") 后每行末尾保留 \r。
 */
const fs = require("fs");
const path = require("path");

const target = path.resolve("d:/AI/meixinji-temp/app.js");
const raw = fs.readFileSync(target, "utf8");
const lines = raw.split("\n");

// expected 中 \r 是真 CR 字符(0x0D),由 JSON 字符串 "\r" 解析得到
const expected = [
  "  text = text.replace(/[ \\t]+\r",   // 21220
  "/g, \"\r",                            // 21221
  "\").replace(/\r",                     // 21222
  "{3,}/g, \"\r",                       // 21223
  "\r",                                  // 21224(空行)
  "\").trim();\r"                        // 21225
];

let bad = false;
for (let i = 0; i < 6; i++) {
  if (lines[21219 + i] !== expected[i]) {
    console.error("mismatch at " + (21220 + i) + " expected " + JSON.stringify(expected[i]) + " got " + JSON.stringify(lines[21219 + i]));
    bad = true;
  }
}
if (bad) process.exit(1);

// 单行正确版(4 处字面 \n,行尾换 \n)
const correct = "  text = text.replace(/[ \\t]+\\n/g, \"\\n\").replace(/\\n{3,}/g, \"\\n\\n\").trim();";
lines[21219] = correct;
// 删 5 行(index 21220..21224)
lines.splice(21220, 5);

fs.writeFileSync(target, lines.join("\n"));
console.log("OK app.js fixed (merged 6 lines into 1)");
