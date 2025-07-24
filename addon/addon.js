const { addonBuilder } = require('stremio-addon-sdk');

// Enhanced logging system for production debugging
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
};

const CURRENT_LOG_LEVEL = process.env.LOG_LEVEL || 'INFO';
const LOG_LEVEL_NUM = LOG_LEVELS[CURRENT_LOG_LEVEL] || LOG_LEVELS.INFO;

function log(level, component, message, data = null) {
    const levelNum = LOG_LEVELS[level] || LOG_LEVELS.INFO;
    if (levelNum >= LOG_LEVEL_NUM) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            component,
            message,
            ...(data && { data })
        };
        
        if (level === 'ERROR') {
            console.error(`[${timestamp}] [${level}] [${component}] ${message}`, data || '');
        } else if (level === 'WARN') {
            console.warn(`[${timestamp}] [${level}] [${component}] ${message}`, data || '');
        } else {
            console.log(`[${timestamp}] [${level}] [${component}] ${message}`, data || '');
        }
    }
}

const TV_JSON_URL = 'https://i.mjh.nz/nz/tv.json';
const DEFAULT_ICON = 'https://i.mjh.nz/tv-logo/tvmate/Freeview.png';

// The public host for the addon. This is crucial for generating absolute URLs that the Stremio
// web player can use. We fall back to a local address for development.
const PORT = process.env.PORT || 8080;
// The addon's public host URL. This is critical for generating absolute stream URLs.
// It's automatically detected from Google Cloud Run's K_SERVICE_URL environment variable.
// If deploying elsewhere, the ADDON_HOST environment variable must be set manually.
const ADDON_HOST = (process.env.K_SERVICE_URL || process.env.ADDON_HOST || '').replace(/^http:\/\//, 'https://');
 
if (!ADDON_HOST) {
    log('ERROR', 'CONFIG', 'CRITICAL: Addon host URL is not configured. Set K_SERVICE_URL or ADDON_HOST.');
} else {
    log('INFO', 'CONFIG', `Public addon host detected: ${ADDON_HOST}`);
}

// Read version from package.json to have a single source of truth
const { version } = require('../package.json');

// Construct the absolute logo URL. This is essential for Stremio clients (especially web)
// to be able to load the image. We fall back to a generic icon if the host is not available.
const LOGO_URL = ADDON_HOST 
    ? `${ADDON_HOST}/static/Logo.png` 
    : 'https://i.mjh.nz/tv-logo/tvmate/Freeview.png';

const manifest = {
    id: 'org.nzfreeview',
    version: version,
    name: 'NZ Freeview TV',
    description: 'Watch free New Zealand TV channels. Live streams and EPG data from i.mjh.nz',
    logo: LOGO_URL,
    background: LOGO_URL,
    contactEmail: 'your@email.com',
    resources: ['catalog', 'meta', 'stream'],
    types: ['tv'],
    catalogs: [
        {
            type: 'tv',
            id: 'nzfreeview',
            name: 'NZ Freeview TV',
            extra: [
                { name: 'genre', isRequired: false },
                { name: 'search', isRequired: false },
            ]
        }
    ],
    idPrefixes: ['nzfreeview-'],
    behaviorHints: {
        configurable: true,
        configurationUrl: '/configure/'
    }
};

const builder = new addonBuilder(manifest);

// Cache configuration
const CACHE_CONFIG = {
    TV_CACHE_DURATION: 60 * 60 * 1000, // 1 hour
};

// Cache storage
let tvDataCache = {
    data: null,
    lastFetch: 0,
    updatePromise: null
};

// Update TV data cache
async function updateTVDataCache() {
    // If an update is already in progress, return the existing promise to avoid race conditions.
    if (tvDataCache.updatePromise) {
        log('DEBUG', 'TV_CACHE', 'Update already in progress, awaiting existing fetch.');
        return tvDataCache.updatePromise;
    }
    
    const startTime = Date.now();
    const updateLogic = async () => {
        try {
            log('INFO', 'TV_CACHE', 'Starting TV data update');
            const tvRes = await fetch(TV_JSON_URL);
            const tvData = await tvRes.json();
            
            tvDataCache.data = tvData;
            tvDataCache.lastFetch = Date.now();
            
            const channelCount = Object.keys(tvData).length;
            const duration = Date.now() - startTime;
            log('INFO', 'TV_CACHE', `Updated with ${channelCount} channels`, { 
                duration, 
                channelCount 
            });
            
        } catch (error) {
            const duration = Date.now() - startTime;
            log('ERROR', 'TV_CACHE', 'Update failed', { 
                error: error.message, 
                duration 
            });
            // Do not replace existing stale data if the update fails
        } finally {
            // Clear the promise to allow future updates
            tvDataCache.updatePromise = null;
        }
    };

    tvDataCache.updatePromise = updateLogic();
    return tvDataCache.updatePromise;
}

// Get TV data with caching
async function getTVData() {
    const now = Date.now();
    
    // If cache is empty or expired, fetch fresh data
    if (!tvDataCache.data || now - tvDataCache.lastFetch > CACHE_CONFIG.TV_CACHE_DURATION) {
        await updateTVDataCache();
    }
    
    return tvDataCache.data || {}; // Always return an object
}

// Get all channels from TV data
async function getChannels() {
    const tvData = await getTVData();
    
    return Object.entries(tvData).map(([id, channel]) => ({
        id: id,
        name: channel.name,
        logo: channel.logo,
        description: channel.description,
        chno: channel.chno,
        url: channel.mjh_master,
        network: channel.network
    })).sort((a, b) => (a.chno || 999) - (b.chno || 999));
}

function getCurrentProgram(channel) {
    if (!channel || !Array.isArray(channel.programs)) return null;
    
    const now = Date.now() / 1000; // Current time in seconds
    const buffer = 5 * 60; // 5 minutes buffer in seconds
    
    for (let i = 0; i < channel.programs.length; i++) {
        const program = channel.programs[i];
        if (!Array.isArray(program) || program.length < 2) continue;
        
        const startTime = program[0];
        const endTime = i < channel.programs.length - 1 ? channel.programs[i + 1][0] : startTime + (3 * 60 * 60); // Assume 3 hours if no next program
        
        if (now >= (startTime - buffer) && now < (endTime + buffer)) {
            return {
                start: startTime * 1000, // Convert to milliseconds
                end: endTime * 1000,
                title: program[1]
            };
        }
    }
    
    return null;
}

function getUserChannels(args, allChannels) {
    if (args.config && args.config.channels && Array.isArray(args.config.channels)) {
        const userChannelIds = args.config.channels;
        const orderedChannels = userChannelIds
            .map(id => allChannels.find(c => c.id === id))
            .filter(Boolean);
        return { channels: orderedChannels, userSorted: true };
    }
    // allChannels is already sorted by chno from the getChannels function
    return { channels: allChannels, userSorted: false };
}

// Catalog handler
builder.defineCatalogHandler(async (args) => {
    const startTime = Date.now();
    log('INFO', 'CATALOG', 'Processing request', { 
        args: Object.keys(args),
        config: args.config ? 'present' : 'absent'
    });
    
    try {
        const tvData = await getTVData();
        const channels = await getChannels();
        const { channels: filteredChannels, userSorted } = getUserChannels(args, channels);
        
        if (!filteredChannels || filteredChannels.length === 0) {
            return { metas: [] };    
        }
        
        const metaPromises = filteredChannels.map(async (channel) => {
            try {
                const channelData = tvData[channel.id];
                const currentProgram = getCurrentProgram(channelData);
                
                let description = channelData.description || `Live channel: ${channel.name}`;
                if (currentProgram) {
                    const startTime = new Date(currentProgram.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                    const endTime = new Date(currentProgram.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
                    description = `Now: ${currentProgram.title} (${startTime} - ${endTime})\n\n${channelData.description || ''}`;
                }

                const genres = channelData.network ? [channelData.network] : ['Live'];
                
                return {
                    id: 'nzfreeview-' + channel.id,
                    type: 'tv',
                    name: channel.name || 'Unknown Channel',
                    poster: channel.logo || DEFAULT_ICON,
                    posterShape: 'landscape',
                    logo: channel.logo || DEFAULT_ICON,
                    description: description.trim(),
                    background: channel.logo || DEFAULT_ICON,
                    country: ['NZ'],
                    language: ['en'],
                    genres,
                    chno: channel.chno
                };
                
            } catch (error) {
                log('ERROR', 'CATALOG', `Error processing channel: ${channel.name}`, { 
                    error: error.message 
                });
                
                return {
                    id: 'nzfreeview-' + channel.id,
                    type: 'tv',
                    name: channel.name || 'Unknown Channel',
                    poster: channel.logo || DEFAULT_ICON,
                    posterShape: 'landscape',
                    logo: channel.logo || DEFAULT_ICON,
                    description: 'NZ Freeview Channel',
                    background: channel.logo || DEFAULT_ICON,
                    country: ['NZ'],
                    language: ['en'],
                    genres: ['Live'],
                    chno: channel.chno
                };
            }
        });
        
        const metas = await Promise.all(metaPromises);
        const totalDuration = Date.now() - startTime;
        
        log('INFO', 'CATALOG', `Returning ${metas.length} channels`, { totalDuration });
        
        return { metas };
        
    } catch (error) {
        log('ERROR', 'CATALOG', 'Critical error', { error: error.message });
        return { metas: [] };
    }
});

// Meta handler
builder.defineMetaHandler(async (args) => {
    const startTime = Date.now();
    const id = args.id.replace('nzfreeview-', '');
    log('INFO', 'META', 'Processing channel', { id });

    const tvData = await getTVData();
    const allChannels = await getChannels();
    if (allChannels.length === 0) {
        return { meta: null };
    }

    const channel = allChannels.find(c => c.id === id);
    if (!channel) {
        return { meta: null };
    }

    try {
        const channelData = tvData[id];
        const currentProgram = getCurrentProgram(channelData);

        let description = channelData.description || `Live channel: ${channel.name}`;
        if (currentProgram) {
            const startTime = new Date(currentProgram.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            const endTime = new Date(currentProgram.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            description = `Now: ${currentProgram.title} (${startTime} - ${endTime})\n\n${channelData.description || ''}`;
        }

        const genres = channelData.network ? [channelData.network] : ['Live'];

        const duration = Date.now() - startTime;
        log('DEBUG', 'META', `Processed channel: ${channel.name}`, { duration });
        
        return { meta: {
            id: 'nzfreeview-' + channel.id,
            type: 'tv',
            name: channel.name || 'Unknown Channel',
            poster: channel.logo || DEFAULT_ICON,
            posterShape: 'landscape',
            logo: channel.logo || DEFAULT_ICON,
            description: description.trim(),
            background: channel.logo || DEFAULT_ICON,
            country: ['NZ'],
            language: ['en'],
            genres,
            chno: channel.chno
        }};
        
    } catch (error) {
        log('ERROR', 'META', 'Error processing channel', { 
            channel: channel.name,
            error: error.message 
        });
        
        return { meta: {
            id: 'nzfreeview-' + channel.id,
            type: 'tv',
            name: channel.name || 'Unknown Channel',
            poster: channel.logo || DEFAULT_ICON,
            posterShape: 'landscape',
            logo: channel.logo || DEFAULT_ICON,
            description: 'NZ Freeview Channel',
            background: channel.logo || DEFAULT_ICON,
            country: ['NZ'],
            language: ['en'],
            genres: channel.group ? [channel.group] : ['Live'],
            chno: channel.chno
        }};
    }
});

// Stream handler
builder.defineStreamHandler(async (args) => {    
    const startTime = Date.now();
    log('INFO', 'STREAM', 'Processing stream request', { id: args.id });

    if (!ADDON_HOST) {
        log('ERROR', 'STREAM', 'Cannot provide streams because addon host URL is not configured.');
        // Stremio expects an empty streams array if no streams are available.
        return { streams: [] };
    }

    // The ID from Stremio includes our prefix. We need to remove it to match our internal channel ID.
    const channelId = args.id.replace('nzfreeview-', '');
    const tvData = await getTVData();
    const channelData = tvData[channelId];
    
    if (!channelData || !channelData.mjh_master) {
        return { streams: [] };
    }

    const url = channelData.mjh_master;
    
    // Build proxy URL with headers - used for both the manifest and segments
    let proxyUrl = `${ADDON_HOST}/proxy/${encodeURIComponent(url)}`;
    if (channelData.headers) {
        const encodedHeaders = encodeURIComponent(JSON.stringify(channelData.headers));
        proxyUrl += `?headers=${encodedHeaders}`;
    }

    // Define headers as a string to avoid double encoding
    const defaultHeaders = {
        'User-Agent': 'stremio-freeview/1.0.0',
        'Referer': ' ',
        'seekable': '0'
    };

    // Merge default headers with channel-specific headers
    const streamHeaders = {
        ...defaultHeaders,
        ...(channelData.headers || {})
    };

    const stream = {
        url: proxyUrl,
        name: 'NZ Freeview (Proxied)',
        // Use `description` as `title` is being deprecated.
        description: `${channelData.name || 'Unknown Channel'}`,
        behaviorHints: {
            // Live stream flags
            isLive: true,
            bingeGroup: `nzfreeview-${channelId}`,
            // Transport hints
            notWebReady: true, // Force proxying for web player
            isHLS: true, // Indicate this is an HLS stream
            isCORSRequired: true,
            player: 'hls',  // Force HLS player
            subtitlesForDirectPlayback: false
        }
    };
    
    const streams = [stream];

    const duration = Date.now() - startTime;
    log('INFO', 'STREAM', 'Returning streams', { 
        duration,
        streamCount: streams.length,
        channelName: channelData.name || 'Unknown Channel'
    });

    return { streams };
});

// Get the addon interface
const addonInterface = builder.getInterface();

// Export for serverless deployment
module.exports = addonInterface;