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

// Serve configure.js at /configure/configure.js for correct relative path support
app.get('/configure/configure.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'config-ui', 'configure.js'));
});

const proxyHandler = async (req, res) => {
    let decodedUrl;
    let upstreamRes;
    let customHeaders;
    try {
        const encodedUrl = req.params[0];
        if (!encodedUrl) {
            return res.status(400).json({ error: 'No encoded URL provided to proxy' });
        }

        decodedUrl = decodeURIComponent(encodedUrl);
        if (!/^https?:\/\//.test(decodedUrl)) {
            return res.status(400).json({ error: 'Invalid URL provided for proxy. Must start with http or https.' });
        }

        const baseUrl = new URL(decodedUrl);

        // Log for debugging
        console.log(`[PROXY] [${req.method}] Proxying: ${decodedUrl}`);

        // Set a timeout for upstream fetch (30s)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        // Parse headers from query params
        let customHeaders = {
            // Default headers as fallback
            'User-Agent': 'otg/1.5.1 (AppleTv Apple TV 4; tvOS16.0; appletv.client) libcurl/7.58.0 OpenSSL/1.0.2o zlib/1.2.11 clib/1.8.56',
            'Referer': ' ',
            'seekable': '0'
        };
        
        if (req.query.headers) {
            try {
                const parsedHeaders = JSON.parse(decodeURIComponent(req.query.headers));
                // Merge headers, but don't overwrite the required ones unless they're in parsedHeaders
                customHeaders = { ...customHeaders, ...parsedHeaders };
            } catch (error) {
                console.error('Error parsing headers:', error);
            }
        }

        try {
            upstreamRes = await fetch(decodedUrl, {
                method: req.method,
                headers: customHeaders,
                signal: controller.signal
            });
            if (!upstreamRes.ok && req.method === 'HEAD') {
                throw new Error('HEAD not supported, fallback to GET');
            }
        } catch (err) {
            if (req.method === 'HEAD') {
                // Fallback to GET using the same headers
                upstreamRes = await fetch(decodedUrl, {
                    method: 'GET',
                    headers: customHeaders,
                    signal: controller.signal
                });
            } else {
                throw err;
            }
        }

        clearTimeout(timeout);

        if (!upstreamRes.ok) {
            throw new Error(`Upstream HTTP ${upstreamRes.status}: ${upstreamRes.statusText}`);
        }

        // Get content type
        let contentType = upstreamRes.headers.get('content-type') || '';
        const isM3U8 = contentType.includes('mpegurl') || contentType.includes('x-mpegURL') || decodedUrl.endsWith('.m3u8');
        const isTS = contentType.includes('video/MP2T') || decodedUrl.endsWith('.ts');

        // Set content type for .ts if missing
        if (!contentType && isTS) {
            contentType = 'video/MP2T';
        }
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }

        // Set content length if present
        const contentLength = upstreamRes.headers.get('content-length');
        if (contentLength) {
            res.setHeader('Content-Length', contentLength);
        }

        // For HEAD, just send headers
        if (req.method === 'HEAD') {
            res.end();
            return;
        }

        // HLS manifest: rewrite segment URLs to go through our proxy
        if (isM3U8) {
            let m3u8Body = await upstreamRes.text();
            const addonBaseUrl = `${req.protocol}://${req.get('host')}`;
            const rewrittenLines = m3u8Body.split('\n').map(line => {
                line = line.trim();
                if (line && !line.startsWith('#')) {
                    // Only rewrite if it's not already absolute and not already proxied
                    try {
                        const absUrl = new URL(line, baseUrl).href;
                        if (absUrl.startsWith(addonBaseUrl)) return line; // already proxied
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
            // For .ts and other files, stream the response
            // Remove content-length if chunked
            if (!contentLength) res.removeHeader('Content-Length');
            upstreamRes.body.pipe(res);
        }
    } catch (error) {
        clearTimeout(timeout);
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
        
        res.status(500).json({
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
