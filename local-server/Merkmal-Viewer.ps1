# Requires Windows PowerShell 5.1 for the settings dialog and DPAPI.
# Double-click Start-Merkmal-Viewer.cmd. Do not pass tokens on the command line.
param(
    [switch]$SelfTest,
    [int]$Port = 8765,
    [string]$MockPath = ""
)

$ErrorActionPreference = "Stop"
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $ScriptDir
$SettingsPath = Join-Path $ScriptDir "settings.json"

function ConvertTo-JsonString {
    param([string]$Text)
    if ($null -eq $Text) { $Text = "" }
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    foreach ($ch in $Text.ToCharArray()) {
        $code = [int]$ch
        switch ($code) {
            34 { [void]$builder.Append('\"') }
            92 { [void]$builder.Append('\\') }
            8 { [void]$builder.Append('\b') }
            12 { [void]$builder.Append('\f') }
            10 { [void]$builder.Append('\n') }
            13 { [void]$builder.Append('\r') }
            9 { [void]$builder.Append('\t') }
            default {
                if ($code -lt 32) {
                    [void]$builder.Append('\u{0:x4}' -f $code)
                } else {
                    [void]$builder.Append($ch)
                }
            }
        }
    }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function ConvertTo-JsonNumber {
    param($Value)
    return $Value.ToString("G15", [Globalization.CultureInfo]::InvariantCulture)
}

function ConvertTo-JsonText {
    param($Value)
    if ($null -eq $Value) { return "null" }
    if ($Value -is [bool]) {
        if ($Value) { return "true" }
        return "false"
    }
    if ($Value -is [string]) { return (ConvertTo-JsonString $Value) }
    if ($Value -is [byte] -or $Value -is [int16] -or $Value -is [int] -or $Value -is [int64]) {
        return (ConvertTo-JsonNumber $Value)
    }
    if ($Value -is [decimal] -or $Value -is [double] -or $Value -is [single]) {
        return (ConvertTo-JsonNumber $Value)
    }
    if ($Value -is [System.Collections.IDictionary]) {
        $parts = @()
        foreach ($key in @($Value.Keys)) {
            $parts += ((ConvertTo-JsonString ([string]$key)) + ":" + (ConvertTo-JsonText $Value[$key]))
        }
        return "{" + ($parts -join ",") + "}"
    }
    if ($Value -is [System.Collections.IEnumerable]) {
        $parts = @()
        foreach ($item in $Value) {
            $parts += (ConvertTo-JsonText $item)
        }
        return "[" + ($parts -join ",") + "]"
    }
    return (ConvertTo-JsonString ([string]$Value))
}

function Get-ProjectFilter {
    param([string]$Project)
    $trim = $Project.Trim()
    if ($trim -match "^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$") {
        return "inspectorProject/id eq $trim"
    }
    $escaped = $trim.Replace("'", "''")
    return "InspectorProject/name eq '$escaped'"
}

function Get-ApiRoot {
    param([string]$ServerUrl)
    $trim = $ServerUrl.Trim().TrimEnd("/")
    if ($trim -match "/dataloopcore/api/metrology$") { return $trim }
    if ($trim -match "/dataloopcore/api/metrology/v2$") { return $trim.Substring(0, $trim.Length - 3) }
    return "$trim/dataloopcore/api/metrology"
}

function Get-LengthUnit {
    param([string]$Length)
    switch ($Length) {
        "Millimeters" { return "mm" }
        "Centimeters" { return "cm" }
        "Meters" { return "m" }
        "Microns" { return "um" }
        "Inches" { return "in" }
        "Feet" { return "ft" }
        default { return "mm" }
    }
}

function Get-ControlLimits {
    param($Control)
    $low = 0.0
    $up = 0.0
    if ($null -ne $Control.tolerance) {
        $low = [double]$Control.tolerance.low
        $up = [double]$Control.tolerance.up
    }
    if ($null -eq $Control.nominal) {
        return @{ nominal = 0.0; usl = $up; lsl = $low }
    }
    $nominal = [double]$Control.nominal
    return @{ nominal = $nominal; usl = ($nominal + $up); lsl = ($nominal + $low) }
}

function Get-CharacteristicId {
    param($Control)
    $objectName = [string]$Control.objectName
    $name = [string]$Control.name
    if ([string]::IsNullOrWhiteSpace($objectName)) { return $name }
    return "$objectName / $name"
}

function Test-HasKey {
    param($Table, [string]$Key)
    foreach ($existing in @($Table.Keys)) {
        if ([string]$existing -eq $Key) { return $true }
    }
    return $false
}

function Get-ODataRows {
    param($Payload)
    if ($null -eq $Payload) { return @() }
    $rows = $Payload.value
    if ($null -eq $rows) { return @() }
    return @($rows)
}

function Invoke-ApiGet {
    param([string]$Uri, [string]$Token)
    $headers = @{
        Authorization = "Bearer $Token"
        Accept = "application/json"
    }
    $payload = Invoke-RestMethod -Method Get -Uri $Uri -Headers $headers
    $rows = @(Get-ODataRows $payload)
    $guard = 0
    while ($payload.'@odata.nextLink' -and $guard -lt 20) {
        $guard += 1
        $payload = Invoke-RestMethod -Method Get -Uri ([string]$payload.'@odata.nextLink') -Headers $headers
        $rows += @(Get-ODataRows $payload)
    }
    return @($rows)
}

function Convert-PieceCacheToDocument {
    param($Pieces, $Cache, [string]$ProjectLabel, [int]$PollSeconds)
    $Pieces = @($Pieces)
    $ordered = @()
    for ($i = $Pieces.Count - 1; $i -ge 0; $i--) {
        $ordered += $Pieces[$i]
    }
    $byId = @{}
    $featureNames = @{}
    foreach ($piece in $ordered) {
        $pieceId = [string]$piece.id
        if (-not (Test-HasKey $Cache $pieceId)) { continue }
        $entry = $Cache[$pieceId]
        foreach ($feature in @($entry.features)) {
            $featureName = [string]$feature.name
            if ($featureName -and -not (Test-HasKey $featureNames $featureName)) {
                $featureNames[$featureName] = [string]$feature.type
            }
        }
        foreach ($control in @($entry.controls)) {
            $id = Get-CharacteristicId $control
            if (-not (Test-HasKey $byId $id)) {
                $limits = Get-ControlLimits $control
                $byId[$id] = @{
                    id = $id
                    name = $id
                    objectName = [string]$control.objectName
                    controlName = [string]$control.name
                    displayName = [string]$control.displayName
                    type = [string]$control.type
                    unit = (Get-LengthUnit ([string]$control.units.length))
                    nominal = $limits.nominal
                    usl = $limits.usl
                    lsl = $limits.lsl
                    measurements = @()
                }
            }
            if ($null -eq $control.measured) { continue }
            $stamp = $null
            if ($control.measurementDateTime) { $stamp = [string]$control.measurementDateTime }
            elseif ($piece.creationDateUser) { $stamp = [string]$piece.creationDateUser }
            $measurement = @{
                pieceId = $pieceId
                pieceName = [string]$piece.name
                value = [double]$control.measured
                timestamp = $stamp
                test = $null
            }
            if ($control.test) { $measurement.test = [string]$control.test }
            $byId[$id].measurements = @($byId[$id].measurements) + @($measurement)
        }
    }
    $characteristics = @()
    foreach ($key in @($byId.Keys)) { $characteristics += $byId[$key] }
    $piecesOut = @()
    foreach ($piece in $ordered) {
        $piecesOut += @{
            id = [string]$piece.id
            name = [string]$piece.name
            timestamp = [string]$piece.creationDateUser
        }
    }
    $features = @()
    foreach ($name in @($featureNames.Keys)) {
        $features += @{ name = $name; type = [string]$featureNames[$name] }
    }
    return @{
        schemaVersion = 1
        source = "live"
        refreshSeconds = $PollSeconds
        fetchedAt = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
        part = @{ id = $ProjectLabel; name = $ProjectLabel }
        pieces = @($piecesOut)
        features = @($features)
        characteristics = @($characteristics)
    }
}

function Update-LiveCache {
    param([string]$ApiRoot, [string]$Token, [string]$Project, [int]$LastPieces, $Cache)
    $filter = [Uri]::EscapeDataString((Get-ProjectFilter $Project))
    $select = [Uri]::EscapeDataString("id,name,creationDateUser")
    $pieceUri = "$ApiRoot/v2/InspectorPieces?`$filter=$filter&`$orderby=creationDateUser%20desc&`$top=$LastPieces&`$select=$select"
    $pieces = @(Invoke-ApiGet -Uri $pieceUri -Token $Token)
    foreach ($piece in $pieces) {
        $pieceId = [string]$piece.id
        if (Test-HasKey $Cache $pieceId) { continue }
        $pieceFilter = [Uri]::EscapeDataString("inspectorPiece/id eq $pieceId")
        $controls = @(Invoke-ApiGet -Uri "$ApiRoot/v2/Controls?`$filter=$pieceFilter" -Token $Token)
        $objects = @(Invoke-ApiGet -Uri "$ApiRoot/v2/MeasurementObjects?`$filter=$pieceFilter" -Token $Token)
        $Cache[$pieceId] = @{ controls = @($controls); features = @($objects) }
    }
    return @($pieces)
}

function Read-SettingsFile {
    if (-not (Test-Path -LiteralPath $SettingsPath)) { return $null }
    $raw = Get-Content -LiteralPath $SettingsPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
    return ($raw | ConvertFrom-Json)
}

function Protect-TokenText {
    param([string]$Plain)
    if ([string]::IsNullOrEmpty($Plain)) { return "" }
    $secure = ConvertTo-SecureString -String $Plain -AsPlainText -Force
    return (ConvertFrom-SecureString -SecureString $secure)
}

function Unprotect-TokenText {
    param([string]$ProtectedText)
    if ([string]::IsNullOrWhiteSpace($ProtectedText)) { return "" }
    $secure = ConvertTo-SecureString -String $ProtectedText
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Save-SettingsFile {
    param($Settings)
    $json = ConvertTo-JsonText $Settings
    [IO.File]::WriteAllText($SettingsPath, $json, (New-Object System.Text.UTF8Encoding $false))
}

function Show-SettingsDialog {
    param($Current, [string]$CurrentToken)
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Merkmal-Viewer"
    $form.FormBorderStyle = "FixedDialog"
    $form.StartPosition = "CenterScreen"
    $form.MaximizeBox = $false
    $form.MinimizeBox = $false
    $form.ClientSize = New-Object System.Drawing.Size(460, 280)
    $form.Font = New-Object System.Drawing.Font("Segoe UI", 9)

    function Add-Row {
        param($LabelText, $Top, $Control)
        $label = New-Object System.Windows.Forms.Label
        $label.Text = $LabelText
        $label.Left = 12
        $label.Top = $Top
        $label.Width = 430
        $label.Height = 18
        $Control.Left = 12
        $Control.Top = $Top + 18
        $Control.Width = 430
        $form.Controls.Add($label)
        $form.Controls.Add($Control)
    }

    $server = New-Object System.Windows.Forms.TextBox
    $server.Text = [string]$Current.serverUrl
    Add-Row "Server-URL (leer lassen, bis der Host bekannt ist)" 8 $server

    $project = New-Object System.Windows.Forms.TextBox
    $project.Text = [string]$Current.project
    Add-Row "Projekt-ID oder Projektname" 62 $project

    $token = New-Object System.Windows.Forms.TextBox
    $token.UseSystemPasswordChar = $true
    $token.Text = $CurrentToken
    Add-Row "Zugriffstoken (wird mit DPAPI geschuetzt gespeichert)" 116 $token

    $poll = New-Object System.Windows.Forms.NumericUpDown
    $poll.Minimum = 5
    $poll.Maximum = 3600
    $poll.Value = [decimal]([int]$Current.pollSeconds)
    $poll.Width = 100
    $last = New-Object System.Windows.Forms.NumericUpDown
    $last.Minimum = 1
    $last.Maximum = 500
    $last.Value = [decimal]([int]$Current.lastPieces)
    $last.Left = 230
    $last.Top = 188
    $last.Width = 100
    $poll.Left = 12
    $poll.Top = 188
    $pollLabel = New-Object System.Windows.Forms.Label
    $pollLabel.Text = "Intervall (s)"
    $pollLabel.Left = 12
    $pollLabel.Top = 170
    $pollLabel.Width = 120
    $lastLabel = New-Object System.Windows.Forms.Label
    $lastLabel.Text = "Letzte Teile"
    $lastLabel.Left = 230
    $lastLabel.Top = 170
    $lastLabel.Width = 120
    $form.Controls.Add($pollLabel)
    $form.Controls.Add($poll)
    $form.Controls.Add($lastLabel)
    $form.Controls.Add($last)

    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = "Start"
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $ok.Left = 250
    $ok.Top = 236
    $ok.Width = 90
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = "Abbrechen"
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $cancel.Left = 350
    $cancel.Top = 236
    $cancel.Width = 90
    $form.Controls.Add($ok)
    $form.Controls.Add($cancel)
    $form.AcceptButton = $ok
    $form.CancelButton = $cancel

    $result = $form.ShowDialog()
    if ($result -ne [System.Windows.Forms.DialogResult]::OK) { return $null }
    return @{
        serverUrl = $server.Text.Trim()
        project = $project.Text.Trim()
        token = $token.Text
        pollSeconds = [int]$poll.Value
        lastPieces = [int]$last.Value
    }
}

function Get-ContentType {
    param([string]$Path)
    switch ([IO.Path]::GetExtension($Path).ToLowerInvariant()) {
        ".html" { return "text/html; charset=utf-8" }
        ".css" { return "text/css; charset=utf-8" }
        ".js" { return "text/javascript; charset=utf-8" }
        ".json" { return "application/json; charset=utf-8" }
        ".svg" { return "image/svg+xml" }
        ".obj" { return "text/plain; charset=utf-8" }
        ".png" { return "image/png" }
        default { return "application/octet-stream" }
    }
}

function Resolve-RepoFile {
    param([string]$AbsolutePath)
    $relative = [Uri]::UnescapeDataString($AbsolutePath)
    if ([string]::IsNullOrWhiteSpace($relative) -or $relative -eq "/") { $relative = "index.html" }
    $relative = $relative.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
    if ($relative.Contains("..")) { return $null }
    $root = [IO.Path]::GetFullPath($RepoRoot)
    if (-not $root.EndsWith([IO.Path]::DirectorySeparatorChar)) {
        $root = $root + [IO.Path]::DirectorySeparatorChar
    }
    $full = [IO.Path]::GetFullPath((Join-Path $RepoRoot $relative))
    if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $null }
    return $full
}

function Write-ResponseBytes {
    param($Response, [int]$Status, [byte[]]$Bytes, [string]$ContentType)
    $Response.StatusCode = $Status
    $Response.ContentType = $ContentType
    $Response.ContentLength64 = $Bytes.Length
    $Response.Headers["Cache-Control"] = "no-store"
    $Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Response.OutputStream.Close()
}

function Write-ResponseText {
    param($Response, [int]$Status, [string]$Text, [string]$ContentType)
    $bytes = [Text.Encoding]::UTF8.GetBytes($Text)
    Write-ResponseBytes -Response $Response -Status $Status -Bytes $bytes -ContentType $ContentType
}

function Start-ViewerServer {
    param([string]$Prefix, $State)
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($Prefix)
    $listener.Start()
    Write-Host "Merkmal-Viewer: $Prefix"
    Write-Host "Einbindung: <iframe src=`"$Prefix`" title=`"Milkyway Merkmale`"></iframe>"
    $nextPoll = [DateTime]::UtcNow
    while ($listener.IsListening) {
        $async = $listener.BeginGetContext($null, $null)
        while (-not $async.AsyncWaitHandle.WaitOne(400)) {
            if ([DateTime]::UtcNow -ge $nextPoll) {
                try {
                    $pieces = Update-LiveCache -ApiRoot $State.ApiRoot -Token $State.Token -Project $State.Project -LastPieces $State.LastPieces -Cache $State.Cache
                    $doc = Convert-PieceCacheToDocument -Pieces $pieces -Cache $State.Cache -ProjectLabel $State.Project -PollSeconds $State.PollSeconds
                    $State.LiveJson = ConvertTo-JsonText $doc
                    $State.LiveError = ""
                } catch {
                    $State.LiveError = $_.Exception.Message
                    Write-Host ("Datenabruf fehlgeschlagen: " + $State.LiveError)
                }
                $nextPoll = [DateTime]::UtcNow.AddSeconds($State.PollSeconds)
            }
        }
        $context = $listener.EndGetContext($async)
        try {
            $path = $context.Request.Url.AbsolutePath
            if ($context.Request.HttpMethod -ne "GET" -and $context.Request.HttpMethod -ne "HEAD") {
                Write-ResponseText -Response $context.Response -Status 405 -Text "GET only" -ContentType "text/plain; charset=utf-8"
                continue
            }
            if ($path -eq "/data/live-measurements.json") {
                if ([string]::IsNullOrEmpty($State.LiveJson)) {
                    Write-ResponseText -Response $context.Response -Status 404 -Text '{"error":"noch keine Live-Daten"}' -ContentType "application/json; charset=utf-8"
                } else {
                    Write-ResponseText -Response $context.Response -Status 200 -Text $State.LiveJson -ContentType "application/json; charset=utf-8"
                }
                continue
            }
            $file = Resolve-RepoFile $path
            if ($null -eq $file -or -not (Test-Path -LiteralPath $file -PathType Leaf)) {
                Write-ResponseText -Response $context.Response -Status 404 -Text "nicht gefunden" -ContentType "text/plain; charset=utf-8"
                continue
            }
            $bytes = [IO.File]::ReadAllBytes($file)
            if ($context.Request.HttpMethod -eq "HEAD") {
                $context.Response.StatusCode = 200
                $context.Response.ContentType = Get-ContentType $file
                $context.Response.ContentLength64 = $bytes.Length
                $context.Response.OutputStream.Close()
            } else {
                Write-ResponseBytes -Response $context.Response -Status 200 -Bytes $bytes -ContentType (Get-ContentType $file)
            }
        } catch {
            try {
                Write-ResponseText -Response $context.Response -Status 500 -Text "Fehler" -ContentType "text/plain; charset=utf-8"
            } catch {
            }
        }
    }
}

function New-DefaultSettings {
    return @{
        serverUrl = ""
        project = ""
        tokenProtected = ""
        pollSeconds = 60
        lastPieces = 50
    }
}

function Start-Main {
    $loaded = Read-SettingsFile
    $settings = New-DefaultSettings
    if ($loaded) {
        if ($loaded.serverUrl) { $settings.serverUrl = [string]$loaded.serverUrl }
        if ($loaded.project) { $settings.project = [string]$loaded.project }
        if ($loaded.tokenProtected) { $settings.tokenProtected = [string]$loaded.tokenProtected }
        if ($loaded.pollSeconds) { $settings.pollSeconds = [int]$loaded.pollSeconds }
        if ($loaded.lastPieces) { $settings.lastPieces = [int]$loaded.lastPieces }
    }
    $token = ""
    if ($settings.tokenProtected) {
        try { $token = Unprotect-TokenText $settings.tokenProtected } catch { $token = "" }
    }
    $needsDialog = [string]::IsNullOrWhiteSpace($settings.serverUrl) -or [string]::IsNullOrWhiteSpace($settings.project) -or [string]::IsNullOrWhiteSpace($token)
    if ($needsDialog) {
        if ($env:OS -ne "Windows_NT") {
            Write-Host "Einstellungen fehlen. Auf Windows den Dialog per Doppelklick auf Start-Merkmal-Viewer.cmd oeffnen."
            exit 1
        }
        $entered = Show-SettingsDialog -Current $settings -CurrentToken $token
        if ($null -eq $entered) { exit 1 }
        $protected = ""
        if (-not [string]::IsNullOrEmpty($entered.token)) {
            $protected = Protect-TokenText $entered.token
        }
        $settings = @{
            serverUrl = $entered.serverUrl
            project = $entered.project
            tokenProtected = $protected
            pollSeconds = $entered.pollSeconds
            lastPieces = $entered.lastPieces
        }
        Save-SettingsFile $settings
        $token = $entered.token
    }
    if ([string]::IsNullOrWhiteSpace($settings.serverUrl) -or [string]::IsNullOrWhiteSpace($token)) {
        Write-Host "Server-URL und Token werden benoetigt."
        exit 1
    }
    $state = @{
        ApiRoot = (Get-ApiRoot $settings.serverUrl)
        Token = $token
        Project = [string]$settings.project
        PollSeconds = [int]$settings.pollSeconds
        LastPieces = [int]$settings.lastPieces
        Cache = @{}
        LiveJson = ""
        LiveError = ""
    }
    $prefix = "http://localhost:$Port/"
    Start-ViewerServer -Prefix $prefix -State $state
}

function Invoke-SelfTest {
    $mockFile = $MockPath
    if ([string]::IsNullOrWhiteSpace($mockFile)) {
        $mockFile = Join-Path $ScriptDir "mock/api-sample.json"
    }
    $mock = Get-Content -LiteralPath $mockFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $cache = @{}
    foreach ($piece in @($mock.pieces.value)) {
        $id = [string]$piece.id
        $controls = @()
        $features = @()
        if ($mock.controls.PSObject.Properties.Name -contains $id) {
            $controls = @(Get-ODataRows $mock.controls.$id)
        }
        if ($mock.objects.PSObject.Properties.Name -contains $id) {
            $features = @(Get-ODataRows $mock.objects.$id)
        }
        $cache[$id] = @{ controls = $controls; features = $features }
    }
    $doc = Convert-PieceCacheToDocument -Pieces @(Get-ODataRows $mock.pieces) -Cache $cache -ProjectLabel "synthetic" -PollSeconds 60
    $json = ConvertTo-JsonText $doc
    if ($json -notmatch '"characteristics"\s*:\s*\[') { throw "characteristics muss ein JSON-Array sein" }
    $parsed = $json | ConvertFrom-Json
    $byName = @{}
    foreach ($item in @($parsed.characteristics)) { $byName[$item.id] = $item }
    $length = $byName["Langloch 1 / Mating Length 1"]
    if ($null -eq $length) { throw "Merkmal Langloch fehlt" }
    if ([math]::Abs([double]$length.nominal - 180.0) -gt 0.0001) { throw "nominal falsch" }
    if ([math]::Abs([double]$length.usl - 180.45) -gt 0.0001) { throw "USL muss nominal+up sein" }
    if ([math]::Abs([double]$length.lsl - 180.0) -gt 0.0001) { throw "LSL muss nominal+low sein" }
    $values = @($length.measurements)
    if ($values.Count -ne 2) { throw "zwei Istwerte erwartet" }
    if ($values[0].pieceName -ne "piece_001") { throw "aeltestes Teil zuerst" }
    if ([math]::Abs([double]$values[0].value - 180.1) -gt 0.0001) { throw "erster Istwert falsch" }
    $position = $byName["Kreis 1 / Position 1"]
    if ([double]$position.nominal -ne 0) { throw "ohne Nennwert gilt Abweichung 0" }
    if ([math]::Abs([double]$position.usl - 0.2) -gt 0.0001) { throw "USL der Lage falsch" }
    if ([math]::Abs([double]$position.lsl - 0.0) -gt 0.0001) { throw "LSL der Lage falsch" }
    $wall = $byName["Wandstaerke / Length"]
    if (@($wall.measurements).Count -ne 0) { throw "fehlender Messwert darf kein Istwert werden" }
    $featureNames = @()
    foreach ($feature in @($parsed.features)) { $featureNames += $feature.name }
    if ($featureNames -notcontains "Langloch 1") { throw "Merkmalsobjekt fehlt" }
    $one = ConvertTo-JsonText @{ characteristics = @(@{ id = "nur-eins" }) }
    if ($one -notmatch '"characteristics":\[') { throw "Einzelnes Array wurde nicht als Array geschrieben" }
    if ((Get-ProjectFilter "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") -ne "inspectorProject/id eq aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee") {
        throw "GUID-Filter falsch"
    }
    if ((Get-ProjectFilter "Linie A") -ne "InspectorProject/name eq 'Linie A'") { throw "Namensfilter falsch" }

    $mockRoot = "http://127.0.0.1:8766/"
    $mockPower = Start-ListenerRunspace -ScriptBlock {
        param($Prefix, $MockFile)
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($Prefix)
        $listener.Start()
        $mock = Get-Content -LiteralPath $MockFile -Raw -Encoding UTF8 | ConvertFrom-Json
        while ($listener.IsListening) {
            $context = $null
            try { $context = $listener.GetContext() } catch { break }
            $path = $context.Request.Url.AbsolutePath
            $query = [Uri]::UnescapeDataString($context.Request.Url.Query)
            $body = '{"value":[]}'
            if ($path -eq "/stop") { $body = "stop"; $listener.Stop() }
            elseif ($path -like "*/InspectorPieces") { $body = ($mock.pieces | ConvertTo-Json -Depth 6 -Compress) }
            elseif ($path -like "*/Controls" -or $path -like "*/MeasurementObjects") {
                $id = ""
                if ($query -match "inspectorPiece/id eq ([0-9a-fA-F-]+)") { $id = $Matches[1] }
                $table = $mock.controls
                if ($path -like "*/MeasurementObjects") { $table = $mock.objects }
                $prop = $table.PSObject.Properties[$id]
                if ($prop) { $body = ($prop.Value | ConvertTo-Json -Depth 8 -Compress) }
            }
            $bytes = [Text.Encoding]::UTF8.GetBytes($body)
            $context.Response.StatusCode = 200
            $context.Response.ContentType = "application/json"
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.OutputStream.Close()
        }
    } -Arguments @($mockRoot, $mockFile)
    Start-Sleep -Milliseconds 400
    try {
        $token = "test-token-not-a-secret"
        $apiCache = @{}
        $apiRoot = ($mockRoot.TrimEnd("/")) + "/dataloopcore/api/metrology"
        $pieces = @(Update-LiveCache -ApiRoot $apiRoot -Token $token -Project $mock.project -LastPieces 50 -Cache $apiCache)
        if (@($pieces).Count -lt 1) { throw "Mock-API lieferte keine Teile" }
        if (-not (Test-HasKey $apiCache "11111111-1111-1111-1111-111111111111")) { throw "Cache fuer neues Teil fehlt" }
        $before = @($apiCache["11111111-1111-1111-1111-111111111111"].controls).Count
        $again = @(Update-LiveCache -ApiRoot $apiRoot -Token $token -Project $mock.project -LastPieces 50 -Cache $apiCache)
        if (@($again).Count -lt 1) { throw "zweiter Abruf leer" }
        if (@($apiCache["11111111-1111-1111-1111-111111111111"].controls).Count -ne $before) { throw "Cache wurde neu geschrieben" }
    } finally {
        try { Invoke-WebRequest -Uri ($mockRoot + "stop") -UseBasicParsing | Out-Null } catch {}
        Stop-ListenerRunspace $mockPower
    }

    $probePrefix = "http://localhost:$Port/"
    $probePower = Start-ListenerRunspace -ScriptBlock {
        param($Prefix, $Repo, $Live)
        $listener = New-Object System.Net.HttpListener
        $listener.Prefixes.Add($Prefix)
        $listener.Start()
        while ($listener.IsListening) {
            $context = $null
            try { $context = $listener.GetContext() } catch { break }
            $path = $context.Request.Url.AbsolutePath
            if ($path -eq "/stop") {
                $context.Response.StatusCode = 200
                $context.Response.OutputStream.Close()
                $listener.Stop()
                continue
            }
            if ($path -eq "/data/live-measurements.json") {
                $bytes = [Text.Encoding]::UTF8.GetBytes($Live)
                $context.Response.StatusCode = 200
                $context.Response.ContentType = "application/json; charset=utf-8"
                $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
                $context.Response.OutputStream.Close()
                continue
            }
            $relative = $path.TrimStart("/")
            if ([string]::IsNullOrWhiteSpace($relative)) { $relative = "index.html" }
            if ($relative.Contains("..")) {
                $context.Response.StatusCode = 400
                $context.Response.OutputStream.Close()
                continue
            }
            $full = [IO.Path]::GetFullPath((Join-Path $Repo $relative))
            $root = [IO.Path]::GetFullPath($Repo)
            if (-not $root.EndsWith([IO.Path]::DirectorySeparatorChar)) { $root += [IO.Path]::DirectorySeparatorChar }
            if (-not $full.StartsWith($root) -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
                $context.Response.StatusCode = 404
                $context.Response.OutputStream.Close()
                continue
            }
            $bytes = [IO.File]::ReadAllBytes($full)
            $context.Response.StatusCode = 200
            $context.Response.ContentType = "text/html; charset=utf-8"
            $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
            $context.Response.OutputStream.Close()
        }
    } -Arguments @($probePrefix, $RepoRoot, $json)
    Start-Sleep -Milliseconds 300
    try {
        $index = Invoke-WebRequest -Uri ($probePrefix + "index.html") -UseBasicParsing
        if ($index.StatusCode -ne 200 -or $index.Content -notmatch "Merkmale") { throw "index.html nicht ausgeliefert" }
        $live = Invoke-WebRequest -Uri ($probePrefix + "data/live-measurements.json") -UseBasicParsing
        if ($live.Content -notmatch "Langloch 1 / Mating Length 1") { throw "Live-JSON fehlt" }
        $blocked = $false
        try {
            $bad = Invoke-WebRequest -Uri ($probePrefix + "..%2F..%2Fetc%2Fpasswd") -UseBasicParsing
            if ($bad.StatusCode -ge 400) { $blocked = $true }
        } catch { $blocked = $true }
        if (-not $blocked) { throw "Pfad ausserhalb der Wurzel wurde nicht abgewiesen" }
    } finally {
        try { Invoke-WebRequest -Uri ($probePrefix + "stop") -UseBasicParsing | Out-Null } catch {}
        Stop-ListenerRunspace $probePower
    }
    Write-Host "SelfTest OK"
    return 0
}

function Start-ListenerRunspace {
    param([scriptblock]$ScriptBlock, [object[]]$Arguments)
    $runspace = [runspacefactory]::CreateRunspace()
    $runspace.Open()
    $power = [powershell]::Create()
    $power.Runspace = $runspace
    [void]$power.AddScript($ScriptBlock)
    foreach ($argument in $Arguments) { [void]$power.AddArgument($argument) }
    $handle = $power.BeginInvoke()
    return @{ Power = $power; Handle = $handle; Runspace = $runspace }
}

function Stop-ListenerRunspace {
    param($Session)
    if ($null -eq $Session) { return }
    try { $Session.Power.Stop() } catch {}
    try { $Session.Runspace.Close() } catch {}
    try { $Session.Power.Dispose() } catch {}
}

if ($SelfTest) {
    try {
        $code = Invoke-SelfTest
        exit $code
    } catch {
        Write-Host ("SelfTest FEHLER: " + $_.Exception.Message)
        exit 1
    }
}

Start-Main
