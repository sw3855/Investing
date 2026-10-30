@echo off
rem S&P 500 + 러셀 1000 데이터 수집 후 원격 D1 적재 (작업 스케줄러 등록용)
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set LOG=%~dp0update_sp500.log

rem 로그가 1MB를 넘으면 이전 내용 삭제
if exist "%LOG%" for %%A in ("%LOG%") do if %%~zA GTR 1048576 del /q "%LOG%"

echo ===== %date% %time% 시작 =====
echo ===== %date% %time% 시작 ===== >> "%LOG%"
python build_sp500.py --workers 2 --upload --log "%LOG%"
set RC=%ERRORLEVEL%
echo ===== %date% %time% 종료 (exit %RC%) =====
echo ===== %date% %time% 종료 (exit %RC%) ===== >> "%LOG%"

exit /b %RC%
