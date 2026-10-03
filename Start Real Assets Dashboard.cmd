@echo off
rem Starts the Real Assets Dashboard at http://localhost:3100 and opens it in the browser.
rem Keep this window open while you use the dashboard; close it to stop the server.
cd /d "%~dp0"
title Real Assets Dashboard
call npm start
pause
