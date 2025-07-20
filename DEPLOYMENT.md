# NZ Freeview Addon - Deployment Guide

## What's Fixed

### 1. CORS Issue for Web Streaming
- **Problem**: Videos wouldn't play in Chrome/Web app due to CORS restrictions
- **Solution**: Added a built-in CORS proxy endpoint (`/proxy/*`) that forwards streaming requests
- **Result**: Web clients can now access streams through the proxy, avoiding CORS errors

### 2. Cloud Run Deployment Issues
- **Problem**: Addon was returning 404 errors when deployed to Google Cloud Run
- **Solution**: 
  - Fixed addon interface structure to use standard Stremio SDK exports
  - Added proper Dockerfile for containerized deployment
  - Fixed config UI serving with explicit routes
  - Updated server.js to handle all endpoints correctly

### 3. Stream Handler Improvements
- **Problem**: Only one stream URL was provided, causing compatibility issues
- **Solution**: Stream handler now provides both direct and proxied URLs:
  - `NZ Freeview (Direct)` - for desktop apps
  - `NZ Freeview (Web)` - for web clients (uses CORS proxy)

## Deployment to Google Cloud Run

### Prerequisites
- Google Cloud CLI installed and configured
- Docker installed (optional, Cloud Run can build from source)

### Quick Deployment
```bash
# Deploy using the provided script
./update-cloudrun.bat

# Or manually
gcloud run deploy nz-freeview-addon --source . --platform managed --region us-central1 --allow-unauthenticated
```

### Manual Deployment Steps
1. **Build and Deploy**:
   ```bash
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

2. **Verify Deployment**:
   ```bash
   # Get the service URL
   gcloud run services describe nz-freeview-addon --region us-central1 --format="value(status.url)"
   
   # Test endpoints
   curl https://your-service-url/health
   curl https://your-service-url/manifest.json
   ```

### Testing Before Deployment
```bash
# Run local tests
node test-deployment.js

# Start local server
npm start

# Test endpoints manually
curl http://localhost:8080/health
curl http://localhost:8080/manifest.json
curl http://localhost:8080/configure/
```

## Endpoints

- **Health Check**: `/health` - Service status
- **Manifest**: `/manifest.json` - Stremio addon manifest
- **Config UI**: `/configure/` - Channel selection interface
- **Stats**: `/stats` - Performance statistics
- **CORS Proxy**: `/proxy/*` - Proxies streaming URLs for web clients
- **Catalog**: `/catalog/tv/nzfreeview.json` - Channel list
- **Meta**: `/meta/tv/nzfreeview-{channelId}.json` - Channel metadata
- **Stream**: `/stream/tv/nzfreeview-{channelId}.json` - Stream URLs

## Configuration

The addon supports channel selection through the config UI:
1. Visit `/configure/` in your browser
2. Select/deselect channels
3. Reorder channels by dragging
4. Copy the generated manifest URL
5. Install in Stremio using the URL

## Troubleshooting

### Common Issues

1. **404 Errors on Cloud Run**:
   - Ensure Dockerfile is present
   - Check that server.js is the entry point
   - Verify port 8080 is exposed

2. **CORS Errors in Web App**:
   - Use the "NZ Freeview (Web)" stream option
   - Check that proxy endpoint is working: `/proxy/https%3A%2F%2Fi.mjh.nz%2F.r%2Ftvnz-1.m3u8`

3. **Stream Not Playing**:
   - Try both direct and proxied stream options
   - Check addon logs for errors
   - Verify channel URLs are accessible

### Logs
```bash
# View Cloud Run logs
gcloud logs read --service=nz-freeview-addon --limit=50

# Local logs
npm start 2>&1 | tee addon.log
```

## Performance

- **Memory**: 512Mi recommended
- **CPU**: 1 vCPU sufficient
- **Max Instances**: 10 (adjust based on traffic)
- **Auto-scaling**: Enabled by default

## Security

- **CORS**: Configured for all origins (required for Stremio compatibility)
- **Authentication**: Disabled (public addon)
- **Rate Limiting**: Built-in protection against abuse
- **Proxy**: Only forwards streaming requests, no data storage 