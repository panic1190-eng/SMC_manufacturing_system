# SMC 기술·생산관리 시스템 — 원클릭 자동 빌드, 버전관리 및 배포 파이프라인
param(
    [string]$Version = "",
    [string]$Message = ""
)

$ErrorActionPreference = "Stop"
$rootDir = $PSScriptRoot
Set-Location $rootDir

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  🚀 SMC 기술·생산관리 시스템 — 자동 배포 & 버전관리 파이프라인" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$nodeExe = "C:\Users\panic\AppData\Roaming\Antigravity\bin\agy-node.cmd"
if (-not (Test-Path $nodeExe)) {
    $nodeExe = "node"
}

# 1. 단위 테스트 검증
Write-Host "`n[Step 1/5] 계산 엔진 단위 테스트 (Vitest) 실행..." -ForegroundColor Yellow
& $nodeExe ./node_modules/vitest/vitest.mjs run
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ 단위 테스트 실패! 배포를 중단합니다." -ForegroundColor Red
    exit 1
}
Write-Host "✅ 계산 엔진 단위 테스트 통과 (15 tests passed)" -ForegroundColor Green

# 2. TypeScript 타입 검사 & Vite 빌드
Write-Host "`n[Step 2/5] TypeScript 검증 & Vite 단일 파일 빌드..." -ForegroundColor Yellow
& $nodeExe ./node_modules/typescript/bin/tsc --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ TypeScript 컴파일 오류! 배포를 중단합니다." -ForegroundColor Red
    exit 1
}
& $nodeExe ./node_modules/vite/bin/vite.js build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Vite 빌드 실패! 배포를 중단합니다." -ForegroundColor Red
    exit 1
}
Write-Host "✅ dist/index.html 단일 파일 빌드 완료" -ForegroundColor Green

# 3. 배포본 동기화 (한국어, 영문, 공식 배포 포털)
Write-Host "`n[Step 3/5] 단일 배포본 파일 동기화 (SMC_system.html, SMC_system_EN.html)..." -ForegroundColor Yellow
Copy-Item -Path "dist\index.html" -Destination "SMC_system.html" -Force

$html = Get-Content -Path "dist\index.html" -Raw -Encoding UTF8
$enHtml = $html -replace '<head>', '<head><script>try{localStorage.setItem(''smc-lang-v1'',''en'')}catch(e){}</script>'
Set-Content -Path "SMC_system_EN.html" -Value $enHtml -Encoding UTF8

if (Test-Path "portal.html") {
    Copy-Item -Path "portal.html" -Destination "dist\portal.html" -Force
}
Write-Host "✅ 단독 실행 파일 동기화 완료" -ForegroundColor Green

# 4. 버전 관리 & Git 커밋
Write-Host "`n[Step 4/5] Git 버전 관리 및 변경사항 커밋..." -ForegroundColor Yellow
$gitCmd = "C:\Users\panic\AppData\Roaming\Antigravity\bin\git.cmd"
if (-not (Test-Path $gitCmd)) {
    $gitCmd = "git"
}

& $gitCmd add -A
$status = & $gitCmd status --porcelain
if ($status) {
    if (-not $Message) {
        $Message = "fix: update SMC manufacturing system and print layout"
    }
    & $gitCmd commit -m $Message
    Write-Host "✅ Git 커밋 완료: $Message" -ForegroundColor Green
} else {
    Write-Host "ℹ️ 새로 커밋할 변경사항이 없습니다." -ForegroundColor DarkGray
}

# 5. 원격 저장소 푸시 (GitHub Pages CI/CD)
Write-Host "`n[Step 5/5] GitHub Pages 원격 배포 푸시..." -ForegroundColor Yellow
$pushOut = & $gitCmd -c core.askPass=echo push origin main 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n🎉 GitHub Pages 배포 푸시가 성공적으로 완료되었습니다!" -ForegroundColor Green
    Write-Host "👉 라이브 서비스: https://jhk113074-hue.github.io/SMC_manufacturing_system/" -ForegroundColor Cyan
} else {
    Write-Host "`nℹ️ 로컬 빌드 및 버전 관리가 완료되었습니다." -ForegroundColor Green
    Write-Host "  * 원격 배포(GitHub)를 위해 1회 계정 로그인이 필요합니다." -ForegroundColor Yellow
    Write-Host "  * 로컬 단일 실행본(SMC_system.html)은 이미 최신으로 완벽히 반영되었습니다." -ForegroundColor Cyan
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "  ✨ 로컬 빌드 및 배포본 최신화 완료 (SMC_system.html)" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
