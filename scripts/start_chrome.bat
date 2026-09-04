:: Windows: 以调试模式启动 Chrome/Edge 并打开外贸通登录页
:: 用法: start_chrome.bat
:: 说明: 优先复用已在跑的 9222 调试端口；不强杀用户正在使用的浏览器
@echo off
setlocal
set PORT=9222
if "%WM_PROFILE%"=="" (set PROFILE=%TEMP%\wm-chrome-profile) else (set PROFILE=%WM_PROFILE%)

REM 若 9222 已在跑，直接复用（不重启、不打扰用户）
curl -s --noproxy * --max-time 2 http://127.0.0.1:%PORT%/json/version >nul 2>&1
if %errorlevel%==0 (
  echo [OK] 调试端口 9222 已在运行，直接复用（未重启浏览器）
  goto OPEN_PAGE
)

REM 检测浏览器路径（Chrome > Edge，可用 WM_BROWSER 覆盖）
set BROWSER=%WM_BROWSER%
if exist "%BROWSER%" goto FOUND
set BROWSER=
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" set BROWSER=C:\Program Files\Google\Chrome\Application\chrome.exe
if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" set BROWSER=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set BROWSER=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe
if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" set BROWSER=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
if exist "C:\Program Files\Microsoft\Edge\Application\msedge.exe" set BROWSER=C:\Program Files\Microsoft\Edge\Application\msedge.exe
if exist "%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe" set BROWSER=%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe

if "%BROWSER%"=="" (
  echo [X] 未找到 Chrome/Edge，请先安装其中之一
  exit /b 1
)

:FOUND
echo [启动] 浏览器调试模式: %BROWSER% profile=%PROFILE%
start "" "%BROWSER%" --remote-debugging-port=%PORT% --remote-debugging-address=127.0.0.1 --user-data-dir="%PROFILE%" "https://waimao.office.163.com/"
echo [OK] 浏览器已启动并打开外贸通登录页，请登录后回到 WorkBuddy 继续
goto END

:OPEN_PAGE
curl -s --noproxy * -X PUT "http://127.0.0.1:%PORT%/json/new?https://waimao.office.163.com/" >nul 2>&1
echo [OK] 已在浏览器打开外贸通登录页，请登录后回到 WorkBuddy 继续

:END
endlocal
