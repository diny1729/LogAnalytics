param (
    [string]$AcrName = "",
    [string]$ImageName = "",
    [string]$ImageTag = "",
    [string]$ConfigFile = "../aks/deploy-config.json"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResolvedConfigFile = Join-Path $ScriptDir $ConfigFile

if (Test-Path $ResolvedConfigFile) {
    $Config = Get-Content $ResolvedConfigFile | ConvertFrom-Json
    if (-not $AcrName -or $AcrName -like "*<*") { $AcrName = $Config.AcrName }
    if (-not $ImageName -or $ImageName -like "*<*") { $ImageName = $Config.ImageName }
    if (-not $ImageTag -or $ImageTag -like "*<*") { $ImageTag = $Config.ImageTag }
}

if (-not $AcrName -or $AcrName -like "*<*") {
    Write-Error "Please specify a valid -AcrName or set AcrName in aks/deploy-config.json."
    exit 1
}

Write-Host "Logging into Azure Container Registry: $AcrName..." -ForegroundColor Cyan
az acr login --name $AcrName

$FullImageName = "${AcrName}.azurecr.io/${ImageName}:${ImageTag}"

$RootDir = Resolve-Path "$ScriptDir/.."
$DockerfilePath = Join-Path $RootDir "Dockerfile"

Write-Host "Building Docker image: $FullImageName..." -ForegroundColor Green
docker build -t $FullImageName -f $DockerfilePath $RootDir

Write-Host "Pushing Docker image to ACR..." -ForegroundColor Green
docker push $FullImageName

Write-Host "Image successfully built and pushed to $FullImageName!" -ForegroundColor Green
