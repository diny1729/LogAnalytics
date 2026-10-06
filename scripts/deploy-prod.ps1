# Single Master Automation Script: Build, Push to ACR, Prompt Confirmation, & Deploy to AKS
# Compatible with both Windows VM and Linux VM running PowerShell (pwsh / Windows PowerShell)
param (
    [string]$ConfigFile = "../aks/deploy-config.json",
    [switch]$AutoApprove,
    [string]$TagOverride,
    [string]$Platform = "linux/amd64"
)

$ErrorActionPreference = "Stop"

# Detect host OS (Windows VM vs Linux VM)
$CurrentOS = if ($PSVersionTable.Platform) { $PSVersionTable.Platform } elseif ($IsLinux) { "Linux" } else { "Windows" }
Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  LogAnalytics Production Deployment Pipeline" -ForegroundColor Cyan
Write-Host "  Host Environment : $CurrentOS VM" -ForegroundColor Cyan
Write-Host "  PowerShell Engine: $($PSVersionTable.PSVersion)" -ForegroundColor Cyan
Write-Host "  Target Platform  : $Platform" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# Determine path to config file
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not ([System.IO.Path]::IsPathRooted($ConfigFile))) {
    $ResolvedConfigFile = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $ConfigFile))
}
else {
    $ResolvedConfigFile = [System.IO.Path]::GetFullPath($ConfigFile)
}

if (-not (Test-Path $ResolvedConfigFile)) {
    Write-Error "Configuration file not found at: $ResolvedConfigFile. Please copy aks/deploy-config.example.json to aks/deploy-config.json and set your credentials."
    exit 1
}

Write-Host "Reading deployment parameters from config file: $ResolvedConfigFile..." -ForegroundColor Green
$Config = Get-Content $ResolvedConfigFile | ConvertFrom-Json

# Override image tag if specified as command-line parameter
if ($TagOverride) {
    $Config.ImageTag = $TagOverride
}

# Validate placeholders
if ($Config.AcrName -like "*<*" -or $Config.ClusterName -like "*<*" -or $Config.ResourceGroup -like "*<*") {
    Write-Host "WARNING: Configuration file contains placeholder values (<your-acr-name>, etc.)." -ForegroundColor Yellow
    Write-Host "Please edit $ResolvedConfigFile with your actual Azure Resource Group, Cluster Name, and ACR Registry." -ForegroundColor Yellow
}

$AcrName = $Config.AcrName
$ImageName = $Config.ImageName
$ImageTag = $Config.ImageTag
$ResourceGroup = $Config.ResourceGroup
$ClusterName = $Config.ClusterName
$SubscriptionId = $Config.SubscriptionId
$FullImageName = "${AcrName}.azurecr.io/${ImageName}:${ImageTag}"

# Step 1: Azure Subscription Context
if ($SubscriptionId -and $SubscriptionId -notlike "*<*") {
    Write-Host "Setting Azure Subscription context: $SubscriptionId..." -ForegroundColor Cyan
    az account set --subscription $SubscriptionId
}

# Step 2: ACR Login
Write-Host "Authenticating with Azure Container Registry: $AcrName..." -ForegroundColor Cyan
az acr login --name $AcrName

# Step 3: Build & Push Production Docker Image with Buildx
$RootDir = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir ".."))
$DockerfilePath = Join-Path $RootDir "Dockerfile"

function Ensure-BuildxBuilder {
    param ([string]$BuilderName = "loganalytics-builder")
    try {
        $builders = docker buildx ls 2>$null
        if ($builders -notmatch $BuilderName) {
            Write-Host "Creating and bootstrapping buildx builder instance '$BuilderName'..." -ForegroundColor Cyan
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

Write-Host "Building and pushing Production Docker image with Buildx [$FullImageName] for platform [$Platform]..." -ForegroundColor Green
docker buildx build --platform $Platform -t $FullImageName -f $DockerfilePath --push $RootDir

if ($LASTEXITCODE -ne 0) {
    Write-Error "Buildx failed to build and push the production image to ACR."
    exit 1
}
Write-Host "Image successfully built and pushed to ACR!" -ForegroundColor Green

# Step 4: Confirmation Prompt before AKS Deployment
Write-Host ""
Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host "                AKS DEPLOYMENT CONFIRMATION                      " -ForegroundColor Yellow
Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host "  Target Subscription : $SubscriptionId"
Write-Host "  Resource Group      : $ResourceGroup"
Write-Host "  AKS Cluster Name    : $ClusterName"
Write-Host "  Pushed Image Tag    : $FullImageName"
Write-Host "=================================================================" -ForegroundColor Yellow

if (-not $AutoApprove) {
    $Confirm = Read-Host "Do you want to proceed with deploying to AKS cluster '$ClusterName'? (Y/N)"
    if ($Confirm -notmatch "^[Yy](es)?$") {
        Write-Host "Deployment to AKS cancelled by user. Image is pushed to ACR." -ForegroundColor Cyan
        exit 0
    }
}

# Step 5: Connect to AKS Cluster
Write-Host "Fetching AKS credentials for cluster: $ClusterName in resource group: $ResourceGroup..." -ForegroundColor Cyan
az aks get-credentials --resource-group $ResourceGroup --name $ClusterName --overwrite-existing

# Step 6: Apply Secret Manifest
$SecretPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/secret.yaml"))
if (Test-Path $SecretPath) {
    Write-Host "Applying Kubernetes Secrets from $SecretPath..." -ForegroundColor Green
    kubectl apply -f $SecretPath
}
else {
    Write-Host "Warning: Secret manifest not found at $SecretPath. Skipping secret apply." -ForegroundColor Yellow
}

# Step 7: Apply Redis Cache Deployment & Service Manifest
$RedisPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/redis-deployment.yaml"))
if (Test-Path $RedisPath) {
    Write-Host "Applying Redis 1GB Cache Pod and Service manifest from $RedisPath..." -ForegroundColor Green
    kubectl apply -f $RedisPath
}

# Step 8: Apply App Deployment Manifest (with dynamic image replacement)
$DeploymentPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/deployment.yaml"))
if (Test-Path $DeploymentPath) {
    Write-Host "Applying Kubernetes Deployment manifest..." -ForegroundColor Green
    $DeploymentYaml = Get-Content $DeploymentPath -Raw
    $DeploymentYamlResolved = $DeploymentYaml -replace '<your-acr-name>\.azurecr\.io/loganalytics-app:latest', $FullImageName
    
    # Pipe resolved manifest directly to kubectl apply
    $DeploymentYamlResolved | kubectl apply -f -
}
else {
    Write-Error "Deployment manifest not found at $DeploymentPath."
    exit 1
}

# Step 9: Apply Istio Ingress (if present)
$IngressPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/istio-ingress.yaml"))
if (Test-Path $IngressPath) {
    Write-Host "Applying Istio Ingress manifest..." -ForegroundColor Green
    kubectl apply -f $IngressPath
}

# Step 10: Restart Deployment 
Write-Host "Restarting Deployment rollout..." -ForegroundColor Cyan
kubectl rollout restart deployment/loganalytics-app

# Step 11: Verify Rollout Status
Write-Host "Waiting for deployment rollout to complete..." -ForegroundColor Cyan
kubectl rollout status deployment/loganalytics-app --timeout=60s

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host " SUCCESS: Production Application Deployed to AKS Cluster! " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "Run 'kubectl get pods -l app=loganalytics-app' to check pod status."
Write-Host "Run 'kubectl get svc istio-ingressgateway -n istio-system' to check external IP."
