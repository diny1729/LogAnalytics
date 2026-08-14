# Single Master Automation Script: Build, Push to ACR, Prompt Confirmation, & Deploy to AKS
param (
    [string]$ConfigFile = "../aks/deploy-config.json",
    [switch]$AutoApprove,
    [string]$TagOverride
)

$ErrorActionPreference = "Stop"

# Determine path to config file
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (System.IO.Path::IsPathRooted($ConfigFile))) {
    $ResolvedConfigFile = Join-Path $ScriptDir $ConfigFile
} else {
    $ResolvedConfigFile = $ConfigFile
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

# Step 3: Build Production Docker Image
$RootDir = Resolve-Path "$ScriptDir/.."
$DockerfilePath = Join-Path $RootDir "Dockerfile"

Write-Host "Building Production Docker image [$FullImageName]..." -ForegroundColor Green
docker build -t $FullImageName -f $DockerfilePath $RootDir

# Step 4: Push Image to ACR
Write-Host "Pushing Docker image to ACR [$FullImageName]..." -ForegroundColor Green
docker push $FullImageName
Write-Host "Image successfully built and pushed to ACR!" -ForegroundColor Green

# Step 5: Confirmation Prompt before AKS Deployment
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

# Step 6: Connect to AKS Cluster
Write-Host "Fetching AKS credentials for cluster: $ClusterName in resource group: $ResourceGroup..." -ForegroundColor Cyan
az aks get-credentials --resource-group $ResourceGroup --name $ClusterName --overwrite-existing

# Step 7: Apply Secret Manifest
$SecretPath = Join-Path $ScriptDir "../aks/secret.yaml"
if (Test-Path $SecretPath) {
    Write-Host "Applying Kubernetes Secrets from $SecretPath..." -ForegroundColor Green
    kubectl apply -f $SecretPath
} else {
    Write-Host "Warning: Secret manifest not found at $SecretPath. Skipping secret apply." -ForegroundColor Yellow
}

# Step 8: Apply Deployment Manifest (with dynamic image replacement)
$DeploymentPath = Join-Path $ScriptDir "../aks/deployment.yaml"
if (Test-Path $DeploymentPath) {
    Write-Host "Applying Kubernetes Deployment manifest..." -ForegroundColor Green
    $DeploymentYaml = Get-Content $DeploymentPath -Raw
    $DeploymentYamlResolved = $DeploymentYaml -replace '<your-acr-name>\.azurecr\.io/loganalytics-app:latest', $FullImageName
    
    # Pipe resolved manifest directly to kubectl apply
    $DeploymentYamlResolved | kubectl apply -f -
} else {
    Write-Error "Deployment manifest not found at $DeploymentPath."
    exit 1
}

# Step 9: Apply Istio Ingress (if present)
$IngressPath = Join-Path $ScriptDir "../aks/istio-ingress.yaml"
if (Test-Path $IngressPath) {
    Write-Host "Applying Istio Ingress manifest..." -ForegroundColor Green
    kubectl apply -f $IngressPath
}

# Step 10: Verify Rollout Status
Write-Host "Waiting for deployment rollout to complete..." -ForegroundColor Cyan
kubectl rollout status deployment/loganalytics-app --timeout=60s

Write-Host ""
Write-Host "=================================================================" -ForegroundColor Green
Write-Host " SUCCESS: Production Application Deployed to AKS Cluster! " -ForegroundColor Green
Write-Host "=================================================================" -ForegroundColor Green
Write-Host "Run 'kubectl get pods -l app=loganalytics-app' to check pod status."
Write-Host "Run 'kubectl get svc istio-ingressgateway -n istio-system' to check external IP."
