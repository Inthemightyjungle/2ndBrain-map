@echo off
title 2nd Brain - publish to Firebase
setlocal
echo.
echo  ==============================================
echo    2nd Brain: publish to Firebase
echo  ==============================================
echo.

rem --- find the app's firebase folder (next to this file, or in the downloaded copy) ---
set "APPDIR="
if exist "%~dp0firebase.json" set "APPDIR=%~dp0"
for %%D in ("%USERPROFILE%\Desktop" "%USERPROFILE%\Downloads" "%USERPROFILE%\Documents") do (
  if not defined APPDIR if exist "%%~D\Inspirations-map-main\firebase\firebase.json" set "APPDIR=%%~D\Inspirations-map-main\firebase\"
  if not defined APPDIR if exist "%%~D\Inspirations-map-main\Inspirations-map-main\firebase\firebase.json" set "APPDIR=%%~D\Inspirations-map-main\Inspirations-map-main\firebase\"
)
if not defined APPDIR (
  echo  Couldn't find the app folder. Put this file inside the "firebase" folder
  echo  of the downloaded Inspirations-map-main folder and double-click it again.
  pause & exit /b 1
)
cd /d "%APPDIR%"
echo  App folder: %CD%
echo.

rem --- Node.js ---
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js isn't installed. The download page will open: install the LTS version,
  echo  then double-click this file again.
  start https://nodejs.org
  pause & exit /b 1
)

echo  [1/5] Installing the Firebase tools (takes a minute)...
call npm install -g firebase-tools >nul 2>nul
where firebase >nul 2>nul || (echo  Installing failed. Close this window, open it again and retry. & pause & exit /b 1)
echo        Done.
echo.

echo  [2/5] Signing in. If a browser opens, sign in with the Google account that
echo        owns your Firebase project and press Allow.
call firebase login --no-localhost 2>nul || call firebase login
echo.

if exist ".firebaserc" (
  echo  [3/5] Project already chosen.
) else (
  echo  [3/5] Pick your project with the arrow keys and press Enter.
  echo        When it asks for an alias, type:  default
  call firebase use --add
)
echo.

echo  [4/5] Claude API key. If it's not stored yet, you'll be asked to paste it
echo        (right-click pastes). It's kept on Google's servers, never in the website.
call firebase functions:secrets:get ANTHROPIC_API_KEY >nul 2>nul
if errorlevel 1 call firebase functions:secrets:set ANTHROPIC_API_KEY
echo.

echo  [5/5] Publishing the app (a few minutes). Answer y if it asks to enable a service.
call firebase deploy
echo.
echo  ==============================================
echo   Finished. Open the "Hosting URL" shown above,
echo   sign in, then Account ^> Import backup.
echo  ==============================================
pause
