@echo off
set "DL_LAUNCH=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$t=Get-Content -LiteralPath $env:DL_LAUNCH -Raw -Encoding UTF8; $m='#__POWERSHELL__'; $i=$t.LastIndexOf($m); if($i -lt 0){Write-Host 'Startmarker fehlt'; exit 1}; iex $t.Substring($i+$m.Length)"
exit /b
#__POWERSHELL__
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { $env:LOCALAPPDATA = [IO.Path]::GetTempPath() }
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
$Script:Version = '0.6.0'
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
  'index.html','css/app.css','js/app.js','js/wizard.js','js/data-source.js','js/geometry.js','js/label-template.js','js/fit.js','js/mesh-select.js','js/tumble-controls.js','js/tumble.js','js/mw-vec.js','js/pointertap.js','js/viewsnap.js','js/viewcube.js','js/polyline.js','data/layout.json','data/example-measurements.json','models/milkyway.obj'
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
    $path = Join-Path $Script:AppDir 'logs\helper.log'
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
function Get-Rows($json) {
  $list = New-List
  if ($null -eq $json) { return $list }
  $value = $null
  if ($json -is [System.Array]) { $value = $json }
  elseif ($json.PSObject.Properties.Name -contains 'value') { $value = $json.value }
  if ($null -eq $value) { return $list }
  foreach ($row in @($value)) { if ($null -ne $row) { [void]$list.Add($row) } }
  return $list
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
  $copy['$top'] = '1'
  $json = Invoke-DlGet (Build-Url $Path $copy)
  if ($json -and ($json.PSObject.Properties.Name -contains '@odata.count') -and $null -ne $json.'@odata.count') { return [int]$json.'@odata.count' }
  return @(Get-Rows $json).Count
}
function Get-PieceTemplates([string]$ProjectId) {
  $json = $null
  try { $json = Invoke-DlGet (Build-Url '/InspectorPieceTemplates' @{ '$filter' = "inspectorProject/id eq $ProjectId"; '$orderby' = 'name' }) } catch { $json = $null }
  $rows = @(Get-Rows $json)
  if ($rows.Count -eq 0) {
    try {
      $project = Invoke-DlGet ((Get-ApiBase) + "/InspectorProjects/$ProjectId" + '?$expand=inspectorPieceTemplates')
      if ($project -and $project.inspectorPieceTemplates) {
        $rows = @()
        foreach ($row in @($project.inspectorPieceTemplates)) { if ($null -ne $row) { $rows += $row } }
      }
    } catch { $rows = @() }
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
function Convert-Control($c) {
  $low = $null
  $up = $null
  if ($c.tolerance) {
    if ($null -ne $c.tolerance.low) { $low = $c.tolerance.low }
    if ($null -ne $c.tolerance.up) { $up = $c.tolerance.up }
  }
  $nominal = $null
  if ($null -ne $c.nominal) { $nominal = $c.nominal }
  return @{ id = (As-Str $c.id); objectName = (As-Str $c.objectName); name = (As-Str $c.name); type = (As-Str $c.type); nominal = $nominal; tolerances = @{ low = $low; up = $up } }
}
function Get-NamedControls([string]$TemplateId, [string]$PieceId) {
  $items = New-List
  if ($PieceId) {
    $json = Invoke-DlGet (Build-Url '/Controls' @{ '$filter' = "inspectorPiece/id eq $PieceId" })
    foreach ($c in @(Get-Rows $json)) { [void]$items.Add((Convert-Control $c)) }
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
  $sample = Invoke-DlGet (Build-Url '/InspectorPieces' @{ '$filter' = "inspectorPieceTemplate/id eq $TemplateId"; '$orderby' = 'creationDateUser desc'; '$top' = '1'; '$select' = 'id' })
  $sampleId = ''
  foreach ($row in @(Get-Rows $sample)) { if (-not $sampleId) { $sampleId = As-Str $row.id } }
  $byId = @{}
  if ($sampleId) {
    $controls = Invoke-DlGet (Build-Url '/Controls' @{ '$filter' = "inspectorPiece/id eq $sampleId" })
    foreach ($c in @(Get-Rows $controls)) { $byId[(As-Str $c.id)] = $c }
  }
  if ($formIds.Count -eq 0) {
    foreach ($key in @($byId.Keys)) { [void]$items.Add((Convert-Control $byId[$key])) }
  } else {
    foreach ($id in $formIds) {
      if ($byId.ContainsKey($id)) { [void]$items.Add((Convert-Control $byId[$id])) }
      else { [void]$items.Add(@{ id = $id; objectName = ''; name = ''; type = ''; nominal = $null; tolerances = @{ low = $null; up = $null } }) }
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
    $file = Ensure-ModelFile $hash
    $ctx.Response.StatusCode = 200
    $ctx.Response.ContentType = 'model/obj'
    $ctx.Response.Headers['Cache-Control'] = 'public, max-age=86400'
    $fs = [IO.File]::OpenRead($file)
    try { $fs.CopyTo($ctx.Response.OutputStream) } finally { $fs.Close() }
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
function Show-Status {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $f = New-Object Windows.Forms.Form
  $f.Text = "DL-Merkmal-Viewer $($Script:Version)"
  $f.FormBorderStyle = 'FixedDialog'
  $f.StartPosition = 'CenterScreen'
  $f.ClientSize = New-Object Drawing.Size(420, 150)
  $f.MaximizeBox = $false
  $label = New-Object Windows.Forms.Label -Property @{ Left = 12; Top = 12; Width = 390; Height = 48; Text = "Version $($Script:Version). Einstellungen, Projekt und Merkmale stehen im Browser." }
  $open = New-Object Windows.Forms.Button -Property @{ Text = 'Im Browser oeffnen'; Left = 12; Top = 70; Width = 160 }
  $quit = New-Object Windows.Forms.Button -Property @{ Text = 'Beenden'; Left = 180; Top = 70; Width = 100 }
  $f.Controls.AddRange(@($label, $open, $quit))
  $open.Add_Click({ Start-Process 'http://localhost:8765/' })
  $quit.Add_Click({ $Script:Stop = $true; $f.Close() })
  $f.Add_FormClosed({ $Script:Stop = $true })
  $f.Show()
  return $f
}
function Start-ServerLoop {
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add('http://localhost:8765/')
  $listener.Start()
  $form = Show-Status
  if (-not $env:DL_NO_BROWSER) { Start-Process 'http://localhost:8765/' }
  while (-not $Script:Stop) {
    [Windows.Forms.Application]::DoEvents()
    $async = $listener.BeginGetContext($null, $null)
    while (-not $async.IsCompleted -and -not $Script:Stop) {
      [Windows.Forms.Application]::DoEvents()
      if ($async.AsyncWaitHandle.WaitOne(40)) { break }
    }
    if ($Script:Stop -or -not $async.IsCompleted) { continue }
    $ctx = $null
    try { $ctx = $listener.EndGetContext($async) } catch { continue }
    try { Handle-Request $ctx } catch { Write-Log $_.Exception.Message; try { Send-Json $ctx 500 @{ error = 'Fehler' } } catch {} }
    finally { try { $ctx.Response.OutputStream.Close() } catch {} }
  }
  $listener.Stop(); $listener.Close()
  if ($form) { $form.Dispose() }
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
  if ($body -notmatch '"version":"0.6.0"') { throw "Version falsch: $body" }
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
