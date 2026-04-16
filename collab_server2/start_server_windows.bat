@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo [collab] 正在安装依赖...
  npm install
  if errorlevel 1 (
    echo [collab] npm install 失败
    pause
    exit /b 1
  )
)

echo [collab] 正在启动服务...
node server.js
