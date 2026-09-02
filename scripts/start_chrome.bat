:: Windows: 以调试模式启动 Chrome 并打开外贸通登录页
:: 用法: start_chrome.bat
@echo off
setlocal
set PORT=9222
set PROFILE=%TEMP%\wm-chrome-profile

REM 检测 Chrome 路径
set CHROME=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe

if "%CHROME%"=="" (
  echo [X] 未找到 Chrome，请先安装 Google Chrome
  exit /b 1
)

echo [启动] Chrome 调试模式 profile=%PROFILE%
taskkill /F /IM chrome.exe >nul 2>&1
timeout /t 2 /nobreak >nul
start "" "%CHROME%" --remote-debugging-port=%PORT% --remote-debugging-address=127.0.0.1 --user-data-dir="%PROFILE%" "https://waimao.office.163.com/"
echo [OK] Chrome 已启动并打开外贸通登录页，请登录后回到 WorkBuddy 继续
endlocal
