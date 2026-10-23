# Creates the public repo backwardzz/miname and uploads the three edited reference views to ref/.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot
gh repo create backwardzz/miname --public --description "miname"
foreach ($v in 'front', 'side', 'back') {
  $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $PSScriptRoot "${v}_edit.png")))
  $body = Join-Path $PSScriptRoot "body_$v.json"
  [IO.File]::WriteAllText($body, "{`"message`":`"Add $v reference view`",`"content`":`"$b64`"}")
  gh api -X PUT "repos/backwardzz/miname/contents/ref/$v.png" --input $body --jq .content.download_url
  Remove-Item $body
}
