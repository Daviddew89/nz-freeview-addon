const express = require('express');
const path = require('path');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon/addon.js');
const fetch = require('node-fetch');

// Read version from package.json to have a single source of truth
const { version } = require('./package.json');

const app = express();
const port = process.env.PORT || 8080;

// Trust the proxy to get the correct protocol (https) from the X-Forwarded-Proto header.
// This is essential for generating correct absolute URLs when hosted behind a reverse proxy
// like on Google Cloud or Heroku.
app.set('trust proxy', true);

// CORS and security middleware
app.use((req, res, next) => {
    // Check origin for Stremio web player compatibility
    const origin = req.headers.origin;
    const allowedOrigins = [
        'https://web.stremio.com',
        'https://app.strem.io',
        'https://stremio.github.io',
        'https://nz-freeview-addon-355637409766.us-west1.run.app'
    ];
    
    // Allow specific origins for Stremio web player
    if (origin && allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    } else {
        res.header('Access-Control-Allow-Origin', '*');
    }
    
    // Essential CORS headers
    res.header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    res.header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');
    
    // Cache control headers
    res.header('Cache-Control', 'no-cache');
    res.header('Pragma', 'no-cache');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    // Add a response handler to ensure CORS headers are set even for errors
    res.on('error', function() {
        if (!res.headersSent) {
            res.header('Access-Control-Allow-Origin', '*');
        }
    });
    
    next();
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

// Serve configure.js at /configure/configure.js for correct relative path support
app.get('/configure/configure.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'config-ui', 'configure.js'));
});

const proxyHandler = async (req, res) => {
    let decodedUrl;
    let upstreamRes;
    let customHeaders;

    // Set CORS headers immediately for all responses (including errors and HEAD)
    const origin = req.headers.origin;
    if (origin && (origin.includes('stremio.com') || origin.includes('strem.io'))) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, Accept-Ranges');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Always respond to OPTIONS early
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    try {
        const encodedUrl = req.params[0];
        if (!encodedUrl) {
            res.status(400).json({ error: 'No encoded URL provided to proxy' });
            return;
        }
        decodedUrl = decodeURIComponent(encodedUrl);
        if (!/^https?:\/\//.test(decodedUrl)) {
            res.status(400).json({ error: 'Invalid URL provided for proxy. Must start with http or https.' });
            return;
        }
        const baseUrl = new URL(decodedUrl);
        // Log for debugging
        console.log(`[PROXY] [${req.method}] Proxying: ${decodedUrl}`);
        // Set a timeout for upstream fetch (30s)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        // Parse headers from query params
        customHeaders = {
            'User-Agent': 'otg/1.5.1 (AppleTv Apple TV 4; tvOS16.0; appletv.client) libcurl/7.58.0 OpenSSL/1.0.2o zlib/1.2.11 clib/1.8.56',
            'Referer': ' ',
            'seekable': '0'
        };
        if (req.query.headers) {
            try {
                const parsedHeaders = JSON.parse(decodeURIComponent(req.query.headers));
                customHeaders = { ...customHeaders, ...parsedHeaders };
            } catch (error) {
                console.error('Error parsing headers:', error);
            }
        }
        // Always try GET for HLS, as some servers don't support HEAD
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        try {
            upstreamRes = await fetch(decodedUrl, {
                method: method,
                headers: customHeaders,
                signal: controller.signal
            });
        } catch (err) {
            clearTimeout(timeout);
            throw err;
        }
        clearTimeout(timeout);
        if (!upstreamRes.ok) {
            res.status(upstreamRes.status).json({ error: `Upstream HTTP ${upstreamRes.status}: ${upstreamRes.statusText}` });
            return;
        }
        // Log response headers for debugging
        console.log('[PROXY] Response headers:', [...upstreamRes.headers.entries()]);
        // Get content type and ensure proper HLS content types
        let contentType = upstreamRes.headers.get('content-type') || '';
        console.log('[PROXY] Original Content-Type:', contentType);
        const isM3U8 = contentType.includes('mpegurl') || contentType.includes('x-mpegURL') || decodedUrl.endsWith('.m3u8');
        const isTS = contentType.includes('video/MP2T') || decodedUrl.endsWith('.ts');
        if (isM3U8) {
            contentType = 'application/vnd.apple.mpegurl';
        } else if (isTS) {
            contentType = 'video/MP2T';
        }
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        if (isM3U8 || isTS) {
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
        }
        const contentLength = upstreamRes.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }
        const range = upstreamRes.headers.get('content-range');
        if (range) {
            res.setHeader('Content-Range', range);
            res.setHeader('Accept-Ranges', 'bytes');
        }
        // For HEAD, just send headers (simulate what GET would send)
        if (req.method === 'HEAD') {
            res.end();
            return;
        }
        // HLS manifest: rewrite segment URLs to go through our proxy
        if (isM3U8) {
            let m3u8Body = await upstreamRes.text();
            const addonBaseUrl = (process.env.K_SERVICE_URL || process.env.ADDON_HOST || `${req.protocol}://${req.get('host')}`).replace(/^http:\/\//, 'https://');
            const rewrittenLines = m3u8Body.split('\n').map(line => {
                line = line.trim();
                if (line && !line.startsWith('#')) {
                    try {
                        const absUrl = new URL(line, baseUrl).href;
                        if (absUrl.startsWith(addonBaseUrl)) return line;
                        return `${addonBaseUrl}/proxy/${encodeURIComponent(absUrl)}`;
                    } catch {
                        return line;
                    }
                }
                return line;
            });
            const rewrittenBody = rewrittenLines.join('\n');
            res.setHeader('Content-Length', Buffer.byteLength(rewrittenBody, 'utf-8'));
            res.send(rewrittenBody);
        } else {
            if (!contentLength) res.removeHeader('Content-Length');
            upstreamRes.body.pipe(res);
        }
    } catch (error) {
        // Always set CORS headers on error (already set at top)
        const errorDetails = {
            timestamp: new Date().toISOString(),
            method: req.method,
            url: decodedUrl,
            error: error.message,
            upstreamStatus: upstreamRes ? upstreamRes.status : null,
            upstreamStatusText: upstreamRes ? upstreamRes.statusText : null,
            headers: customHeaders || {},
            query: req.query
        };
        console.error('[PROXY] Error:', JSON.stringify(errorDetails, null, 2));
        if (req.method === 'HEAD') {
            res.status(503).end();
            return;
        }
        res.status(503).json({
            error: 'Proxy error',
            message: `${error.message}${decodedUrl ? ` for URL: ${decodedUrl}` : ''}`,
            upstreamStatus: upstreamRes ? upstreamRes.status : null,
            url: req.params[0] || null,
            details: errorDetails
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
            version: version,
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
        version: version
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
