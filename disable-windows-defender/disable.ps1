# Stops Defender scanning what a build writes. -Wait first waits for a
# WinDefend that is still starting; the action runs that form detached.
param([switch]$Wait)

$ErrorActionPreference = 'Stop'

if ($Wait) {
	$svc = Get-Service -Name WinDefend
	$svc.WaitForStatus('Running', [TimeSpan]::FromMinutes(2))
}

# Exclusions first: these survive where the switches below do not.
foreach ($path in @($env:GITHUB_WORKSPACE, $env:RUNNER_TEMP, $env:TEMP, $env:TMP)) {
	if ($path) {
		try { Add-MpPreference -ExclusionPath $path -ErrorAction Stop }
		catch { Write-Host "exclusion $path not taken: $($_.Exception.Message)" }
	}
}

Set-MpPreference -DisableRealtimeMonitoring $true -ErrorAction Stop

# Splatted: "-$switch $true" reads the name as a positional value and takes nothing.
foreach ($switch in @('DisableBehaviorMonitoring', 'DisableIOAVProtection',
		'DisableScriptScanning', 'DisableArchiveScanning',
		'DisableScanningNetworkFiles')) {
	$one = @{$switch = $true}
	try { Set-MpPreference @one -ErrorAction Stop }
	catch { Write-Host "$switch not taken: $($_.Exception.Message)" }
}

# Read it back. Tamper protection lets the set succeed and keeps the scanner on.
$pref = Get-MpPreference
Write-Host "DisableRealtimeMonitoring: $($pref.DisableRealtimeMonitoring)"
Write-Host "DisableBehaviorMonitoring: $($pref.DisableBehaviorMonitoring)"
Write-Host "ExclusionPath: $($pref.ExclusionPath -join ', ')"
if (-not $pref.DisableRealtimeMonitoring) {
	throw "Defender still scans this build. Real-time monitoring stayed on, so this runner reads every file the build writes, and it decides what a freshly linked binary may do. Check whether tamper protection is on for this image."
}
