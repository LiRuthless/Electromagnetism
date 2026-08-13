# -*- coding: utf-8 -*-
"""从 electron-builder 的 builder-debug.yml 提取 nsis 脚本并写出 .nsi 文件。"""
import re
from pathlib import Path

release = Path(__file__).parent.parent / "release"
raw = (release / "builder-debug.yml").read_text(encoding="utf-8")

m = re.search(r'script: "(.*)"\s*$', raw, re.S)
assert m, "script not found in builder-debug.yml"
s = m.group(1)

ESCAPES = {"n": "\n", "t": "\t", '"': '"', "\\": "\\"}
s = re.sub(r"\\(.)", lambda mm: ESCAPES.get(mm.group(1), mm.group(1)), s)

out = release / "portable.nsi"
out.write_text(s, encoding="utf-8")
print("written:", out, "chars:", len(s))

for i, line in enumerate(s.splitlines(), 1):
    if re.search(r"OutFile|\.7z|PACKAGE|!addplugindir|RequestExecutionLevel", line):
        print(f"{i}: {line.strip()[:160]}")
