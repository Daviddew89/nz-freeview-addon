# NZ Freeview Stremio Addon

A Stremio addon that provides access to free New Zealand TV channels with full EPG (Electronic Program Guide) support.

## Features

- 📺 **51+ NZ TV Channels** - All major Freeview channels
- 📅 **Live EPG Data** - Current programme information with show details
- 🎨 **Modern Config UI** - Beautiful channel selection interface
- 🌐 **Web Compatible** - Works in both desktop and web Stremio
- 🔄 **Auto-updating** - EPG data refreshes automatically
- 🎯 **Channel Selection** - Choose which channels to display
- 📱 **Multi-platform** - Works on Windows, Android, Samsung TV, and more

## Quick Install

1. **Copy this URL**: `https://your-addon-url.run.app/manifest.json`
2. **Open Stremio** → Addons → Community Addons
3. **Click "Add Addon"** and paste the URL
4. **Click "Install"**

## Channel Categories

- **Main Channels**: TVNZ 1, TVNZ 2, Three, Bravo, DUKE, eden
- **News**: 1News, Newshub, BBC News, CNN, Al Jazeera, DW News
- **Sports**: Trackside 1 & 2, Redbull TV
- **Entertainment**: HGTV, House Hunters, Deadliest Catch, Motorheads
- **International**: Chinese TV, APNA Television, Channel News Asia
- **Regional**: Parliament TV, Wairarapa TV, Whakaata Māori

## Configuration

Visit the config UI to customize your channel selection:
- **URL**: `https://your-addon-url.run.app/configure/`
- **Features**: Select/deselect channels, drag-and-drop reordering
- **Manifest URL**: Automatically generated for easy installation

## Technical Details

- **Data Source**: EPG and channel data from [i.mjh.nz](https://i.mjh.nz/)
- **Stream Format**: HLS (HTTP Live Streaming)
- **CORS Support**: Built-in proxy for web compatibility
- **Auto-update**: EPG refreshes every 30 minutes
- **Caching**: Optimized for performance and reliability

## Development

### Local Setup
```bash
# Clone the repository
git clone https://github.com/yourusername/nz-freeview-addon.git
cd nz-freeview-addon

# Install dependencies
npm install

# Start the addon
npm start

# Access config UI
open http://localhost:8080/configure/
```

### Project Structure
```
├── addon/
│   └── addon.js          # Main addon logic
├── config-ui/
│   ├── index.html        # Config UI interface
│   └── configure.js      # Config UI logic
├── static/
│   └── Logo.png          # Addon logo
├── server.js             # Express server
├── package.json          # Dependencies
└── README.md            # This file
```

## Deployment: Google Cloud Run

This addon is deployed on **Google Cloud Run** - a fully managed serverless platform.

### Prerequisites
- Google Cloud account with billing enabled
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed
- Docker (optional, Cloud Run can build from source)

### Quick Deployment
```bash
# Run the deployment script
./deploy-simple.ps1

# Or deploy manually
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

### Benefits of Google Cloud Run:
- ✅ **Serverless** - No server management required
- ✅ **Auto-scaling** - Scales to zero when not in use
- ✅ **Global CDN** - Fast worldwide access
- ✅ **Automatic HTTPS** - Required for Stremio
- ✅ **CORS support** - Perfect for streaming proxy
- ✅ **Pay per use** - Only pay for actual usage

### Deployment Files
- `Dockerfile` - Container configuration
- `app.yaml` - App Engine configuration (alternative)
- `.gcloudignore` - Files to exclude from deployment
- `deploy-simple.ps1` - Automated deployment script

## Troubleshooting

### Stream Not Playing
- The addon provides a single, proxied stream for maximum compatibility. If it's not playing, please check the following:
- Check your internet connection
- Some streams may be region-locked to New Zealand

### Addon Not Loading
- Ensure you're using the correct manifest URL
- Check that the addon is accessible: `https://your-addon-url.run.app/health`
- Verify HTTPS is working (required for Stremio)

### EPG Data Missing
- EPG data is automatically updated every 30 minutes
- Some channels may not have EPG data available
- Check the addon logs for any errors

### Deployment Issues
- Ensure Google Cloud CLI is installed and authenticated
- Check that billing is enabled for your project
- Verify required APIs are enabled (Cloud Run, Cloud Build)

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test locally with `npm start`
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Credits

- **EPG Data**: [i.mjh.nz](https://i.mjh.nz/) - Matt Huisman
- **Stremio SDK**: [stremio-addon-sdk](https://github.com/Stremio/stremio-addon-sdk)
- **Hosting**: [Google Cloud Run](https://cloud.google.com/run) - Serverless container platform

## Support

If you encounter any issues:
1. Check the troubleshooting section above
2. Test the addon endpoints manually
3. Check the addon logs for errors
4. Create an issue on GitHub with details

---

**Enjoy watching NZ TV in Stremio! 🇳🇿📺**
