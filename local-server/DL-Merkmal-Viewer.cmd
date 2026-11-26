@echo off
set "DL_LAUNCH=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=Get-Content -LiteralPath $env:DL_LAUNCH -Raw -Encoding UTF8; $m='#__POWERSHELL__'; $i=$t.LastIndexOf($m); if($i -lt 0){Write-Host 'Startmarker fehlt'; exit 1}; iex $t.Substring($i+$m.Length)"
exit /b
#__POWERSHELL__
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { $env:LOCALAPPDATA = [IO.Path]::GetTempPath() }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Script:AppDir = Join-Path $env:LOCALAPPDATA 'DL-Merkmal-Viewer'
$Script:SettingsFile = Join-Path $Script:AppDir 'settings.json'
$Script:WatchFile = Join-Path $Script:AppDir 'watched.json'
$Script:CacheDir = Join-Path $Script:AppDir 'cache'
$Script:Pages = 'https://deanosaurus89.github.io/embedded_semi_interactive_test'
$Script:HostUrl = ''
$Script:Token = ''
$Script:PollSeconds = 60
$Script:LastPieces = 50
$Script:TemplateId = ''
$Script:TemplateName = ''
$Script:PieceCache = @{}
$Script:Sync = [hashtable]::Synchronized(@{ LiveJson = ''; ModelPath = ''; Status = 'Bereit'; Stop = $false; WantTop = '50'; WantFrom = ''; WantTo = '' })
$Script:StaticFiles = @(
  'index.html','css/app.css','js/app.js','js/data-source.js','js/geometry.js','js/label-template.js','js/fit.js','js/mesh-select.js','js/tumble-controls.js','js/tumble.js','js/mw-vec.js','js/pointertap.js','js/viewsnap.js','js/viewcube.js','js/polyline.js','data/layout.json','data/example-measurements.json','models/milkyway.obj'
)

function As-One($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [string] -or $v -is [ValueType]) { return $v }
  $arr = @($v)
  if ($arr.Count -eq 0) { return $null }
  return $arr[0]
}
function As-Str($v) { $x = As-One $v; if ($null -eq $x) { return '' }; return [string]$x }
function Esc($s) { ([string]$s) -replace "'", "''" }
function UrlEnc($s) { [Uri]::EscapeDataString([string]$s) }
function Normalize-SearchTerm($Term) {
  $t = if ($null -eq $Term) { '' } else { ([string]$Term).Trim() }
  if ($t -eq '' -or $t -eq '*' -or $t -eq '%') { return '' }
  return $t
}
function Get-ApiBase { ($Script:HostUrl.TrimEnd('/')) + '/dataloopcore/api/metrology/v2' }
function New-ProjRef($project, $workspace) {
  $ws = As-One $workspace
  [pscustomobject]@{
    projectId = As-Str $project.id
    projectName = As-Str $project.name
    workspaceId = As-Str $(if ($null -ne $ws) { $ws.id } else { $null })
    workspaceName = As-Str $(if ($null -ne $ws) { $ws.name } else { $null })
  }
}
function Invoke-DlGet([string]$Url) {
  if (-not $Script:HostUrl) { throw 'Keine Server-URL' }
  if (-not $Script:Token) { throw 'Kein Token' }
  $r = [System.Net.HttpWebRequest]::Create($Url)
  $r.Method = 'GET'; $r.Accept = 'application/json'; $r.Timeout = 120000
  $r.Headers.Add('Authorization', "Bearer $($Script:Token)")
  $resp = $null
  try { $resp = $r.GetResponse() } catch [System.Net.WebException] { $resp = $_.Exception.Response; if (-not $resp) { throw $_.Exception.Message } }
  $status = 0; $text = ''
  try {
    $status = [int]$resp.StatusCode
    $sr = New-Object IO.StreamReader($resp.GetResponseStream(), [Text.Encoding]::UTF8)
    $text = $sr.ReadToEnd(); $sr.Close()
  } finally { $resp.Close() }
  if ($status -lt 200 -or $status -ge 300) { throw "HTTP $status" }
  if ($text) { return ($text | ConvertFrom-Json) }
  return $null
}
function Build-Url([string]$Path, [hashtable]$Params) {
  $q = ($Params.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$(UrlEnc $_.Value)" }) -join '&'
  (Get-ApiBase) + $Path + $(if ($q) { "?$q" } else { '' })
}
function Get-DlAll([string]$Path, [hashtable]$Params) {
  $url = Build-Url $Path $Params
  $acc = New-Object System.Collections.Generic.List[object]
  $guard = 0
  while ($url -and $guard -lt 30) {
    $guard++
    $j = Invoke-DlGet $url
    foreach ($v in @($j.value)) { if ($null -ne $v) { [void]$acc.Add($v) } }
    $url = $j.'@odata.nextLink'
  }
  $out = @()
  foreach ($item in $acc) { $out += $item }
  return $out
}
function Search-Workspaces([string]$Term) {
  $Term = Normalize-SearchTerm $Term
  $p = @{ '$select' = 'id,name'; '$orderby' = 'name'; '$top' = '50' }
  if ($Term) { $p['$filter'] = "contains(tolower(name),'$(Esc $Term.ToLower())')" }
  $rows = @()
  foreach ($item in @((Invoke-DlGet (Build-Url '/Workspaces' $p)).value)) { if ($null -ne $item) { $rows += $item } }
  return $rows
}
function Build-PieceFilter([string]$ProjectId, [string]$TemplateId, [string]$From, [string]$To) {
  $filter = "inspectorProject/id eq $ProjectId"
  if ($TemplateId) { $filter = $filter + " and inspectorPieceTemplate/id eq $TemplateId" }
  if ($From -match '^\d{4}-\d{2}-\d{2}$') { $filter = $filter + " and creationDateUser ge ${From}T00:00:00Z" }
  if ($To -match '^\d{4}-\d{2}-\d{2}$') { $filter = $filter + " and creationDateUser le ${To}T23:59:59Z" }
  return $filter
}
function Get-ODataCount([string]$Path, [hashtable]$Params) {
  $copy = @{}
  foreach ($key in @($Params.Keys)) { $copy[$key] = $Params[$key] }
  $copy['$count'] = 'true'
  $copy['$top'] = '1'
  $json = Invoke-DlGet (Build-Url $Path $copy)
  $count = $json.'@odata.count'
  if ($null -eq $count) { return @($json.value).Count }
  return [int]$count
}
function Get-PieceTemplates([string]$ProjectId) {
  $rows = @()
  try {
    $rows = @(Get-DlAll '/InspectorPieceTemplates' @{ '$filter' = "inspectorProject/id eq $ProjectId"; '$orderby' = 'name' })
  } catch { $rows = @() }
  if ($rows.Count -eq 0) {
    try {
      $project = Invoke-DlGet ((Get-ApiBase) + "/InspectorProjects/$ProjectId" + '?$expand=inspectorPieceTemplates')
      $rows = @($project.inspectorPieceTemplates)
    } catch { $rows = @() }
  }
  $out = @()
  foreach ($row in $rows) {
    if ($null -eq $row) { continue }
    $id = As-Str $row.id
    if (-not $id) { continue }
    $count = 0
    try {
      $count = Get-ODataCount '/InspectorPieces' @{ '$filter' = "inspectorProject/id eq $ProjectId and inspectorPieceTemplate/id eq $id" }
    } catch { $count = 0 }
    $out += [pscustomobject]@{ id = $id; name = (As-Str $row.name); pieceCount = $count }
  }
  return $out
}
function Get-TemplateControlNames([string]$ProjectId, [string]$TemplateId) {
  $pieces = @(Get-DlAll '/InspectorPieces' @{
    '$filter' = "inspectorProject/id eq $ProjectId and inspectorPieceTemplate/id eq $TemplateId"
    '$orderby' = 'creationDateUser desc'
    '$top' = '1'
    '$select' = 'id'
  })
  if ($pieces.Count -lt 1 -or $null -eq $pieces[0]) { return @() }
  $controls = @(Get-DlAll '/Controls' @{ '$filter' = "inspectorPiece/id eq $(As-Str $pieces[0].id)" })
  $names = @()
  foreach ($control in $controls) {
    if ($null -eq $control) { continue }
    $names += (Get-ControlId $control)
  }
  return $names
}
function Search-Projects([string]$Mode, [string]$Term) {
  $Term = Normalize-SearchTerm $Term
  $out = @()
  if ($Mode -eq 'Workspace') {
    foreach ($w in @(Search-Workspaces $Term)) {
      $projs = @(Get-DlAll '/InspectorProjects' @{ '$filter' = "workspace/id eq $(As-Str $w.id)"; '$select' = 'id,name'; '$orderby' = 'name' })
      foreach ($p in $projs) { $out += (New-ProjRef $p $w) }
    }
  } else {
    $p = @{ '$select' = 'id,name'; '$expand' = 'workspace($select=id,name)'; '$orderby' = 'name'; '$top' = '200' }
    if ($Term) { $p['$filter'] = "contains(tolower(name),'$(Esc $Term.ToLower())')" }
    foreach ($x in @((Invoke-DlGet (Build-Url '/InspectorProjects' $p)).value)) { $out += (New-ProjRef $x $x.workspace) }
  }
  return $out
}
function Read-Utf8Text([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -eq 0) { return '' }
  $start = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $start = 3 }
  return [Text.Encoding]::UTF8.GetString($bytes, $start, $bytes.Length - $start)
}
function Write-Utf8Text([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $enc = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($Path, $Text, $enc)
}
function ConvertTo-PlainJson($Value) {
  if ($null -eq $Value) { return 'null' }
  if ($Value -is [bool]) { if ($Value) { return 'true' } else { return 'false' } }
  if ($Value -is [string]) {
    $t = $Value.Replace('\','\\').Replace('"','\"').Replace("`r",'\r').Replace("`n",'\n')
    return '"' + $t + '"'
  }
  if ($Value -is [int] -or $Value -is [long] -or $Value -is [double] -or $Value -is [decimal] -or $Value -is [single]) {
    return $Value.ToString('G15', [Globalization.CultureInfo]::InvariantCulture)
  }
  if ($Value -is [System.Collections.IDictionary]) {
    $parts = @()
    foreach ($key in @($Value.Keys)) { $parts += ((ConvertTo-PlainJson ([string]$key)) + ':' + (ConvertTo-PlainJson $Value[$key])) }
    return '{' + ($parts -join ',') + '}'
  }
  if ($Value -is [System.Collections.IEnumerable]) {
    $parts = @()
    foreach ($item in $Value) { $parts += (ConvertTo-PlainJson $item) }
    return '[' + ($parts -join ',') + ']'
  }
  return (ConvertTo-PlainJson ([string]$Value))
}
function ConvertTo-JsonArray($items) {
  $parts = New-Object System.Collections.Generic.List[string]
  foreach ($x in @($items)) {
    if ($null -eq $x) { continue }
    [void]$parts.Add((ConvertTo-Json -InputObject $x -Depth 6 -Compress))
  }
  if ($parts.Count -eq 0) { return '[]' }
  return '[' + ($parts -join ',') + ']'
}
function Load-Watched {
  if (-not (Test-Path $Script:WatchFile)) { return $null }
  $raw = (Read-Utf8Text $Script:WatchFile).Trim().TrimStart([char]0xFEFF)
  if (-not $raw -or $raw -eq '[]') { return $null }
  $data = ConvertFrom-Json -InputObject $raw
  $first = As-One @($data)
  if ($null -eq $first) { return $null }
  return [pscustomobject]@{
    projectId = As-Str $first.projectId
    projectName = As-Str $first.projectName
    workspaceId = As-Str $first.workspaceId
    workspaceName = As-Str $first.workspaceName
  }
}
function Save-Watched($proj) {
  if ($null -eq $proj) { Write-Utf8Text $Script:WatchFile '[]'; return }
  $entry = [pscustomobject]@{
    projectId = As-Str $proj.projectId
    projectName = As-Str $proj.projectName
    workspaceId = As-Str $proj.workspaceId
    workspaceName = As-Str $proj.workspaceName
  }
  Write-Utf8Text $Script:WatchFile (ConvertTo-JsonArray @($entry))
}
function Load-Settings {
  if (-not (Test-Path $Script:SettingsFile)) { return $false }
  $s = Read-Utf8Text $Script:SettingsFile | ConvertFrom-Json
  if ($s.server) { $Script:HostUrl = [string]$s.server }
  if ($s.pollSeconds) { $Script:PollSeconds = [int]$s.pollSeconds }
  if ($s.lastPieces) { $Script:LastPieces = [int]$s.lastPieces }
  if ($s.templateId) { $Script:TemplateId = [string]$s.templateId }
  if ($s.templateName) { $Script:TemplateName = [string]$s.templateName }
  if (-not $s.tokenProtected) { return $false }
  $sec = ConvertTo-SecureString ([string]$s.tokenProtected)
  $Script:Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  return [bool]$Script:Token
}
function Save-Settings {
  $enc = ''
  if ($Script:Token) { $enc = [string](ConvertTo-SecureString $Script:Token -AsPlainText -Force | ConvertFrom-SecureString) }
  $obj = [pscustomobject]@{ server = $Script:HostUrl; tokenProtected = $enc; pollSeconds = $Script:PollSeconds; lastPieces = $Script:LastPieces; templateId = $Script:TemplateId; templateName = $Script:TemplateName }
  Write-Utf8Text $Script:SettingsFile (ConvertTo-Json -InputObject $obj -Depth 4)
}
function Get-RowTag($row) {
  if ($null -eq $row) { return $null }
  try { return $row.Tag } catch { return $null }
}
function Ensure-Cache {
  if (-not (Test-Path $Script:CacheDir)) { New-Item -ItemType Directory -Path $Script:CacheDir | Out-Null }
  $web = Join-Path $Script:CacheDir 'www'
  if (-not (Test-Path $web)) { New-Item -ItemType Directory -Path $web | Out-Null }
  foreach ($rel in $Script:StaticFiles) {
    $dest = Join-Path $web ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
    $folder = Split-Path -Parent $dest
    if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
    try {
      $url = $Script:Pages.TrimEnd('/') + '/' + $rel
      $req = [System.Net.HttpWebRequest]::Create($url)
      $req.Method = 'GET'; $req.Timeout = 120000
      $resp = $req.GetResponse()
      $fs = [IO.File]::Create($dest)
      $resp.GetResponseStream().CopyTo($fs)
      $fs.Close(); $resp.Close()
    } catch {
      if (-not (Test-Path $dest)) { throw "Seite nicht geladen: $rel" }
    }
  }
  $Script:Sync.Www = $web
}
function Get-ControlId($c) {
  $obj = As-Str $c.objectName
  $name = As-Str $c.name
  if ($obj) { return "$obj / $name" }
  return $name
}
function Get-Limits($c) {
  $low = 0.0; $up = 0.0
  if ($c.tolerance) { $low = [double]$c.tolerance.low; $up = [double]$c.tolerance.up }
  if ($null -eq $c.nominal) { return @{ nominal = 0.0; usl = $up; lsl = $low } }
  $n = [double]$c.nominal
  return @{ nominal = $n; usl = ($n + $up); lsl = ($n + $low) }
}
function Unit-Of($c) {
  $u = ''
  if ($c.units) { $u = As-Str $c.units.length }
  if ($u -eq 'Millimeters') { return 'mm' }
  if ($u -eq 'Inches') { return 'in' }
  return 'mm'
}
function Update-LiveData([string]$ProjectId) {
  if (-not $ProjectId) { return }
  $top = $Script:LastPieces
  if ($Script:Sync.WantTop) { $parsedTop = 0; if ([int]::TryParse([string]$Script:Sync.WantTop, [ref]$parsedTop) -and $parsedTop -gt 0) { $top = $parsedTop } }
  $from = [string]$Script:Sync.WantFrom
  $to = [string]$Script:Sync.WantTo
  $filter = Build-PieceFilter $ProjectId $Script:TemplateId $from $to
  $pieces = @(Get-DlAll '/InspectorPieces' @{
    '$filter' = $filter
    '$orderby' = 'creationDateUser desc'
    '$top' = [string]$top
    '$select' = 'id,name,creationDateUser,userProperties'
  })
  if ($pieces.Count -gt 0) { Update-LiveModel (As-Str $pieces[0].id) }
  $ordered = @()
  for ($i = $pieces.Count - 1; $i -ge 0; $i--) { $ordered += $pieces[$i] }
  $byId = @{}
  $features = @{}
  foreach ($piece in $ordered) {
    $pid = As-Str $piece.id
    if (-not $Script:PieceCache.Contains($pid)) {
      $controls = @(Get-DlAll '/Controls' @{ '$filter' = "inspectorPiece/id eq $pid" })
      $objects = @()
      try { $objects = @(Get-DlAll '/MeasurementObjects' @{ '$filter' = "inspectorPiece/id eq $pid" }) } catch { $objects = @() }
      $Script:PieceCache[$pid] = @{ controls = $controls; features = $objects }
    }
    $entry = $Script:PieceCache[$pid]
    foreach ($f in @($entry.features)) { $features[(As-Str $f.name)] = As-Str $f.type }
    foreach ($c in @($entry.controls)) {
      $id = Get-ControlId $c
      if (-not $byId.Contains($id)) {
        $lim = Get-Limits $c
        $byId[$id] = @{
          id = $id; name = $id; objectName = As-Str $c.objectName; controlName = As-Str $c.name
          displayName = As-Str $c.displayName; unit = (Unit-Of $c)
          nominal = $lim.nominal; usl = $lim.usl; lsl = $lim.lsl; measurements = @()
        }
      }
      if ($null -eq $c.measured) { continue }
      $stamp = As-Str $c.measurementDateTime
      if (-not $stamp) { $stamp = As-Str $piece.creationDateUser }
      $props = @{}
      if ($piece.userProperties) {
        foreach ($prop in $piece.userProperties.PSObject.Properties) { $props[$prop.Name] = As-Str $prop.Value }
      }
      $meas = @{ pieceId = $pid; pieceName = As-Str $piece.name; value = [double]$c.measured; timestamp = $stamp; creationDateUser = (As-Str $piece.creationDateUser); userProperties = $props }
      if ($c.test) { $meas.test = As-Str $c.test }
      $byId[$id].measurements = @($byId[$id].measurements) + @($meas)
    }
  }
  $chars = @()
  foreach ($k in @($byId.Keys)) { $chars += $byId[$k] }
  $pieceOut = @()
  foreach ($p in $ordered) { $pieceOut += @{ id = As-Str $p.id; name = As-Str $p.name; timestamp = As-Str $p.creationDateUser } }
  $featOut = @()
  foreach ($k in @($features.Keys)) { $featOut += @{ name = $k; type = [string]$features[$k] } }
  $doc = @{
    schemaVersion = 1; source = 'live'; refreshSeconds = $Script:PollSeconds
    fetchedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    part = @{ id = $ProjectId; name = $ProjectId; template = @{ id = [string]$Script:TemplateId; name = [string]$Script:TemplateName } }
    pieces = @($pieceOut); features = @($featOut); characteristics = @($chars)
  }
  $Script:Sync.LiveJson = ConvertTo-PlainJson $doc
  $tpl = [string]$Script:TemplateName
  if (-not $tpl) { $tpl = [string]$Script:TemplateId }
  if ($tpl) { $Script:Sync.Status = "Live $(Get-Date -Format 'HH:mm:ss')  ($($pieces.Count) Teile, $tpl)" }
  else { $Script:Sync.Status = "Live $(Get-Date -Format 'HH:mm:ss')  ($($pieces.Count) Teile)" }
}
function Update-LiveModel([string]$PieceId) {
  if (-not $PieceId) { return }
  $json = Invoke-DlGet ((Get-ApiBase) + "/InspectorPieces/$PieceId/Models")
  $href = $null
  if ($json._links -and $json._links.obj) { $href = As-Str $json._links.obj.href }
  if (-not $href) {
    foreach ($item in @($json.value)) {
      if ($item._links -and $item._links.obj) { $href = As-Str $item._links.obj.href; break }
    }
  }
  if (-not $href) { return }
  $hash = ($href -split '/')[-1]
  $dest = Join-Path (Join-Path $Script:CacheDir 'models') $hash
  $folder = Split-Path -Parent $dest
  if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
  if (-not (Test-Path $dest)) {
    $url = $href
    if ($href.StartsWith('/v2/')) { $url = (Get-ApiBase) + $href.Substring(3) }
    elseif ($href.StartsWith('/')) { $url = ($Script:HostUrl.TrimEnd('/')) + $href }
    $req = [System.Net.HttpWebRequest]::Create($url)
    $req.Method = 'GET'; $req.Timeout = 180000
    $req.Headers.Add('Authorization', "Bearer $($Script:Token)")
    $resp = $req.GetResponse()
    $fs = [IO.File]::Create($dest)
    $resp.GetResponseStream().CopyTo($fs)
    $fs.Close(); $resp.Close()
  }
  $Script:Sync.ModelPath = $dest
}
function Start-HttpServer {
  $prefix = 'http://localhost:8765/'
  $ps = [powershell]::Create()
  $rs = [runspacefactory]::CreateRunspace()
  $rs.Open(); $ps.Runspace = $rs
  [void]$ps.AddScript({
    param($Sync, $Prefix)
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($Prefix)
    $listener.Start()
    while (-not $Sync.Stop) {
      $async = $listener.BeginGetContext($null, $null)
      if (-not $async.AsyncWaitHandle.WaitOne(500)) { continue }
      $ctx = $null
      try { $ctx = $listener.EndGetContext($async) } catch { continue }
      try {
        $path = $ctx.Request.Url.AbsolutePath
        $www = [string]$Sync.Www
        if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
        if ($path -eq '/data/live-measurements.json') {
          $query = [string]$ctx.Request.Url.Query
          if ($query.StartsWith('?')) { $query = $query.Substring(1) }
          foreach ($part in $query.Split('&')) {
            if (-not $part) { continue }
            $bits = $part.Split('=')
            $qk = [Uri]::UnescapeDataString($bits[0])
            $qv = ''
            if ($bits.Length -gt 1) { $qv = [Uri]::UnescapeDataString($bits[1]) }
            if ($qk -eq 'top') { $Sync.WantTop = $qv }
            elseif ($qk -eq 'from') { $Sync.WantFrom = $qv }
            elseif ($qk -eq 'to') { $Sync.WantTo = $qv }
          }
          $text = [string]$Sync.LiveJson
          if (-not $text) { $text = '{"error":"noch keine Live-Daten"}'; $ctx.Response.StatusCode = 404 } else { $ctx.Response.StatusCode = 200 }
          $bytes = [Text.Encoding]::UTF8.GetBytes($text)
          $ctx.Response.ContentType = 'application/json; charset=utf-8'
          $ctx.Response.Headers['Cache-Control'] = 'no-store'
          $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
        } elseif ($path -eq '/models/live.obj') {
          $model = [string]$Sync.ModelPath
          if (-not $model -or -not (Test-Path -LiteralPath $model)) { $ctx.Response.StatusCode = 404; $buf = [Text.Encoding]::UTF8.GetBytes('kein Modell') }
          else { $ctx.Response.StatusCode = 200; $buf = [IO.File]::ReadAllBytes($model) }
          $ctx.Response.ContentType = 'text/plain; charset=utf-8'
          $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
        } else {
          $rel = $path.TrimStart('/')
          if ($rel.Contains('..')) { $ctx.Response.StatusCode = 400 }
          else {
            $full = [IO.Path]::GetFullPath((Join-Path $www ($rel -replace '/', '\')))
            $root = [IO.Path]::GetFullPath($www)
            if (-not $root.EndsWith('\')) { $root += '\' }
            if ($full.StartsWith($root) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
              $ctx.Response.StatusCode = 200
              $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
              $type = 'application/octet-stream'
              if ($ext -eq '.html') { $type = 'text/html; charset=utf-8' }
              elseif ($ext -eq '.js') { $type = 'text/javascript; charset=utf-8' }
              elseif ($ext -eq '.css') { $type = 'text/css; charset=utf-8' }
              elseif ($ext -eq '.json') { $type = 'application/json; charset=utf-8' }
              elseif ($ext -eq '.obj') { $type = 'text/plain; charset=utf-8' }
              $ctx.Response.ContentType = $type
              $buf = [IO.File]::ReadAllBytes($full)
              $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
            } else { $ctx.Response.StatusCode = 404 }
          }
        }
      } catch { try { $ctx.Response.StatusCode = 500 } catch {} }
      finally { try { $ctx.Response.OutputStream.Close() } catch {} }
    }
    $listener.Stop(); $listener.Close()
  }).AddArgument($Script:Sync).AddArgument('http://localhost:8765/')
  $Script:ServerHandle = $ps.BeginInvoke()
  $Script:ServerPower = $ps
}
function Show-FirstRun {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $f = New-Object Windows.Forms.Form
  $f.Text = 'DL-Merkmal-Viewer'
  $f.FormBorderStyle = 'FixedDialog'
  $f.StartPosition = 'CenterScreen'
  $f.ClientSize = New-Object Drawing.Size(480, 180)
  $f.MaximizeBox = $false
  $l1 = New-Object Windows.Forms.Label -Property @{ Text = 'Server-URL'; Left = 12; Top = 12; Width = 440 }
  $t1 = New-Object Windows.Forms.TextBox -Property @{ Left = 12; Top = 32; Width = 440; Text = $Script:HostUrl }
  $l2 = New-Object Windows.Forms.Label -Property @{ Text = 'Personal Access Token'; Left = 12; Top = 64; Width = 440 }
  $t2 = New-Object Windows.Forms.TextBox -Property @{ Left = 12; Top = 84; Width = 440; UseSystemPasswordChar = $true }
  $ok = New-Object Windows.Forms.Button -Property @{ Text = 'Weiter'; Left = 270; Top = 130; Width = 80; DialogResult = 'OK' }
  $cancel = New-Object Windows.Forms.Button -Property @{ Text = 'Abbrechen'; Left = 360; Top = 130; Width = 90; DialogResult = 'Cancel' }
  $f.Controls.AddRange(@($l1,$t1,$l2,$t2,$ok,$cancel)); $f.AcceptButton = $ok; $f.CancelButton = $cancel
  if ($f.ShowDialog() -ne 'OK') { return $false }
  $Script:HostUrl = $t1.Text.Trim()
  if ($t2.Text) { $Script:Token = $t2.Text }
  return [bool]($Script:HostUrl -and $Script:Token)
}
function Show-Main {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $f = New-Object Windows.Forms.Form
  $f.Text = 'DL-Merkmal-Viewer'
  $f.StartPosition = 'CenterScreen'
  $f.ClientSize = New-Object Drawing.Size(760, 720)
  $f.Font = New-Object Drawing.Font('Segoe UI', 9)
  $bar = New-Object Windows.Forms.FlowLayoutPanel -Property @{ Dock = 'Top'; Height = 40; Padding = '6,6,6,0' }
  $txt = New-Object Windows.Forms.TextBox -Property @{ Width = 220 }
  $mode = New-Object Windows.Forms.ComboBox -Property @{ Width = 120; DropDownStyle = 'DropDownList' }
  [void]$mode.Items.AddRange(@('Projekt','Workspace')); $mode.SelectedIndex = 0
  $search = New-Object Windows.Forms.Button -Property @{ Text = 'Suchen'; Width = 90 }
  $bar.Controls.AddRange(@($txt,$mode,$search))
  $grid = New-Object Windows.Forms.DataGridView -Property @{ Dock = 'Fill'; ReadOnly = $true; AllowUserToAddRows = $false; SelectionMode = 'FullRowSelect'; MultiSelect = $false; RowHeadersVisible = $false; AutoSizeColumnsMode = 'Fill'; BackgroundColor = 'White' }
  [void]$grid.Columns.Add('Stern','')
  [void]$grid.Columns.Add('Projekt','Projekt')
  [void]$grid.Columns.Add('Workspace','Workspace')
  $grid.Columns[0].FillWeight = 20
  $bottom = New-Object Windows.Forms.Panel -Property @{ Dock = 'Bottom'; Height = 330 }
  $watched = New-Object Windows.Forms.Label -Property @{ Left = 12; Top = 8; Width = 720; Text = 'Beobachtet: (noch keins)' }
  $tplLabel = New-Object Windows.Forms.Label -Property @{ Left = 12; Top = 28; Width = 430; Text = 'Stueckvorlage' }
  $tplGrid = New-Object Windows.Forms.DataGridView -Property @{ Left = 12; Top = 48; Width = 430; Height = 110; ReadOnly = $true; AllowUserToAddRows = $false; SelectionMode = 'FullRowSelect'; MultiSelect = $false; RowHeadersVisible = $false; AutoSizeColumnsMode = 'Fill'; BackgroundColor = 'White' }
  [void]$tplGrid.Columns.Add('Wahl','')
  [void]$tplGrid.Columns.Add('Name','Vorlage')
  [void]$tplGrid.Columns.Add('Teile','Teile')
  $tplGrid.Columns[0].FillWeight = 18
  $ctrlLabel = New-Object Windows.Forms.Label -Property @{ Left = 452; Top = 28; Width = 290; Text = 'Merkmale (Objekt / Name)' }
  $ctrlList = New-Object Windows.Forms.ListBox -Property @{ Left = 452; Top = 48; Width = 290; Height = 110 }
  $interval = New-Object Windows.Forms.ComboBox -Property @{ Left = 12; Top = 170; Width = 140; DropDownStyle = 'DropDownList' }
  [void]$interval.Items.AddRange(@('30 s','1 min','5 min','15 min'))
  $map = @{ 30 = 0; 60 = 1; 300 = 2; 900 = 3 }
  if ($map.ContainsKey($Script:PollSeconds)) { $interval.SelectedIndex = $map[$Script:PollSeconds] } else { $interval.SelectedIndex = 1 }
  $open = New-Object Windows.Forms.Button -Property @{ Text = 'Im Browser oeffnen'; Left = 170; Top = 168; Width = 160 }
  $snippet = New-Object Windows.Forms.TextBox -Property @{ Left = 12; Top = 208; Width = 560; ReadOnly = $true; Text = '<iframe src="http://localhost:8765/" title="Milkyway Merkmale"></iframe>' }
  $copy = New-Object Windows.Forms.Button -Property @{ Text = 'Kopieren'; Left = 580; Top = 206; Width = 90 }
  $status = New-Object Windows.Forms.Label -Property @{ Left = 12; Top = 246; Width = 720; Height = 70; Text = 'Bereit' }
  $bottom.Controls.AddRange(@($watched,$tplLabel,$tplGrid,$ctrlLabel,$ctrlList,$interval,$open,$snippet,$copy,$status))
  $f.Controls.Add($grid); $f.Controls.Add($bottom); $f.Controls.Add($bar)
  $renderStars = {
    $cur = Load-Watched
    $id = $(if ($cur) { As-Str $cur.projectId } else { '' })
    foreach ($row in $grid.Rows) {
      $tag = Get-RowTag $row
      $on = $tag -and ((As-Str $tag.projectId) -eq $id)
      $row.Cells[0].Value = $(if ($on) { [string]([char]0x2605) } else { [string]([char]0x2606) })
    }
    if ($cur) { $watched.Text = "Beobachtet: $($cur.workspaceName) / $($cur.projectName)" } else { $watched.Text = 'Beobachtet: (noch keins)' }
  }
  $markTemplate = {
    foreach ($row in $tplGrid.Rows) {
      $tag = Get-RowTag $row
      $on = $tag -and ((As-Str $tag.id) -eq [string]$Script:TemplateId)
      $row.Cells[0].Value = $(if ($on) { '*' } else { '' })
    }
  }
  $applyTemplate = {
    param($tag)
    if ($null -eq $tag) { return }
    $Script:TemplateId = As-Str $tag.id
    $Script:TemplateName = As-Str $tag.name
    Save-Settings
    & $markTemplate
    $ctrlList.Items.Clear()
    try {
      $names = @(Get-TemplateControlNames (As-Str (Load-Watched).projectId) $Script:TemplateId)
      foreach ($name in $names) { if ($name) { [void]$ctrlList.Items.Add([string]$name) } }
      $status.Text = "$($Script:TemplateName): $($names.Count) Merkmale, $($tag.pieceCount) Teile"
    } catch { $status.Text = $_.Exception.Message }
    $cur = Load-Watched
    if ($cur) { try { Update-LiveData (As-Str $cur.projectId); $status.Text = [string]$Script:Sync.Status } catch { $status.Text = $_.Exception.Message } }
  }
  $loadTemplates = {
    $tplGrid.Rows.Clear()
    $ctrlList.Items.Clear()
    $cur = Load-Watched
    if (-not $cur) { return }
    try {
      $status.Text = 'Vorlagen ...'
      $templates = @(Get-PieceTemplates (As-Str $cur.projectId))
      $pick = $null
      $best = -1
      foreach ($template in $templates) {
        $i = $tplGrid.Rows.Add('', (As-Str $template.name), [string]$template.pieceCount)
        $tplGrid.Rows[$i].Tag = $template
        if ((As-Str $template.id) -eq [string]$Script:TemplateId) { $pick = $template }
        if ([int]$template.pieceCount -gt $best) { $best = [int]$template.pieceCount; if (-not $pick) { $pick = $template } }
      }
      if ($pick) { & $applyTemplate $pick } else { $status.Text = 'Keine Stueckvorlage' }
    } catch { $status.Text = $_.Exception.Message }
  }
  $search.Add_Click({
    try {
      $status.Text = 'Suche ...'
      $grid.Rows.Clear()
      $rows = @(Search-Projects $(if ($mode.SelectedIndex -eq 1) { 'Workspace' } else { 'Projekt' }) $txt.Text)
      foreach ($p in $rows) {
        $i = $grid.Rows.Add([string]([char]0x2606), (As-Str $p.projectName), (As-Str $p.workspaceName))
        $grid.Rows[$i].Tag = $p
      }
      & $renderStars
      $status.Text = "$($rows.Count) Projekte"
    } catch { $status.Text = $_.Exception.Message }
  })
  $grid.Add_CellClick({
    if ($_.RowIndex -lt 0) { return }
    $row = $grid.Rows[$_.RowIndex]
    $tag = Get-RowTag $row
    if ($null -eq $tag) { return }
    Save-Watched $tag
    & $renderStars
    & $loadTemplates
  })
  $tplGrid.Add_CellClick({
    if ($_.RowIndex -lt 0) { return }
    $tag = Get-RowTag $tplGrid.Rows[$_.RowIndex]
    if ($null -eq $tag) { return }
    & $applyTemplate $tag
  })
  $interval.Add_SelectedIndexChanged({
    $Script:PollSeconds = @(30,60,300,900)[$interval.SelectedIndex]
    Save-Settings
  })
  $open.Add_Click({ Start-Process 'http://localhost:8765/' })
  $copy.Add_Click({ [Windows.Forms.Clipboard]::SetText($snippet.Text); $status.Text = 'iframe kopiert' })
  $timer = New-Object Windows.Forms.Timer
  $timer.Interval = [Math]::Max(5000, $Script:PollSeconds * 1000)
  $timer.Add_Tick({
    $cur = Load-Watched
    if (-not $cur) { return }
    try { Update-LiveData (As-Str $cur.projectId); $status.Text = [string]$Script:Sync.Status } catch { $status.Text = $_.Exception.Message }
  })
  $timer.Start()
  $f.Add_FormClosed({ $Script:Sync.Stop = $true; $timer.Stop() })
  $cur = Load-Watched
  if ($cur) { & $loadTemplates }
  & $renderStars
  [void]$f.ShowDialog()
}
function Invoke-SelfTest {
  $launch = $env:DL_LAUNCH
  if ($launch -and (Test-Path -LiteralPath $launch)) {
    $bytes = [IO.File]::ReadAllBytes($launch)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { throw 'cmd darf kein UTF-8-BOM haben' }
    foreach ($b in $bytes) { if ($b -gt 127) { throw 'cmd muss reines ASCII sein' } }
    $asText = [Text.Encoding]::ASCII.GetString($bytes)
    if ($asText -match '(?<!\r)\n') { throw 'cmd muss CRLF verwenden' }
    if ($asText -notmatch 'Get-Content -LiteralPath \$env:DL_LAUNCH -Raw -Encoding UTF8') { throw 'Bootstrap liest nicht als UTF8' }
  }
  $json = ConvertTo-JsonArray @([pscustomobject]@{ projectId = 'p1'; projectName = 'Eins'; workspaceId = 'w'; workspaceName = 'WS' })
  if ($json -notmatch '^\[') { throw 'Array erwartet' }
  $two = ConvertTo-JsonArray @(
    [pscustomobject]@{ projectId = 'p1'; projectName = 'Eins'; workspaceId = 'w'; workspaceName = 'WS' }
    [pscustomobject]@{ projectId = 'p2'; projectName = 'Zwei'; workspaceId = 'w'; workspaceName = 'WS' }
  )
  if ($two -notmatch '^\[') { throw 'Zwei Eintraege muessen ein Array sein' }
  $dir = Join-Path ([IO.Path]::GetTempPath()) ('dl-merkmal-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $dir | Out-Null
  $www = Join-Path $dir 'www'
  New-Item -ItemType Directory -Path $www | Out-Null
  [IO.File]::WriteAllText((Join-Path $www 'index.html'), '<html><title>Merkmale</title></html>')
  $sync = [hashtable]::Synchronized(@{ LiveJson = '{"source":"live","characteristics":[]}'; ModelPath = ''; Www = $www; Stop = $false })
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add('http://127.0.0.1:8777/')
  $listener.Start()
  $client = New-Object System.Net.Http.HttpClient
  $task = $client.GetAsync('http://127.0.0.1:8777/index.html')
  $ctx = $listener.GetContext()
  $bytes = [IO.File]::ReadAllBytes((Join-Path $www 'index.html'))
  $ctx.Response.StatusCode = 200
  $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  $ctx.Response.OutputStream.Close()
  $body = $task.Result.Content.ReadAsStringAsync().Result
  $listener.Stop(); $listener.Close()
  if ($body -notmatch 'Merkmale') { throw 'Listener lieferte die Seite nicht' }
  $one = ConvertTo-PlainJson @{ characteristics = @(@{ id = 'nur-eins'; measurements = @(@{ value = 1.5 }) }) }
  if ($one -notmatch '"characteristics":\[') { throw 'Einzelnes Merkmal muss ein Array sein' }
  if ($one -notmatch '"measurements":\[') { throw 'Einzelner Messwert muss ein Array sein' }
  Remove-Item -Recurse -Force $dir
  $filter = Build-PieceFilter 'proj-1' 'tpl-1' '2026-01-01' '2026-01-31'
  if ($filter -notmatch 'inspectorProject/id eq proj-1') { throw 'Projektfilter fehlt' }
  if ($filter -notmatch 'inspectorPieceTemplate/id eq tpl-1') { throw 'Templatefilter fehlt' }
  if ($filter -notmatch 'creationDateUser ge 2026-01-01T00:00:00Z') { throw 'Von-Datum fehlt' }
  if ($filter -notmatch 'creationDateUser le 2026-01-31T23:59:59Z') { throw 'Bis-Datum fehlt' }
  if ($filter -match 'controlsCount') { throw 'controlsCount darf nicht im Filter stehen' }
  $bare = Build-PieceFilter 'proj-1' '' '' ''
  if ($bare -match 'inspectorPieceTemplate') { throw 'Ohne Vorlage kein Templatefilter' }
  $settingsDir = Join-Path ([IO.Path]::GetTempPath()) ('dl-merkmal-set-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $settingsDir | Out-Null
  $Script:SettingsFile = Join-Path $settingsDir 'settings.json'
  $Script:HostUrl = 'https://example.test'
  $Script:Token = ''
  $Script:TemplateId = 'tpl-1'
  $Script:TemplateName = 'Vorlage Eins'
  Save-Settings
  $saved = Read-Utf8Text $Script:SettingsFile
  if ($saved -notmatch 'tpl-1') { throw 'templateId nicht gespeichert' }
  if ($saved -notmatch 'Vorlage Eins') { throw 'templateName nicht gespeichert' }
  $Script:TemplateId = ''
  $Script:TemplateName = ''
  Load-Settings | Out-Null
  if ($Script:TemplateId -ne 'tpl-1') { throw 'templateId nicht geladen' }
  if ($Script:TemplateName -ne 'Vorlage Eins') { throw 'templateName nicht geladen' }
  Remove-Item -Recurse -Force $settingsDir
  Write-Host 'SelfTest OK'
}
if ($env:DL_MERKMAL_SELFTEST -eq '1') { Invoke-SelfTest; exit 0 }
New-Item -ItemType Directory -Path $Script:AppDir -Force | Out-Null
$ready = $false
try { $ready = Load-Settings } catch { $ready = $false }
if (-not $ready) {
  if (-not (Show-FirstRun)) { exit 1 }
  Save-Settings
}
try { Ensure-Cache } catch { [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'DL-Merkmal-Viewer') ; exit 1 }
Start-HttpServer
Show-Main
exit 0
