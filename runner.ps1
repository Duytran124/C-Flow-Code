# Khoi dong "runner" Docker tren may ban de web cong khai (Render) dung khi may ban dang bat.
# Cach dung: mo terminal trong thu muc cpp-flow roi chay   .\runner.ps1
# Neu PowerShell bao bi chan script:   powershell -ExecutionPolicy Bypass -File .\runner.ps1

Set-Location $PSScriptRoot

if (-not $env:CPPFLOW_RUNNER_TOKEN) {
    $secure = Read-Host "Nhap mat khau runner (giong gia tri CPPFLOW_REMOTE_RUNNER_TOKEN tren Render)" -AsSecureString
    $env:CPPFLOW_RUNNER_TOKEN = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
}
$env:CPPFLOW_EXEC_MODE = "docker"

$dockerOk = $false
try {
    docker version --format "{{.Server.Version}}" *> $null
    $dockerOk = ($LASTEXITCODE -eq 0)
} catch {}
if (-not $dockerOk) {
    Write-Warning "Docker chua chay. Hay mo Docker Desktop, doi no chay xong roi chay lai script nay."
    exit 1
}

# Dung image rieng (gcc + gdb + ban bien dich san cua bits/stdc++.h) de chay code nhanh hon.
# Lan dau mat vai phut (tai gcc va bien dich), cac lan sau gan nhu tuc thi vi da co cache.
Write-Host "Dang chuan bi image Docker (lan dau co the mat vai phut)..."
docker build -q -f Dockerfile.debug -t cpp-flow-debug:local . *> $null
if ($LASTEXITCODE -eq 0) {
    $env:CPPFLOW_RUN_IMAGE = "cpp-flow-debug:local"
} else {
    Write-Warning "Khong dung duoc image rieng, se dung gcc:14 (chay duoc nhung cham hon)."
}

$python = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) { $python = "python" }

Write-Host "Runner dang chay tai http://127.0.0.1:8001 . Mo ngrok o terminal khac: ngrok http 8001"
& $python -m uvicorn app.main:app --host 127.0.0.1 --port 8001
