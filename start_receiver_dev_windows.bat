@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if exist "C:\Program Files\nodejs\node.exe" (
  set "PATH=C:\Program Files\nodejs;%PATH%"
  set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 未检测到 Node.js，请先安装 Node.js 20+。
    echo 下载：https://nodejs.org/
    pause
    exit /b 1
  )
  set "NPM_CMD=npm"
)

if not exist node_modules (
  echo 正在安装依赖...
  "%NPM_CMD%" install
  if errorlevel 1 (
    echo npm install 失败
    pause
    exit /b 1
  )
)

echo 启动 Receiver 模式...
"%NPM_CMD%" run dev:receiver
