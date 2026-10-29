# 本地开发：一次性测试库 + 随机口令，后台启动 next dev（127.0.0.1:3101）。
# 用法：pwsh scripts/dev-local.ps1 [-Db data/ui-dev.db] [-Fresh]
# 口令写入 $env:TEMP\vl-dev-token.txt，供浏览器自动化脚本读取；不会打印到终端。
param(
  [string]$Db = 'data/ui-dev.db',
  [switch]$Fresh
)
$ErrorActionPreference = 'Stop'
if ($Fresh -and (Test-Path $Db)) { Remove-Item $Db -Force; Remove-Item "$Db-wal", "$Db-shm" -ErrorAction SilentlyContinue }
$token = node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
Set-Content -Path "$env:TEMP\vl-dev-token.txt" -Value $token -NoNewline -Encoding utf8NoBOM
$env:VERIFIED_LEARNING_LOCAL = '1'
$env:VERIFIED_LEARNING_ACCESS_TOKEN = $token
$env:DB_PATH = $Db
if (-not (Test-Path $Db)) { pnpm vl:init --db $Db --create | Out-Null }
$log = "$env:TEMP\vl-dev.log"
# Windows 上 pnpm 是 cmd 脚本，需经 cmd.exe 启动；直接调用 next 的 JS 入口更稳定
$next = Join-Path (Get-Location) 'node_modules/next/dist/bin/next'
$process = Start-Process -FilePath 'node' -ArgumentList $next, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3101' -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
Set-Content -Path "$env:TEMP\vl-dev.pid" -Value $process.Id
Write-Output "已启动 next dev（PID $($process.Id)），日志：$log"
