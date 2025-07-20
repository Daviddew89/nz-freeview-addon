const express = require('express');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon/addon.js');
const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 8080;

// Trust the proxy to get the correct protocol (https) from the X-Forwarded-Proto header.
// This is essential for generating correct absolute URLs when hosted behind a reverse proxy
// like on Google Cloud or Heroku.
app.set('trust proxy', true);

// Universal CORS middleware for all Stremio clients
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, Cache-Control, X-Requested-With');
    res.header('Access-Control-Max-Age', '86400');
    
    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    
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

const proxyHandler = async (req, res) => {
    try {
        const encodedUrl = req.params[0];
        if (!encodedUrl) {
            return res.status(400).json({ error: 'No encoded URL provided to proxy' });
        }

        const decodedUrl = decodeURIComponent(encodedUrl);
        if (!decodedUrl.startsWith('http')) {
            return res.status(400).json({ error: 'Invalid URL provided for proxy. Must start with http or https.' });
        }

        const baseUrl = new URL(decodedUrl);
        
        console.log(`[PROXY] [${req.method}] Proxying request to: ${decodedUrl}`);
        
        const response = await fetch(decodedUrl, {
            method: req.method, // Pass through the method (GET or HEAD)
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
                'Referer': baseUrl.origin
            },
            timeout: 30000
        });

        if (!response.ok) {
            throw new Error(`Upstream HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type') || '';
        res.setHeader('Content-Type', contentType);

        const contentLength = response.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // For HEAD requests, we are done. Just send the headers.
        if (req.method === 'HEAD') {
            res.end();
            return;
        }

        // If it's an HLS manifest, we need to rewrite its contents
        if (contentType.includes('mpegurl') || contentType.includes('x-mpegURL')) {
            let m3u8Body = await response.text();
            
            // Determine the addon's base URL from the incoming request. This is crucial for rewriting
            // relative paths in the manifest to absolute paths that the player can understand.
            const addonBaseUrl = `${req.protocol}://${req.get('host')}`;

            const rewrittenLines = m3u8Body.split('\n').map(line => {
                line = line.trim();
                if (line && !line.startsWith('#')) {
                    // This is a URL to a segment or another playlist. Resolve it and re-proxy.
                    const absoluteUrl = new URL(line, baseUrl).href;
                    return `${addonBaseUrl}/proxy/${encodeURIComponent(absoluteUrl)}`;
                }
                return line;
            });
            
            const rewrittenBody = rewrittenLines.join('\n');
            // Recalculate content-length for the rewritten body
            res.setHeader('Content-Length', Buffer.byteLength(rewrittenBody, 'utf-8'));
            res.send(rewrittenBody);
        } else {
            // For any other content (like .ts segments), just pipe it
            response.body.pipe(res);
        }
        
    } catch (error) {
        console.error(`[PROXY] [${req.method}] Error:`, error.message);
        res.status(500).json({ 
            error: 'Proxy error', 
            message: error.message,
            url: req.params[0] // Keep showing the encoded URL for debugging
        });
    }
};

// CORS Proxy for streaming URLs - handles both GET and HEAD
app.get('/proxy/*', proxyHandler);
app.head('/proxy/*', proxyHandler);

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

// Root endpoint: Redirect to the configuration page for a user-friendly experience
app.get('/', (req, res) => {
    res.redirect('/configure/');
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
