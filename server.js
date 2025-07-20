const express = require('express');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon/addon.js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// Universal CORS middleware for all Stremio clients (Windows, Web, Android TV, etc.)
app.use((req, res, next) => {
    // Allow all origins for maximum compatibility
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Requested-With');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Cache control for different clients
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    
    // Additional headers for new Stremio core
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'SAMEORIGIN');
    
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

// Serve static files
app.use('/static', express.static(path.join(__dirname, 'static')));

// Serve config UI files
app.get('/configure', (req, res) => {
    res.sendFile(path.join(__dirname, 'config-ui', 'index.html'));
});

app.get('/configure/', (req, res) => {
    res.sendFile(path.join(__dirname, 'config-ui', 'index.html'));
});

app.get('/configure.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'config-ui', 'configure.js'));
});

// CORS Proxy for streaming URLs (fixes web app compatibility)
app.get('/proxy/*', async (req, res) => {
    try {
        const targetUrl = req.params[0];
        if (!targetUrl) {
            return res.status(400).json({ error: 'No URL provided' });
        }

        // Decode the URL
        const decodedUrl = decodeURIComponent(targetUrl);
        
        console.log(`[PROXY] Proxying request to: ${decodedUrl}`);
        
        const response = await fetch(decodedUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            },
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Forward the content type
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        // Forward other important headers
        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // Stream the response
        response.body.pipe(res);
        
    } catch (error) {
        console.error(`[PROXY] Error proxying request:`, error.message);
        res.status(500).json({ 
            error: 'Proxy error', 
            message: error.message,
            url: req.params[0]
        });
    }
});

// Stats endpoint
app.get('/stats', (req, res) => {
    try {
        const stats = {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '1.0.4',
            memory: process.memoryUsage(),
            platform: process.platform,
            nodeVersion: process.version
        };
        res.json(stats);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.4'
    });
});

// Use the standard Stremio addon router for all other endpoints
const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

// Start the server
app.listen(port, () => {
    console.log(`NZ Freeview Addon running on port ${port}`);
    console.log(`- Manifest: http://localhost:${port}/manifest.json`);
    console.log(`- Config UI: http://localhost:${port}/configure/`);
    console.log(`- Stats: http://localhost:${port}/stats`);
    console.log(`- Health: http://localhost:${port}/health`);
    console.log(`- Proxy: http://localhost:${port}/proxy/`);
});
