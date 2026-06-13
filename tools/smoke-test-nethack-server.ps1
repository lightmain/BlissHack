[CmdletBinding()]
param(
    [string]$ServerExe = "binary\NetHackServer.exe",
    [Alias("Host")]
    [string]$ServerHost = "127.0.0.1",
    [int]$Port = 17777
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-JsonField {
    param(
        [Parameter(Mandatory = $true)] [object]$Json,
        [Parameter(Mandatory = $true)] [string]$Path,
        [Parameter(Mandatory = $true)] [object]$Expected
    )

    $current = $Json
    foreach ($part in $Path.Split(".")) {
        if ($null -eq $current -or -not ($current.PSObject.Properties.Name -contains $part)) {
            throw "Expected JSON field '$Path' to exist."
        }
        $current = $current.$part
    }

    if ($current -ne $Expected) {
        throw "Expected JSON field '$Path' to be '$Expected', got '$current'."
    }
}

function Read-JsonLine {
    param(
        [Parameter(Mandatory = $true)] [System.IO.StreamReader]$Reader,
        [Parameter(Mandatory = $true)] [string]$Label
    )

    $line = $Reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($line)) {
        throw "Expected $Label JSON line, got empty input."
    }

    try {
        return $line | ConvertFrom-Json
    } catch {
        throw "Failed to parse $Label JSON line '$line': $($_.Exception.Message)"
    }
}

function Send-JsonLine {
    param(
        [Parameter(Mandatory = $true)] [System.IO.StreamWriter]$Writer,
        [Parameter(Mandatory = $true)] [hashtable]$Message
    )

    $json = $Message | ConvertTo-Json -Compress -Depth 8
    $Writer.WriteLine($json)
}

$repoRoot = Split-Path -Parent $PSScriptRoot
if ([System.IO.Path]::IsPathRooted($ServerExe)) {
    $serverPath = $ServerExe
} else {
    $serverPath = Join-Path $repoRoot $ServerExe
}

if (-not (Test-Path -LiteralPath $serverPath -PathType Leaf)) {
    throw "Server executable not found: $serverPath"
}
$serverPath = (Resolve-Path -LiteralPath $serverPath).Path

$serverProcess = $null
$client = $null
$reader = $null
$writer = $null

try {
    $serverProcess = Start-Process `
        -FilePath $serverPath `
        -ArgumentList @("--host", $ServerHost, "--port", [string]$Port) `
        -WorkingDirectory $repoRoot `
        -WindowStyle Hidden `
        -PassThru

    $deadline = [DateTime]::UtcNow.AddSeconds(5)
    do {
        if ($serverProcess.HasExited) {
            throw "Server exited before accepting connections. Exit code: $($serverProcess.ExitCode)"
        }

        $client = [System.Net.Sockets.TcpClient]::new()
        try {
            $client.Connect($ServerHost, $Port)
            break
        } catch {
            $client.Close()
            $client = $null
            Start-Sleep -Milliseconds 100
        }
    } while ([DateTime]::UtcNow -lt $deadline)

    if ($null -eq $client -or -not $client.Connected) {
        throw "Timed out connecting to $ServerHost`:$Port."
    }

    $stream = $client.GetStream()
    $stream.ReadTimeout = 5000
    $stream.WriteTimeout = 5000

    $encoding = [System.Text.UTF8Encoding]::new($false)
    $reader = [System.IO.StreamReader]::new($stream, $encoding, $false, 4096, $true)
    $writer = [System.IO.StreamWriter]::new($stream, $encoding, 4096, $true)
    $writer.NewLine = "`n"
    $writer.AutoFlush = $true

    $welcome = Read-JsonLine -Reader $reader -Label "initial welcome"
    Assert-JsonField -Json $welcome -Path "type" -Expected "session.welcome"
    Assert-JsonField -Json $welcome -Path "seq" -Expected 1
    Assert-JsonField -Json $welcome -Path "payload.status" -Expected "connected"
    Assert-JsonField -Json $welcome -Path "payload.server" -Expected "NetHackServer"
    Assert-JsonField -Json $welcome -Path "payload.protocol_version" -Expected 1
    Assert-JsonField -Json $welcome -Path "payload.transport" -Expected "ndjson"

    Send-JsonLine -Writer $writer -Message @{
        type = "session.hello"
        seq = 100
        payload = @{
            client = "godothack-smoke-test"
            protocol_version = 1
        }
    }

    $hello = Read-JsonLine -Reader $reader -Label "session.hello response"
    Assert-JsonField -Json $hello -Path "type" -Expected "session.welcome"
    Assert-JsonField -Json $hello -Path "seq" -Expected 2
    Assert-JsonField -Json $hello -Path "payload.status" -Expected "ready"
    Assert-JsonField -Json $hello -Path "payload.client_seq" -Expected 100
    Assert-JsonField -Json $hello -Path "payload.client" -Expected "godothack-smoke-test"
    Assert-JsonField -Json $hello -Path "payload.client_protocol_version" -Expected 1

    Send-JsonLine -Writer $writer -Message @{
        type = "game.start"
        seq = 101
        payload = @{}
    }

    $notImplemented = Read-JsonLine -Reader $reader -Label "game.start response"
    Assert-JsonField -Json $notImplemented -Path "type" -Expected "game.error"
    Assert-JsonField -Json $notImplemented -Path "seq" -Expected 3
    Assert-JsonField -Json $notImplemented -Path "payload.code" -Expected "not_implemented"
    Assert-JsonField -Json $notImplemented -Path "payload.recoverable" -Expected $true
    Assert-JsonField -Json $notImplemented -Path "payload.client_seq" -Expected 101

    "PASS"
} finally {
    if ($null -ne $writer) {
        $writer.Dispose()
    }
    if ($null -ne $reader) {
        $reader.Dispose()
    }
    if ($null -ne $client) {
        $client.Close()
    }
    if ($null -ne $serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
        $serverProcess.WaitForExit(5000) | Out-Null
    }
}
