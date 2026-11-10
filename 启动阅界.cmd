@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 阅界 · 阅读助手
rem 避免个别环境把 Electron 当成 Node 运行
set "ELECTRON_RUN_AS_NODE="

where node >nul 2>nul
if errorlevel 1 (
  echo [阅界] 未找到 Node.js，请先安装 Node.js 20 或更高版本：https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [阅界] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [阅界] 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)

if not exist "web\dist\index.html" (
  echo [阅界] 正在构建界面...
  call npm run build
  if errorlevel 1 (
    echo [阅界] 界面构建失败，请检查上面的错误信息。
    pause
    exit /b 1
  )
)

echo [阅界] 正在启动阅读助手...
start "" "%CD%\node_modules\electron\dist\electron.exe" .
endlocal
exit /b 0
