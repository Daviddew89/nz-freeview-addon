# NZ Freeview Stremio Add-on

This project provides a Stremio add-on for New Zealand Freeview TV channels, with a modern configuration UI, robust EPG (Electronic Program Guide) support, and is ready for deployment on Google Cloud Run.

## Features
- Watch free NZ TV channels in Stremio
- Full EPG (program guide) integration with current show images
- **Rich Programme Metadata**: Title, description, rating, cast, director, awards
- **Video Objects**: Only the current programme is shown for selection (no "up next")
- **Related Content Links**: Actor, director, and genre links
- **Enhanced Search**: Search by show title, description, and programme info
- Modern, dark-mode config UI at `/configure/`
- Drag-and-drop channel reordering and selection
- Channel selection and manifest URL generation
- Real-time EPG data with show thumbnails and artwork
- **No external metadata enrichment**: Only EPG data is used, with robust fallbacks
- **Logo**: Custom logo is used in Stremio (see `/static/Logo.png`)
- **Google Cloud Run ready**: Easy deployment and update scripts

## Usage

### 1. Start Locally

```powershell
npm start
```

2. Open http://localhost:7000/configure/ to configure channels and get your manifest URL.

### 2. Configuration UI
- The configuration UI is always available at `/configure/`.
- The manifest endpoint (`/manifest.json`) will redirect to `/configure/?fresh=1` if accessed with a `config` parameter, ensuring the user always sees the config UI for setup or reconfiguration.
- The config UI allows you to select and reorder channels, and generates a custom manifest URL for Stremio.

### 3. Logo
- The add-on uses a custom logo at `/static/Logo.png` which appears in Stremio next to the add-on name.

## Deployment: Google Cloud Run

### Prerequisites
- Google Cloud account and project
- [Google Cloud SDK](https://cloud.google.com/sdk/docs/install) installed and authenticated
- Billing enabled for your project

### Steps
1. **Build and Deploy**
   - Create a Dockerfile (see below for an example if not present)
   - Build and deploy using Google Cloud SDK:
     ```powershell
     gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/nz-freeview-addon
     gcloud run deploy nz-freeview-addon --image gcr.io/YOUR_PROJECT_ID/nz-freeview-addon --platform managed --region YOUR_REGION --allow-unauthenticated --port 7000
     ```
   - Replace `YOUR_PROJECT_ID` and `YOUR_REGION` with your actual project and region.

2. **Get the Service URL**
   - After deployment, Google Cloud Run will provide a public HTTPS URL (e.g. `https://nz-freeview-addon-xxxxxx.a.run.app`).
   - Use this URL as the base for your manifest and config UI (e.g. `https://.../manifest.json`, `https://.../configure/`).

3. **Update Deployment**
   - To update the deployed app, rebuild and redeploy:
     ```powershell
     gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/nz-freeview-addon
     gcloud run deploy nz-freeview-addon --image gcr.io/YOUR_PROJECT_ID/nz-freeview-addon --platform managed --region YOUR_REGION --allow-unauthenticated --port 7000
     ```
   - You can use the provided `update-cloudrun.bat` (Windows) or `update-cloudrun.sh` (Linux/macOS) scripts if present, or create your own for convenience.

## Troubleshooting

- **Manifest Loading Issues**: Ensure the server is running and accessible at the correct port or Cloud Run URL.
- **Streams Not Playing**: Some streams may be region-locked to New Zealand. Check your network and try a VPN if outside NZ.
- **Metadata Issues**: Only EPG data is used. If EPG is missing, robust fallbacks (channel name/logo) are used.
- **Logo Not Showing**: Ensure `/static/Logo.png` is present and accessible.

## Technical Details
- All metadata is derived from EPG data. No external enrichment (TVMaze/TMDB) is used.
- The config UI is always available at `/configure/` and is linked from the manifest for Stremio's "Configure" button.
- The manifest and all endpoints are CORS-enabled for Stremio compatibility.
- The add-on is designed for maximum compatibility across Windows, Android, Samsung Tizen, and other Stremio platforms.

## Credits
- EPG and channel data from [i.mjh.nz](https://i.mjh.nz/)
- Stremio Addon SDK

---

For more details, see the code and comments in `addon/addon.js` and the config UI in `config-ui/`. 