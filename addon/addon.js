const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const zlib = require('zlib');

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

const M3U_URL = 'https://i.mjh.nz/nz/kodi-tv.m3u8';
const EPG_URL = 'https://i.mjh.nz/nz/epg.xml.gz';
const DEFAULT_ICON = 'https://i.mjh.nz/tv-logo/tvmate/Freeview.png';

const manifest = {
    id: 'org.nzfreeview',
    version: '1.0.4',
    name: 'NZ Freeview TV',
    description: 'Watch free New Zealand TV channels. m3u8 and epg from https://www.matthuisman.nz/ and i.mjh.nz',
    logo: '/static/Logo.png',
    background: 'https://i.mjh.nz/tv-logo/tvmate/Freeview.png',
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
    EPG_CACHE_DURATION: 60 * 60 * 1000, // 1 hour
    CHANNEL_CACHE_DURATION: 60 * 60 * 1000, // 1 hour
};

// Cache storage
let epgCache = {
    data: null,
    lastFetch: 0,
    isUpdating: false
};

let channelCache = {
    data: null,
    lastFetch: 0,
    isUpdating: false
};

// Update EPG cache
async function updateEpgCache() {
    if (epgCache.isUpdating) {
        log('DEBUG', 'EPG_CACHE', 'Update already in progress, skipping');
        return;
    }
    
    const startTime = Date.now();
    epgCache.isUpdating = true;
    
    try {
        log('INFO', 'EPG_CACHE', 'Starting EPG update');
        const epgRes = await fetch(EPG_URL);
        const epgBuf = await epgRes.buffer();
        const epgXml = zlib.gunzipSync(epgBuf).toString();
        const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
        const epg = parser.parse(epgXml);
        
        epgCache.data = epg;
        epgCache.lastFetch = Date.now();
        
        const duration = Date.now() - startTime;
        const programmeCount = epg.tv.programme?.length || 0;
        log('INFO', 'EPG_CACHE', `Updated with ${programmeCount} programmes`, { 
            duration, 
            programmeCount
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        log('ERROR', 'EPG_CACHE', 'Update failed', { 
            error: error.message, 
            duration 
        });
    } finally {
        epgCache.isUpdating = false;
    }
}

// Update channel cache
async function updateChannelCache() {
    if (channelCache.isUpdating) {
        log('DEBUG', 'CHANNEL_CACHE', 'Update already in progress, skipping');
        return;
    }
    
    const startTime = Date.now();
    channelCache.isUpdating = true;
    
    try {
        log('INFO', 'CHANNEL_CACHE', 'Starting channel update');
        const m3uRes = await fetch(M3U_URL);
        const m3u = await m3uRes.text();
        const lines = m3u.split(/\r?\n/);
        
        const channels = [];
        let cur = null;
        for (let i = 0; i < lines.length; ++i) {
            const line = lines[i];
            if (line.startsWith('#EXTINF:')) {
                const attrs = {};
                const attrRegex = /([\w-]+)="([^"]*)"/g;
                let match;
                while ((match = attrRegex.exec(line))) {
                    attrs[match[1]] = match[2];
                }
                const lastComma = line.lastIndexOf(',');
                let name = lastComma !== -1 ? line.slice(lastComma + 1).trim() : undefined;
                cur = {
                    id: attrs['channel-id'] || attrs['tvg-id'] || (name ? name.replace(/\s+/g, '-').toLowerCase() : undefined),
                    name,
                    logo: attrs['tvg-logo'] || undefined,
                    group: attrs['group-title'] || undefined,
                    chno: attrs['tvg-chno'] || undefined,
                    url: null
                };
            } else if (cur && line && !line.startsWith('#')) {
                cur.url = line.trim();
                if (cur.id && cur.name && cur.url) {
                    channels.push(cur);
                }
                cur = null;
            }
        }
        
        channelCache.data = channels;
        channelCache.lastFetch = Date.now();
        
        const duration = Date.now() - startTime;
        log('INFO', 'CHANNEL_CACHE', `Updated with ${channels.length} channels`, { 
            duration, 
            channelCount: channels.length 
        });
        
    } catch (error) {
        const duration = Date.now() - startTime;
        log('ERROR', 'CHANNEL_CACHE', 'Update failed', { 
            error: error.message, 
            duration 
        });
    } finally {
        channelCache.isUpdating = false;
    }
}

// Get EPG data with caching
async function getEPG() {
    const now = Date.now();
    
    // If cache is empty or expired, fetch fresh data
    if (!epgCache.data || now - epgCache.lastFetch > CACHE_CONFIG.EPG_CACHE_DURATION) {
        await updateEpgCache();
    }
    
    return epgCache.data;
}

// Get channels with caching
async function getChannels() {
    const now = Date.now();
    
    // If cache is empty or expired, fetch fresh data
    if (!channelCache.data || now - channelCache.lastFetch > CACHE_CONFIG.CHANNEL_CACHE_DURATION) {
        await updateChannelCache();
    }
    
    return channelCache.data;
}

function parseEpgDate(dateString) {
    if (!dateString) return null;
    
    try {
        // Handle EPG date format: "20250719035000 +0000"
        if (dateString.match(/^\d{14}\s+\+\d{4}$/)) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            const hour = dateString.substring(8, 10);
            const minute = dateString.substring(10, 12);
            const second = dateString.substring(12, 14);
            
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
            return new Date(isoString);
        }
        
        return new Date(dateString);
    } catch (error) {
        log('ERROR', 'EPG_DATE', 'Error parsing EPG date', { 
            dateString, 
            error: error.message 
        });
        return null;
    }
}

function getEpgForChannel(epg, epgId) {
    const progs = (epg.tv.programme || []).filter(p => p.channel === epgId);
    const now = Date.now();
    let current = null;
    
    progs.sort((a, b) => {
        const aStart = parseEpgDate(a.start);
        const bStart = parseEpgDate(b.start);
        if (!aStart || !bStart) return 0;
        return aStart.getTime() - bStart.getTime();
    });
    
    for (let i = 0; i < progs.length; ++i) {
        try {
            const start = parseEpgDate(progs[i].start);
            const stop = parseEpgDate(progs[i].stop);
            
            if (!start || !stop || !progs[i].title) {
                continue;
            }
            
            const startTime = start.getTime();
            const stopTime = stop.getTime();
            const buffer = 5 * 60 * 1000; // 5 minutes buffer
            
            if (now >= (startTime - buffer) && now < (stopTime + buffer)) {
                current = progs[i];
                break;
            }
        } catch (error) {
            continue;
        }
    }
    
    return { current };
}

function createVideoObject(programme, channelId, isCurrent = true) {
    const videoId = `nzfreeview-${channelId}`;
    
    if (!programme) {
        const now = new Date();
        return {
            id: videoId,
            title: 'Live',
            released: now.toISOString(),
            thumbnail: undefined,
            overview: 'Live TV stream',
            available: true,
            season: null,
            episode: null,
            live: true,
            type: 'tv'
        };
    }
    
    let releasedDate;
    try {
        if (programme.start) {
            const parsedDate = parseEpgDate(programme.start);
            releasedDate = parsedDate ? parsedDate.toISOString() : new Date().toISOString();
        } else {
            releasedDate = new Date().toISOString();
        }
    } catch (error) {
        releasedDate = new Date().toISOString();
    }
    
    return {
        id: videoId,
        title: 'Live',
        released: releasedDate,
        thumbnail: programme.icon?.src || programme.thumb?.src || programme.art?.poster,
        overview: programme.desc || 'Live TV stream',
        season: null,
        episode: null,
        runtime: programme.runtime,
        available: true,
        live: true,
        type: 'tv'
    };
}

function lcnSort(a, b) {
    const getLcn = meta => parseInt(meta.chno) || 9999;
    const lcnDiff = getLcn(a) - getLcn(b);
    
    if (lcnDiff === 0) {
        return (a.name || '').localeCompare(b.name || '');
    }
    
    return lcnDiff;
}

function getUserChannels(args, allChannels) {
    if (args.config && args.config.channels && Array.isArray(args.config.channels)) {
        const userChannelIds = args.config.channels;
        const orderedChannels = userChannelIds
            .map(id => allChannels.find(c => c.id === id))
            .filter(Boolean);
        return { channels: orderedChannels, userSorted: true };
    }
    const sortedChannels = [...allChannels].sort(lcnSort);
    return { channels: sortedChannels, userSorted: false };
}

// Catalog handler
builder.defineCatalogHandler(async (args) => {
    const startTime = Date.now();
    log('INFO', 'CATALOG', 'Processing request', { 
        args: Object.keys(args),
        config: args.config ? 'present' : 'absent'
    });
    
    try {
        const channels = await getChannels();
        const epg = await getEPG();
        const { channels: filteredChannels, userSorted } = getUserChannels(args, channels);
        
        if (!filteredChannels || filteredChannels.length === 0) {
            return { metas: [] };    
        }
        
        const metaPromises = filteredChannels.map(async (channel) => {
            try {
                const epgId = channel.id;
                const { current } = getEpgForChannel(epg, epgId);
                const currentVideo = createVideoObject(current, channel.id, true);
                
                const poster = currentVideo.thumbnail || channel.logo || DEFAULT_ICON;
                const background = currentVideo.thumbnail || channel.logo || DEFAULT_ICON;
                const genres = channel.group ? [channel.group] : ['Live'];
                
                return {
                    id: 'nzfreeview-' + channel.id,
                    type: 'tv',
                    name: channel.name || 'Unknown Channel',
                    poster,
                    posterShape: 'landscape',
                    logo: channel.logo || DEFAULT_ICON,
                    description: `Live channel: ${channel.name}`,
                    background,
                    country: ['NZ'],
                    language: ['en'],
                    genres,
                    chno: channel.chno,
                    videos: [currentVideo]
                };
                
            } catch (error) {
                log('ERROR', 'CATALOG', `Error processing channel: ${channel.name}`, { 
                    error: error.message 
                });
                
                const liveVideo = createVideoObject(null, channel.id, true);
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
                    genres: channel.group ? [channel.group] : ['Live'],
                    chno: channel.chno,
                    videos: [liveVideo]
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

    const allChannels = await getChannels();
    if (allChannels.length === 0) {
        return { meta: null };
    }

    const channel = allChannels.find(c => c.id === id);
    if (!channel) {
        return { meta: null };
    }

    try {
        const epg = await getEPG();
        const { current } = getEpgForChannel(epg, id);
        const currentVideo = createVideoObject(current, channel.id, true);
        
        const poster = currentVideo.thumbnail || channel.logo || DEFAULT_ICON;
        const background = currentVideo.thumbnail || channel.logo || DEFAULT_ICON;
        const genres = channel.group ? [channel.group] : ['Live'];
        
        const duration = Date.now() - startTime;
        log('DEBUG', 'META', `Processed channel: ${channel.name}`, { duration });
        
        return { meta: {
            id: 'nzfreeview-' + channel.id,
            type: 'tv',
            name: channel.name || 'Unknown Channel',
            poster,
            posterShape: 'landscape',
            logo: channel.logo || DEFAULT_ICON,
            description: `Live channel: ${channel.name}`,
            background,
            country: ['NZ'],
            language: ['en'],
            genres,
            chno: channel.chno,
            videos: [currentVideo]
        }};
        
    } catch (error) {
        log('ERROR', 'META', 'Error processing channel', { 
            channel: channel.name,
            error: error.message 
        });
        
        const liveVideo = createVideoObject(null, channel.id, true);
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
            chno: channel.chno,
            videos: [liveVideo]
        }};
    }
});

// Stream handler
builder.defineStreamHandler(async (args) => {    
    const startTime = Date.now();
    log('INFO', 'STREAM', 'Processing stream request', { id: args.id });

    let channelId;
    if (args.id.startsWith('nzfreeview-')) {
        channelId = args.id.replace('nzfreeview-', '');
    } else {
        channelId = args.id;
    }

    const allChannels = await getChannels();
    if (allChannels.length === 0) {
        return { streams: [] };
    }

    const channel = allChannels.find(c => c.id === channelId);
    if (!channel || !channel.url) {
        return { streams: [] };
    }

    let cleanUrl = channel.url;
    if (cleanUrl.includes('|')) {
        [cleanUrl] = cleanUrl.split('|');
    }

    const streams = [
        {
            url: cleanUrl,
            name: 'NZ Freeview (Direct)',
            title: channel.name || 'Unknown Channel',
            type: 'hls',
            quality: 'HD'
        },
        {
            url: `/proxy/${encodeURIComponent(cleanUrl)}`,
            name: 'NZ Freeview (Web)',
            title: channel.name || 'Unknown Channel',
            type: 'hls',
            quality: 'HD'
        }
    ];

    const duration = Date.now() - startTime;
    log('INFO', 'STREAM', 'Returning streams', { 
        duration,
        streamCount: streams.length,
        channelName: channel.name
    });

    return { streams };
});

// Get the addon interface
const addonInterface = builder.getInterface();

// Export for serverless deployment
module.exports = addonInterface;