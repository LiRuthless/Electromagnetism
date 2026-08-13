@echo off
chcp 65001 >nul
title 电磁场建模仿真工具
cd /d "%~dp0em-field-studio"

rem 如果 7100 端口已在运行，直接打开浏览器
netstat -ano | findstr ":7100" | findstr "LISTENING" >nul
if not errorlevel 1 goto OPEN_BROWSER

rem 把 npm 所在目录加入 PATH（Kimi 内置 Node 环境）
set "PATH=C:\Users\Li\AppData\Roaming\kimi-desktop\daimon-share\daimon\command-process-owner\bin;%PATH%"

echo ========================================
echo   电磁场建模仿真工具 正在启动...
echo   浏览器会自动打开，请稍等几秒
echo   关闭本窗口即可停止仿真服务
echo ========================================
echo.

rem 5 秒后自动打开浏览器（等 dev server 就绪）
start "" /min cmd /c "timeout /t 5 >nul & start http://localhost:7100/"

rem 前台运行开发服务器，关闭此窗口即停止
call npm run dev
pause
exit /b 0

:OPEN_BROWSER
echo [√] 仿真服务已在运行，正在为你打开浏览器...
start "" http://localhost:7100/
pause
exit /b 0
