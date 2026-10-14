"""
  ``app.js`` line 21220 二次损坏修复脚本(同位置反复出问题)。

  现象:字面正则 `text.replace(/[ \t]+\n/g, ...)` 又被错误拆成多行,
  浏览器加载时报 `SyntaxError: Invalid regular expression: missing /`,白屏。

  根因:某次编辑(编辑器自动断行 / CRLF 转换 / Git 同步)把字面 `\n` 还原成了真换行,
  把 `\\n` 里的反斜杠 + n 拆成两行后,正则立刻失效。

  本脚本:
  1. 读 ``d:\\AI\\meixinji-temp\\app.js``
  2. 用一个固定特征字符串定位损坏行(只动这一处,不动其他)
  3. 把 5 行损坏段合并成正确的 1 行
  4. 写回文件
  5. 跑 ``node --check`` 二次确认
"""
import sys, subprocess, re

PATH = r"d:\AI\meixinji-temp\app.js"

with open(PATH, "r", encoding="utf-8", newline="") as f:
    lines = f.readlines()

# 找损坏起始行:看到 `text.replace(/[ \t]+` 后且本行末尾是字面 `\n`
# (没 /g 配对),就视为损坏起点。
TARGET_PREFIX = '  text = text.replace(/[ \\t]+'

bad_start = None
for i, line in enumerate(lines):
    stripped = line.rstrip('\r\n')
    if stripped.startswith(TARGET_PREFIX) and not stripped.endswith('/g,"\\n")'):
        bad_start = i
        break

if bad_start is None:
    print("[FIX] 没找到损坏模式;可能已经修过了。检查 line 21220 附近 6 行:")
    for k in range(21215, 21230):
        if k < len(lines):
            print(f"L{k}: {lines[k]!r}")
    sys.exit(0)

# 损坏段起始,向后 6 行内全部合并
# 正确版:
CORRECT = (
    '  text = text.replace(/[ \\t]+\\n/g, "\\n")'
    '.replace(/\\n{3,}/g, "\\n\\n").trim();\n'
)

# 收集损坏的 6 行(保守多收一行),用它们的内容组合后丢掉
window = lines[bad_start:bad_start + 6]
print("[FIX] 找到损坏起始行 line %d" % (bad_start + 1))
print("[FIX]    损坏段:")
for k, l in enumerate(window):
    print(f"L{bad_start+1+k}: {l!r}")

# 替换
new_lines = lines[:bad_start] + [CORRECT] + lines[bad_start + len(window):]
# 把多出来的部分如果还有 .replace(/\n{3,} 残留就再清一遍
# 简单做法:再扫一遍,如果还有 .replace(/\n{3,} 在文件里就合并到 CORRECT 后面
# 这次只动 line 21220 一处,跳过此步

with open(PATH, "w", encoding="utf-8", newline="") as f:
    f.writelines(new_lines)

print(f"[FIX] 已写回。原 %d 行 → 现 %d 行" % (len(lines), len(new_lines)))

# node --check 验证
print("[FIX] 跑 node --check 验证 ...")
r = subprocess.run(
    ["node", "--check", PATH],
    capture_output=True, text=True
)
if r.returncode == 0:
    print("[FIX] ✓ node --check 通过")
else:
    print("[FIX] ✗ node --check 仍报错:")
    print(r.stdout)
    print(r.stderr)
    sys.exit(1)