@echo off
title Account Manager
echo =========================================
echo Starting Account Manager Development Server
echo =========================================
echo.
echo Please wait while the server starts...
echo You can access the application at http://localhost:5173
echo.
cd /d "%~dp0"
call npm run dev
pause
