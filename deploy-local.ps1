<#
.SYNOPSIS
    Deploys the application locally using Docker Compose.

.DESCRIPTION
    This script builds and starts the application containers locally for testing.
    It checks if Docker is running, ensures a .env file exists, and then runs docker-compose up.
#>

$ErrorActionPreference = "Stop"

Write-Host "Starting local deployment..." -ForegroundColor Cyan

# 1. Check if Docker is running
Write-Host "Checking Docker status..."
try {
    $null = docker info 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Docker is not running or not installed. Please start Docker Desktop and try again."
        exit 1
    }
} catch {
    Write-Error "Failed to check Docker status. Ensure Docker is installed and running."
    exit 1
}
Write-Host "Docker is running." -ForegroundColor Green

# 2. Check for .env file
if (-not (Test-Path ".env")) {
    Write-Warning ".env file not found. Creating one from .env.example if it exists..."
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "Copied .env.example to .env. Please review the .env file and update necessary variables." -ForegroundColor Yellow
    } else {
        Write-Warning "No .env.example found. The application might fail to start if it requires environment variables defined in docker-compose.yml."
    }
}

# 3. Deploy with docker-compose
Write-Host "Building and starting containers..." -ForegroundColor Cyan
try {
    docker-compose up -d --build
    
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Deployment failed during docker-compose up."
        exit 1
    }
} catch {
    Write-Error "Failed to execute docker-compose. Make sure it is installed and in your PATH."
    exit 1
}

Write-Host ""
Write-Host "Deployment initiated successfully!" -ForegroundColor Green
Write-Host "The application should be accessible at http://localhost:8080"
Write-Host "To view logs, run: docker-compose logs -f" -ForegroundColor DarkGray
Write-Host "To stop the application, run: docker-compose down" -ForegroundColor DarkGray
