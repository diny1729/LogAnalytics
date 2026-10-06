param (
    [string]$ResourceGroup = "",
    [string]$ClusterName = "",
    [string]$ConfigFile = "../aks/deploy-config.json"
)

$ErrorActionPreference = "Stop"

# Detect host OS (Windows VM vs Linux VM)
$CurrentOS = if ($PSVersionTable.Platform) { $PSVersionTable.Platform } elseif ($IsLinux) { "Linux" } else { "Windows" }
Write-Host "Detected Execution Host: $CurrentOS VM (PowerShell $($PSVersionTable.PSVersion))" -ForegroundColor Cyan

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResolvedConfigFile = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir $ConfigFile))

# Load config if file exists and parameters are empty or default
if (Test-Path $ResolvedConfigFile) {
    $Config = Get-Content $ResolvedConfigFile | ConvertFrom-Json
    if (-not $ResourceGroup -or $ResourceGroup -like "*<*") {
        $ResourceGroup = $Config.ResourceGroup
    }
    if (-not $ClusterName -or $ClusterName -like "*<*") {
        $ClusterName = $Config.ClusterName
    }
}

if (-not $ResourceGroup -or $ResourceGroup -like "*<*" -or -not $ClusterName -or $ClusterName -like "*<*") {
    Write-Error "Please specify valid -ResourceGroup and -ClusterName parameters or configure aks/deploy-config.json."
    exit 1
}

Write-Host "Getting AKS credentials for cluster: $ClusterName in resource group: $ResourceGroup..." -ForegroundColor Cyan
az aks get-credentials --resource-group $ResourceGroup --name $ClusterName --overwrite-existing

$SecretPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/secret.yaml"))
if (Test-Path $SecretPath) {
    Write-Host "Applying Kubernetes Secrets from $SecretPath..." -ForegroundColor Green
    kubectl apply -f $SecretPath
}

$DeploymentPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/deployment.yaml"))
if (Test-Path $DeploymentPath) {
    Write-Host "Applying Kubernetes Deployment..." -ForegroundColor Green
    kubectl apply -f $DeploymentPath
}

$IngressPath = [System.IO.Path]::GetFullPath((Join-Path $ScriptDir "../aks/istio-ingress.yaml"))
if (Test-Path $IngressPath) {
    Write-Host "Applying Istio Ingress configuration..." -ForegroundColor Green
    kubectl apply -f $IngressPath
}

Write-Host "Deployment applied successfully!" -ForegroundColor Green
Write-Host "Run 'kubectl get pods -l app=loganalytics-app' to check pod status."
Write-Host "Run 'kubectl get svc istio-ingressgateway -n istio-system' to get the external IP for your domain."
