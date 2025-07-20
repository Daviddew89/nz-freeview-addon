# Simple Deployment Script for NZ Freeview Addon
# This script will help you deploy to Google Cloud Run

Write-Host "🚀 Simple Deployment for NZ Freeview Addon" -ForegroundColor Green
Write-Host ""

# Check if gcloud is available
try {
    $gcloudVersion = gcloud --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Google Cloud CLI is available" -ForegroundColor Green
    } else {
        Write-Host "❌ Google Cloud CLI not found" -ForegroundColor Red
        Write-Host "Please install it from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
        exit 1
    }
} catch {
    Write-Host "❌ Google Cloud CLI not found" -ForegroundColor Red
    Write-Host "Please install it from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# Check authentication
Write-Host "Checking authentication..." -ForegroundColor Yellow
$authCheck = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null

if (-not $authCheck) {
    Write-Host "❌ Not authenticated with Google Cloud" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please run these commands:" -ForegroundColor Yellow
    Write-Host "   gcloud auth login" -ForegroundColor Cyan
    Write-Host "   gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Or create a new project:" -ForegroundColor Yellow
    Write-Host "   gcloud projects create nz-freeview-addon --name='NZ Freeview Addon'" -ForegroundColor Cyan
    Write-Host "   gcloud config set project nz-freeview-addon" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ Authenticated as: $authCheck" -ForegroundColor Green

# Get current project
$project = gcloud config get-value project 2>$null
if (-not $project) {
    Write-Host "❌ No project set" -ForegroundColor Red
    Write-Host "Please run: gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Cyan
    exit 1
}

Write-Host "📁 Project: $project" -ForegroundColor Green

# Ask user if they want to proceed
Write-Host ""
Write-Host "Ready to deploy to Google Cloud Run?" -ForegroundColor Yellow
Write-Host "This will create a service called 'nz-freeview-addon' in us-central1" -ForegroundColor White
$response = Read-Host "Continue? (y/N)"

if ($response -ne "y" -and $response -ne "Y") {
    Write-Host "Deployment cancelled." -ForegroundColor Yellow
    exit 0
}

# Enable required APIs
Write-Host ""
Write-Host "Enabling required APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com 2>$null
gcloud services enable cloudbuild.googleapis.com 2>$null

# Deploy to Cloud Run
Write-Host ""
Write-Host "Deploying to Cloud Run..." -ForegroundColor Yellow
Write-Host "This may take a few minutes..." -ForegroundColor White

try {
    gcloud run deploy nz-freeview-addon `
        --source . `
        --platform managed `
        --region us-central1 `
        --allow-unauthenticated `
        --port 8080 `
        --memory 512Mi `
        --cpu 1 `
        --max-instances 10

    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✅ Deployment successful!" -ForegroundColor Green
        
        # Get the service URL
        $serviceUrl = gcloud run services describe nz-freeview-addon --region us-central1 --format="value(status.url)" 2>$null
        
        Write-Host ""
        Write-Host "🌐 Your addon is now live at:" -ForegroundColor Cyan
        Write-Host "   $serviceUrl" -ForegroundColor White
        
        Write-Host ""
        Write-Host "📋 Important URLs:" -ForegroundColor Yellow
        Write-Host "   Manifest: $serviceUrl/manifest.json" -ForegroundColor White
        Write-Host "   Config UI: $serviceUrl/configure/" -ForegroundColor White
        Write-Host "   Health Check: $serviceUrl/health" -ForegroundColor White
        
        Write-Host ""
        Write-Host "🔗 To install in Stremio:" -ForegroundColor Yellow
        Write-Host "   1. Open Stremio" -ForegroundColor White
        Write-Host "   2. Go to Addons → Add Addon" -ForegroundColor White
        Write-Host "   3. Enter: $serviceUrl/manifest.json" -ForegroundColor White
        
        Write-Host ""
        Write-Host "📊 Monitor your deployment:" -ForegroundColor Yellow
        Write-Host "   gcloud logs read --service=nz-freeview-addon --region=us-central1 --limit=50" -ForegroundColor White
        
        Write-Host ""
        Write-Host "🎉 Your NZ Freeview addon is ready!" -ForegroundColor Green
        
    } else {
        Write-Host "❌ Deployment failed!" -ForegroundColor Red
        Write-Host "Check the error messages above for details." -ForegroundColor Yellow
        exit 1
    }
    
} catch {
    Write-Host "❌ Error during deployment: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} 