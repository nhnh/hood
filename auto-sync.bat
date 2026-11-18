@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

REM ============================================================
REM  HoOD: House of Official Documents - Auto Sync
REM  Pantau folder "Main", commit dan push ke GitHub bila berubah.
REM
REM  Sebelum jalankan, tetapkan token GitHub dalam environment:
REM    set HOOD_GH_TOKEN=ghp_xxxx...        (terminal semasa)
REM    setx HOOD_GH_TOKEN ghp_xxxx...      (kekal, terminal baru)
REM ============================================================

set "BRANCH=main"
set "WATCH=Main"
set "INTERVAL=5"
set "SNAP=%TEMP%\hood_main_snapshot.txt"
set "PREV=%TEMP%\hood_main_previous.txt"
set "PENDING=%TEMP%\hood_main_pending.txt"

title HoOD Auto Sync

echo.
echo   HoOD: House of Official Documents - Auto Sync
echo   Folder pantau : %CD%\%WATCH%
echo   Interval      : %INTERVAL% saat
echo   Tekan CTRL+C untuk berhenti.
echo.

if not defined HOOD_GH_TOKEN (
  echo [ERROR] HOOD_GH_TOKEN belum ditetapkan.
  echo Contoh:
  echo   set HOOD_GH_TOKEN=ghp_xxxx...
  exit /b 1
)

if not exist "%WATCH%\" (
  echo [ERROR] Folder "%WATCH%" tidak wujud.
  exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Folder ini bukan git repository.
  exit /b 1
)

call :snapshot > "%SNAP%"
copy /y "%SNAP%" "%PREV%" >nul
echo [%date% %time%] Pemantauan bermula.

:loop
if exist "%PENDING%" (
  echo [%date% %time%] Cuba push semula perubahan tertangguh...
  call :push
  if not errorlevel 1 (
    del "%PENDING%" >nul
    copy /y "%SNAP%" "%PREV%" >nul
    echo [%date% %time%] Push berjaya.
  ) else (
    echo [%date% %time%] Push masih gagal.
  )
)

timeout /t %INTERVAL% /nobreak >nul

call :snapshot > "%SNAP%"
fc /b "%PREV%" "%SNAP%" >nul
if errorlevel 1 (
  echo [%date% %time%] Perubahan dikesan dalam folder %WATCH%.

  git add -A -- "%WATCH%"
  git diff --cached --quiet
  if errorlevel 1 (
    for /f "delims=" %%a in ('powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd_HHmmss'"') do set "STAMP=%%a"
    git commit -m "Auto-update Main !STAMP!"
    if errorlevel 1 (
      echo [%date% %time%] Commit gagal.
    ) else (
      echo [%date% %time%] Commit berjaya.
      call :push
      if errorlevel 1 (
        echo ok > "%PENDING%"
        echo [%date% %time%] Push gagal. Akan cuba semula automatik.
      ) else (
        copy /y "%SNAP%" "%PREV%" >nul
        echo [%date% %time%] Push berjaya.
      )
    )
  ) else (
    copy /y "%SNAP%" "%PREV%" >nul
    echo [%date% %time%] Tiada perubahan kandungan untuk commit.
  )
)
goto :loop

:snapshot
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root=(Resolve-Path -LiteralPath '%WATCH%').Path; " ^
  "Get-ChildItem -LiteralPath $root -Recurse -Force -File | " ^
  "Sort-Object FullName | " ^
  "ForEach-Object { $rel=$_.FullName.Substring($root.Length).TrimStart('\','/'); " ^
  "$hash=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash; " ^
  "'{0}|{1}|{2}' -f $rel,$_.Length,$hash }"
exit /b

:push
git -c credential.helper= push "https://x-access-token:%HOOD_GH_TOKEN%@github.com/nhnh/hood.git" HEAD:%BRANCH%
exit /b
