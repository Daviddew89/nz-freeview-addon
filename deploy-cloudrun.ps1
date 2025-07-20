# NZ Freeview Addon - Google Cloud Run Deployment Script
# Run this script to deploy your addon to Google Cloud Run

Write-Host "🚀 Deploying NZ Freeview Addon to Google Cloud Run..." -ForegroundColor Green

# Check if gcloud is authenticated
Write-Host "Checking Google Cloud authentication..." -ForegroundColor Yellow
$authCheck = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null

if (-not $authCheck) {
    Write-Host "❌ Not authenticated with Google Cloud. Please run:" -ForegroundColor Red
    Write-Host "   gcloud auth login" -ForegroundColor Cyan
    Write-Host "   gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ Authenticated as: $authCheck" -ForegroundColor Green

# Get current project
$project = gcloud config get-value project 2>$null
if (-not $project) {
    Write-Host "❌ No project set. Please run:" -ForegroundColor Red
    Write-Host "   gcloud config set project YOUR_PROJECT_ID" -ForegroundColor Cyan
    exit 1
}

Write-Host "📁 Project: $project" -ForegroundColor Green

# Enable required APIs
Write-Host "Enabling required APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com 2>$null
gcloud services enable cloudbuild.googleapis.com 2>$null

# Deploy to Cloud Run
Write-Host "Deploying to Cloud Run..." -ForegroundColor Yellow
$serviceName = "nz-freeview-addon"
$region = "us-central1"

try {
    gcloud run deploy $serviceName `
        --source . `
        --platform managed `
        --region $region `
        --allow-unauthenticated `
        --port 8080 `
        --memory 512Mi `
        --cpu 1 `
        --max-instances 10 `
        --timeout 300 `
        --concurrency 80

    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Deployment successful!" -ForegroundColor Green
        
        # Get the service URL
        $serviceUrl = gcloud run services describe $serviceName --region $region --format="value(status.url)" 2>$null
        
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
        Write-Host "   2. Go to Addons" -ForegroundColor White
        Write-Host "   3. Click 'Add Addon'" -ForegroundColor White
        Write-Host "   4. Enter: $serviceUrl/manifest.json" -ForegroundColor White
        
        Write-Host ""
        Write-Host "📊 Monitor your deployment:" -ForegroundColor Yellow
        Write-Host "   gcloud logs read --service=$serviceName --region=$region --limit=50" -ForegroundColor White
        
    } else {
        Write-Host "❌ Deployment failed!" -ForegroundColor Red
        exit 1
    }
    
} catch {
    Write-Host "❌ Error during deployment: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} 