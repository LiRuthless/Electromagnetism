# -*- coding: utf-8 -*-
"""提取 archive/papers/ 下 PDF 的目录结构与正文文本（分文件输出 txt 到 archive/papers/papers_text/）"""
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / "papers"
OUT = ROOT / "papers" / "papers_text"
OUT.mkdir(parents=True, exist_ok=True)

for pdf in sorted(BASE.glob("*.pdf")):
    out_txt = OUT / (pdf.stem + ".txt")
    if out_txt.exists() and out_txt.stat().st_size > 1000:
        print(f"[skip] {pdf.name} 已提取")
        continue
    print(f"[..] {pdf.name} ({pdf.stat().st_size/1e6:.1f} MB)", flush=True)
    try:
        reader = PdfReader(str(pdf))
        n = len(reader.pages)
        print(f"     页数: {n}", flush=True)
        chunks = []
        for i, page in enumerate(reader.pages):
            try:
                t = page.extract_text() or ""
            except Exception as e:
                t = f"[page {i} extract error: {e}]"
            chunks.append(f"\n===== Page {i+1}/{n} =====\n{t}")
            if (i + 1) % 50 == 0:
                print(f"     {i+1}/{n}", flush=True)
        out_txt.write_text("".join(chunks), encoding="utf-8")
        print(f"     -> {out_txt.name}  {out_txt.stat().st_size/1024:.0f} KB", flush=True)
    except Exception as e:
        print(f"[ERROR] {pdf.name}: {e}", flush=True)

print("done")
