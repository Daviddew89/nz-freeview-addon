# 🚀 Fixed Deployment Guide - NZ Freeview Addon

## ✅ What Was Fixed

The addon has been updated to use the **new Stremio SDK serverless pattern**:

1. **Updated Addon Structure**: Created `addon/addon-serverless.js` using the new `addonBuilder` pattern
2. **Simplified Code**: Removed complex features that were causing issues
3. **Serverless Compatible**: Now follows the recommended deployment pattern
4. **Tested Locally**: All endpoints working correctly

## 🎯 Quick Deployment (Recommended)

### Step 1: Setup Google Cloud
```powershell
# Login to Google Cloud
gcloud auth login

# Create a new project
gcloud projects create nz-freeview-addon --name="NZ Freeview Addon"

# Set the project
gcloud config set project nz-freeview-addon

# Enable billing (required for Cloud Run)
# Go to: https://console.cloud.google.com/billing
```

### Step 2: Deploy
```powershell
# Run the simple deployment script
.\deploy-simple.ps1
```

### Step 3: Install in Stremio
1. Open Stremio
2. Go to Addons → Add Addon
3. Enter your manifest URL: `https://your-service-url/manifest.json`

---

## 🔧 Manual Deployment

If you prefer to deploy manually:

```powershell
# Enable required APIs
gcloud services enable run.googleapis.com
gcloud services enable cloudbuild.googleapis.com

# Deploy to Cloud Run
gcloud run deploy nz-freeview-addon \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --max-instances 10
```

---

## 🧪 Test Locally First

Before deploying, test locally:

```powershell
# Install dependencies
npm install

# Start the server
npm start

# Test endpoints
curl http://localhost:8080/health
curl http://localhost:8080/manifest.json
curl http://localhost:8080/catalog/tv/nzfreeview.json
```

---

## 📊 What's Working Now

✅ **Manifest Endpoint**: `/manifest.json` - Returns addon configuration  
✅ **Catalog Endpoint**: `/catalog/tv/nzfreeview.json` - Returns channel list  
✅ **Meta Endpoint**: `/meta/tv/nzfreeview-{channelId}.json` - Returns channel metadata  
✅ **Stream Endpoint**: `/stream/tv/nzfreeview-{channelId}.json` - Returns stream URLs  
✅ **Config UI**: `/configure/` - Channel selection interface  
✅ **CORS Proxy**: `/proxy/*` - Handles web streaming  
✅ **Health Check**: `/health` - Service status  

---

## 🌐 Alternative Platforms

If Google Cloud Run doesn't work for you:

### Railway (Easy Setup)
1. Go to [railway.app](https://railway.app)
2. Connect your GitHub account
3. Create new project from this repo
4. Deploy automatically

### Render (Good Free Tier)
1. Go to [render.com](https://render.com)
2. Connect your GitHub account
3. Create new Web Service
4. Set build command: `npm install`
5. Set start command: `npm start`

---

## 🔍 Troubleshooting

### Common Issues:

1. **"Not authenticated" error**
   ```powershell
   gcloud auth login
   gcloud config set project YOUR_PROJECT_ID
   ```

2. **"Project not found" error**
   - Create a new project in Google Cloud Console
   - Enable billing for the project

3. **"API not enabled" error**
   ```powershell
   gcloud services enable run.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   ```

4. **Addon not working in Stremio**
   - Check the manifest URL is accessible
   - Verify CORS headers are set correctly
   - Test the health endpoint

### Testing Your Deployment:
```powershell
# Test health endpoint
curl https://your-service-url/health

# Test manifest
curl https://your-service-url/manifest.json

# Test catalog
curl https://your-service-url/catalog/tv/nzfreeview.json
```

---

## 📈 Monitoring

### View Logs:
```powershell
# Google Cloud Run logs
gcloud logs read --service=nz-freeview-addon --region=us-central1 --limit=50

# Real-time logs
gcloud logs tail --service=nz-freeview-addon --region=us-central1
```

### Performance Metrics:
- Visit your service URL + `/stats` for performance data
- Monitor memory usage and response times
- Check for errors in the logs

---

## 🎉 Success!

Your NZ Freeview addon should now deploy successfully and work in Stremio. The key fixes were:

1. **Updated to new SDK pattern** - Uses `addonBuilder` instead of old pattern
2. **Simplified code** - Removed complex features that were causing issues
3. **Serverless compatible** - Follows recommended deployment structure
4. **Tested endpoints** - All core functionality working

The addon will provide:
- **Live NZ TV channels** from Freeview
- **EPG data** for current programming
- **Config UI** for channel selection
- **CORS proxy** for web compatibility
- **Auto-scaling** on Google Cloud Run

Enjoy your NZ Freeview addon! 🍃📺 