/**
 * 手动完成 portable exe 的最后一步：复现 electron-builder 的 makensis 调用。
 *
 * 背景：完整 electron-builder 流程中 7z 归档（约 5 分钟）已成功生成
 * release/my-app-0.0.0-x64.nsis.7z，但随后 makensis 子进程失败。
 * 本脚本复用已生成的 7z 与 builder-debug.yml 中提取的 portable.nsi，
 * 补齐 0-messages.nsh 与全部 /D、/X 参数后直接调用 makensis。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const RELEASE = path.join(ROOT, 'release');
const TEMPLATES = path.join(ROOT, 'node_modules', 'app-builder-lib', 'templates', 'nsis');
const PKG = require(path.join(ROOT, 'package.json'));

const PRODUCT_NAME = PKG.build.productName; // 电磁场建模仿真工具
const VERSION = PKG.version; // 0.0.0
const APP_ID = PKG.build.appId;
const ARCHIVE = path.join(RELEASE, `my-app-${VERSION}-x64.nsis.7z`);
const OUT_EXE = path.join(RELEASE, `${PRODUCT_NAME} ${VERSION}.exe`);
const MAKENSIS = 'C:\\Users\\Li\\AppData\\Local\\electron-builder\\Cache\\nsis-3.0.4.1\\nsis-3.0.4.1-w8az6\\Bin\\makensis.exe';

// ---------- 1. 生成 0-messages.nsh（复刻 nsisLang.computeCustomMessageTranslations） ----------
function genMessages() {
  const yaml = require(path.join(ROOT, 'node_modules', 'js-yaml'));
  const { bundledLanguages, toLangWithRegion, lcid } = require(path.join(
    ROOT, 'node_modules', 'app-builder-lib', 'out', 'util', 'langs.js'));
  const data = yaml.load(fs.readFileSync(path.join(TEMPLATES, 'messages.yml'), 'utf8'));
  const langs = bundledLanguages.slice(); // LangConfigurator 默认（多语言）
  const out = [];
  for (const messageId of Object.keys(data)) {
    const tr = data[messageId];
    const unspecified = new Set(langs);
    for (const lang of Object.keys(tr)) {
      const lwr = toLangWithRegion(lang);
      if (!unspecified.has(lwr)) continue;
      out.push(`LangString ${messageId} ${lcid[lwr]} "${String(tr[lang]).replace(/\n/g, '$\\r$\\n')}"`);
      unspecified.delete(lwr);
    }
    const def = String(tr.en).replace(/\n/g, '$\\r$\\n');
    for (const lwr of unspecified) {
      out.push(`LangString ${messageId} ${lcid[lwr]} "${def}"`);
    }
  }
  const file = path.join(RELEASE, '0-messages.nsh');
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  return file;
}

// ---------- 2. 修补 portable.nsi 中的 0-messages.nsh 引用 ----------
function patchScript(messagesFile) {
  let s = fs.readFileSync(path.join(RELEASE, 'portable.nsi'), 'utf8');
  s = s.replace(/!include ".*0-messages\.nsh"/, `!include "${messagesFile.replace(/\//g, '\\')}"`);
  // makensis 按脚本所在目录解析相对 include，补上模板根目录（common.nsh 等）
  s = `!addincludedir "${TEMPLATES}"\n` + s;
  const file = path.join(RELEASE, 'portable-full.nsi');
  fs.writeFileSync(file, s, 'utf8');
  return file;
}

// ---------- 3. 计算 defines ----------
function dirSizeBytes(dir) {
  let sum = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) sum += dirSizeBytes(p);
    else sum += fs.statSync(p).size;
  }
  return sum;
}

function nsisEscape(v) {
  // 与 nsisScriptGenerator.nsisEscapeString 等价的最小实现
  return String(v).replace(/\r?\n/g, ' ').replace(/\$/g, '$$').replace(/"/g, '$\\"');
}

function main() {
  const { UUID } = require(path.join(ROOT, 'node_modules', 'builder-util-runtime'));
  const NS_UUID = UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3');
  const guid = UUID.v5(APP_ID, NS_UUID);

  const sha512 = crypto.createHash('sha512').update(fs.readFileSync(ARCHIVE)).digest('hex').toUpperCase();
  const unpackedKB = Math.ceil(dirSizeBytes(path.join(RELEASE, 'win-unpacked')) / 1024);

  const defines = {
    APP_ID,
    APP_GUID: guid,
    UNINSTALL_APP_KEY: guid.replace(/\\/g, ' - '),
    PRODUCT_NAME,
    PRODUCT_FILENAME: PRODUCT_NAME,
    APP_FILENAME: PRODUCT_NAME,
    APP_DESCRIPTION: '',
    VERSION,
    PROJECT_DIR: ROOT,
    BUILD_RESOURCES_DIR: path.join(ROOT, 'build'),
    APP_PACKAGE_NAME: 'my-app',
    APP_INSTALLER_STORE_FILE: `${PRODUCT_NAME}-updater\\__installer.exe`,
    COMPRESSION_METHOD: '7z',
    APP_64: ARCHIVE,
    APP_64_NAME: path.basename(ARCHIVE),
    APP_64_HASH: sha512,
    APP_64_UNPACKED_SIZE: String(unpackedKB),
    ESTIMATED_SIZE: String(Math.round(unpackedKB / 1024)),
    REQUEST_EXECUTION_LEVEL: 'user',
    UNPACK_DIR_NAME: 'emf' + Date.now().toString(36),
    COMPRESS: 'auto',
  };

  const commands = [
    `OutFile "${OUT_EXE}"`,
    `VIProductVersion "${VERSION}.0"`,
    `VIAddVersionKey /ProductName "${PRODUCT_NAME}"`,
    `VIAddVersionKey /ProductVersion "${VERSION}"`,
    `VIAddVersionKey /FileDescription "${PRODUCT_NAME}"`,
    `Unicode true`,
    `SetCompressor zlib`,
  ];

  const messagesFile = genMessages();
  const scriptFile = patchScript(messagesFile);

  const args = ['-INPUTCHARSET', 'UTF8'];
  for (const [k, v] of Object.entries(defines)) args.push(`-D${k}=${nsisEscape(v)}`);
  for (const c of commands) args.push(`-X${c}`);
  args.push(scriptFile);

  console.log('makensis args count:', args.length);
  const r = spawnSync(MAKENSIS, args, { cwd: TEMPLATES, encoding: 'utf8', timeout: 240000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const tail = out.trim().split('\n').slice(-12).join('\n');
  console.log(tail);
  if (r.error) throw r.error;
  if (r.status !== 0) {
    console.error('makensis failed, status =', r.status);
    process.exit(1);
  }
  const sz = fs.statSync(OUT_EXE).size;
  console.log('OK:', OUT_EXE, (sz / 1024 / 1024).toFixed(1), 'MB');
}

main();
