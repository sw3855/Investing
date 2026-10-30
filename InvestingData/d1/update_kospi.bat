@echo off
rem 코스피 보통주 데이터 수집(네이버 증권) 후 원격 D1 적재 (작업 스케줄러 등록용)
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set LOG=%~dp0update_kospi.log

rem 로그는 매 실행마다 덮어씀
echo ===== %date% %time% 시작 =====
echo ===== %date% %time% 시작 ===== > "%LOG%"
python build_kospi.py --workers 6 --upload --log "%LOG%"
set RC=%ERRORLEVEL%
echo ===== %date% %time% 종료 (exit %RC%) =====
echo ===== %date% %time% 종료 (exit %RC%) ===== >> "%LOG%"

exit /b %RC%
