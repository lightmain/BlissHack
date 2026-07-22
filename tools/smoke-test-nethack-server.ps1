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

function Assert-Condition {
    param(
        [Parameter(Mandatory = $true)] [bool]$Condition,
        [Parameter(Mandatory = $true)] [string]$Message
    )

    if (-not $Condition) {
        throw $Message
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
        -WorkingDirectory (Split-Path -Parent $serverPath) `
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

    $gameStarting = $null
    $gameStarted = $null
    $initialMap = $null
    $playerUpdate = $null
    $messageUpdate = $null
    $commandPrompt = $null

    for ($i = 0; $i -lt 300; $i++) {
        $event = Read-JsonLine -Reader $reader -Label "initial game event"
        switch ($event.type) {
            "game.starting" { $gameStarting = $event }
            "game.started" { $gameStarted = $event }
            "view.map" {
                if (@($event.payload.cells).Count -gt 0) {
                    $initialMap = $event
                }
            }
            "view.player" { $playerUpdate = $event }
            "view.messages" { $messageUpdate = $event }
            "prompt.command" { $commandPrompt = $event }
        }

        if ($null -ne $gameStarting -and $null -ne $gameStarted `
            -and $null -ne $initialMap -and $null -ne $playerUpdate `
            -and $null -ne $messageUpdate -and $null -ne $commandPrompt) {
            break
        }
    }

    Assert-JsonField -Json $gameStarting -Path "seq" -Expected 3
    Assert-JsonField -Json $gameStarted -Path "type" -Expected "game.started"
    Assert-JsonField -Json $initialMap -Path "payload.width" -Expected 80
    Assert-JsonField -Json $initialMap -Path "payload.height" -Expected 21
    Assert-Condition -Condition ($null -ne $playerUpdate) `
        -Message "Expected at least one view.player event."
    Assert-Condition -Condition ($null -ne $messageUpdate) `
        -Message "Expected at least one view.messages event."
    Assert-Condition -Condition ($null -ne $commandPrompt) `
        -Message "Expected NetHack to request a command."

    $cells = @($initialMap.payload.cells)
    $hero = $cells | Where-Object {
        $_.PSObject.Properties.Name -contains "char" -and $_.char -eq "@"
    } | Select-Object -First 1
    Assert-Condition -Condition ($null -ne $hero) `
        -Message "Expected the initial map to contain the hero."

    $directions = @(
        @{ Name = "west"; DeltaX = -1; DeltaY = 0 },
        @{ Name = "east"; DeltaX = 1; DeltaY = 0 },
        @{ Name = "north"; DeltaX = 0; DeltaY = -1 },
        @{ Name = "south"; DeltaX = 0; DeltaY = 1 },
        @{ Name = "northwest"; DeltaX = -1; DeltaY = -1 },
        @{ Name = "northeast"; DeltaX = 1; DeltaY = -1 },
        @{ Name = "southwest"; DeltaX = -1; DeltaY = 1 },
        @{ Name = "southeast"; DeltaX = 1; DeltaY = 1 }
    )

    $move = $null
    foreach ($candidate in $directions) {
        $targetX = [int]$hero.x + $candidate.DeltaX
        $targetY = [int]$hero.y + $candidate.DeltaY
        $target = $cells | Where-Object {
            $_.x -eq $targetX -and $_.y -eq $targetY `
                -and $_.PSObject.Properties.Name -contains "char" -and $_.char -eq "."
        } | Select-Object -First 1
        if ($null -ne $target) {
            $move = @{
                Direction = $candidate.Name
                TargetX = $targetX
                TargetY = $targetY
            }
            break
        }
    }
    Assert-Condition -Condition ($null -ne $move) `
        -Message "Expected an adjacent floor cell for the movement smoke test."

    Send-JsonLine -Writer $writer -Message @{
        type = "command.move"
        seq = 102
        payload = @{ direction = $move.Direction }
    }

    $moved = $false
    for ($i = 0; $i -lt 300; $i++) {
        $event = Read-JsonLine -Reader $reader -Label "movement event"
        if ($event.type -ne "view.map") {
            continue
        }
        $updatedHero = @($event.payload.cells) | Where-Object {
            $_.PSObject.Properties.Name -contains "char" -and $_.char -eq "@" `
                -and $_.x -eq $move.TargetX -and $_.y -eq $move.TargetY
        } | Select-Object -First 1
        if ($null -ne $updatedHero) {
            $moved = $true
            break
        }
    }
    Assert-Condition -Condition $moved `
        -Message "Expected command.move to update the hero position."

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
