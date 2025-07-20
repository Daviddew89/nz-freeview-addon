const { addonBuilder } = require('stremio-addon-sdk');
const fetch = require('node-fetch');
const { XMLParser } = require('fast-xml-parser');
const zlib = require('zlib');
const express = require('express');
const path = require('path');

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

// Performance monitoring
const performanceMetrics = {
    requests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    proxyUsage: 0,
    errors: 0,
    startTime: Date.now()
};

function logPerformance(operation, duration, success = true) {
    log('DEBUG', 'PERFORMANCE', `${operation} took ${duration}ms`, { success, operation });
    if (!success) performanceMetrics.errors++;
}

function getPerformanceStats() {
    const uptime = Date.now() - performanceMetrics.startTime;
    return {
        uptime: Math.round(uptime / 1000),
        requests: performanceMetrics.requests,
        cacheHitRate: performanceMetrics.requests > 0 ? 
            Math.round((performanceMetrics.cacheHits / performanceMetrics.requests) * 100) : 0,
        proxyUsage: performanceMetrics.proxyUsage,
        errors: performanceMetrics.errors
    };
}

// Rate limiting system for resilient fetch
const rateLimitConfig = {
    maxRequestsPerMinute: 60,
    maxRequestsPerProxy: 10,
    requestTimeout: 10000, // 10 seconds
    backoffMultiplier: 2,
    maxBackoffDelay: 30000 // 30 seconds
};

const requestQueue = [];
const proxyHealth = new Map();
const requestCounts = {
    total: 0,
    byProxy: new Map(),
    lastReset: Date.now()
};

// Reset request counts every minute
setInterval(() => {
    const now = Date.now();
    if (now - requestCounts.lastReset > 60000) {
        requestCounts.total = 0;
        requestCounts.byProxy.clear();
        requestCounts.lastReset = now;
        log('DEBUG', 'RATE_LIMIT', 'Request counts reset');
    }
}, 60000);

function isRateLimited(proxy = null) {
    const now = Date.now();
    
    // Check total requests per minute
    if (requestCounts.total >= rateLimitConfig.maxRequestsPerMinute) {
        log('WARN', 'RATE_LIMIT', 'Total rate limit exceeded', { 
            total: requestCounts.total, 
            limit: rateLimitConfig.maxRequestsPerMinute 
        });
        return true;
    }
    
    // Check proxy-specific limits
    if (proxy && requestCounts.byProxy.get(proxy) >= rateLimitConfig.maxRequestsPerProxy) {
        log('WARN', 'RATE_LIMIT', 'Proxy rate limit exceeded', { 
            proxy, 
            count: requestCounts.byProxy.get(proxy),
            limit: rateLimitConfig.maxRequestsPerProxy 
        });
        return true;
    }
    
    return false;
}

function incrementRequestCount(proxy = null) {
    requestCounts.total++;
    if (proxy) {
        const current = requestCounts.byProxy.get(proxy) || 0;
        requestCounts.byProxy.set(proxy, current + 1);
    }
}

function updateProxyHealth(proxy, success) {
    const health = proxyHealth.get(proxy) || { success: 0, failure: 0, lastUsed: 0 };
    
    if (success) {
        health.success++;
        health.failure = Math.max(0, health.failure - 1); // Reduce failure count on success
    } else {
        health.failure++;
    }
    
    health.lastUsed = Date.now();
    proxyHealth.set(proxy, health);
    
    log('DEBUG', 'PROXY_HEALTH', `Proxy ${proxy} health updated`, { 
        success: health.success, 
        failure: health.failure,
        successRate: health.success + health.failure > 0 ? 
            Math.round((health.success / (health.success + health.failure)) * 100) : 0
    });
}

function getBestProxy() {
    const proxies = [...PUBLIC_PROXY_URLS];
    
    // Sort by health score (success rate * recency)
    proxies.sort((a, b) => {
        const healthA = proxyHealth.get(a) || { success: 0, failure: 0, lastUsed: 0 };
        const healthB = proxyHealth.get(b) || { success: 0, failure: 0, lastUsed: 0 };
        
        const totalA = healthA.success + healthA.failure;
        const totalB = healthB.success + healthB.failure;
        
        const scoreA = totalA > 0 ? (healthA.success / totalA) * (1 + (Date.now() - healthA.lastUsed) / 60000) : 0;
        const scoreB = totalB > 0 ? (healthB.success / totalB) * (1 + (Date.now() - healthB.lastUsed) / 60000) : 0;
        
        return scoreB - scoreA; // Higher score first
    });
    
    return proxies[0];
}

const M3U_URL = 'https://i.mjh.nz/nz/kodi-tv.m3u8';
const EPG_URL = 'https://i.mjh.nz/nz/epg.xml.gz';
const TVMATE_BACKUP_IMAGE = 'https://i.mjh.nz/tv-logo/tvmate/';
const DEFAULT_ICON = 'https://i.mjh.nz/tv-logo/tvmate/Freeview.png';

const manifest = {
    id: 'org.nzfreeview',
    version: '1.0.4',
    name: 'NZ Freeview TV',
    description: 'Watch free New Zealand TV channels. m3u8 and epg from https://www.matthuisman.nz/ and i.mjh.nz',
    logo: '/static/Logo.png', // Use the new logo
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
                { name: 'genre', isRequired: false }, // <-- Add genre filter for Stremio UI
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

// Cache configuration - optimized for live TV
const CACHE_CONFIG = {
    EPG_CACHE_DURATION: 60 * 60 * 1000, // 1 hour (EPG doesn't change frequently)
    CHANNEL_CACHE_DURATION: 60 * 60 * 1000, // 1 hour
    AUTO_UPDATE_INTERVAL: 30 * 60 * 1000 // 30 minutes (less frequent updates)
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

// Auto-update timer
let autoUpdateTimer = null;

// Initialize auto-update system
function initializeAutoUpdate() {
    log('INFO', 'AUTO_UPDATE', 'Initialized (30 min interval)');
    
    // Start auto-update timer
    autoUpdateTimer = setInterval(async () => {
        const now = Date.now();
        
        // Check if EPG cache needs updating
        if (now - epgCache.lastFetch > CACHE_CONFIG.EPG_CACHE_DURATION) {
            log('INFO', 'AUTO_UPDATE', 'Refreshing EPG data');
            await updateEpgCache();
        }
        
        // Check if channel cache needs updating
        if (now - channelCache.lastFetch > CACHE_CONFIG.CHANNEL_CACHE_DURATION) {
            log('INFO', 'AUTO_UPDATE', 'Refreshing channel data');
            await updateChannelCache();
        }
    }, CACHE_CONFIG.AUTO_UPDATE_INTERVAL);
}

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
        const epgRes = await resilientFetch(EPG_URL);
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
            programmeCount,
            cacheSize: JSON.stringify(epg).length 
        });
        logPerformance('EPG_UPDATE', duration, true);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        log('ERROR', 'EPG_CACHE', 'Update failed', { 
            error: error.message, 
            duration 
        });
        logPerformance('EPG_UPDATE', duration, false);
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
        const m3uRes = await resilientFetch(M3U_URL);
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
        logPerformance('CHANNEL_UPDATE', duration, true);
        
    } catch (error) {
        const duration = Date.now() - startTime;
        log('ERROR', 'CHANNEL_CACHE', 'Update failed', { 
            error: error.message, 
            duration 
        });
        logPerformance('CHANNEL_UPDATE', duration, false);
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
        // Format: YYYYMMDDHHMMSS +TZ
        if (dateString.match(/^\d{14}\s+\+\d{4}$/)) {
            const year = dateString.substring(0, 4);
            const month = dateString.substring(4, 6);
            const day = dateString.substring(6, 8);
            const hour = dateString.substring(8, 10);
            const minute = dateString.substring(10, 12);
            const second = dateString.substring(12, 14);
            
            // Create ISO string
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
            return new Date(isoString);
        }
        
        // Fallback to standard date parsing
        return new Date(dateString);
    } catch (error) {
        log('ERROR', 'EPG_DATE', 'Error parsing EPG date', { 
            dateString, 
            error: error.message 
        });
        return null;
    }
}





// Channel-specific fallback images and metadata
const CHANNEL_FALLBACKS = {
    // Trackside channels (horse racing)
    'mjh-trackside-1': {
        name: 'Trackside 1',
        description: 'Live horse racing coverage from New Zealand and Australia',
        genres: ['Sports', 'Racing', 'Horse Racing'],
        fallbackImage: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&h=450&fit=crop&crop=center',
        category: 'Horse Racing',
        country: 'New Zealand'
    },
    'mjh-trackside-2': {
        name: 'Trackside 2',
        description: 'Extended horse racing coverage and international racing events',
        genres: ['Sports', 'Racing', 'Horse Racing'],
        fallbackImage: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&h=450&fit=crop&crop=center',
        category: 'Horse Racing',
        country: 'New Zealand'
    },
    'mjh-trackside-premier': {
        name: 'Trackside Premier',
        description: 'Premium horse racing coverage with expert analysis',
        genres: ['Sports', 'Racing', 'Horse Racing'],
        fallbackImage: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&h=450&fit=crop&crop=center',
        category: 'Horse Racing',
        country: 'New Zealand'
    },
    
    // Redbull TV (extreme sports)
    'mjh-redbull-tv': {
        name: 'Redbull TV',
        description: 'Extreme sports, action sports, and adventure content',
        genres: ['Sports', 'Extreme Sports', 'Action Sports'],
        fallbackImage: 'https://images.unsplash.com/photo-1571019613454-1cb2f99b2d8b?w=800&h=450&fit=crop&crop=center',
        category: 'Extreme Sports',
        country: 'International'
    },
    
    // Chinese TV channels
    'mjh-chinese-tv28': {
        name: 'Chinese TV28',
        description: 'Chinese language programming and cultural content',
        genres: ['International', 'Chinese', 'Cultural'],
        fallbackImage: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=450&fit=crop&crop=center',
        category: 'Chinese Programming',
        country: 'China'
    },
    'mjh-chinese-tv29': {
        name: 'Chinese TV29',
        description: 'Chinese entertainment and news programming',
        genres: ['International', 'Chinese', 'Entertainment'],
        fallbackImage: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&h=450&fit=crop&crop=center',
        category: 'Chinese Programming',
        country: 'China'
    },
    
    // APNA Television (South Asian)
    'mjh-apna-television': {
        name: 'APNA Television',
        description: 'South Asian programming and cultural content',
        genres: ['International', 'South Asian', 'Cultural'],
        fallbackImage: 'https://images.unsplash.com/photo-1524492412937-b28074a5d7da?w=800&h=450&fit=crop&crop=center',
        category: 'South Asian Programming',
        country: 'India'
    },
    
    // Panda TV
    'mjh-panda-tv': {
        name: 'Panda TV',
        description: 'Asian entertainment and cultural programming',
        genres: ['International', 'Asian', 'Entertainment'],
        fallbackImage: 'https://images.unsplash.com/photo-1551698618-1dfe5d97d256?w=800&h=450&fit=crop&crop=center',
        category: 'Asian Programming',
        country: 'Asia'
    },
    
    // TVSN Shopping
    'mjh-tvsn-shopping': {
        name: 'TVSN Shopping',
        description: 'Home shopping and product demonstrations',
        genres: ['Shopping', 'Retail', 'Lifestyle'],
        fallbackImage: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=800&h=450&fit=crop&crop=center',
        category: 'Shopping',
        country: 'New Zealand'
    },
    
    // Channel News Asia
    'mjh-channel-news-asia': {
        name: 'Channel News Asia (CNA)',
        description: 'Asian news and current affairs',
        genres: ['News', 'International', 'Asian'],
        fallbackImage: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&h=450&fit=crop&crop=center',
        category: 'Asian News',
        country: 'Singapore'
    }
};

// Channels that never have EPG data - skip EPG fetching completely
const CHANNELS_WITHOUT_EPG = new Set([
    'mjh-chinese-tv28',
    'mjh-chinese-tv29', 
    'mjh-apna-television',
    'mjh-panda-tv',
    'mjh-tvsn-shopping',
    'mjh-channel-news-asia',
    'mjh-trackside-premier'
]);

// NZ TV channel sorting order (standard Freeview order)
const NZ_CHANNEL_ORDER = [
    // Main channels
    'mjh-tvnz-1',      // TVNZ 1
    'mjh-tvnz-2',      // TVNZ 2
    'mjh-three',       // Three
    'mjh-bravo',       // Bravo
    'mjh-tvnz-duke',   // DUKE
    'mjh-eden',        // eden
    'mjh-discovery-hgtv', // HGTV
    'mjh-house-hunters', // House Hunters
    'mjh-deadliest-catch', // Deadliest Catch
    'mjh-motorheads',  // Motorheads
    'mjh-true-crime',  // True Crime
    'mjh-paranormal',  // Paranormal
    'mjh-whakaata-maori', // Whakaata Māori
    'mjh-te-reo',      // Te Reo
    
    // News channels
    'mjh-newshub',     // Newshub
    'mjh-1news',       // 1News
    'mjh-bbc-news',    // BBC News
    'mjh-dw-news',     // DW News
    'mjh-cnn',         // CNN
    'mjh-al-jazeera',  // Al Jazeera
    'mjh-france24',    // France 24
    'mjh-cnbc',        // CNBC
    'mjh-bloomberg',   // Bloomberg
    
    // Sports channels
    'mjh-trackside-1', // Trackside 1
    'mjh-trackside-2', // Trackside 2
    'mjh-redbull-tv',  // Redbull TV
    
    // Entertainment channels
    'mjh-discovery-popup1', // ThreeNow Sport 1
    'mjh-discovery-popup2', // ThreeNow Sport 2
    'mjh-discovery-popup3', // ThreeNow Sport 3
    'mjh-discovery-popup4', // ThreeNow Sport 4
    'mjh-discovery-popup5', // ThreeNow Sport 5
    'mjh-discovery-popup6', // ThreeNow Sport 6
    'mjh-discovery-popup7', // ThreeNow Sport 7
    'mjh-discovery-popup8', // ThreeNow Sport 8
    'mjh-discovery-popup9', // ThreeNow Sport 9
    'mjh-discovery-popup10', // ThreeNow Sport 10
    
    // Religious channels
    'mjh-shine-tv',    // Shine TV
    'mjh-firstlight',  // Firstlight
    'mjh-hope-channel', // Hope Channel
    
    // Regional channels
    'mjh-parliament-tv', // Parliament TV
    'mjh-wairarapa-tv', // Wairarapa TV
    'mjh-ch200',       // JUICE TV
    
    // International channels
    'mjh-chinese-tv28', // Chinese TV28
    'mjh-chinese-tv29', // Chinese TV29
    'mjh-apna-television', // APNA Television
    'mjh-panda-tv',    // Panda TV
    'mjh-channel-news-asia', // Channel News Asia
    
    // Shopping
    'mjh-tvsn-shopping' // TVSN Shopping
];

// Sports data enrichment
async function enrichSportsData(channelId, channelName) {
    const lowerName = channelName.toLowerCase();
    
    // Check if it's a racing channel
    if (lowerName.includes('trackside') || lowerName.includes('racing')) {
        return await getRacingData();
    }
    
    // Check if it's Redbull TV
    if (lowerName.includes('redbull')) {
        return await getExtremeSportsData();
    }
    
    return null;
}

// Get racing data (horse racing)
async function getRacingData() {
    try {
        // Try to get current racing events
        const now = new Date();
        const dayOfWeek = now.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        
        let racingInfo = {
            title: 'Live Racing Coverage',
            description: 'Live horse racing from tracks across New Zealand and Australia',
            category: 'Horse Racing',
            genres: ['Sports', 'Racing', 'Horse Racing']
        };
        
        if (isWeekend) {
            racingInfo.title = 'Weekend Racing - Live Coverage';
            racingInfo.description = 'Weekend racing action with live coverage from major tracks';
        }
        
        // Add some racing-specific metadata
        racingInfo.runtime = 'Live';
        racingInfo.country = 'New Zealand';
        racingInfo.language = 'en';
        
        return racingInfo;
    } catch (error) {
        console.log('Failed to get racing data:', error.message);
        return null;
    }
}

// Get extreme sports data for Redbull TV
async function getExtremeSportsData() {
    try {
        const extremeSports = [
            'BMX Freestyle',
            'Mountain Biking',
            'Surfing',
            'Skateboarding',
            'Snowboarding',
            'Rock Climbing',
            'Motocross',
            'Parkour'
        ];
        
        const randomSport = extremeSports[Math.floor(Math.random() * extremeSports.length)];
        
        return {
            title: `${randomSport} - Action Sports`,
            description: `Extreme sports coverage featuring ${randomSport.toLowerCase()} and other action sports`,
            category: 'Extreme Sports',
            genres: ['Sports', 'Extreme Sports', 'Action Sports'],
            runtime: 'Live',
            country: 'International',
            language: 'en'
        };
    } catch (error) {
        console.log('Failed to get extreme sports data:', error.message);
        return null;
    }
}

// Utility: Should we try to enrich this title?
function shouldEnrichTitle(title) {
    if (!title || typeof title !== 'string') return false;
    const genericTitles = [
        'News', 'Live', 'Music', 'Show', 'Episode', 'Program', 'Movie', 'Sports', 'Channel', 'Parliament', 'Shopping',
        'BBC News', 'CNN', 'DW', 'Al Jazeera', 'Top Stories from CNN', 'News Live', 'LIVE:', 'Sky News', 'France 24', 'Bloomberg', 'CNBC', 'Redbull TV', 'Trackside', 'Trackside 1', 'Trackside 2', 'Trackside Premier', 'Panda TV', 'APNA Television', 'Chinese TV28', 'Chinese TV29', 'TVSN Shopping', 'Channel News Asia', 'Shine TV', 'Firstlight', 'Hope Channel', 'Wairarapa TV', 'JUICE TV', 'Prime', 'Bravo', 'Three', 'TVNZ 1', 'TVNZ 2', 'DUKE', 'eden', 'HGTV', 'Te Reo', 'Whakaata Māori', 'Parliament TV', 'Sky Open', 'Sky Open+1', 'Bravo PLUS 1', 'ThreePlus1', 'eden+1', 'Prime PLUS 1', 'Prime+1', 'Rush', 'Rush NZ', 'Mood', 'Mood 1286', 'Mood 1287', 'Mood 1288', 'Mood 1289', 'Mood 1290', 'Discovery', 'Discovery Fast', 'Discovery Popup', 'Discovery PT', 'Discovery PTMS', 'Discovery PTMB', 'Discovery PTGN', 'Discovery FAST1', 'Discovery FAST2', 'Discovery FAST3', 'Discovery FAST4', 'Discovery FAST5', 'Discovery FAST6', 'Discovery Popup1', 'Discovery Popup2', 'Discovery Popup3', 'Discovery Popup4', 'Discovery Popup5', 'Discovery Popup6', 'Discovery Popup7', 'Discovery Popup8', 'Discovery Popup9', 'Discovery Popup10'
    ];
    if (title.length < 5) return false;
    if (genericTitles.some(g => title.toLowerCase().includes(g.toLowerCase()))) return false;
    if (/^(Live|News|Music|Show|Episode|Program|Movie|Sports)$/i.test(title.trim())) return false;
    return true;
}

// current programme for live TV
function getEpgForChannel(epg, epgId) {
    // Skip EPG lookup for channels that never have EPG data
    if (CHANNELS_WITHOUT_EPG.has(epgId)) {
        log('DEBUG', 'EPG', 'Skipping EPG lookup for channel without EPG data', { epgId });
        return { current: null };
    }
    
    const progs = (epg.tv.programme || []).filter(p => p.channel === epgId);
    const now = Date.now();
    let current = null;
    
    // Only log for channels with programmes
    if (progs.length > 0) {
        log('DEBUG', 'EPG', 'Channel has programmes', { 
            epgId, 
            programmeCount: progs.length 
        });
    }
    
    // Sort programmes by start time to ensure proper order
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
            
            if (!start || !stop) {
                continue;
            }
            
            // Ensure programme has a valid title
            if (!progs[i].title || typeof progs[i].title !== 'string') {
                continue;
            }
            
            const startTime = start.getTime();
            const stopTime = stop.getTime();
            
            // Add 5-minute buffer for current programme detection
            const buffer = 5 * 60 * 1000; // 5 minutes in milliseconds
            
            // Check if this programme is currently airing (with buffer)
            if (now >= (startTime - buffer) && now < (stopTime + buffer)) {
                current = progs[i];
                log('DEBUG', 'EPG', 'Found current programme', { 
                    epgId, 
                    title: current.title 
                });
                break; // Found current programme, no need to continue
            }
        } catch (error) {
            // Silently skip programmes with parsing errors
            continue;
        }
    }
    
    if (!current) {
        log('DEBUG', 'EPG', 'No current programme found', { epgId });
    }
    
    return { current };
}

// Enhanced metadata extraction with external sources and channel-specific fallbacks
async function extractShowInfo(programme, channelId = null, channelName = null) {
    if (!programme) {
        // If no programme data, try to get channel-specific fallback data
        if (channelId && CHANNEL_FALLBACKS[channelId]) {
            const fallback = CHANNEL_FALLBACKS[channelId];
            const sportsData = await enrichSportsData(channelId, channelName);
            
            return {
                title: sportsData?.title || fallback.name,
                description: sportsData?.description || fallback.description,
                rating: '',
                category: sportsData?.category || fallback.category,
                year: '',
                country: sportsData?.country || fallback.country,
                language: sportsData?.language || 'en',
                runtime: sportsData?.runtime || '',
                director: '',
                cast: [],
                awards: '',
                website: '',
                genres: sportsData?.genres || fallback.genres,
                fallbackImage: fallback.fallbackImage
            };
        }
        return {};
    }
    
    // Try to extract show information from programme data
    const showInfo = {
        title: programme.title || '',
        description: programme.desc || '',
        rating: programme.rating || '',
        category: programme.category || '',
        year: programme.year || '',
        country: programme.country || '',
        language: programme.language || '',
        runtime: programme.runtime || '',
        director: programme.director || '',
        cast: programme.actor ? [programme.actor] : [],
        awards: programme.awards || '',
        website: programme.website || ''
    };
    
    // Extract genres from category - handle both string and object formats
    if (programme.category) {
        if (typeof programme.category === 'string') {
            showInfo.genres = programme.category.split(',').map(g => g.trim()).filter(Boolean);
        } else if (typeof programme.category === 'object' && programme.category.value) {
            // Handle category object format
            showInfo.genres = [programme.category.value];
        } else {
            showInfo.genres = [];
        }
    } else {
        showInfo.genres = [];
    }
    
    // No external enrichment needed - all metadata comes from EPG
    
    return showInfo;
}



function getEpgImage(programme) {
    // Try to get the best available image for the programme
    if (programme && programme.icon && programme.icon.src) {
        return programme.icon.src;
    }
    if (programme && programme.thumb && programme.thumb.src) {
        return programme.thumb.src;
    }
    if (programme && programme.art && programme.art.poster) {
        return programme.art.poster;
    }
    return null;
}

function getEpgMetadata(programme) {
    if (!programme) return null;
    
    // Extract rich metadata from EPG programme
    const metadata = {
        title: programme.title || '',
        desc: programme.desc || '',
        icon: getEpgImage(programme),
        start: programme.start,
        stop: programme.stop,
        category: programme.category || '',
        episode: programme['episode-num'] || '',
        rating: programme.rating || '',
        progress: programme.start && programme.stop ? 
            Math.max(0, Math.min(1, (Date.now() - new Date(programme.start).getTime()) / 
            (new Date(programme.stop).getTime() - new Date(programme.start).getTime()))) : null
    };
    
    // Additional metadata fields
    if (programme.director) metadata.director = programme.director;
    if (programme.actor) metadata.actor = programme.actor;
    if (programme.writer) metadata.writer = programme.writer;
    if (programme.year) metadata.year = programme.year;
    if (programme.country) metadata.country = programme.country;
    if (programme.language) metadata.language = programme.language;
    if (programme.awards) metadata.awards = programme.awards;
    if (programme.website) metadata.website = programme.website;
    if (programme.runtime) metadata.runtime = programme.runtime;
    
    return metadata;
}

function createVideoObject(programme, channelId, isCurrent = true) {
    // Use the meta ID format as the video ID - this ensures consistent stream handler calls
    const videoId = `nzfreeview-${channelId}`;
    
    if (!programme) {
        // For live TV without programme data, create a default video object
        const now = new Date();
        const videoObject = {
            id: videoId,
            title: 'Live',
            released: now.toISOString(),
            thumbnail: undefined,
            overview: 'Live TV stream',
            available: true,
            // Explicitly set season/episode to null for new core compatibility
            season: null,
            episode: null,
            // Add live TV specific fields
            live: true,
            type: 'tv'
        };
        
        log('DEBUG', 'VIDEO_OBJECT', `Created live video object for ${channelId}`, { 
            videoId,
            title: videoObject.title,
            available: videoObject.available
        });
        
        return videoObject;
    }
    
    const metadata = getEpgMetadata(programme);
    
    // Parse the programme start date properly
    let releasedDate;
    try {
        if (programme.start) {
            const parsedDate = parseEpgDate(programme.start);
            releasedDate = parsedDate ? parsedDate.toISOString() : new Date().toISOString();
        } else {
            releasedDate = new Date().toISOString();
        }
    } catch (error) {
        log('ERROR', 'VIDEO_OBJECT', `Error parsing programme date for ${channelId}`, { error: error.message });
        releasedDate = new Date().toISOString();
    }
    
    // Parse season/episode numbers safely for new core
    let season = null;
    let episode = null;
    
    try {
        if (metadata.episode && !isNaN(parseInt(metadata.episode))) {
            episode = parseInt(metadata.episode);
        }
        if (programme.season && !isNaN(parseInt(programme.season))) {
            season = parseInt(programme.season);
        }
    } catch (error) {
        log('ERROR', 'VIDEO_OBJECT', `Error parsing season/episode for ${channelId}`, { error: error.message });
    }
    
    // Create video object following exact Stremio format for TV channels
    const videoObject = {
        id: videoId,
        title: 'Live', // Always use 'Live' for live TV channels
        released: releasedDate,
        thumbnail: metadata.icon,
        overview: metadata.desc || 'Live TV stream',
        season: season,
        episode: episode,
        runtime: metadata.runtime,
        available: true, // Always set to true for live TV
        // Add live TV specific fields
        live: true,
        type: 'tv'
    };
    
    log('DEBUG', 'VIDEO_OBJECT', `Created EPG video object for ${channelId}`, { 
        videoId,
        title: videoObject.title,
        available: videoObject.available,
        hasThumbnail: !!videoObject.thumbnail,
        programmeTitle: programme.title
    });
    
    return videoObject;
}

function lcnSort(a, b) {
    // Use NZ channel order if available, otherwise sort by channel number, then by name
    const aIndex = NZ_CHANNEL_ORDER.indexOf(a.id);
    const bIndex = NZ_CHANNEL_ORDER.indexOf(b.id);
    
    // If both channels are in the NZ order list, sort by their position
    if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex;
    }
    
    // If only one is in the list, prioritize it
    if (aIndex !== -1) return -1;
    if (bIndex !== -1) return 1;
    
    // Fallback to channel number sorting
    const getLcn = meta => parseInt(meta.chno) || 9999;
    const lcnDiff = getLcn(a) - getLcn(b);
    
    // If channel numbers are the same, sort by name
    if (lcnDiff === 0) {
        return (a.name || '').localeCompare(b.name || '');
    }
    
    return lcnDiff;
}

function getUserChannels(args, allChannels) {
    // Get user-selected channels from the config object provided by the SDK.
    if (args.config && args.config.channels && Array.isArray(args.config.channels)) {
        const userChannelIds = args.config.channels;
        // Preserve the user's specified order from the config.
        const orderedChannels = userChannelIds
            .map(id => allChannels.find(c => c.id === id))
            .filter(Boolean); // Filter out channels that might no longer exist.
        return { channels: orderedChannels, userSorted: true };
    }
    // If no config is provided, return all channels sorted by NZ channel order
    const sortedChannels = [...allChannels].sort(lcnSort);
    return { channels: sortedChannels, userSorted: false };
}

// Standard genre mapping for Stremio category dropdown
const GENRE_MAP = {
    'News': 'News',
    'Current Affairs': 'News',
    'World News': 'News',
    'Sports': 'Sports',
    'Racing': 'Sports',
    'Horse Racing': 'Sports',
    'Extreme Sports': 'Sports',
    'Movies': 'Movies',
    'Film': 'Movies',
    'Drama': 'Movies',
    'Kids': 'Kids',
    'Children': 'Kids',
    'Cartoon': 'Kids',
    'Lifestyle': 'Lifestyle',
    'Cooking': 'Lifestyle',
    'Home': 'Lifestyle',
    'Shopping': 'Shopping',
    'Retail': 'Shopping',
    'International': 'International',
    'Chinese': 'International',
    'South Asian': 'International',
    'Asian': 'International',
    'Cultural': 'International',
    'Religious': 'Religious',
    'Christian': 'Religious',
    'Entertainment': 'Entertainment',
    'Comedy': 'Entertainment',
    'Music': 'Entertainment',
    'Documentary': 'Entertainment',
    'Parliament': 'News',
    'Live': 'Live',
    'Reality': 'Entertainment',
    'Talk': 'Entertainment',
    'Game Show': 'Entertainment',
    'Travel': 'Lifestyle',
    'Education': 'Kids',
    'Science': 'Entertainment',
    'Technology': 'Entertainment',
    'Weather': 'News',
    'Business': 'News',
    'Finance': 'News',
    'Politics': 'News',
    'Crime': 'News',
    'True Crime': 'Entertainment',
    'Regional': 'International',
    'Maori': 'International',
    'Pacific': 'International',
    'Other': 'Entertainment'
};

function normalizeGenres(genres) {
    // Map to standard genres, deduplicate, and ensure at least one genre
    const mapped = (genres || [])
        .map(g => GENRE_MAP[g.trim()] || g.trim())
        .filter(Boolean);
    // Always include at least one genre
    if (mapped.length === 0) return ['Entertainment'];
    return [...new Set(mapped)];
}

// Helper to extract user/critic score from EPG data
function extractUserScore(epgRating) {
    // Extract rating from EPG data if available
    if (!epgRating) return undefined;
    if (typeof epgRating === 'string' && /\d+(\.\d+)?\/?10/.test(epgRating)) return epgRating;
    if (typeof epgRating === 'number') return `${epgRating}/10`;
    return undefined;
}

// Helper to extract content rating (age/maturity) from EPG data
function extractContentRating(epgRating) {
    // Only call trim if epgRating is a string
    if (typeof epgRating === 'string' && /^[A-Z0-9\-+ ]{1,6}$/.test(epgRating.trim())) return epgRating.trim();
    return undefined;
}

// Helper to determine if a channel is live/linear (no EPG/episodes, just a stream)
function isLiveChannel(channel, showInfo) {
    // Consider live if in CHANNELS_WITHOUT_EPG, or group is News, Music, or fallback genres
    const liveGroups = ['News', 'Music', 'Live', 'International'];
    if (CHANNELS_WITHOUT_EPG.has(channel.id)) return true;
    if (channel.group && liveGroups.includes(channel.group)) return true;
    if (showInfo && showInfo.genres && showInfo.genres.some(g => liveGroups.includes(g))) return true;
    return false;
}

// Helper to create links array for meta objects
function createMetaLinks(showInfo, current) {
    const links = [];
    
    // Add director link
    if (showInfo.director) {
        links.push({
            name: showInfo.director,
            category: 'director',
            url: `stremio://search/director/${encodeURIComponent(showInfo.director)}`
        });
    }
    
    // Add cast links
    if (showInfo.cast && showInfo.cast.length > 0) {
        showInfo.cast.forEach(actor => {
            links.push({
                name: actor,
                category: 'actor',
                url: `stremio://search/actor/${encodeURIComponent(actor)}`
            });
        });
    }
    
    // Add genre links
    if (showInfo.genres && showInfo.genres.length > 0) {
        showInfo.genres.forEach(genre => {
            links.push({
                name: genre,
                category: 'genre',
                url: `stremio://search/genre/${encodeURIComponent(genre)}`
            });
        });
    }
    
    // Add writer link if available
    if (current && current.writer) {
        links.push({
            name: current.writer,
            category: 'writer',
            url: `stremio://search/writer/${encodeURIComponent(current.writer)}`
        });
    }
    
    // Add country link if available
    if (showInfo.country && showInfo.country !== 'New Zealand') {
        links.push({
            name: showInfo.country,
            category: 'country',
            url: `stremio://search/country/${encodeURIComponent(showInfo.country)}`
        });
    }
    
    return links.length > 0 ? links : null;
}

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
        log('INFO', 'CATALOG', `Processing ${filteredChannels.length} channels`, { 
            totalChannels: channels.length,
            userSorted 
        });

        if (!filteredChannels || filteredChannels.length === 0) {
            log('WARN', 'CATALOG', 'No channels to process');
            return { metas: [] };    
        }
        
        // Process channels in parallel for better performance
        const metaPromises = filteredChannels.map(async (channel) => {
            const channelStartTime = Date.now();
            
            try {
                // 1. For racing/horse/Redbull TV, skip EPG/meta enrichment, use static meta
                if (['mjh-trackside-1', 'mjh-trackside-2', 'mjh-trackside-premier', 'mjh-redbull-tv'].includes(channel.id)) {
                    const fallback = CHANNEL_FALLBACKS[channel.id];
                    const liveVideo = createVideoObject(null, channel.id, true);
                    const links = createMetaLinks(fallback, null);
                    
                    const duration = Date.now() - channelStartTime;
                    log('DEBUG', 'CATALOG', `Processed racing channel: ${channel.name}`, { duration });
                    
                    return {
                        id: 'nzfreeview-' + channel.id,
                        type: 'tv',
                        name: fallback?.name || channel.name || 'Unknown Channel',
                        poster: fallback?.fallbackImage || channel.logo || DEFAULT_ICON,
                        posterShape: 'landscape',
                        logo: channel.logo || DEFAULT_ICON,
                        description: fallback?.description || `Live channel: ${channel.name}`,
                        background: fallback?.fallbackImage || channel.logo || DEFAULT_ICON,
                        country: [fallback?.country || 'NZ'],
                        language: ['en'],
                        genres: fallback?.genres || [channel.group || 'Live'],
                        chno: channel.chno,
                        videos: [liveVideo],
                        links
                    };
                }
                
                // 2. For other channels that never have meta
                if (CHANNELS_WITHOUT_EPG.has(channel.id) || (channel.group && ['News', 'Music', 'Live', 'International'].includes(channel.group))) {
                    const poster = channel.logo || DEFAULT_ICON;
                    const background = channel.logo || DEFAULT_ICON;
                    const genres = channel.group ? [channel.group] : ['Live'];
                    const liveVideo = createVideoObject(null, channel.id, true);
                    
                    const duration = Date.now() - channelStartTime;
                    log('DEBUG', 'CATALOG', `Processed live channel: ${channel.name}`, { duration });
                    
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
                        videos: [liveVideo]
                    };
                }
                
                // 3. All other channels: use full meta/EPG logic
                const epgId = channel.id;
                const { current } = getEpgForChannel(epg, epgId);
                let showInfo = await extractShowInfo(current, channel.id, channel.name);
                
                if (!showInfo || Object.keys(showInfo).length === 0) {
                    showInfo = {
                        title: channel.name,
                        description: `Live channel: ${channel.name}`,
                        genres: channel.group ? [channel.group] : ['Live'],
                        year: '',
                        country: 'New Zealand',
                        language: 'en',
                        runtime: '',
                        director: '',
                        cast: [],
                        awards: '',
                        website: '',
                        fallbackImage: channel.logo || DEFAULT_ICON
                    };
                }
                
                const epgImage = getEpgImage(current);
                const poster = epgImage || showInfo.fallbackImage || channel.logo || DEFAULT_ICON;
                const background = epgImage || showInfo.fallbackImage || channel.logo || DEFAULT_ICON;
                
                let genres = [];
                if (channel.group) genres.push(channel.group);
                if (showInfo.genres) genres.push(...showInfo.genres);
                const normalizedGenres = normalizeGenres(genres);
                
                let descParts = [];
                if (showInfo.description) descParts.push(showInfo.description);
                if (showInfo.year) descParts.push(`Year: ${showInfo.year}`);
                if (normalizedGenres.length) descParts.push(`Genre: ${normalizedGenres.join(', ')}`);
                if (showInfo.cast && showInfo.cast.length) descParts.push(`Cast: ${showInfo.cast.join(', ')}`);
                if (showInfo.director) descParts.push(`Director: ${showInfo.director}`);
                if (showInfo.runtime) descParts.push(`Runtime: ${showInfo.runtime}`);
                if (showInfo.country) descParts.push(`Country: ${showInfo.country}`);
                if (showInfo.language) descParts.push(`Language: ${showInfo.language}`);
                
                let userScore, contentRating;
                userScore = current && current.rating ? extractUserScore(current.rating) : undefined;
                contentRating = current && current.rating ? extractContentRating(current.rating) : undefined;
                
                const description = descParts.length ? descParts.join('\n') : `Live channel: ${channel.name}`;
                
                let videos = [];
                const currentVideo = createVideoObject(current, channel.id, true);
                if (currentVideo) videos.push(currentVideo);
                
                if (videos.length === 0) {
                    const liveVideo = createVideoObject(null, channel.id, true);
                    videos.push(liveVideo);
                }
                
                const links = createMetaLinks(showInfo, current);
                
                const duration = Date.now() - channelStartTime;
                log('DEBUG', 'CATALOG', `Processed EPG channel: ${channel.name}`, { 
                    duration,
                    hasEpg: !!current,
                    videoCount: videos.length,
                    linkCount: links ? links.length : 0
                });
                
                // Debug: Log the video objects being returned
                videos.forEach((video, index) => {
                    log('DEBUG', 'CATALOG', `Video object ${index + 1}`, {
                        id: video.id,
                        title: video.title,
                        available: video.available,
                        hasThumbnail: !!video.thumbnail,
                        overview: video.overview?.substring(0, 50) + (video.overview?.length > 50 ? '...' : ''),
                        released: video.released
                    });
                });
                
                // Debug: Log the complete meta object structure
                const metaObject = {
                    id: 'nzfreeview-' + channel.id,
                    type: 'tv',
                    name: channel.name || "Unknown Channel",
                    poster: poster,
                    posterShape: 'landscape',
                    logo: channel.logo || DEFAULT_ICON,
                    description: description,
                    background: background,
                    country: showInfo.country ? [showInfo.country] : ['NZ'],
                    language: showInfo.language ? [showInfo.language] : ['en'],
                    genres: normalizedGenres,
                    chno: channel.chno,
                    videos: videos,
                    
                    // Enhanced metadata from current show
                    releaseInfo: showInfo.year || '',
                    director: showInfo.director ? [showInfo.director] : null,
                    cast: (showInfo.cast && showInfo.cast.length > 0) ? showInfo.cast : null,
                    awards: showInfo.awards || null,
                    website: showInfo.website || null,
                    runtime: showInfo.runtime || null,
                    rating: current && current.rating ? current.rating : (showInfo.rating || null),
                    contentRating: current && current.rating ? extractContentRating(current.rating) : null,
                    imdbRating: current && current.rating ? extractUserScore(current.rating) : null,
                    
                    // Current programme information
                    now: current ? {
                        title: current.title,
                        description: current.desc,
                        start: current.start,
                        stop: current.stop,
                        category: current.category,
                        rating: current.rating,
                        icon: getEpgImage(current)
                    } : (showInfo.title ? {
                        title: showInfo.title,
                        description: showInfo.description,
                        start: new Date().toISOString(),
                        stop: new Date(Date.now() + 3600000).toISOString(),
                        category: showInfo.category,
                        rating: showInfo.rating,
                        icon: showInfo.fallbackImage
                    } : null),
                    
                    // Links for better Stremio integration
                    links,
                    
                    behaviorHints: {
                        defaultVideoId: `nzfreeview-${channel.id}`
                    }
                };
                
                log('DEBUG', 'CATALOG', `Complete meta object for ${channel.name}`, {
                    id: metaObject.id,
                    type: metaObject.type,
                    videoCount: metaObject.videos.length,
                    hasNow: !!metaObject.now,
                    hasLinks: !!metaObject.links,
                    defaultVideoId: metaObject.behaviorHints.defaultVideoId
                });
                
                return metaObject;
                
            } catch (error) {
                const duration = Date.now() - channelStartTime;
                log('ERROR', 'CATALOG', `Error processing channel: ${channel.name}`, { 
                    error: error.message, 
                    duration 
                });
                
                const liveVideo = createVideoObject(null, channel.id, true);
                const fallbackMeta = {
                    id: 'nzfreeview-' + channel.id,
                    type: 'tv',
                    name: channel.name || "Unknown Channel",
                    poster: channel.logo || DEFAULT_ICON,
                    posterShape: 'landscape',
                    logo: channel.logo || DEFAULT_ICON,
                    description: 'NZ Freeview Channel',
                    background: channel.logo || DEFAULT_ICON,
                    country: ['NZ'],
                    language: ['en'],
                    genres: channel.group ? [channel.group] : ['Nz'],
                    chno: channel.chno,
                    videos: [liveVideo],
                    now: null
                };
                return fallbackMeta;
            }
        });
        
        const metas = await Promise.all(metaPromises);
        const totalDuration = Date.now() - startTime;
        
        log('INFO', 'CATALOG', `Returning ${metas.length} channels`, { 
            totalDuration,
            averageTime: Math.round(totalDuration / metas.length)
        });
        logPerformance('CATALOG_PROCESSING', totalDuration, true);
        
        return { metas };
        
    } catch (error) {
        const totalDuration = Date.now() - startTime;
        log('ERROR', 'CATALOG', 'Critical error', { 
            error: error.message, 
            totalDuration 
        });
        logPerformance('CATALOG_PROCESSING', totalDuration, false);
        return { metas: [] };
    }
});

builder.defineMetaHandler(async (args) => {
    const startTime = Date.now();
    const id = args.id.replace('nzfreeview-', '');
    log('INFO', 'META', 'Processing channel', { 
        id,
        args: Object.keys(args)
    });

    const allChannels = await getChannels();
    if (allChannels.length === 0) {
        log('ERROR', 'META', 'Channel list is empty');
        return { meta: null };
    }

    const channel = allChannels.find(c => c.id === id);

    if (!channel) {
        log('ERROR', 'META', 'Channel not found', { id });
        return { meta: null };
    }

    log('INFO', 'META', 'Processing channel', { 
        name: channel.name,
        id: channel.id 
    });

    try {
        // 1. For racing/horse/Redbull TV, skip EPG/meta enrichment, use static meta
        if (['mjh-trackside-1', 'mjh-trackside-2', 'mjh-trackside-premier', 'mjh-redbull-tv'].includes(channel.id)) {
            const fallback = CHANNEL_FALLBACKS[channel.id];
            const liveVideo = createVideoObject(null, channel.id, true);
            const links = createMetaLinks(fallback, null);
            
            const duration = Date.now() - startTime;
            log('DEBUG', 'META', `Processed racing channel: ${channel.name}`, { duration });
            
            return { meta: {
                id: 'nzfreeview-' + channel.id,
                type: 'tv',
                name: fallback?.name || channel.name || 'Unknown Channel',
                poster: fallback?.fallbackImage || channel.logo || DEFAULT_ICON,
                posterShape: 'landscape',
                logo: channel.logo || DEFAULT_ICON,
                description: fallback?.description || `Live channel: ${channel.name}`,
                background: fallback?.fallbackImage || channel.logo || DEFAULT_ICON,
                country: [fallback?.country || 'NZ'],
                language: ['en'],
                genres: fallback?.genres || [channel.group || 'Live'],
                chno: channel.chno,
                videos: [liveVideo],
                links
            }};
        }
        
        // 2. For other channels that never have meta
        if (CHANNELS_WITHOUT_EPG.has(channel.id) || (channel.group && ['News', 'Music', 'Live', 'International'].includes(channel.group))) {
            const poster = channel.logo || DEFAULT_ICON;
            const background = channel.logo || DEFAULT_ICON;
            const genres = channel.group ? [channel.group] : ['Live'];
            const liveVideo = createVideoObject(null, channel.id, true);
            
            const duration = Date.now() - startTime;
            log('DEBUG', 'META', `Processed live channel: ${channel.name}`, { duration });
            
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
                videos: [liveVideo]
            }};
        }
        
        // 3. All other channels: use full meta/EPG logic
        const epg = await getEPG();
        const { current } = getEpgForChannel(epg, id);
        let showInfo = await extractShowInfo(current, channel.id, channel.name);
        
        if (!showInfo || Object.keys(showInfo).length === 0) {
            showInfo = {
                title: channel.name,
                description: `Live channel: ${channel.name}`,
                genres: channel.group ? [channel.group] : ['Live'],
                year: '',
                country: 'New Zealand',
                language: 'en',
                runtime: '',
                director: '',
                cast: [],
                awards: '',
                website: '',
                fallbackImage: channel.logo || DEFAULT_ICON
            };
        }
        
        const epgImage = getEpgImage(current);
        const poster = epgImage || showInfo.fallbackImage || channel.logo || DEFAULT_ICON;
        const background = epgImage || showInfo.fallbackImage || channel.logo || DEFAULT_ICON;
        
        let genres = [];
        if (channel.group) genres.push(channel.group);
        if (showInfo.genres) genres.push(...showInfo.genres);
        const normalizedGenres = normalizeGenres(genres);
        
        let descParts = [];
        if (showInfo.description) descParts.push(showInfo.description);
        if (showInfo.year) descParts.push(`Year: ${showInfo.year}`);
        if (normalizedGenres.length) descParts.push(`Genre: ${normalizedGenres.join(', ')}`);
        if (showInfo.cast && showInfo.cast.length) descParts.push(`Cast: ${showInfo.cast.join(', ')}`);
        if (showInfo.director) descParts.push(`Director: ${showInfo.director}`);
        if (showInfo.runtime) descParts.push(`Runtime: ${showInfo.runtime}`);
        if (showInfo.country) descParts.push(`Country: ${showInfo.country}`);
        if (showInfo.language) descParts.push(`Language: ${showInfo.language}`);
        
        let userScore, contentRating;
        userScore = current && current.rating ? extractUserScore(current.rating) : undefined;
        contentRating = current && current.rating ? extractContentRating(current.rating) : undefined;
        
        const description = descParts.length ? descParts.join('\n') : `Live channel: ${channel.name}`;
        
        let videos = [];
        const currentVideo = createVideoObject(current, channel.id, true);
        if (currentVideo) videos.push(currentVideo);
        
        if (videos.length === 0) {
            const liveVideo = createVideoObject(null, channel.id, true);
            videos.push(liveVideo);
        }
        
        const links = createMetaLinks(showInfo, current);
        
        const duration = Date.now() - startTime;
        log('DEBUG', 'META', `Processed EPG channel: ${channel.name}`, { 
            duration,
            hasEpg: !!current,
            videoCount: videos.length,
            linkCount: links ? links.length : 0
        });
        logPerformance('META_PROCESSING', duration, true);
        
        // Debug: Log the video objects being returned
        videos.forEach((video, index) => {
            log('DEBUG', 'META', `Video object ${index + 1}`, {
                id: video.id,
                title: video.title,
                available: video.available,
                hasThumbnail: !!video.thumbnail
            });
        });
        
        return { meta: {
            id: 'nzfreeview-' + channel.id,
            type: 'tv',
            name: channel.name || 'Unknown Channel',
            poster,
            posterShape: 'landscape',
            logo: channel.logo || DEFAULT_ICON,
            description,
            background,
            country: showInfo.country ? [showInfo.country] : ['NZ'],
            language: showInfo.language ? [showInfo.language] : ['en'],
            genres: normalizedGenres,
            chno: channel.chno,
            releaseInfo: showInfo.year || '',
            director: showInfo.director ? [showInfo.director] : null,
            cast: (showInfo.cast && showInfo.cast.length > 0) ? showInfo.cast : null,
            awards: showInfo.awards || null,
            website: showInfo.website || null,
            runtime: showInfo.runtime || null,
            rating: contentRating,
            contentRating: contentRating,
            imdbRating: userScore,
            videos,
            links,
            epg: {
                now: current ? {
                    title: current.title || 'Live',
                    description: current.desc || 'Live TV stream',
                    start: current.start || new Date().toISOString(),
                    stop: current.stop || new Date(Date.now() + 3600000).toISOString(),
                    category: current.category || 'Live',
                    rating: current.rating || null,
                    icon: getEpgImage(current) || null
                } : (showInfo.title ? {
                    title: showInfo.title,
                    description: showInfo.description || 'Live TV stream',
                    start: new Date().toISOString(),
                    stop: new Date(Date.now() + 3600000).toISOString(),
                    category: showInfo.category || 'Live',
                    rating: showInfo.rating || null,
                    icon: showInfo.fallbackImage || null
                } : null),
            },
            behaviorHints: {
                defaultVideoId: `nzfreeview-${channel.id}`
            }
        }};
        
    } catch (error) {
        const duration = Date.now() - startTime;
        log('ERROR', 'META', 'Error processing channel', { 
            channel: channel.name,
            error: error.message, 
            duration 
        });
        logPerformance('META_PROCESSING', duration, false);
        
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
            genres: channel.group ? [channel.group] : ['Nz'],
            chno: channel.chno,
            videos: [liveVideo],
            now: null
        }};
    }
});    
 
// Public CORS proxies for resilient streaming and data fetching
const PUBLIC_PROXY_URLS = [
    'https://corsproxy.io/?',
    'https://cors.eu.org/',
    'https://thingproxy.freeboard.io/fetch/',
    'https://api.allorigins.win/raw?url=',
    'https://cors-anywhere.herokuapp.com/'
];

// Enhanced resilient fetch function with rate limiting and comprehensive logging
async function resilientFetch(url, options = {}) {
    const startTime = Date.now();
    performanceMetrics.requests++;
    
    log('DEBUG', 'RESILIENT_FETCH', 'Starting request', { 
        url: url.substring(0, 100) + (url.length > 100 ? '...' : ''),
        options: Object.keys(options)
    });
    
    let lastError = null;
    let attemptCount = 0;
    const maxAttempts = 3;

    // Try direct fetch first
    try {
        if (isRateLimited()) {
            log('WARN', 'RESILIENT_FETCH', 'Rate limited, skipping direct fetch');
            throw new Error('Rate limited');
        }
        
        incrementRequestCount();
        const response = await fetch(url, { 
            ...options, 
            timeout: rateLimitConfig.requestTimeout 
        });
        
        if (response.ok) {
            const duration = Date.now() - startTime;
            log('INFO', 'RESILIENT_FETCH', 'Direct fetch successful', { 
                duration, 
                status: response.status,
                attemptCount: ++attemptCount
            });
            logPerformance('DIRECT_FETCH', duration, true);
            return response;
        }
    } catch (error) {
        lastError = error;
        log('DEBUG', 'RESILIENT_FETCH', 'Direct fetch failed', { 
            error: error.message,
            attemptCount: ++attemptCount
        });
    }

    // Try public proxies with intelligent ordering
    const proxies = [getBestProxy(), ...PUBLIC_PROXY_URLS.filter(p => p !== getBestProxy())];
    
    for (const proxy of proxies) {
        try {
            if (isRateLimited(proxy)) {
                log('DEBUG', 'RESILIENT_FETCH', `Proxy ${proxy} rate limited, skipping`);
                continue;
            }
            
            incrementRequestCount(proxy);
            performanceMetrics.proxyUsage++;
            
            const proxyUrl = `${proxy}${url}`;
            log('DEBUG', 'RESILIENT_FETCH', `Trying proxy: ${proxy}`, { attemptCount: ++attemptCount });
            
            const response = await fetch(proxyUrl, { 
                ...options, 
                timeout: rateLimitConfig.requestTimeout 
            });
            
            if (response.ok) {
                const duration = Date.now() - startTime;
                log('INFO', 'RESILIENT_FETCH', `Proxy fetch successful: ${proxy}`, { 
                    duration, 
                    status: response.status,
                    attemptCount,
                    proxy
                });
                logPerformance('PROXY_FETCH', duration, true);
                updateProxyHealth(proxy, true);
                return response;
            }
        } catch (error) {
            log('DEBUG', 'RESILIENT_FETCH', `Proxy failed: ${proxy}`, { 
                error: error.message,
                attemptCount: ++attemptCount
            });
            updateProxyHealth(proxy, false);
            lastError = error;
        }
    }

    // If all attempts fail, throw the last error
    const duration = Date.now() - startTime;
    log('ERROR', 'RESILIENT_FETCH', 'All fetch attempts failed', { 
        duration, 
        attemptCount,
        lastError: lastError?.message 
    });
    logPerformance('RESILIENT_FETCH', duration, false);
    
    throw lastError || new Error(`Failed to fetch ${url} after ${attemptCount} attempts`);
}

// Stream handler for new Stremio core compatibility
builder.defineStreamHandler(async (args) => {    
    const startTime = Date.now();
    log('INFO', 'STREAM', '=== STREAM HANDLER CALLED ===', { 
        id: args.id,
        args: Object.keys(args),
        fullArgs: JSON.stringify(args)
    });

    // Extract channel ID from video ID - handle multiple formats
    let channelId;
    if (args.id.startsWith('nzfreeview-')) {
        // Handle meta ID format: nzfreeview-mjh-tvnz-1
        channelId = args.id.replace('nzfreeview-', '');
        log('DEBUG', 'STREAM', 'Meta ID format detected', { channelId });
    } else {
        // Handle direct channel ID format: mjh-tvnz-1
        channelId = args.id;
        log('DEBUG', 'STREAM', 'Direct channel ID format detected', { channelId });
    }

    log('INFO', 'STREAM', 'Final channelId', { channelId });

    const allChannels = await getChannels();
    log('DEBUG', 'STREAM', 'Found total channels', { count: allChannels.length });
    
    if (allChannels.length === 0) {
        log('ERROR', 'STREAM', 'Channel list is empty');
        return { streams: [] };
    }

    const channel = allChannels.find(c => c.id === channelId);
    log('DEBUG', 'STREAM', 'Channel lookup result', { 
        found: !!channel,
        name: channel?.name 
    });

    if (!channel) {
        log('ERROR', 'STREAM', 'Channel not found', { 
            channelId,
            availableChannels: allChannels.slice(0, 10).map(c => c.id)
        });
        return { streams: [] };
    }

    if (!channel.url) {
        log('ERROR', 'STREAM', 'Channel has no stream URL', { channelId });
        return { streams: [] };
    }

    log('INFO', 'STREAM', 'Returning stream', { 
        channelName: channel.name,
        originalUrl: channel.url.substring(0, 100) + (channel.url.length > 100 ? '...' : '')
    });

    // Clean the URL (remove any custom headers)
    let cleanUrl = channel.url;
    if (cleanUrl.includes('|')) {
        [cleanUrl] = cleanUrl.split('|');
        log('DEBUG', 'STREAM', 'Cleaned URL', { cleanUrl: cleanUrl.substring(0, 100) + (cleanUrl.length > 100 ? '...' : '') });
    }

    // Create multiple stream objects for different client types
    const streams = [];
    
    // 1. Direct stream (for desktop apps)
    streams.push({
        url: cleanUrl,
        name: 'NZ Freeview (Direct)',
        title: channel.name || 'Unknown Channel',
        type: 'hls',
        quality: 'HD'
    });
    
    // 2. Proxied stream (for web clients to avoid CORS)
    const proxyUrl = `/proxy/${encodeURIComponent(cleanUrl)}`;
    streams.push({
        url: proxyUrl,
        name: 'NZ Freeview (Web)',
        title: channel.name || 'Unknown Channel',
        type: 'hls',
        quality: 'HD'
    });

    const duration = Date.now() - startTime;
    log('INFO', 'STREAM', 'Final stream objects created', { 
        duration,
        streamCount: streams.length,
        directUrl: cleanUrl.substring(0, 100) + (cleanUrl.length > 100 ? '...' : ''),
        proxyUrl: proxyUrl
    });
    logPerformance('STREAM_PROCESSING', duration, true);

    return { streams };
});

// Initialize the auto-update system when the module loads
initializeAutoUpdate();

// Get the standard addon interface
const addonInterface = builder.getInterface();

// Export the standard addon interface (this is what Stremio expects)
module.exports = addonInterface;