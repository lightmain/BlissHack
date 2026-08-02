[CmdletBinding()]
param(
    [string]$Source,
    [string]$Section,
    [int]$StartLine,
    [int]$EndLine,
    [switch]$ListSections
)

if ([string]::IsNullOrWhiteSpace($Source)) {
    $scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
    $Source = Join-Path $scriptRoot 'Guidebook-short.tex'
}

if (-not (Test-Path -LiteralPath $Source)) {
    Write-Error "Source file not found: $Source"
    exit 1
}

$lines = Get-Content -LiteralPath $Source -Encoding UTF8

function Convert-GuidebookTitle {
    param([string]$Title)

    $clean = $Title
    $clean = $clean -replace '\\texttt\{([^{}]*)\}', '$1'
    $clean = $clean -replace '\\textrm\{\\textmd\{([^{}]*)\}\}', '$1'
    $clean = $clean.Replace('\textasciicircum', '^')
    $clean = $clean.Replace('\textdollar', '$')
    $clean = $clean.Replace('\textunderscore', '_')
    $clean = $clean.Replace('\textasciigrave', '`')
    $clean = $clean.Replace('\textbackslash', '\')
    $clean = $clean.Replace('\%', '%')
    $clean = $clean.Replace('\#', '#')
    $clean = $clean.Replace('\&', '&')
    $clean = $clean.Replace('\$', '$')
    $clean = $clean -replace '[{}]', ''
    return $clean.Trim()
}

$headingPattern = '^\s*\\(section|subsection\*|subsubsection\*)\{(.+)\}\s*$'
$headings = @()
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $headingPattern) {
        $kind = $Matches[1]
        $titleRaw = $Matches[2]
        $level = switch ($kind) {
            'section' { 1 }
            'subsection*' { 2 }
            'subsubsection*' { 3 }
        }

        $headings += [pscustomobject]@{
            Line = $i + 1
            Level = $level
            Title = Convert-GuidebookTitle $titleRaw
            RawTitle = $titleRaw
        }
    }
}

if ($ListSections) {
    foreach ($heading in $headings) {
        '{0,5}  L{1}  {2}' -f $heading.Line, $heading.Level, $heading.Title
    }
    if (-not $Section -and -not $PSBoundParameters.ContainsKey('StartLine') -and -not $PSBoundParameters.ContainsKey('EndLine')) {
        exit 0
    }
}

if ($Section) {
    $match = $headings |
        Where-Object { $_.Title -like "*$Section*" -or $_.RawTitle -like "*$Section*" } |
        Select-Object -First 1

    if (-not $match) {
        Write-Error "No section title matched: $Section"
        exit 2
    }

    $next = $headings |
        Where-Object { $_.Line -gt $match.Line -and $_.Level -le $match.Level } |
        Select-Object -First 1

    $StartLine = $match.Line
    $EndLine = if ($next) { $next.Line - 1 } else { $lines.Count }
}

$hasStart = $PSBoundParameters.ContainsKey('StartLine') -or $Section
$hasEnd = $PSBoundParameters.ContainsKey('EndLine') -or $Section

if (-not $hasStart -or -not $hasEnd) {
    Write-Error 'Use -ListSections, -Section <title>, or -StartLine <n> -EndLine <n>.'
    exit 2
}

if ($StartLine -lt 1 -or $EndLine -lt $StartLine -or $EndLine -gt $lines.Count) {
    Write-Error "Invalid line range: $StartLine-$EndLine. File has $($lines.Count) lines."
    exit 3
}

for ($lineNumber = $StartLine; $lineNumber -le $EndLine; $lineNumber++) {
    '{0,5}: {1}' -f $lineNumber, $lines[$lineNumber - 1]
}