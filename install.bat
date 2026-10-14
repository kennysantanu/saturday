@echo off
setlocal DisableDelayedExpansion
rem No PowerShell, administrator privileges or global runtime changes.
set "NODE_VERSION=24.21.0"
if /I not "%PROCESSOR_ARCHITECTURE%"=="AMD64" if /I not "%PROCESSOR_ARCHITEW6432%"=="AMD64" goto unsupported
if not defined LOCALAPPDATA goto unsupported
set "SATURDAY_ROOT=%LOCALAPPDATA%\Saturday"
if defined SATURDAY_INSTALL_ROOT set "SATURDAY_ROOT=%SATURDAY_INSTALL_ROOT%"
set "RUNTIME=node-v%NODE_VERSION%-win-x64"
set "HASH=158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541"
set "DOWNLOADS=%SATURDAY_ROOT%\runtime\downloads"
set "ARCHIVE=%DOWNLOADS%\%RUNTIME%.zip"
set "NODE=%SATURDAY_ROOT%\runtime\%RUNTIME%\node.exe"
where curl.exe >nul 2>nul
if errorlevel 1 goto prerequisites
where tar.exe >nul 2>nul
if errorlevel 1 goto prerequisites
where certutil.exe >nul 2>nul
if errorlevel 1 goto prerequisites
if not exist "%DOWNLOADS%" mkdir "%DOWNLOADS%"
if errorlevel 1 goto failed
if exist "%ARCHIVE%" goto verify
curl.exe --proto "=https" --tlsv1.2 -fL --retry 2 -o "%ARCHIVE%.part" "https://nodejs.org/dist/v%NODE_VERSION%/%RUNTIME%.zip"
if errorlevel 1 goto failed
move /Y "%ARCHIVE%.part" "%ARCHIVE%" >nul
if errorlevel 1 goto failed
:verify
certutil.exe -hashfile "%ARCHIVE%" SHA256 > "%DOWNLOADS%\runtime-hash.txt"
if errorlevel 1 goto failed
findstr /I /X /C:"%HASH%" "%DOWNLOADS%\runtime-hash.txt" >nul
if errorlevel 1 goto checksum
if exist "%NODE%" goto engine
set "EXTRACT=%DOWNLOADS%\extract-%RANDOM%-%RANDOM%"
mkdir "%EXTRACT%"
if errorlevel 1 goto failed
tar.exe -xf "%ARCHIVE%" -C "%EXTRACT%"
if errorlevel 1 goto failed
if exist "%SATURDAY_ROOT%\runtime\%RUNTIME%" goto failed
move "%EXTRACT%\%RUNTIME%" "%SATURDAY_ROOT%\runtime\%RUNTIME%" >nul
if errorlevel 1 goto failed
rmdir "%EXTRACT%"
:engine
"%NODE%" -e "if(process.versions.node!=='24.21.0')process.exit(1)"
if errorlevel 1 goto failed
if exist "%~dp0scripts\install.mjs" goto local
"%NODE%" --input-type=module -e "const r=await fetch('https://api.github.com/repos/kennysantanu/saturday/commits/main',{headers:{'user-agent':'Saturday installer'},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('GitHub '+r.status);const j=await r.json();if(!/^[a-f0-9]{40}$/.test(j.sha))throw Error('Invalid commit');console.log(j.sha)" > "%DOWNLOADS%\commit.txt"
if errorlevel 1 goto failed
set /P "COMMIT=" < "%DOWNLOADS%\commit.txt"
set "ENGINE=%DOWNLOADS%\install-%COMMIT%.mjs"
curl.exe --proto "=https" --tlsv1.2 -fL --retry 2 -o "%ENGINE%.part" "https://raw.githubusercontent.com/kennysantanu/saturday/%COMMIT%/scripts/install.mjs"
if errorlevel 1 goto failed
move /Y "%ENGINE%.part" "%ENGINE%" >nul
if errorlevel 1 goto failed
"%NODE%" "%ENGINE%" --root "%SATURDAY_ROOT%" --bootstrap-commit "%COMMIT%" %*
if errorlevel 1 goto failed
goto success
:local
"%NODE%" "%~dp0scripts\install.mjs" --root "%SATURDAY_ROOT%" %*
if errorlevel 1 goto failed
:success
echo Saturday installation finished. Reopen with the Open Saturday desktop shortcut.
exit /B 0
:checksum
echo Runtime checksum failed. Remove only "%ARCHIVE%" and retry.
goto failed
:unsupported
echo Initial Windows installer target: Windows 11 x64. See README.
goto failed
:prerequisites
echo Missing Windows prerequisites: curl.exe, tar.exe or certutil.exe. See README. No PowerShell fallback is used.
:failed
echo Installation did not finish. Retry the same installer; do not delete your data.
echo Installation folder: "%SATURDAY_ROOT%"
echo Use Command Prompt to retain errors, or press a key to close this window.
if not defined SATURDAY_NONINTERACTIVE pause
exit /B 1
