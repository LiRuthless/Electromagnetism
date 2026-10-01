@echo off
rem build.bat — 车载控制器 WASM 编译样例（ABI v1，specs/features/13-wasm-controller/）
rem
rem 依赖：LLVM clang（wasm32 目标，freestanding 无标准库）。
rem 用法：在本目录执行 build.bat，产出 pd_controller.wasm；
rem       复制到 ..\scripts\fixtures\ 后提交入库，供 npm run selfcheck:wasm 作 V-1 对照基准。
rem
rem 关键参数：
rem   --target=wasm32      裸 wasm32（非 wasi）
rem   -nostdlib            freestanding：无 CRT/libc；libm 的 float 符号由宿主 env 兜底
rem   -Wl,--no-entry       无 _start 入口
rem   -Wl,--export=...     导出 ABI 任务入口与版本声明（controller.c 内 export_name 亦可，
rem                        此处显式列出以防符号被裁剪）
rem   -Wl,--strip-all      去调试符号
rem
rem Emscripten（emcc）亦可，但默认产出带 WASI 依赖的模块，宿主不支持——
rem 需 standalone 裁剪（-sSTANDALONE_WASM + 去除全部 WASI 导入），推荐直接用 clang。

clang --target=wasm32 -O2 -nostdlib ^
  -Wl,--no-entry ^
  -Wl,--export=ctrl_init ^
  -Wl,--export=ctrl_task_1ms ^
  -Wl,--export=ctrl_task_2ms ^
  -Wl,--export=CTRL_ABI_VERSION ^
  -Wl,--strip-all ^
  -o pd_controller.wasm controller.c

if %ERRORLEVEL% EQU 0 (
  echo OK: pd_controller.wasm
  echo 请复制到 ..\scripts\fixtures\pd_controller.wasm 并提交入库
)
