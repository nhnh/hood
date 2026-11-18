@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  HoOD: House of Official Documents - Sync Main (sekali jalan)
REM  Klik .bat ini -> detect perubahan dalam folder "Main",
REM  commit dan push ke GitHub, kemudian tamat.
REM
REM  Sebelum klik, tetapkan token GitHub dalam environment:
REM    setx HOOD_GH_TOKEN ghp_xxxx...      (kekal, untuk double-click)
REM ============================================================

set "BRANCH=main"
set "WATCH=Main"
set "PENDING=%TEMP%\hood_main_pending_push.txt"

title HoOD Sync Main

echo.
echo   HoOD: House of Official Documents
echo   Sync sekali: folder %WATCH% ke GitHub
echo.

if not defined HOOD_GH_TOKEN (
  echo [ERROR] HOOD_GH_TOKEN belum ditetapkan.
  echo Jalankan sekali sebelum klik .bat:
  echo   setx HOOD_GH_TOKEN ghp_xxxx...
  echo kemudian tutup dan buka semula terminal / File Explorer.
  goto :end
)

if not exist "%WATCH%\" (
  echo [ERROR] Folder "%WATCH%" tidak wujud.
  goto :end
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Folder ini bukan git repository.
  goto :end
)

REM Jika push sebelum ini gagal, cuba semula dulu.
if exist "%PENDING%" (
  echo Push tertangguh dikesan. Cuba push semula...
  call :push
  if not errorlevel 1 (
    del "%PENDING%" >nul
    echo Push tertangguh berjaya.
  ) else (
    echo Push tertangguh masih gagal. Token/network perlu disemak.
  )
  echo.
)

git add -A -- "%WATCH%"
git diff --cached --quiet
if errorlevel 1 (
  echo Perubahan dikesan dalam folder %WATCH%:
  git diff --cached --stat -- "%WATCH%"

  for /f "delims=" %%a in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HHmmss'"') do set "STAMP=%%a"

  git commit -m "Auto-update Main !STAMP!"
  if errorlevel 1 (
    echo [ERROR] Commit gagal.
  ) else (
    echo Commit berjaya.
    call :push
    if errorlevel 1 (
      echo ok > "%PENDING%"
      echo [ERROR] Push gagal. Klik .bat ini semula kemudian untuk cuba lagi.
    ) else (
      if exist "%PENDING%" del "%PENDING%" >nul
      echo Push berjaya.
    )
  )
) else (
  echo Tiada perubahan dalam folder %WATCH%. Tiada commit diperlukan.
)

:end
echo.
echo Selesai.
pause
exit /b

:push
git -c credential.helper= push "https://x-access-token:%HOOD_GH_TOKEN%@github.com/nhnh/hood.git" HEAD:%BRANCH%
exit /b
