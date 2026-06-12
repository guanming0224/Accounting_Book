$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

node .\node_modules\ts-node\dist\bin.js -P json/tsconfig.json app/src/main.ts
exit $LASTEXITCODE
