@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "NPM_CMD=npm"

where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" (
    set "NPM_CMD=C:\Program Files\nodejs\npm.cmd"
    set "PATH=C:\Program Files\nodejs;%PATH%"
  ) else (
    echo 未检测到 Node.js，请先安装 Node.js 20+（含 npm）。
    pause
    exit /b 1
  )
)

if not exist node_modules (
  "%NPM_CMD%" install
  if errorlevel 1 (
    echo npm install 失败
    pause
    exit /b 1
  )
)

"%NPM_CMD%" run dist:win
if errorlevel 1 (
  echo 打包失败
  pause
  exit /b 1
)

echo 打包完成，请查看 release 目录。
