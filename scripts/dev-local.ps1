# 本地开发：后台启动 next dev（127.0.0.1:3101），认证读取 .env.local。
# 用法：pwsh scripts/dev-local.ps1 [-Db data/ui-dev.db] [-Fresh]
# 不传 -Db 时使用 .env.local 中的 DB_PATH，不生成随机口令。
param(
  [string]$Db = '',
  [switch]$Fresh
)
$ErrorActionPreference = 'Stop'
if ($Fresh -and -not $Db) { throw '-Fresh 必须显式指定 -Db，避免误清理配置的数据库' }
if ($Fresh -and (Test-Path $Db)) { Remove-Item $Db -Force; Remove-Item "$Db-wal", "$Db-shm" -ErrorAction SilentlyContinue }
if ($Db) {
  $env:DB_PATH = $Db
  if (-not (Test-Path $Db)) { pnpm vl:init --db $Db --create | Out-Null; if ($LASTEXITCODE -ne 0) { throw '数据库初始化失败' } }
}
$log = "$env:TEMP\vl-dev.log"
# Windows 上 pnpm 是 cmd 脚本，需经 cmd.exe 启动；直接调用 next 的 JS 入口更稳定
$next = Join-Path (Get-Location) 'node_modules/next/dist/bin/next'
$process = Start-Process -FilePath 'node' -ArgumentList $next, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3101' -RedirectStandardOutput $log -RedirectStandardError "$log.err" -PassThru -WindowStyle Hidden
Set-Content -Path "$env:TEMP\vl-dev.pid" -Value $process.Id
Write-Output "已启动 next dev（PID $($process.Id)），日志：$log"
