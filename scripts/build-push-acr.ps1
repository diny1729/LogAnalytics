param (
    [string]$AcrName = "",
    [string]$ImageName = "",
    [string]$ImageTag = "",
    [string]$Platform = "linux/amd64",
    [string]$ConfigFile = "../aks/deploy-config.json",
    [switch]$NoPush,
    [switch]$LoadLocal
)

$ErrorActionPreference = "Stop"

# Detect host OS (Windows VM vs Linux VM)
$CurrentOS = if ($PSVersionTable.Platform) { $PSVersionTable.Platform } elseif ($IsLinux) { "Linux" } else { "Windows" }
Write-Host "Detected Execution Host: $CurrentOS VM (PowerShell $($PSVersionTable.PSVersion))" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResolvedConfigFile = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $ConfigFile))

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

$FullImageName = "${AcrName}.azurecr.io/${ImageName}:${ImageTag}"

# Log in to ACR if pushing
if (-not $NoPush -and -not $LoadLocal) {
    Write-Host "Logging into Azure Container Registry: $AcrName..." -ForegroundColor Cyan
    az acr login --name $AcrName
}

$RootDir = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir ".."))
$DockerfilePath = Join-Path $RootDir "Dockerfile"

# Ensure buildx builder exists and supports cross-platform container builds
function Ensure-BuildxBuilder {
    param ([string]$BuilderName = "loganalytics-builder")
    try {
        $builders = docker buildx ls 2>$null
        if ($builders -notmatch $BuilderName) {
            Write-Host "Initializing docker buildx builder instance '$BuilderName'..." -ForegroundColor Cyan
            docker buildx create --name $BuilderName --driver docker-container --use 2>$null
            docker buildx inspect --bootstrap 2>$null
        } else {
            docker buildx use $BuilderName 2>$null
        }
    } catch {
        Write-Warning "Using default buildx builder instance."
    }
}

Ensure-BuildxBuilder

if ($LoadLocal) {
    Write-Host "Building image with Buildx [$FullImageName] for platform [$Platform] and loading locally..." -ForegroundColor Green
    docker buildx build --platform $Platform -t $FullImageName -f $DockerfilePath --load $RootDir
} elseif ($NoPush) {
    Write-Host "Building image with Buildx [$FullImageName] for platform [$Platform] (no push)..." -ForegroundColor Green
    docker buildx build --platform $Platform -t $FullImageName -f $DockerfilePath $RootDir
} else {
    Write-Host "Building and pushing image with Buildx [$FullImageName] for platform [$Platform] directly to ACR..." -ForegroundColor Green
    docker buildx build --platform $Platform -t $FullImageName -f $DockerfilePath --push $RootDir
}

if ($LASTEXITCODE -ne 0) {
    Write-Error "Buildx failed to build the image."
    exit 1
}

Write-Host "Image successfully processed: $FullImageName" -ForegroundColor Green
