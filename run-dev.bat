@echo off
setlocal
title Piano Puzzle Studio - Development

cd /d "%~dp0"

echo Starting Piano Puzzle Studio in development mode...
echo.
call npm.cmd run dev

echo.
echo Development process finished.
pause
