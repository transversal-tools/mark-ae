# Mark - Windows installer (run once, as your normal user, NOT as administrator).
#
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1
#
# Does: checks Node, turns on CEP debug mode for AE, links this folder into AE's
# extensions as "Mark", and registers the Mark MCP server with Claude Code if it is
# installed. Safe to run again.

$ErrorActionPreference = 'Stop'
$Repo = Split-Path -Parent $MyInvocation.MyCommand.Path

function Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "   OK  $t" -ForegroundColor Green }
function Warn($t) { Write-Host "   !!  $t" -ForegroundColor Yellow }

Step 'Tools'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Warn 'Node.js not found. Install it, open a NEW PowerShell, and run this again:'
    Write-Host '       winget install OpenJS.NodeJS.LTS'
    exit 1
}
Ok ("Node " + (& node --version))

Step 'CEP debug mode (lets AE load Mark, which is not a signed .zxp)'
foreach ($v in 9..13) {
    $key = "HKCU:\Software\Adobe\CSXS.$v"
    if (-not (Test-Path $key)) { New-Item -Path $key -Force | Out-Null }
    Set-ItemProperty -Path $key -Name PlayerDebugMode -Value '1' -Type String
}
Ok 'PlayerDebugMode = 1 for CSXS 9 to 13'

Step 'Mark panel'
$extDir = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
New-Item -ItemType Directory -Force -Path $extDir | Out-Null
$link = Join-Path $extDir 'Mark'
if (Test-Path $link) {
    $item = Get-Item $link -Force
    if ($item.LinkType) {
        cmd /c rmdir "$link" | Out-Null      # removes only the link, never the files it points to
    } else {
        Warn "$link already exists and is a real folder. Rename or remove it, then run this again."
        exit 1
    }
}
New-Item -ItemType Junction -Path $link -Target $Repo | Out-Null
Ok "Window > Extensions > Mark  ->  $Repo"

Step 'Claude Code: Mark MCP server'
$server = Join-Path $Repo 'mcp-server\server.js'
$claude = Get-Command claude -ErrorAction SilentlyContinue
if ($claude) {
    & claude mcp remove mark -s user 2>$null | Out-Null
    & claude mcp add -s user mark -- $node.Source $server
    Ok "mark -> $server"
} else {
    Warn 'Claude Code not found, skipped. The Chat tab needs it too. Install it, open a NEW PowerShell, run "claude" once to sign in, then run this again:'
    Write-Host '       irm https://claude.ai/install.ps1 | iex'
}

Step 'Codex (optional)'
Write-Host '   Add this to ~/.codex/config.toml:'
Write-Host ''
Write-Host '   [mcp_servers.mark]'
Write-Host ('   command = "' + ($node.Source -replace '\\','/') + '"')
Write-Host ('   args = ["' + ($server -replace '\\','/') + '"]')

Write-Host "`nDone. Restart After Effects and open Window > Extensions > Mark." -ForegroundColor Cyan
