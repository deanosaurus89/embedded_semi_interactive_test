@echo off
set "DL_LAUNCH=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=Get-Content -LiteralPath $env:DL_LAUNCH -Raw -Encoding UTF8; $m='#__POWERSHELL__'; $i=$t.LastIndexOf($m); if($i -lt 0){Write-Host 'Startmarker fehlt'; exit 1}; iex $t.Substring($i+$m.Length)"
exit /b
#__POWERSHELL__
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { $env:LOCALAPPDATA = [IO.Path]::GetTempPath() }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Script:Version = '0.9.0'
$Script:AppDir = Join-Path $env:LOCALAPPDATA 'DL-Merkmal-Viewer'
$Script:SettingsFile = Join-Path $Script:AppDir 'settings.json'
$Script:CacheDir = Join-Path $Script:AppDir 'cache'
$Script:Pages = 'https://deanosaurus89.github.io/embedded_semi_interactive_test'
$Script:HostUrl = ''
$Script:Token = ''
$Script:PollSeconds = 60
$Script:Www = ''
$Script:Stop = $false
$Script:SizeCache = @{}
$Script:MockJson = $null
$Script:MockSizes = $null
$Script:MockCalls = 0
$Script:LastUrl = ''
$Script:StaticFiles = @(
  'index.html','css/app.css','js/app.js','js/wizard.js','js/anchors.js','js/views.js','js/labels.js','js/data-source.js','js/geometry.js','js/label-template.js','js/fit.js','js/mesh-select.js','js/tumble-controls.js','js/tumble.js','js/mw-vec.js','js/pointertap.js','js/viewsnap.js','js/viewcube.js','js/polyline.js','data/layout.json','data/example-measurements.json','models/milkyway.obj'
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
function New-List { $list = New-Object System.Collections.Generic.List[object]; return ,$list }
function Get-ApiBase { ($Script:HostUrl.TrimEnd('/')) + '/dataloopcore/api/metrology/v2' }
function Read-Utf8Text([string]$Path) {
  $bytes = [IO.File]::ReadAllBytes($Path)
  if ($bytes.Length -eq 0) { return '' }
  $start = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191) { $start = 3 }
  return [Text.Encoding]::UTF8.GetString($bytes, $start, $bytes.Length - $start)
}
function Write-Utf8Text([string]$Path, [string]$Text) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  $enc = New-Object System.Text.UTF8Encoding $false
  [IO.File]::WriteAllText($Path, $Text, $enc)
}
function Write-Log([string]$Text) {
  try {
    $path = Join-Path $Script:AppDir 'log.txt'
    $dir = Split-Path -Parent $path
    if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
    Add-Content -LiteralPath $path -Value ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Text) -Encoding ASCII
  } catch {}
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
function Build-Url([string]$Path, [hashtable]$Params) {
  $q = ($Params.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$(UrlEnc $_.Value)" }) -join '&'
  (Get-ApiBase) + $Path + $(if ($q) { "?$q" } else { '' })
}
function Invoke-DlGet([string]$Url) {
  if ($Script:MockJson) {
    $Script:MockCalls = [int]$Script:MockCalls + 1
    $Script:LastUrl = $Url
    $text = & $Script:MockJson $Url
    if ($null -eq $text -or $text -eq '') { return $null }
    return ($text | ConvertFrom-Json)
  }
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
function Invoke-DlRange([string]$Hash) {
  $url = (Get-ApiBase) + '/Files/' + $Hash
  $r = [System.Net.HttpWebRequest]::Create($url)
  $r.Method = 'GET'; $r.Timeout = 60000
  $r.AddRange(0, 255)
  $r.Headers.Add('Authorization', "Bearer $($Script:Token)")
  $resp = $r.GetResponse()
  try {
    $total = [int64]0
    $cr = [string]$resp.Headers['Content-Range']
    if ($cr -match '/(\d+)\s*$') { $total = [int64]$Matches[1] }
    if ($total -le 0) {
      $len = $resp.ContentLength
      if ($len -gt 0) { $total = [int64]$len }
    }
    $stream = $resp.GetResponseStream()
    $buf = New-Object byte[] 256
    [void]$stream.Read($buf, 0, $buf.Length)
    $stream.Close()
    return $total
  } finally { $resp.Close() }
}
function Get-ModelSize([string]$Hash) {
  $Hash = $Hash.ToLower()
  if ($Script:SizeCache.ContainsKey($Hash)) { return [int64]$Script:SizeCache[$Hash] }
  $size = [int64]0
  if ($Script:MockSizes -and $Script:MockSizes.ContainsKey($Hash)) { $size = [int64]$Script:MockSizes[$Hash] }
  else { $size = Invoke-DlRange $Hash }
  $Script:SizeCache[$Hash] = $size
  return $size
}
function Has-Prop($obj, [string]$name) {
  if ($null -eq $obj -or $obj -is [System.Array] -or $obj -is [ValueType] -or $obj -is [string]) { return $false }
  foreach ($p in @($obj.PSObject.Properties)) { if ($p.Name -eq $name) { return $true } }
  return $false
}
function Get-Rows($json) {
  $list = New-List
  if ($null -eq $json) { return ,$list }
  $value = $null
  if ($json -is [System.Array]) { $value = $json }
  elseif (Has-Prop $json 'value') { $value = $json.value }
  if ($null -eq $value) { return ,$list }
  foreach ($row in @($value)) { if ($null -ne $row) { [void]$list.Add($row) } }
  return ,$list
}
function Get-ProjectPage([string]$Q, [string]$Workspace, [int]$Top, [int]$Skip) {
  if ($Top -lt 1) { $Top = 20 }
  if ($Top -gt 50) { $Top = 50 }
  if ($Skip -lt 0) { $Skip = 0 }
  $Q = Normalize-SearchTerm $Q
  $Workspace = Normalize-SearchTerm $Workspace
  $filters = New-Object System.Collections.Generic.List[string]
  if ($Q) { [void]$filters.Add("contains(tolower(name),'$(Esc $Q.ToLower())')") }
  if ($Workspace) { [void]$filters.Add("contains(tolower(workspace/name),'$(Esc $Workspace.ToLower())')") }
  $p = @{ '$select' = 'id,name'; '$expand' = 'workspace($select=id,name)'; '$orderby' = 'name'; '$top' = [string]$Top; '$skip' = [string]$Skip; '$count' = 'true' }
  if ($filters.Count -gt 0) { $p['$filter'] = ($filters -join ' and ') }
  $before = [int]$Script:MockCalls
  $json = Invoke-DlGet (Build-Url '/InspectorProjects' $p)
  if ($Script:MockJson -and ([int]$Script:MockCalls - $before) -ne 1) { throw 'Projektliste darf nur eine Seite laden' }
  $items = New-List
  foreach ($x in @(Get-Rows $json)) {
    $ws = ''
    if ($x.workspace) { $ws = As-Str $x.workspace.name }
    [void]$items.Add(@{ id = (As-Str $x.id); name = (As-Str $x.name); workspaceName = $ws })
  }
  $total = $items.Count
  if ($json -and ($json.PSObject.Properties.Name -contains '@odata.count') -and $null -ne $json.'@odata.count') { $total = [int]$json.'@odata.count' }
  return @{ total = $total; skip = $Skip; top = $Top; items = $items }
}
function Get-ODataCount([string]$Path, [hashtable]$Params) {
  $copy = @{}
  foreach ($key in @($Params.Keys)) { $copy[$key] = $Params[$key] }
  $copy['$count'] = 'true'
  $copy['$top'] = '0'
  $Script:LastCountUrl = Build-Url $Path $copy
  $json = Invoke-DlGet $Script:LastCountUrl
  if ((Has-Prop $json '@odata.count') -and $null -ne $json.'@odata.count') { return [int]$json.'@odata.count' }
  return 0
}
function Get-PieceTemplates([string]$ProjectId) {
  $rows = New-List
  $skip = 0
  for ($guard = 0; $guard -lt 40; $guard++) {
    $json = $null
    try {
      $json = Invoke-DlGet (Build-Url '/InspectorPieceTemplates' @{ '$filter' = "inspectorProject/id eq $ProjectId"; '$orderby' = 'name'; '$top' = '50'; '$skip' = [string]$skip })
    } catch { $json = $null }
    $batch = Get-Rows $json
    $n = 0
    foreach ($row in $batch) { [void]$rows.Add($row); $n++ }
    if ($n -lt 50) { break }
    $skip += 50
  }
  if ($rows.Count -eq 0) {
    try {
      $project = Invoke-DlGet ((Get-ApiBase) + "/InspectorProjects/$ProjectId" + '?$expand=inspectorPieceTemplates')
      if ($project -and $project.inspectorPieceTemplates) {
        foreach ($row in @($project.inspectorPieceTemplates)) { if ($null -ne $row) { [void]$rows.Add($row) } }
      }
    } catch { }
  }
  $items = New-List
  foreach ($row in $rows) {
    $id = As-Str $row.id
    if (-not $id) { continue }
    $count = 0
    $sample = ''
    try { $count = Get-ODataCount '/InspectorPieces' @{ '$filter' = "inspectorProject/id eq $ProjectId and inspectorPieceTemplate/id eq $id" } } catch { $count = 0 }
    try {
      $one = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = "inspectorPieceTemplate/id eq $id"; '$top' = '1'; '$select' = 'id' })
      foreach ($p in @(Get-Rows $one)) { if (-not $sample) { $sample = As-Str $p.id } }
    } catch { $sample = '' }
    [void]$items.Add(@{ id = $id; name = (As-Str $row.name); pieceCount = $count; samplePieceId = $sample })
  }
  return @{ items = $items }
}
function Get-ProjectPieces([string]$ProjectId, [bool]$Unlinked, [string]$Q, [int]$Top) {
  if ($Top -lt 1) { $Top = 40 }
  if ($Top -gt 100) { $Top = 100 }
  $Q = Normalize-SearchTerm $Q
  $filter = "inspectorProject/id eq $ProjectId"
  if ($Unlinked) { $filter = $filter + ' and inspectorPieceTemplate eq null' }
  if ($Q) { $filter = $filter + " and contains(tolower(name),'$(Esc $Q.ToLower())')" }
  $json = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = $filter; '$orderby' = 'name'; '$top' = [string]$Top; '$select' = 'id,name' })
  $items = New-List
  foreach ($row in @(Get-Rows $json)) { [void]$items.Add(@{ id = (As-Str $row.id); name = (As-Str $row.name) }) }
  return @{ items = $items }
}
function Get-PieceModels([string]$PieceId) {
  $json = Invoke-DlGet ((Get-ApiBase) + "/InspectorPieces/$PieceId/Models")
  $rows = New-List
  if ($null -eq $json) { }
  elseif ($json -is [System.Array]) { foreach ($row in $json) { if ($null -ne $row) { [void]$rows.Add($row) } } }
  elseif ($json.PSObject.Properties.Name -contains 'value') { foreach ($row in @(Get-Rows $json)) { [void]$rows.Add($row) } }
  elseif ($json._links -or $json.name) { [void]$rows.Add($json) }
  $items = New-List
  foreach ($row in $rows) {
    $href = ''
    if ($row._links -and $row._links.obj) { $href = As-Str $row._links.obj.href }
    if (-not $href) { continue }
    $hash = (($href -split '/')[-1]).ToLower()
    $size = Get-ModelSize $hash
    [void]$items.Add(@{ name = (As-Str $row.name); hash = $hash; sizeBytes = $size })
  }
  return @{ items = $items }
}
function Control-Label($objectName, $name, $id) {
  $o = As-Str $objectName
  $n = As-Str $name
  if ($o -and $n) { return ($o + ' / ' + $n) }
  $short = As-Str $id
  if ($short.Length -gt 8) { $short = $short.Substring(0, 8) }
  if (-not $short) { $short = '?' }
  return ('unbenannt (' + $short + ')')
}
function Convert-Control($c) {
  $low = $null
  $up = $null
  if ($c.tolerance) {
    if ($null -ne $c.tolerance.low) { $low = $c.tolerance.low }
    if ($null -ne $c.tolerance.up) { $up = $c.tolerance.up }
  }
  $nominal = $null
  if ($null -ne $c.nominal) { $nominal = $c.nominal }
  $id = As-Str $c.id
  $objectName = As-Str $c.objectName
  $name = As-Str $c.name
  return @{ id = $id; objectName = $objectName; name = $name; type = (As-Str $c.type); nominal = $nominal; tolerances = @{ low = $low; up = $up }; label = (Control-Label $objectName $name $id) }
}
function Merge-Control($byId, $c) {
  $id = As-Str $c.id
  if (-not $id) { return }
  $named = (As-Str $c.objectName) -and (As-Str $c.name)
  if (-not $byId.ContainsKey($id)) { $byId[$id] = $c; return }
  $prev = $byId[$id]
  $prevNamed = (As-Str $prev.objectName) -and (As-Str $prev.name)
  if ($named -and -not $prevNamed) { $byId[$id] = $c }
}
function Get-NamedControls([string]$TemplateId, [string]$PieceId) {
  $items = New-List
  if ($PieceId) {
    $json = Invoke-DlGet (Build-Url '/Controls' @{ '$filter' = "inspectorPiece/id eq $PieceId" })
    foreach ($c in (Get-Rows $json)) { [void]$items.Add((Convert-Control $c)) }
    return @{ items = $items }
  }
  if (-not $TemplateId) { throw 'templateId oder pieceId fehlt' }
  $form = Invoke-DlGet ((Get-ApiBase) + "/InspectorPieceTemplates/$TemplateId/Form")
  $formIds = New-Object System.Collections.Generic.List[string]
  $nodes = @()
  if ($form -and $form.controls) { $nodes = @($form.controls) }
  elseif ($form -and $form.value) { $nodes = @($form.value) }
  foreach ($node in $nodes) {
    if ($null -eq $node) { continue }
    $id = As-Str $node.id
    if ($id) { [void]$formIds.Add($id) }
  }
  $sample = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = "inspectorPieceTemplate/id eq $TemplateId"; '$orderby' = 'creationDateUser desc'; '$top' = '20'; '$select' = 'id' })
  $byId = @{}
  foreach ($row in (Get-Rows $sample)) {
    $complete = $true
    if ($formIds.Count -gt 0) {
      foreach ($id in $formIds) {
        if (-not $byId.ContainsKey($id)) { $complete = $false; break }
        $known = $byId[$id]
        if (-not ((As-Str $known.objectName) -and (As-Str $known.name))) { $complete = $false; break }
      }
    }
    if ($complete -and $formIds.Count -gt 0) { break }
    $controls = Invoke-DlGet (Build-Url '/Controls' @{ '$filter' = "inspectorPiece/id eq $(As-Str $row.id)" })
    foreach ($c in (Get-Rows $controls)) { Merge-Control $byId $c }
  }
  if ($formIds.Count -eq 0) {
    foreach ($key in @($byId.Keys)) { [void]$items.Add((Convert-Control $byId[$key])) }
  } else {
    foreach ($id in $formIds) {
      if ($byId.ContainsKey($id)) { [void]$items.Add((Convert-Control $byId[$id])) }
      else { [void]$items.Add(@{ id = $id; objectName = ''; name = ''; type = ''; nominal = $null; tolerances = @{ low = $null; up = $null }; label = (Control-Label '' '' $id) }) }
    }
  }
  return @{ items = $items }
}
function Build-PieceFilter([string]$ProjectId, [string]$TemplateId, [string]$From, [string]$To) {
  $filter = "inspectorProject/id eq $ProjectId"
  if ($TemplateId) { $filter = $filter + " and inspectorPieceTemplate/id eq $TemplateId" }
  if ($From -match '^\d{4}-\d{2}-\d{2}$') { $filter = $filter + " and creationDateUser ge ${From}T00:00:00Z" }
  if ($To -match '^\d{4}-\d{2}-\d{2}$') { $filter = $filter + " and creationDateUser le ${To}T23:59:59Z" }
  return $filter
}
function Load-Settings {
  if (-not (Test-Path $Script:SettingsFile)) { return $false }
  $s = Read-Utf8Text $Script:SettingsFile | ConvertFrom-Json
  if ($s.server) { $Script:HostUrl = [string]$s.server }
  if ($s.pollSeconds) { $Script:PollSeconds = [int]$s.pollSeconds }
  if (-not $s.tokenProtected) { $Script:Token = ''; return $false }
  $sec = ConvertTo-SecureString ([string]$s.tokenProtected)
  $Script:Token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
  return [bool]$Script:Token
}
function Save-Settings {
  $enc = ''
  if ($Script:Token) { $enc = [string](ConvertTo-SecureString $Script:Token -AsPlainText -Force | ConvertFrom-SecureString) }
  $obj = [pscustomobject]@{ schemaVersion = 1; server = $Script:HostUrl; tokenProtected = $enc; pollSeconds = $Script:PollSeconds }
  Write-Utf8Text $Script:SettingsFile (ConvertTo-Json -InputObject $obj -Depth 4)
}
function Get-PublicSettings {
  return @{ server = [string]$Script:HostUrl; tokenSet = [bool]$Script:Token; pollSeconds = [int]$Script:PollSeconds }
}
function Has-Field($body, [string]$name) {
  if ($null -eq $body) { return $false }
  if ($body -is [System.Collections.IDictionary]) { return $body.Contains($name) }
  return $null -ne $body.PSObject.Properties[$name]
}
function Apply-Settings($body) {
  if (Has-Field $body 'server') { $Script:HostUrl = (As-Str $body.server).Trim() }
  if (Has-Field $body 'pollSeconds') {
    $n = 0
    if ([int]::TryParse((As-Str $body.pollSeconds), [ref]$n)) {
      if ($n -lt 5) { $n = 5 }
      if ($n -gt 3600) { $n = 3600 }
      $Script:PollSeconds = $n
    }
  }
  if ((Has-Field $body 'token') -and (As-Str $body.token)) { $Script:Token = As-Str $body.token }
  Save-Settings
}
function Model-Path([string]$Hash) { Join-Path (Join-Path $Script:CacheDir 'models') ($Hash.ToLower() + '.obj') }
function Ensure-ModelFile([string]$Hash) {
  $Hash = $Hash.ToLower()
  if ($Hash -notmatch '^[0-9a-f]{8,128}$') { throw 'ungueltiger Hash' }
  $dest = Model-Path $Hash
  $folder = Split-Path -Parent $dest
  if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
  if (Test-Path -LiteralPath $dest) { return $dest }
  $url = (Get-ApiBase) + '/Files/' + $Hash
  $r = [System.Net.HttpWebRequest]::Create($url)
  $r.Method = 'GET'; $r.Timeout = 180000
  $r.Headers.Add('Authorization', "Bearer $($Script:Token)")
  $resp = $r.GetResponse()
  try {
    $fs = [IO.File]::Create($dest)
    $resp.GetResponseStream().CopyTo($fs)
    $fs.Close()
  } finally { $resp.Close() }
  return $dest
}
function Read-Query($ctx) {
  $map = @{}
  $query = [string]$ctx.Request.Url.Query
  if ($query.StartsWith('?')) { $query = $query.Substring(1) }
  foreach ($part in $query.Split('&')) {
    if (-not $part) { continue }
    $eq = $part.IndexOf('=')
    if ($eq -lt 0) { $map[[Uri]::UnescapeDataString($part)] = ''; continue }
    $k = [Uri]::UnescapeDataString($part.Substring(0, $eq))
    $v = [Uri]::UnescapeDataString($part.Substring($eq + 1))
    $map[$k] = $v
  }
  return $map
}
function Send-Bytes($ctx, [int]$Code, [byte[]]$Bytes, [string]$Type) {
  $ctx.Response.StatusCode = $Code
  $ctx.Response.ContentType = $Type
  if ($Bytes -and $Bytes.Length -gt 0) { $ctx.Response.OutputStream.Write($Bytes, 0, $Bytes.Length) }
}
function Send-Text($ctx, [int]$Code, [string]$Text, [string]$Type) {
  if (-not $Type) { $Type = 'text/plain; charset=utf-8' }
  Send-Bytes $ctx $Code ([Text.Encoding]::UTF8.GetBytes([string]$Text)) $Type
}
function Send-Json($ctx, [int]$Code, $Obj) {
  $ctx.Response.Headers['Cache-Control'] = 'no-store'
  Send-Text $ctx $Code (ConvertTo-PlainJson $Obj) 'application/json; charset=utf-8'
}
function Safe-ViewName([string]$Name) {
  $clean = ([string]$Name).Trim()
  if ($clean -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw 'ungueltiger Ansichtsname' }
  return $clean
}
function Get-ViewList {
  $items = New-List
  $dir = Join-Path $Script:AppDir 'views'
  if (Test-Path -LiteralPath $dir) {
    foreach ($file in @(Get-ChildItem -LiteralPath $dir -Filter '*.json' -File)) {
      [void]$items.Add(@{ name = [IO.Path]::GetFileNameWithoutExtension($file.Name) })
    }
  }
  return @{ items = $items }
}
function Read-View([string]$Name) {
  $safe = Safe-ViewName $Name
  $path = Join-Path (Join-Path $Script:AppDir 'views') ($safe + '.json')
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  return (Read-Utf8Text $path)
}
function Save-View([string]$Raw) {
  $obj = $Raw | ConvertFrom-Json
  $safe = Safe-ViewName (As-Str $obj.name)
  $dir = Join-Path $Script:AppDir 'views'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Write-Utf8Text (Join-Path $dir ($safe + '.json')) $Raw
}
function Join-IdSet($controls) {
  $ids = @()
  foreach ($c in @($controls)) {
    if ($null -eq $c) { continue }
    $id = As-Str $c.id
    if ($id) { $ids += [string]$id }
  }
  if ($ids.Count -lt 1) { return '' }
  for ($i = 0; $i -lt $ids.Count; $i++) {
    for ($j = $i + 1; $j -lt $ids.Count; $j++) {
      if ([string]$ids[$j] -lt [string]$ids[$i]) { $tmp = $ids[$i]; $ids[$i] = $ids[$j]; $ids[$j] = $tmp }
    }
  }
  return ($ids -join '|')
}
function Get-PieceControls([string]$PieceId) {
  $json = Invoke-DlGet (Build-Url '/Controls' @{ '$filter' = "inspectorPiece/id eq $PieceId" })
  $rows = @()
  foreach ($row in @(Get-Rows $json)) { $rows += $row }
  return ,$rows
}
function Limit-Of($c) {
  $low = 0.0; $up = 0.0
  if ($c.tolerance) {
    if ($null -ne $c.tolerance.low) { $low = [double]$c.tolerance.low }
    if ($null -ne $c.tolerance.up) { $up = [double]$c.tolerance.up }
  }
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
function Live-CacheKey($q) {
  $viewName = ''
  if ($q.Contains('view') -and [string]$q['view']) { return 'view-' + (Safe-ViewName ([string]$q['view'])) }
  $project = ''
  if ($q.Contains('project')) { $project = [string]$q['project'] }
  $tail = ''
  if ($q.Contains('template') -and [string]$q['template']) { $tail = [string]$q['template'] }
  elseif ($q.Contains('piece')) { $tail = 'piece-' + [string]$q['piece'] }
  $raw = "session-$project-$tail"
  return ($raw -replace '[^A-Za-z0-9_-]', '-')
}
function Live-CachePath([string]$Key) {
  $dir = Join-Path $Script:AppDir 'cache\live'
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  return (Join-Path $dir ($Key + '.json'))
}
function Convert-ToMap($v) {
  if ($null -eq $v) { return $null }
  if ($v -is [string] -or $v -is [bool] -or $v -is [ValueType]) { return $v }
  if ($v -is [System.Collections.IDictionary]) {
    $map = @{}
    foreach ($k in @($v.Keys)) { $map[[string]$k] = Convert-ToMap $v[$k] }
    return $map
  }
  if ($v -is [System.Collections.IEnumerable]) {
    $list = New-List
    foreach ($item in $v) { [void]$list.Add((Convert-ToMap $item)) }
    return ,$list
  }
  $map = @{}
  foreach ($p in @($v.PSObject.Properties)) { $map[$p.Name] = Convert-ToMap $p.Value }
  return $map
}
function Write-LiveCache([string]$Key, $Doc) { Write-Utf8Text (Live-CachePath $Key) (ConvertTo-PlainJson $Doc) }
function Read-LiveCache([string]$Key) {
  $path = Live-CachePath $Key
  if (-not (Test-Path -LiteralPath $path)) { return $null }
  $obj = (Read-Utf8Text $path) | ConvertFrom-Json
  return (Convert-ToMap $obj)
}
function Get-LivePieceRows([string]$projectId, [string]$templateId, [string]$basisId, [int]$top, [string]$from, [string]$to) {
  if (-not [string]::IsNullOrEmpty($templateId)) {
    $filter = Build-PieceFilter $projectId $templateId $from $to
    $json = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = $filter; '$orderby' = 'creationDateUser desc'; '$top' = [string]$top; '$select' = 'id,name,creationDateUser,userProperties' })
    return (Get-Rows $json)
  }
  # No template: same project, unlinked, same control UUID set.
  # If the chosen piece has snapshotHash, the piece must share that form snapshot too.
  $basis = Invoke-DlGet ((Get-ApiBase) + "/InspectorPieces/$basisId" + '?$select=id,name,snapshotHash')
  $snap = As-Str $basis.snapshotHash
  $basisSet = Join-IdSet (Get-PieceControls $basisId)
  $filter = (Build-PieceFilter $projectId '' $from $to) + ' and inspectorPieceTemplate eq null'
  $json = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = $filter; '$orderby' = 'creationDateUser desc'; '$top' = [string]$top; '$select' = 'id,name,creationDateUser,snapshotHash,userProperties' })
  $kept = New-List
  $listed = Get-Rows $json
  foreach ($row in $listed) {
    $rowSnap = As-Str $row.snapshotHash
    if ($snap.Length -gt 0 -and $rowSnap -cne $snap) { continue }
    $set = Join-IdSet (Get-PieceControls (As-Str $row.id))
    if ($set -ceq $basisSet) { [void]$kept.Add($row) }
  }
  return @($kept.ToArray())
}
function Build-LiveDocument($q) {
  $view = $null
  $viewName = ''
  if ($q.Contains('view') -and [string]$q['view']) { $viewName = [string]$q['view'] }
  $project = ''; $template = ''; $piece = ''; $partName = ''; $templateName = ''
  $ids = New-Object System.Collections.Generic.List[string]
  $poll = [int]$Script:PollSeconds
  if ($viewName) {
    $raw = Read-View $viewName
    if (-not $raw) { throw 'Ansicht fehlt' }
    $view = $raw | ConvertFrom-Json
    $project = As-Str $view.projectId
    $template = As-Str $view.templateId
    $piece = As-Str $view.pieceId
    $partName = As-Str $view.projectName
    $templateName = As-Str $view.templateName
    if ($view.pollSeconds) { $poll = [int]$view.pollSeconds }
    foreach ($c in @($view.controls)) {
      if ($null -eq $c) { continue }
      $take = $true
      if (($c.PSObject.Properties.Name -contains 'selected') -and ($c.selected -eq $false)) { $take = $false }
      if ($take -and (As-Str $c.id)) { [void]$ids.Add((As-Str $c.id)) }
    }
  } else {
    if ($q.Contains('project')) { $project = [string]$q['project'] }
    if ($q.Contains('template')) { $template = [string]$q['template'] }
    if ($q.Contains('piece')) { $piece = [string]$q['piece'] }
    $partName = $project
    $templateName = $template
    if ($q.Contains('controls') -and [string]$q['controls']) {
      foreach ($bit in ([string]$q['controls']).Split(',')) {
        $bit = $bit.Trim()
        if ($bit) { [void]$ids.Add($bit) }
      }
    }
  }
  if (-not $project) { throw 'Projekt fehlt' }
  $top = 25
  if ($q.Contains('top')) { [void][int]::TryParse([string]$q['top'], [ref]$top) }
  if ($top -lt 1) { $top = 1 }
  if ($top -gt 5000) { $top = 5000 }
  $from = ''; $to = ''
  if ($q.Contains('from')) { $from = [string]$q['from'] }
  if ($q.Contains('to')) { $to = [string]$q['to'] }
  $allow = @{}
  foreach ($id in $ids) { $allow[$id] = $true }
  $desc = @(Get-LivePieceRows $project $template $piece $top $from $to)
  $ordered = New-List
  for ($i = $desc.Count - 1; $i -ge 0; $i--) { if ($null -ne $desc[$i]) { [void]$ordered.Add($desc[$i]) } }
  $chars = @{}
  $charOrder = New-List
  foreach ($id in $ids) {
    if ($chars.ContainsKey($id)) { continue }
    $entry = @{ id = $id; name = $id; objectName = ''; controlName = ''; displayName = ''; unit = 'mm'; nominal = 0.0; usl = 0.0; lsl = 0.0; measurements = (New-List) }
    if ($view) {
      foreach ($c in @($view.controls)) {
        if ($null -ne $c -and (As-Str $c.id) -eq $id) {
          $entry.objectName = As-Str $c.objectName
          $entry.controlName = As-Str $c.name
          if ($entry.objectName) { $entry.name = ($entry.objectName + ' / ' + $entry.controlName) } else { $entry.name = $entry.controlName }
          if ($null -ne $c.nominal) { $entry.nominal = [double]$c.nominal }
          if ($null -ne $c.usl) { $entry.usl = [double]$c.usl }
          if ($null -ne $c.lsl) { $entry.lsl = [double]$c.lsl }
        }
      }
    }
    $chars[$id] = $entry
    [void]$charOrder.Add($id)
  }
  $pieceOut = New-List
  foreach ($p in $ordered) {
    $pieceId = As-Str $p.id
    [void]$pieceOut.Add(@{ id = $pieceId; name = (As-Str $p.name); timestamp = (As-Str $p.creationDateUser) })
    $controls = Get-PieceControls $pieceId
    foreach ($c in $controls) {
      $id = As-Str $c.id
      if (-not $allow.ContainsKey($id)) { continue }
      if (-not $chars.ContainsKey($id)) { continue }
      $lim = Limit-Of $c
      $chars[$id].nominal = $lim.nominal
      $chars[$id].usl = $lim.usl
      $chars[$id].lsl = $lim.lsl
      $chars[$id].unit = Unit-Of $c
      $chars[$id].objectName = As-Str $c.objectName
      $chars[$id].controlName = As-Str $c.name
      if ($chars[$id].objectName) { $chars[$id].name = ($chars[$id].objectName + ' / ' + $chars[$id].controlName) }
      if ($null -eq $c.measured) { continue }
      $stamp = As-Str $c.measurementDateTime
      if (-not $stamp) { $stamp = As-Str $p.creationDateUser }
      [void]$chars[$id].measurements.Add(@{ pieceId = $pieceId; pieceName = (As-Str $p.name); value = [double]$c.measured; timestamp = $stamp; creationDateUser = (As-Str $p.creationDateUser); userProperties = @{} })
    }
  }
  $charOut = New-List
  foreach ($id in $charOrder) { [void]$charOut.Add($chars[$id]) }
  $tplId = $template
  $tplLabel = $templateName
  if (-not $tplId -and $piece) { $tplId = 'piece:' + $piece; if (-not $tplLabel) { $tplLabel = $piece } }
  return @{
    schemaVersion = 1
    source = 'live'
    stale = $false
    refreshSeconds = $poll
    fetchedAt = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    part = @{ id = $project; name = $(if ($partName) { $partName } else { $project }); template = @{ id = $tplId; name = $tplLabel } }
    pieces = $pieceOut
    features = (New-List)
    characteristics = $charOut
  }
}
function Get-LiveResponse($q) {
  $key = Live-CacheKey $q
  try {
    $doc = Build-LiveDocument $q
    Write-LiveCache $key $doc
    return $doc
  } catch {
    $cached = Read-LiveCache $key
    if ($null -eq $cached) { throw }
    $cached.stale = $true
    return $cached
  }
}
function Add-DayCount($buckets, [string]$stamp) {
  if ($stamp.Length -lt 10) { return }
  $day = $stamp.Substring(0, 10)
  if ($day -notmatch '^\d{4}-\d{2}-\d{2}$') { return }
  if (-not $buckets.ContainsKey($day)) { $buckets[$day] = 0 }
  $buckets[$day] = [int]$buckets[$day] + 1
}
function Get-Timeline($q) {
  $project = ''; $template = ''; $piece = ''
  if ($q.Contains('view') -and [string]$q['view']) {
    $raw = Read-View ([string]$q['view'])
    if (-not $raw) { throw 'Ansicht fehlt' }
    $view = $raw | ConvertFrom-Json
    $project = As-Str $view.projectId
    $template = As-Str $view.templateId
    $piece = As-Str $view.pieceId
  } else {
    if ($q.Contains('project')) { $project = [string]$q['project'] }
    if ($q.Contains('template')) { $template = [string]$q['template'] }
    if ($q.Contains('piece')) { $piece = [string]$q['piece'] }
  }
  if (-not $project) { throw 'Projekt fehlt' }
  if ($template) { $filter = Build-PieceFilter $project $template '' '' }
  else { $filter = (Build-PieceFilter $project '' '' '') + ' and inspectorPieceTemplate eq null' }
  $buckets = @{}
  $total = 0
  $skip = 0
  for ($guard = 0; $guard -lt 40; $guard++) {
    $json = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = $filter; '$select' = 'creationDateUser'; '$orderby' = 'creationDateUser'; '$top' = '200'; '$skip' = [string]$skip })
    $batch = Get-Rows $json
    $n = 0
    foreach ($row in $batch) {
      $n++
      $total++
      Add-DayCount $buckets (As-Str $row.creationDateUser)
    }
    if ($n -lt 200) { break }
    $skip += 200
  }
  $days = New-List
  foreach ($day in @($buckets.Keys | Sort-Object)) { [void]$days.Add(@{ date = [string]$day; count = [int]$buckets[$day] }) }
  return @{ total = $total; buckets = $days }
}
function Handle-Api($ctx, [string]$Method, [string]$Path) {
  if ($Path -eq '/api/version' -and $Method -eq 'GET') { Send-Json $ctx 200 @{ name = 'DL-Merkmal-Viewer'; version = $Script:Version }; return }
  if ($Path -eq '/api/settings') {
    if ($Method -eq 'GET') { Send-Json $ctx 200 (Get-PublicSettings); return }
    if ($Method -eq 'POST') {
      $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
      $raw = $reader.ReadToEnd(); $reader.Close()
      $body = $null
      if ($raw) { $body = $raw | ConvertFrom-Json }
      Apply-Settings $body
      Send-Json $ctx 200 (Get-PublicSettings)
      return
    }
  }
  $q = Read-Query $ctx
  if ($Path -eq '/api/live' -and $Method -eq 'GET') { Send-Json $ctx 200 (Get-LiveResponse $q); return }
  if ($Path -eq '/api/timeline' -and $Method -eq 'GET') { Send-Json $ctx 200 (Get-Timeline $q); return }
  if ($Path -eq '/api/projects' -and $Method -eq 'GET') {
    $top = 20; $skip = 0
    if ($q.Contains('top')) { [void][int]::TryParse([string]$q['top'], [ref]$top) }
    if ($q.Contains('skip')) { [void][int]::TryParse([string]$q['skip'], [ref]$skip) }
    $nameQ = ''; $ws = ''
    if ($q.Contains('q')) { $nameQ = [string]$q['q'] }
    if ($q.Contains('workspace')) { $ws = [string]$q['workspace'] }
    Send-Json $ctx 200 (Get-ProjectPage $nameQ $ws $top $skip)
    return
  }
  if ($Path -match '^/api/projects/([^/]+)/templates$' -and $Method -eq 'GET') {
    Send-Json $ctx 200 (Get-PieceTemplates ([Uri]::UnescapeDataString($Matches[1])))
    return
  }
  if ($Path -match '^/api/projects/([^/]+)/pieces$' -and $Method -eq 'GET') {
    $top = 40
    if ($q.Contains('top')) { [void][int]::TryParse([string]$q['top'], [ref]$top) }
    $unlinked = $false
    if ($q.Contains('unlinked') -and [string]$q['unlinked'] -eq '1') { $unlinked = $true }
    $nameQ = ''
    if ($q.Contains('q')) { $nameQ = [string]$q['q'] }
    Send-Json $ctx 200 (Get-ProjectPieces ([Uri]::UnescapeDataString($Matches[1])) $unlinked $nameQ $top)
    return
  }
  if ($Path -match '^/api/pieces/([^/]+)/models$' -and $Method -eq 'GET') {
    Send-Json $ctx 200 (Get-PieceModels ([Uri]::UnescapeDataString($Matches[1])))
    return
  }
  if ($Path -match '^/api/models/([0-9a-fA-F]+)$' -and $Method -eq 'GET') {
    $hash = $Matches[1].ToLower()
    $cachedOnly = $q.Contains('cached') -and [string]$q['cached'] -eq '1'
    if ($cachedOnly) {
      $file = Model-Path $hash
      if (-not (Test-Path -LiteralPath $file)) { Send-Json $ctx 404 @{ error = 'nicht im Cache' }; return }
    } else { $file = Ensure-ModelFile $hash }
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentType = 'model/obj'
    $ctx.Response.Headers['Cache-Control'] = 'public, max-age=86400'
    $fs = [IO.File]::OpenRead($file)
    try { $fs.CopyTo($ctx.Response.OutputStream) } finally { $fs.Close() }
    return
  }
  if ($Path -eq '/api/views' -and $Method -eq 'GET') { Send-Json $ctx 200 (Get-ViewList); return }
  if ($Path -eq '/api/views' -and $Method -eq 'POST') {
    $reader = New-Object IO.StreamReader($ctx.Request.InputStream, [Text.Encoding]::UTF8)
    $raw = $reader.ReadToEnd(); $reader.Close()
    Save-View $raw
    Send-Json $ctx 200 @{ ok = $true }
    return
  }
  if ($Path -match '^/api/views/([A-Za-z0-9_-]+)$' -and $Method -eq 'GET') {
    $file = Read-View ([Uri]::UnescapeDataString($Matches[1]))
    if ($null -eq $file) { Send-Json $ctx 404 @{ error = 'nicht gefunden' }; return }
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentType = 'application/json; charset=utf-8'
    $ctx.Response.Headers['Cache-Control'] = 'no-store'
    $bytes = [Text.Encoding]::UTF8.GetBytes($file)
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    return
  }
  if ($Path -eq '/api/controls' -and $Method -eq 'GET') {
    $templateId = ''; $pieceId = ''
    if ($q.Contains('templateId')) { $templateId = [string]$q['templateId'] }
    if ($q.Contains('pieceId')) { $pieceId = [string]$q['pieceId'] }
    Send-Json $ctx 200 (Get-NamedControls $templateId $pieceId)
    return
  }
  Send-Json $ctx 404 @{ error = 'nicht gefunden' }
}
function Handle-Request($ctx) {
  $path = [string]$ctx.Request.Url.AbsolutePath
  $method = [string]$ctx.Request.HttpMethod
  if ($path -eq '/' -or $path -eq '') { $path = '/index.html' }
  if ($path.StartsWith('/api/')) {
    if (-not $ctx.Request.IsLocal) { Send-Text $ctx 403 'nur localhost' 'text/plain; charset=utf-8'; return }
    Handle-Api $ctx $method $path
    return
  }
  $rel = $path.TrimStart('/')
  if ($rel.Contains('..') -or -not $Script:Www) { $ctx.Response.StatusCode = 400; return }
  $full = [IO.Path]::GetFullPath((Join-Path $Script:Www ($rel -replace '/', '\')))
  $root = [IO.Path]::GetFullPath($Script:Www)
  if (-not $root.EndsWith('\')) { $root += '\' }
  if ($full.StartsWith($root) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    $type = 'application/octet-stream'
    if ($ext -eq '.html') { $type = 'text/html; charset=utf-8' }
    elseif ($ext -eq '.js') { $type = 'text/javascript; charset=utf-8' }
    elseif ($ext -eq '.css') { $type = 'text/css; charset=utf-8' }
    elseif ($ext -eq '.json') { $type = 'application/json; charset=utf-8' }
    elseif ($ext -eq '.obj') { $type = 'model/obj' }
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentType = $type
    $buf = [IO.File]::ReadAllBytes($full)
    $ctx.Response.OutputStream.Write($buf, 0, $buf.Length)
  } else { $ctx.Response.StatusCode = 404 }
}
function Ensure-Dirs {
  foreach ($rel in @('', 'views', 'cache', 'cache\models', 'cache\www', 'logs')) {
    $p = if ($rel) { Join-Path $Script:AppDir $rel } else { $Script:AppDir }
    if (-not (Test-Path $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
  }
}
function Install-Self {
  Ensure-Dirs
  $src = $env:DL_LAUNCH
  if (-not $src -or -not (Test-Path -LiteralPath $src)) { return }
  $dest = Join-Path $Script:AppDir 'DL-Merkmal-Viewer.cmd'
  if ([IO.Path]::GetFullPath($src) -eq [IO.Path]::GetFullPath($dest)) { return }
  Copy-Item -LiteralPath $src -Destination $dest -Force
}
function Find-BundleRoot {
  $launch = $env:DL_LAUNCH
  if (-not $launch) { return '' }
  $dir = Split-Path -Parent $launch
  $parent = Split-Path -Parent $dir
  if ($parent -and (Test-Path (Join-Path $parent 'index.html'))) { return $parent }
  if (Test-Path (Join-Path $dir 'index.html')) { return $dir }
  return ''
}
function Ensure-Cache {
  $web = Join-Path $Script:CacheDir 'www'
  if (-not (Test-Path $web)) { New-Item -ItemType Directory -Path $web | Out-Null }
  $bundle = Find-BundleRoot
  foreach ($rel in $Script:StaticFiles) {
    $dest = Join-Path $web ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
    $folder = Split-Path -Parent $dest
    if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder | Out-Null }
    $copied = $false
    if ($bundle) {
      $src = Join-Path $bundle ($rel -replace '/', [IO.Path]::DirectorySeparatorChar)
      if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $dest -Force; $copied = $true }
    }
    if ($copied) { continue }
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
  $Script:Www = $web
}
function Install-WinFormsGuard {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.Application]::SetUnhandledExceptionMode('CatchException')
    $handler = [System.Threading.ThreadExceptionEventHandler] {
      param($sender, $e)
      try { Write-Log $e.Exception.ToString() } catch {}
    }
    [System.Windows.Forms.Application]::add_ThreadException($handler)
  } catch { Write-Log $_.Exception.Message }
}
function Show-Status {
  Install-WinFormsGuard
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $f = New-Object Windows.Forms.Form
  $Script:StatusForm = $f
  $f.Text = "DL-Merkmal-Viewer $($Script:Version)"
  $f.FormBorderStyle = 'FixedDialog'
  $f.StartPosition = 'CenterScreen'
  $f.ClientSize = New-Object Drawing.Size(420, 150)
  $f.MaximizeBox = $false
  $label = New-Object Windows.Forms.Label -Property @{ Left = 12; Top = 12; Width = 390; Height = 48; Text = "Version $($Script:Version). Einstellungen, Projekt und Merkmale stehen im Browser." }
  $open = New-Object Windows.Forms.Button -Property @{ Text = 'Im Browser oeffnen'; Left = 12; Top = 70; Width = 160 }
  $quit = New-Object Windows.Forms.Button -Property @{ Text = 'Beenden'; Left = 180; Top = 70; Width = 100 }
  $f.Controls.AddRange(@($label, $open, $quit))
  $open.Add_Click({ try { Start-Process 'http://localhost:8765/' } catch { Write-Log $_.Exception.Message } })
  $quit.Add_Click({
    try {
      $Script:Stop = $true
      if ($Script:StatusForm) { $Script:StatusForm.Close() }
    } catch { Write-Log $_.Exception.Message }
  })
  $f.Add_FormClosed({ try { $Script:Stop = $true } catch { Write-Log $_.Exception.Message } })
  $f.Show()
  return $f
}
function Start-ServerLoop {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add('http://localhost:8765/')
  $listener.Start()
  $form = $null
  try { $form = Show-Status } catch { Write-Log $_.Exception.Message }
  if (-not $env:DL_NO_BROWSER) { try { Start-Process 'http://localhost:8765/' } catch { Write-Log $_.Exception.Message } }
  while (-not $Script:Stop) {
    try {
      if ($form) { [Windows.Forms.Application]::DoEvents() }
      $async = $listener.BeginGetContext($null, $null)
      if (-not $async) { continue }
      while (-not $async.IsCompleted -and -not $Script:Stop) {
        if ($form) { [Windows.Forms.Application]::DoEvents() }
        if ($async.AsyncWaitHandle.WaitOne(40)) { break }
      }
      if ($Script:Stop -or -not $async.IsCompleted) { continue }
      $ctx = $null
      try { $ctx = $listener.EndGetContext($async) } catch { continue }
      if (-not $ctx) { continue }
      try { Handle-Request $ctx } catch { Write-Log $_.Exception.Message; try { Send-Json $ctx 500 @{ error = 'Fehler' } } catch {} }
      finally { try { if ($ctx.Response) { $ctx.Response.OutputStream.Close() } } catch {} }
    } catch { Write-Log $_.Exception.Message }
  }
  try { $listener.Stop(); $listener.Close() } catch { Write-Log $_.Exception.Message }
  try { if ($Script:StatusForm) { $Script:StatusForm.Dispose() } } catch { Write-Log $_.Exception.Message }
}
function Get-MockBody([string]$Url) {
  $Url = [Uri]::UnescapeDataString($Url)
  if ($Url -match '/InspectorPieceTemplates/.+/Form') { return '{"controls":[{"id":"ctl-1"},{"id":"ctl-2"}]}' }
  if ($Url -match 'InspectorPieceTemplates') { return '{"value":[{"id":"tpl-1","name":"Stand B"}]}' }
  if ($Url -match 'InspectorProjects' -and $Url -match 'expand=inspectorPieceTemplates') { return '{"id":"proj-beta","inspectorPieceTemplates":[]}' }
  if ($Url -match 'InspectorProjects' -and $Url -match 'proj-beta') { return '{"value":[]}' }
  if ($Url -match 'InspectorProjects') { return '{"@odata.count":1,"value":[{"id":"proj-alpha","name":"Projekt Alpha","workspace":{"id":"ws-1","name":"Arbeitsbereich Eins"}}]}' }
  if ($Url -match '\$count=true') { return '{"@odata.count":4,"value":[{"id":"piece-a"}]}' }
  if ($Url -match '/Models') { return '[{"name":"Gehaeuse.prt","_links":{"obj":{"href":"/v2/Files/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","type":"model/obj"}}},{"name":"Deckel.prt","_links":{"obj":{"href":"/v2/Files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","type":"model/obj"}}},{"name":"Deckel Kopie.prt","_links":{"obj":{"href":"/v2/Files/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","type":"model/obj"}}}]' }
  if ($Url -match 'inspectorPieceTemplate eq null') { return '{"value":[{"id":"piece-loose","name":"Teil Ohne Vorlage"}]}' }
  if ($Url -match 'inspectorPieceTemplate/id eq tpl-1' -and $Url -match '\$select=id') { return '{"value":[{"id":"piece-a"}]}' }
  if ($Url -match 'inspectorPiece/id eq piece-loose') { return '{"value":[{"id":"ctl-9","objectName":"Flaeche","name":"Ebenheit","type":"Flatness","nominal":0,"tolerance":{"low":0,"up":0.05}}]}' }
  if ($Url -match 'inspectorPiece/id eq piece-a') { return '{"value":[{"id":"ctl-1","objectName":"Objekt 1","name":"Merkmal A","type":"Distance","nominal":10,"tolerance":{"low":-0.1,"up":0.2}},{"id":"ctl-2","objectName":"Objekt 2","name":"Merkmal B","type":"Angle","nominal":90,"tolerance":{"low":-0.5,"up":0.5}}]}' }
  if ($Url -match 'InspectorPieces') { return '{"value":[]}' }
  return '{"value":[]}'
}
function Get-TwoTemplateMock([string]$Url) {
  $Url = [Uri]::UnescapeDataString($Url)
  if ($Url -match 'InspectorPieceTemplates') { return '{"value":[{"id":"tpl-a","name":"Stand A"},{"id":"tpl-b","name":"Stand B"}]}' }
  if ($Url -match '\$count=true' -and $Url -match 'tpl-a') { return '{"@odata.count":400,"value":[]}' }
  if ($Url -match '\$count=true' -and $Url -match 'tpl-b') { return '{"@odata.count":635,"value":[]}' }
  if ($Url -match '\$select=id') { return '{"value":[{"id":"piece-sample"}]}' }
  return '{"value":[]}'
}
function Get-NameMock([string]$Url) {
  $Url = [Uri]::UnescapeDataString($Url)
  if ($Url -match '/Form') { return '{"controls":[{"id":"ctl-1"},{"id":"ctl-2"},{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"}]}' }
  if ($Url -match '\$select=id') { return '{"value":[{"id":"piece-new"},{"id":"piece-old"}]}' }
  if ($Url -match 'piece-new') { return '{"value":[{"id":"ctl-1","objectName":"Langloch 1","name":"Mating Length 1","type":"Distance","nominal":10,"tolerance":{"low":-0.1,"up":0.1}}]}' }
  if ($Url -match 'piece-old') { return '{"value":[{"id":"ctl-2","objectName":"Zylinder 4","name":"Position 1","type":"Position","nominal":0,"tolerance":{"low":-0.2,"up":0.2}}]}' }
  return '{"value":[]}'
}
function Get-LiveMock([string]$Url) {
  $Url = [Uri]::UnescapeDataString($Url)
  if ($Url -match 'inspectorPieceTemplate/id eq tpl-b') { return '{"value":[{"id":"piece-b","name":"Teil B","creationDateUser":"2026-11-01T00:00:00Z"}]}' }
  if ($Url -match 'inspectorPieceTemplate/id eq tpl-a') { return '{"value":[{"id":"piece-a","name":"Teil A","creationDateUser":"2026-11-02T00:00:00Z"}]}' }
  if ($Url -match '/InspectorPieces/piece-loose') { return '{"id":"piece-loose","name":"Teil Lose","snapshotHash":"snap-1"}' }
  if ($Url -match 'inspectorPieceTemplate eq null') { return '{"value":[{"id":"piece-loose","name":"Teil Lose","creationDateUser":"2026-11-03T00:00:00Z","snapshotHash":"snap-1"},{"id":"piece-other","name":"Teil Anders","creationDateUser":"2026-11-04T00:00:00Z","snapshotHash":"snap-1"},{"id":"piece-same","name":"Teil Gleich","creationDateUser":"2026-11-05T00:00:00Z","snapshotHash":"snap-1"},{"id":"piece-oldsnap","name":"Teil Alt","creationDateUser":"2026-11-06T00:00:00Z","snapshotHash":"snap-9"}]}' }
  if ($Url -match 'inspectorPiece/id eq piece-b') { return '{"value":[{"id":"ctl-b1","objectName":"Objekt B","name":"Merkmal B","nominal":1,"tolerance":{"low":-0.1,"up":0.1},"measured":1.01},{"id":"ctl-b2","objectName":"Objekt B","name":"Nicht Gewaehlt","nominal":2,"tolerance":{"low":0,"up":0.2},"measured":2}]}' }
  if ($Url -match 'inspectorPiece/id eq piece-a') { return '{"value":[{"id":"ctl-a1","objectName":"Objekt A","name":"Merkmal A","nominal":3,"tolerance":{"low":0,"up":0.1},"measured":3}]}' }
  if ($Url -match 'inspectorPiece/id eq piece-loose' -or $Url -match 'inspectorPiece/id eq piece-same' -or $Url -match 'inspectorPiece/id eq piece-oldsnap') { return '{"value":[{"id":"ctl-u1","objectName":"Flaeche","name":"Ebenheit","nominal":0,"tolerance":{"low":0,"up":0.05},"measured":0.01},{"id":"ctl-u2","objectName":"Kante","name":"Laenge","nominal":5,"tolerance":{"low":-0.1,"up":0.1},"measured":5.02}]}' }
  if ($Url -match 'inspectorPiece/id eq piece-other') { return '{"value":[{"id":"ctl-x","objectName":"Fremd","name":"Fremd","nominal":9,"tolerance":{"low":0,"up":1},"measured":9}]}' }
  return '{"value":[]}'
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
  $one = ConvertTo-PlainJson @{ characteristics = @(@{ id = 'nur-eins'; measurements = @(@{ value = 1.5 }) }) }
  if ($one -notmatch '"characteristics":\[') { throw 'Einzelnes Merkmal muss ein Array sein' }
  if ($one -notmatch '"measurements":\[') { throw 'Einzelner Messwert muss ein Array sein' }
  $filter = Build-PieceFilter 'proj-1' 'tpl-1' '2026-01-01' '2026-01-31'
  if ($filter -notmatch 'inspectorProject/id eq proj-1') { throw 'Projektfilter fehlt' }
  if ($filter -notmatch 'inspectorPieceTemplate/id eq tpl-1') { throw 'Templatefilter fehlt' }
  if ($filter -notmatch 'creationDateUser ge 2026-01-01T00:00:00Z') { throw 'Von-Datum fehlt' }
  if ($filter -notmatch 'creationDateUser le 2026-01-31T23:59:59Z') { throw 'Bis-Datum fehlt' }
  $bare = Build-PieceFilter 'proj-1' '' '' ''
  if ($bare -match 'inspectorPieceTemplate') { throw 'Ohne Vorlage kein Templatefilter' }
  $settingsDir = Join-Path ([IO.Path]::GetTempPath()) ('dl-merkmal-set-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $settingsDir | Out-Null
  $Script:SettingsFile = Join-Path $settingsDir 'settings.json'
  $Script:HostUrl = 'https://example.test'
  $Script:Token = 'plain-secret-value'
  $Script:PollSeconds = 45
  Save-Settings
  $saved = Read-Utf8Text $Script:SettingsFile
  if ($saved -match 'plain-secret-value') { throw 'Token steht im Klartext' }
  if ($saved -notmatch 'tokenProtected') { throw 'tokenProtected fehlt' }
  $Script:Token = ''
  $Script:HostUrl = ''
  Load-Settings | Out-Null
  if ($Script:Token -ne 'plain-secret-value') { throw 'Token wurde nicht entschluesselt' }
  $public = ConvertTo-PlainJson (Get-PublicSettings)
  if ($public -match 'plain-secret-value' -or $public -match 'tokenProtected') { throw 'Token an den Browser' }
  if ($public -notmatch '"tokenSet":true') { throw 'tokenSet fehlt' }
  Remove-Item -Recurse -Force $settingsDir
  $Script:HostUrl = 'https://example.test'
  $Script:MockJson = { param($Url) return (Get-MockBody $Url) }
  $Script:MockSizes = @{ 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' = [int64]1200000; 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' = [int64]62914560 }
  $Script:MockCalls = 0
  $page = Get-ProjectPage 'alpha' '' 20 0
  $decoded = [Uri]::UnescapeDataString($Script:LastUrl)
  if ($decoded -notmatch 'contains\(tolower\(name\)') { throw 'Suche nutzt nicht contains(tolower(name))' }
  if ($Script:LastUrl -match 'nextLink') { throw 'nextLink darf nicht angefragt werden' }
  if ($page.items.Count -ne 1 -or $page.items[0].name -ne 'Projekt Alpha') { throw 'Projektsuche leer' }
  if ($page.items[0].workspaceName -ne 'Arbeitsbereich Eins') { throw 'Workspace fehlt' }
  $Script:MockJson = { param($Url) if ($Url -match 'InspectorPieceTemplates' -and $Url -notmatch 'Form') { return '{"value":[]}' }; if ($Url -match 'expand=inspectorPieceTemplates') { return '{"id":"proj-beta","inspectorPieceTemplates":[]}' }; return (Get-MockBody $Url) }
  $none = Get-PieceTemplates 'proj-beta'
  if ($none.items.Count -ne 0) { throw 'Projekt ohne Vorlage hat Vorlagen' }
  $pieces = Get-ProjectPieces 'proj-beta' $true '' 20
  if (([Uri]::UnescapeDataString($Script:LastUrl)) -notmatch 'inspectorPieceTemplate eq null') { throw 'Unlinked-Filter fehlt' }
  if ($pieces.items.Count -ne 1 -or $pieces.items[0].id -ne 'piece-loose') { throw 'Teil ohne Vorlage fehlt' }
  $Script:MockJson = { param($Url) return (Get-MockBody $Url) }
  $tpl = Get-PieceTemplates 'proj-alpha'
  if ($tpl.items.Count -ne 1 -or $tpl.items[0].pieceCount -ne 4) { throw 'Vorlage oder Teilezahl falsch' }
  if ($tpl.items[0].samplePieceId -ne 'piece-a') { throw 'Beispielteil fehlt' }
  $models = Get-PieceModels 'piece-asm'
  if ($models.items.Count -ne 3) { throw 'Drei Modelle erwartet' }
  $hashes = @{}
  foreach ($m in $models.items) { $hashes[$m.hash] = $true }
  if ($hashes.Count -ne 2) { throw 'Doppelter Hash muss gleich bleiben' }
  $large = $false
  foreach ($m in $models.items) { if ([int64]$m.sizeBytes -gt 50MB) { $large = $true } }
  if (-not $large) { throw 'Grosse Datei ohne Groesse' }
  $named = Get-NamedControls 'tpl-1' ''
  if ($named.items.Count -ne 2 -or $named.items[0].objectName -ne 'Objekt 1' -or $named.items[0].id -ne 'ctl-1') { throw 'Vorlagen-Merkmale falsch' }
  $loose = Get-NamedControls '' 'piece-loose'
  if ($loose.items.Count -ne 1 -or $loose.items[0].name -ne 'Ebenheit') { throw 'Teil-Merkmale falsch' }
  $Script:MockJson = { param($Url) return (Get-TwoTemplateMock $Url) }
  $two = Get-PieceTemplates 'proj-two'
  if ($two.items.Count -ne 2) { throw 'Zwei Vorlagen erwartet' }
  $byName = @{}
  foreach ($item in $two.items) { $byName[(As-Str $item.name)] = [int]$item.pieceCount }
  if ($byName['Stand A'] -ne 400 -or $byName['Stand B'] -ne 635) { throw 'Teilezahl ist gedeckelt' }
  if (([Uri]::UnescapeDataString([string]$Script:LastCountUrl)) -notmatch '\$top=0') { throw 'Zaehlung nutzt nicht top=0' }
  $Script:MockJson = { param($Url) return (Get-NameMock $Url) }
  $namedMany = Get-NamedControls 'tpl-names' ''
  if ($namedMany.items.Count -ne 3) { throw 'Drei Merkmale erwartet' }
  $labels = @{}
  foreach ($item in $namedMany.items) { $labels[(As-Str $item.id)] = As-Str $item.label }
  if ($labels['ctl-1'] -ne 'Langloch 1 / Mating Length 1') { throw 'Erster Name falsch' }
  if ($labels['ctl-2'] -ne 'Zylinder 4 / Position 1') { throw 'Name aus weiterem Teil fehlt' }
  if ($labels['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'] -notmatch '^unbenannt \(aaaaaaaa\)') { throw 'Unbenanntes Merkmal zeigt eine UUID' }
  $Script:MockJson = { param($Url) return (Get-MockBody $Url) }
  if ($launch -and (([IO.File]::ReadAllText($launch)) -notmatch 'SetUnhandledExceptionMode')) { throw 'Kein globaler Fehlerhandler' }
  if ($launch -and (([IO.File]::ReadAllText($launch)) -notmatch 'log.txt')) { throw 'log.txt fehlt' }
  if ($launch -and (([IO.File]::ReadAllText($launch)) -notmatch 'Script:StatusForm')) { throw 'Fenster wird als Null geschlossen' }
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add('http://127.0.0.1:8778/')
  $listener.Start()
  $client = New-Object System.Net.Http.HttpClient
  $task = $client.GetAsync('http://127.0.0.1:8778/api/version')
  $ctx = $listener.GetContext()
  Handle-Request $ctx
  try { $ctx.Response.OutputStream.Close() } catch {}
  $body = $task.Result.Content.ReadAsStringAsync().Result
  $listener.Stop(); $listener.Close()
  if ($body -notmatch '"version":"0.9.0"') { throw "Version falsch: $body" }
  $viewRoot = Join-Path ([IO.Path]::GetTempPath()) ('dl-views-' + [guid]::NewGuid().ToString('N'))
  $Script:AppDir = $viewRoot
  $viewJson = '{"schemaVersion":2,"name":"ansicht-1","projectId":"proj-alpha","templateId":"tpl-1","pieceId":null,"models":[{"name":"Gehaeuse.prt","hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","enabled":true}],"labelSize":"small","controls":[{"id":"ctl-1","objectName":"Objekt 1","name":"Merkmal A","color":"#2456b5","selected":true}],"placements":{"ctl-1":{"color":"#2456b5","anchor":{"kind":"geometry","geometryId":"geo-1","mode":"contour","point":{"x":1,"y":2,"z":3}}}},"geometries":[],"camera":null}'
  Save-View $viewJson
  $listed = Get-ViewList
  if ($listed.items.Count -ne 1 -or $listed.items[0].name -ne 'ansicht-1') { throw 'Ansicht fehlt in der Liste' }
  $loaded = Read-View 'ansicht-1'
  if ($loaded -notmatch 'proj-alpha' -or $loaded -notmatch 'tpl-1' -or $loaded -notmatch 'ctl-1' -or $loaded -notmatch 'contour' -or $loaded -notmatch '#2456b5') { throw 'Ansicht nicht vollstaendig gelesen' }
  $bad = $false
  try { Safe-ViewName '..\evil' | Out-Null } catch { $bad = $true }
  if (-not $bad) { throw 'Pfad in der Ansicht war erlaubt' }
  $Script:MockJson = { param($Url) return (Get-LiveMock $Url) }
  $viewB = '{"schemaVersion":2,"name":"ansicht-b","projectId":"proj-1","projectName":"Projekt Eins","templateId":"tpl-b","templateName":"Stand B","pieceId":null,"pollSeconds":30,"controls":[{"id":"ctl-b1","objectName":"Objekt B","name":"Merkmal B","nominal":1,"usl":1.1,"lsl":0.9,"selected":true},{"id":"ctl-a1","objectName":"Objekt A","name":"Merkmal A","nominal":3,"usl":3.1,"lsl":2.9,"selected":false}],"placements":{},"geometries":[],"models":[]}'
  Save-View $viewB
  $live = Get-LiveResponse @{ view = 'ansicht-b'; top = '10' }
  $liveJson = ConvertTo-PlainJson $live
  if ($liveJson -match 'ctl-a1' -or $liveJson -match 'piece-a' -or $liveJson -match 'zyl-a-dm' -or $liveJson -match 'ctl-b2') { throw "Vorlage mischt fremde Merkmale: $liveJson" }
  if ($liveJson -notmatch 'ctl-b1' -or $liveJson -notmatch 'piece-b' -or $liveJson -notmatch 'tpl-b') { throw 'Gewaehltes Merkmal fehlt' }
  if ($live.stale) { throw 'Frische Live-Antwort ist veraltet' }
  $loose = Get-LiveResponse @{ project = 'proj-1'; piece = 'piece-loose'; controls = 'ctl-u1,ctl-u2'; top = '20' }
  $looseJson = ConvertTo-PlainJson $loose
  if ($looseJson -notmatch 'piece-loose' -or $looseJson -notmatch 'piece-same') { throw 'Gleiche Kontrollmenge fehlt' }
  if ($looseJson -match 'piece-other' -or $looseJson -match 'piece-oldsnap' -or $looseJson -match 'ctl-x' -or $looseJson -match 'tpl-b') { throw "Teile ohne Vorlage vermischt: $looseJson" }
  $Script:MockJson = { param($Url) throw 'offline' }
  $stale = Get-LiveResponse @{ view = 'ansicht-b'; top = '10' }
  if (-not $stale.stale) { throw 'Cache wird nicht als veraltet markiert' }
  $staleJson = ConvertTo-PlainJson $stale
  if ($staleJson -notmatch 'ctl-b1' -or $staleJson -match 'ctl-a1' -or $staleJson -match 'zyl-a-dm') { throw 'Veralteter Cache ist falsch' }
  Remove-Item -Recurse -Force $viewRoot
  Write-Host 'SelfTest OK'
}
if ($env:DL_MERKMAL_SELFTEST -eq '1') { Invoke-SelfTest; exit 0 }
Install-Self
Ensure-Dirs
try { Load-Settings | Out-Null } catch { Write-Log $_.Exception.Message }
try { Ensure-Cache } catch {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'DL-Merkmal-Viewer')
  exit 1
}
Start-ServerLoop
exit 0
