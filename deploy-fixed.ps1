# Fixed Deployment Script for NZ Freeview Addon
# This script will deploy to your existing Google Cloud project

Write-Host "🚀 Deploying NZ Freeview Addon to Google Cloud Run..." -ForegroundColor Green
Write-Host ""

# Set the project
Write-Host "Setting project to: asnzs-electrical-engineering" -ForegroundColor Yellow
gcloud config set project asnzs-electrical-engineering

# Check if we're authenticated
Write-Host "Checking authentication..." -ForegroundColor Yellow
$authCheck = gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null

if (-not $authCheck) {
    Write-Host "❌ Not authenticated with Google Cloud" -ForegroundColor Red
    Write-Host "Please run: gcloud auth login" -ForegroundColor Cyan
    exit 1
}

Write-Host "✅ Authenticated as: $authCheck" -ForegroundColor Green

# Enable required APIs
Write-Host "Enabling required APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com 2>$null
gcloud services enable cloudbuild.googleapis.com 2>$null

# Deploy to Cloud Run with explicit Node.js runtime
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
        --max-instances 10 `
        --set-env-vars NODE_ENV=production

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