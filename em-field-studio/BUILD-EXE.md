# 打包 exe 操作手册（本机环境适配版）

> 约定：两阶段发布——改完代码只出预览版（`npm run build` / `npm run dev`），经用户明确同意后才按本手册打便携版 exe。
> 产物复制到工作目录根 `E:\study\Electromagnetism\电磁场建模仿真工具 0.1.0.exe`（覆盖旧版），并上传 GitHub Releases
>（exe 不进 git，走 Releases 附件，规避 GitHub 单文件 100MB 限制）；不再保留本地旧版备份（原 `backup/` 做法已于 2026-10-01 废止）。

## 本机环境的三个坑（2026-07-24 实测）

1. **GitHub 直连超时**：electron-builder 默认从 GitHub 下载 Electron，会
   `connect ETIMEDOUT`。本机已有缓存压缩包，用 `-c.electronDist=` 指过去即可完全离线：
   `C:\Users\Li\AppData\Local\electron\Cache\0622c5b5b51ab3180f02f5370d555559fd4865e1757af5b2d5583806f774c12f\electron-v43.2.0-win32-x64.zip`
2. **win-unpacked.tmp 改名 EPERM**：杀毒软件实时扫描会锁定刚解压的 Electron 目录，
   electron-builder 的 rename 必现 `EPERM`。解法：手动 `cp -r win-unpacked.tmp win-unpacked`，
   组装 `resources/app`（dist + electron + package.json，并把 electron.exe 改名为
   `电磁场建模仿真工具.exe`），然后用 `--prepackaged` 跳过打包阶段。
3. **单次 Bash 300s 限制**：7z 正常压缩约 5 分钟，前台一次跑不完。解法：先单独让
   electron-builder 生成 `release/my-app-0.1.0-x64.nsis.7z`（超时被杀也没关系，
   7z 写完即落盘），再用 `scripts/ui/finish-portable.cjs` 复现 makensis 调用组装最终 exe。

## 标准流程

```bash
cd E:/study/Electromagnetism/em-field-studio
NPM="/c/Users/Li/AppData/Roaming/kimi-desktop/daimon-share/daimon/command-process-owner/bin/npm.cmd"
ELECTRON_ZIP="C:\\Users\\Li\\AppData\\Local\\electron\\Cache\\0622c5b5b51ab3180f02f5370d555559fd4865e1757af5b2d5583806f774c12f\\electron-v43.2.0-win32-x64.zip"

# 1. 构建 web 端
"$NPM" run build

# 2. 打包 win-unpacked（离线指定 Electron；若 rename EPERM，走 2b）
./node_modules/.bin/electron-builder --win portable -c.compression=store "-c.electronDist=$ELECTRON_ZIP"

# 2b. rename 失败时手动接管
cd release && cp -r win-unpacked.tmp win-unpacked && cd win-unpacked
mv electron.exe "电磁场建模仿真工具.exe"
mkdir -p resources/app
cp -r ../../dist resources/app/dist
cp -r ../../electron resources/app/electron
cp ../../package.json resources/app/package.json
cd ../..

# 3. 生成 7z 归档（正常压缩，约 5 分钟；被杀后 7z 仍已落盘）
./node_modules/.bin/electron-builder --prepackaged release/win-unpacked --win portable || true

# 4. 复现 makensis 组装最终 exe（复用上一步的 7z + builder-debug.yml）
python scripts/ui/extract-nsi.py   # 从 builder-debug.yml 提取 portable.nsi
node scripts/ui/finish-portable.cjs

# 5. 复制到工作目录根并清理中间产物
cp "release/电磁场建模仿真工具 0.1.0.exe" "E:/study/Electromagnetism/电磁场建模仿真工具 0.1.0.exe"
rm -rf release/win-unpacked release/win-unpacked.tmp release/*.7z \
       release/builder-debug.yml release/portable*.nsi release/0-messages.nsh

# 6. 上传 GitHub Releases（发布渠道，2026-10-01 起；本地不再保留旧版备份）
gh release create v0.1.0 "E:/study/Electromagnetism/电磁场建模仿真工具 0.1.0.exe" --title "电磁场建模仿真工具 0.1.0"
```

注意：第 2 步的 `-c.compression=store` 只影响 win-unpacked 阶段的临时产物；
最终 exe 体积由第 3 步的 7z 正常压缩决定（约 90 MB）。
