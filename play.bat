@echo off
rem FPV Sim launcher: builds the game if needed, starts the controller bridge and opens the game.
rem   play.bat              normal (vsync on, fullscreen)
rem   play.bat lowlatency   vsync off: lowest input lag, may tear
rem   play.bat windowed     not fullscreen
setlocal
cd /d "%~dp0"

if not exist "dist\index.html" (
  echo Building the game...
  call npm install --no-audit --no-fund || goto :fail
  call npm run build || goto :fail
)

set ARGS=--launch
if /i "%~1"=="lowlatency" set ARGS=%ARGS% --low-latency
if /i "%~1"=="windowed" set ARGS=%ARGS% --windowed
if /i "%~2"=="lowlatency" set ARGS=%ARGS% --low-latency
if /i "%~2"=="windowed" set ARGS=%ARGS% --windowed

python bridge\bridge.py %ARGS%
if errorlevel 1 goto :fail
exit /b 0

:fail
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
