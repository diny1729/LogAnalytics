param (
    [string]$ResourceGroup = "",
    [string]$ClusterName = "",
    [string]$ConfigFile = "../aks/deploy-config.json"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ResolvedConfigFile = Join-Path $ScriptDir $ConfigFile

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

$SecretPath = Join-Path $ScriptDir "../aks/secret.yaml"
if (Test-Path $SecretPath) {
    Write-Host "Applying Kubernetes Secrets from $SecretPath..." -ForegroundColor Green
    kubectl apply -f $SecretPath
}

$DeploymentPath = Join-Path $ScriptDir "../aks/deployment.yaml"
if (Test-Path $DeploymentPath) {
    Write-Host "Applying Kubernetes Deployment..." -ForegroundColor Green
    kubectl apply -f $DeploymentPath
}

$IngressPath = Join-Path $ScriptDir "../aks/istio-ingress.yaml"
if (Test-Path $IngressPath) {
    Write-Host "Applying Istio Ingress configuration..." -ForegroundColor Green
    kubectl apply -f $IngressPath
}

Write-Host "Deployment applied successfully!" -ForegroundColor Green
Write-Host "Run 'kubectl get pods -l app=loganalytics-app' to check pod status."
Write-Host "Run 'kubectl get svc istio-ingressgateway -n istio-system' to get the external IP for your domain."
