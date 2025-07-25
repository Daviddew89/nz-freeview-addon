const express = require('express');
const path = require('path');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon/addon.js');

const { version } = require('./package.json');

const app = express();
const port = process.env.PORT || 8080;

// Trust the proxy to get the correct protocol (https) from the X-Forwarded-Proto header.
app.set('trust proxy', true);

// CORS configuration
const corsOptions = {
    origin: (origin, callback) => {
        const allowedOrigins = [
            'https://web.stremio.com',
            'https://app.strem.io',
            'https://stremio.github.io',
        ];
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: ['GET', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Accept', 'Range'],
    exposedHeaders: ['Content-Length', 'Content-Range', 'Content-Type', 'Accept-Ranges'],
    credentials: true,
};
app.use(cors(corsOptions));

// Proxy middleware
const proxy = createProxyMiddleware({
    // The target will be dynamically set in the router function
    router: (req) => {
        const encodedUrl = req.params[0];
        if (!encodedUrl) {
            throw new Error('No encoded URL provided');
        }
        const decodedUrl = decodeURIComponent(encodedUrl);
        if (!/^https?:\/\//.test(decodedUrl)) {
            throw new Error('Invalid URL for proxy');
        }
        return decodedUrl;
    },
    changeOrigin: true,
    selfHandleResponse: true, // We need to handle the response to rewrite HLS playlists
    onProxyReq: (proxyReq, req, res) => {
        // Apply custom headers from the query string
        if (req.query.headers) {
            try {
                const headers = JSON.parse(decodeURIComponent(req.query.headers));
                for (const key in headers) {
                    proxyReq.setHeader(key, headers[key]);
                }
            } catch (error) {
                console.error('Error parsing headers for proxy:', error);
            }
        }
    },
    onProxyRes: (proxyRes, req, res) => {
        const addonHost = process.env.ADDON_HOST || `${req.protocol}://${req.get('host')}`;
        const requestUrl = req.params[0];
        const targetUrl = decodeURIComponent(requestUrl);
        
        // Rewrite HLS playlists to use the proxy for all segments
        const contentType = proxyRes.headers['content-type'] || '';
        if (contentType.includes('mpegurl') || contentType.includes('x-mpegURL') || targetUrl.endsWith('.m3u8')) {
            let body = [];
            proxyRes.on('data', (chunk) => body.push(chunk));
            proxyRes.on('end', () => {
                let m3u8Body = Buffer.concat(body).toString();
                const rewrittenBody = m3u8Body.split('
').map(line => {
                    line = line.trim();
                    if (line && !line.startsWith('#')) {
                        try {
                            const segmentUrl = new URL(line, targetUrl);
                            return `${addonHost}/proxy/${encodeURIComponent(segmentUrl.href)}`;
                        } catch (error) {
                            return line; // Ignore invalid lines
                        }
                    }
                    return line;
                }).join('
');
                
                res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
                res.setHeader('Content-Length', Buffer.byteLength(rewrittenBody));
                res.end(rewrittenBody);
            });
        } else {
            // For all other content types, just pipe the response
            res.writeHead(proxyRes.statusCode, proxyRes.headers);
            proxyRes.pipe(res);
        }
    },
    onError: (err, req, res) => {
        console.error('Proxy error:', err);
        res.status(500).send('Proxy Error');
    }
});

// Proxy routes - MUST be defined before the addon router
app.get('/proxy/*', proxy);
app.head('/proxy/*', proxy);

// Serve static and config files
app.use('/static', express.static(path.join(__dirname, 'static')));
app.use('/configure', express.static(path.join(__dirname, 'config-ui')));
app.get('/configure/', (req, res) => res.sendFile(path.join(__dirname, 'config-ui', 'index.html')));

// Health and stats endpoints
app.get('/health', (req, res) => res.json({ status: 'ok', version }));
app.get('/stats', (req, res) => res.json({
    status: 'ok',
    version,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
}));

// Root redirect
app.get('/', (req, res) => {
    res.redirect('/configure/');
});

// Stremio addon router
const addonRouter = getRouter(addonInterface);
app.use('/', addonRouter);

// Start server
app.listen(port, () => {
    console.log(`NZ Freeview Addon running on port ${port}`);
    console.log(`- Manifest: http://localhost:${port}/manifest.json`);
});
