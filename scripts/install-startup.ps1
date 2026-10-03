# Starts the Real Assets Dashboard automatically when this Windows user logs on
# (a per-user Scheduled Task; no administrator rights needed).
#   Install:    powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
#   Uninstall:  powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -Remove
param([switch]$Remove)

$name = 'Real Assets Dashboard'
if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host "Removed the '$name' startup task."
  exit 0
}

$root = Split-Path -Parent $PSScriptRoot
# --no-open: at logon the server starts quietly; open http://localhost:3100 when needed.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c cd /d `"$root`" && npm start -- --no-open > data\server.log 2>&1" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Local server for the Real Assets Dashboard (http://localhost:3100)' -Force | Out-Null
Write-Host "Installed: the dashboard will start at logon. Open http://localhost:3100 (log: data\server.log)."
