// Cure Procrastination - Settings Manager
'use strict';

// GLOBAL STATE CACHE (Concurrency Fix)
let g_dailyStats = null;
let g_settingsCache = null;
let g_lockSnapshots = {}; // Persistent Rule Snapshots for anti-cheat
let g_systemInstanceId = null; // Fix: Unique ID to invalidate stale sessionStorage on reinstall/reset
let g_activeReminders = new Map(); // FIX 129: Track active reminders per hostname for iframe queries
let g_activeGlobalReminder = null; // FIX 155: Track active global reminder (browser-wide)

// Helper: Persist Snapshots
const saveSnapshots = () => chrome.storage.local.set({ lockSnapshots: g_lockSnapshots });

// Load Snapshots on Start
chrome.storage.local.get(['lockSnapshots', 'systemInstanceId'], res => {
    if (res.lockSnapshots) g_lockSnapshots = res.lockSnapshots;
    // Fix: Initialize System ID (Generate if missing, primarily for first run or after reinstall)
    if (res.systemInstanceId) {
        g_systemInstanceId = res.systemInstanceId;
    } else {
        g_systemInstanceId = Math.random().toString(36).substring(2, 15);
        chrome.storage.local.set({ systemInstanceId: g_systemInstanceId });
    }
});


// Promise-based storage helpers for cleaner async/await
const storage = {
    local: {
        get: (keys) => new Promise(resolve => chrome.storage.local.get(keys, resolve)),
        set: (data) => new Promise(resolve => chrome.storage.local.set(data, resolve)),
        remove: (keys) => new Promise(resolve => chrome.storage.local.remove(keys, resolve))
    },
    sync: {
        get: (keys) => new Promise(resolve => chrome.storage.sync.get(keys, resolve)),
        set: (data) => new Promise(resolve => chrome.storage.sync.set(data, resolve))
    },
    session: {
        get: (keys) => new Promise(resolve => {
            if (!chrome.storage.session) return resolve({});
            chrome.storage.session.get(keys, resolve);
        }),
        set: (data) => new Promise(resolve => {
            if (!chrome.storage.session) return resolve();
            chrome.storage.session.set(data, resolve);
        }),
        remove: (keys) => new Promise(resolve => {
            if (!chrome.storage.session) return resolve();
            chrome.storage.session.remove(keys, resolve);
        })
    }
};

async function ensureSettings() {
    if (g_settingsCache) return g_settingsCache;
    const res = await storage.sync.get('settings');
    g_settingsCache = { ...DEFAULT_SETTINGS, ...(res.settings || {}) };
    return g_settingsCache;
}

async function getDailyStats() {
    if (g_dailyStats) return g_dailyStats;
    await ensureSettings();
    const startHour = g_settingsCache.dayStartHour || 0;
    
    const res = await storage.local.get('dailyStats');
    const logicalDate = getLogicalDate(Date.now(), startHour);
    g_dailyStats = res.dailyStats || { date: logicalDate, sites: {}, browserUsageHistory: [] };
    
    // Check for stale date immediately on load
    if (g_dailyStats.date < logicalDate) {
        console.log('[Cure] Loaded stale stats (new day), resetting.');
        g_dailyStats = { date: logicalDate, sites: {}, browserUsageHistory: [] };
    }
    return g_dailyStats;
}

let g_saveTimeout = null;

async function saveStats() {
    if (g_dailyStats) {
        // FIX: Debounce High-Frequency I/O
        // With 50+ tabs, direct writes cause browser lag.
        // We buffer updates in memory and commit to disk only once every 2 seconds.
        if (g_saveTimeout) clearTimeout(g_saveTimeout);
        
        g_saveTimeout = setTimeout(() => {
            chrome.storage.local.set({ dailyStats: g_dailyStats });
            g_saveTimeout = null;
        }, 2000);
    }
}



/**
 * Default configuration for the extension.
 * @constant
 */
const DEFAULT_SETTINGS = {
    whitelist: ['google.com', 'chrome://', 'about:blank', 'localhost'],
    blacklist: [],
    shortcuts: [
        { name: 'Gmail', url: 'https://mail.google.com' },
        { name: 'Notion', url: 'https://notion.com' }
    ],
    breathingRoomDuration: 15,
    sessionTimeoutMins: 30, // Reset session index if away for 30 min
    hardLockDuration: 30, // Minutes
    unlockReward: 5, // Minutes
    unlockRewardType: 'time', // or 'session'
    reminderInterval: 15, // Minutes
    reminderIntervalEnabled: true,
    reminderIntervalType: 'repeating',
    reminderBrowserType: 'once', 
    typingDifficulty: 50, // Characters (Legacy)
    reminderStyle: 'overlay', // Changed to overlay by default
    soundEnabled: true,
    showTimerPill: true,
    showPillOnWhitelist: true,
    unlockProtocols: {
        typing: { enabled: true, difficulty: 50 }, // Difficulty is now in Words
        password: { enabled: false, value: "" },
        delay: { enabled: false, duration: 5 },
        godMode: false
    },
    hardLockTriggers: {
        sessionLimit: { enabled: true, value: 30, windowSeconds: 86400 },
        browserLimit: { enabled: false, value: 480, windowSeconds: 86400 },
        launchLimit: { enabled: false, value: 3, windowSeconds: 3600 }
    },
    passiveWorkDefault: 25, // Default work threshold (Pomodoro adjacent)
    passiveRewardDefault: 5, // Default reward value
    passiveReward: { enabled: false, threshold: 1500, reward: 300 }, // 25m work (1500s) -> 5m reward (300s)
    reminderWhitelist: false,
    pauseWhitelist: false,
    breathingFreq: 'always',
    pauseTriggers: {
        launchLimit: { enabled: false, value: 5, windowSeconds: 3600 },
        browserLimit: { enabled: false, value: 120, windowSeconds: 86400 }
    },
    masterHardLock: true,
    masterPause: false,
    masterReminders: true
};

// Initialize settings on installation
chrome.runtime.onInstalled.addListener(async () => {
    try {
        // Fix 56: Enable session storage access for content scripts
        if (chrome.storage.session && chrome.storage.session.setAccessLevel) {
            chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
        }

        const result = await chrome.storage.sync.get('settings');
        const settings = result.settings || DEFAULT_SETTINGS;
        if (!result.settings) {
            await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
            await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
            console.debug('[Cure] Default settings initialized.');
        }
        // Initialize blocking rules on install/update
        updateBlockingRules(settings.blacklist || []);
    } catch (error) {
        console.error('[Cure] Install initialization failed:', error);
    }
});

/**
 * Syncs the blacklist with declarativeNetRequest dynamic rules.
 * This provides robust, network-level blocking for iframes and scripts.
 */
async function updateBlockingRules(blacklist) {
    if (!chrome.declarativeNetRequest) return;

    try {
        // 1. Clear existing dynamic rules
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingIds = existingRules.map(r => r.id);
        
        // 2. Map blacklist to rules
        // We use two rules per site: one to redirect frames (clean UI) and one to block everything else
        let currentId = 1;
        const rules = [];

        (blacklist || []).forEach((site) => {
            if (!site) return;
            let cleanSite = site.trim().toLowerCase();
            if (cleanSite.includes('://')) cleanSite = cleanSite.split('://')[1];
            cleanSite = cleanSite.split('/')[0];
            const siteNoWww = cleanSite.replace(/^www\./, '');
            if (!siteNoWww) return;

            // Rule A: Redirect Iframes (Sub) to blocked.html
            // We only redirect sub_frame to keep the main_frame accessible for the content script's "Unlock" challenge
            rules.push({
                id: currentId++,
                priority: 1,
                action: { 
                    type: 'redirect',
                    redirect: { extensionPath: '/blocked.html' }
                },
                condition: {
                    urlFilter: `*://${siteNoWww}/*`,
                    resourceTypes: ['sub_frame']
                }
            });

            // Rule B: Block auxiliary resources (Scripts, XHR, etc.) in all contexts
            rules.push({
                id: currentId++,
                priority: 1,
                action: { type: 'block' },
                condition: {
                    urlFilter: `*://${siteNoWww}/*`,
                    resourceTypes: ['script', 'xmlhttprequest', 'websocket', 'font', 'image', 'media']
                }
            });
        });

        await chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: existingIds,
            addRules: rules
        });
        console.debug(`[Cure] NetRequest rules updated: ${rules.length} domains blocked.`);
    } catch (e) {
        console.error('[Cure] Failed to update NetRequest rules:', e);
    }
}

// Handle messages from content scripts/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'challengeStarted') {
        const hostname = request.hostname;
        const tabId = sender.tab?.id;
        if (hostname && tabId && chrome.storage.session) {
            // Track this challenge extension-wide
            chrome.storage.session.set({ [`cure_challenge_active_${tabId}`]: hostname });
            
            // ANTI-CHEAT: Snapshot rules NOW. 
            // The site is now stuck with these until the challenge is finished.
            const cleanHost = hostname.replace(/^www\./, '');
            if (!g_lockSnapshots[cleanHost]) {
                g_lockSnapshots[cleanHost] = JSON.parse(JSON.stringify(g_settingsCache || DEFAULT_SETTINGS));
                saveSnapshots();
            }

            // 🛑 CRITICAL / LOCKED FEATURE 🛑
            // DO NOT CHANGE THIS LOGIC. SEE LOCKED_FEATURES.md
            // PESSIMISTIC LOCKING: We set the reset flag NOW.
            chrome.storage.session.set({ [`cure_needs_reset_${hostname}`]: true });
            
            console.debug(`[Cure] Challenge started on ${hostname} (Tab ${tabId})`);
        }
        sendResponse({ success: true });
        return;
    }

    if (request.action === 'challengeFinished') {
        const hostname = request.hostname;
        const tabId = sender.tab?.id;
        if (tabId && chrome.storage.session) {
            chrome.storage.session.remove([`cure_challenge_active_${tabId}`, `cure_needs_reset_${hostname}`]);
            console.log(`[Cure] Challenge finished on ${hostname} (Tab ${tabId})`);
        }
        sendResponse({ success: true });
        return;
    }

    if (request.action === 'getSystemInfo') {
        sendResponse({ instanceId: g_systemInstanceId });
        return;
    }

    if (request.action === 'checkResetStatus') {
        const hostname = request.hostname;
        // console.debug(`[Cure] checkResetStatus called for: ${hostname}`);
        storage.session.get(`cure_needs_reset_${hostname}`).then(res => {
            const needsReset = res[`cure_needs_reset_${hostname}`] === true;
            // console.debug(`[Cure] status for ${hostname}:`, needsReset);
            sendResponse({ needsReset });
        }).catch(e => {
            console.error(`[Cure] checkResetStatus error:`, e);
            sendResponse({ needsReset: false, error: e.message });
        });
        return true; // Async
    }

    if (request.action === 'clearResetFlag') {
        const hostname = request.hostname;
        if (chrome.storage.session) {
            chrome.storage.session.remove(`cure_needs_reset_${hostname}`);
            // Also notify tabs on this hostname to stop showing the toast
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(t => {
                    try {
                        if (t.url && new URL(t.url).hostname.replace('www.', '') === hostname.replace('www.', '')) {
                            chrome.tabs.sendMessage(t.id, { action: 'dismissResetToast' }).catch(() => {});
                        }
                    } catch(e) {}
                });
            });
        }
        sendResponse({ success: true });
        return;
    }

    if (request.action === 'setResetFlag') {
        const hostname = request.hostname;
        if (chrome.storage.session && hostname) {
            chrome.storage.session.set({ [`cure_needs_reset_${hostname}`]: true });
            console.log(`[Cure] Global reset flag set for ${hostname}`);
        }
        sendResponse({ success: true });
        return;
    }

    // --- STORAGE PROXY (Local/Session) ---
    if (request.action === 'sessionStorageProxy') {
        const { op, key, value, storageArea } = request;
        
        // Default to session for backward compatibility, but allow 'local' for persistence
        const storage = (storageArea === 'local') ? chrome.storage.local : chrome.storage.session;

        // Fallback for session storage if undefined in some contexts (though usually available)
        if (!storage) {
            sendResponse({ error: 'Storage area unavailable' });
            return;
        }

        if (op === 'get') {
            storage.get(key).then(res => sendResponse({ value: res[key] }));
        } else if (op === 'set') {
            storage.set({ [key]: value }).then(() => sendResponse({ success: true }));
        } else if (op === 'remove') {
            storage.remove(key).then(() => sendResponse({ success: true }));
        }
        return true; // Async
    }

    if (request.action === 'getSettings') {
        const sendEffectiveSettings = (currentSettings) => {
            let hostname = request.hostname;
            if (!hostname && sender.tab && sender.tab.url) {
                try {
                    hostname = new URL(sender.tab.url).hostname;
                } catch (e) {}
            }
            
            let finalSettings = currentSettings || DEFAULT_SETTINGS;
            if (hostname) {
                const cleanHost = hostname.replace(/^www\./, '');
                // AUTHORITATIVE SNAPSHOT: If locked, site ONLY sees the frozen rules.
                if (g_lockSnapshots[cleanHost]) {
                    finalSettings = g_lockSnapshots[cleanHost];
                }
            }
            sendResponse({ settings: finalSettings });
        };

        if (g_settingsCache) {
            sendEffectiveSettings(g_settingsCache);
        } else {
            ensureSettings().then(sendEffectiveSettings);
        }
        return true; 
    }

    if (request.action === 'relayDebugTrigger') {
        const { type, tabId } = request;
        if (!tabId) {
            sendResponse({ success: false, error: 'No target tab' });
            return true;
        }

        chrome.tabs.sendMessage(tabId, { action: 'debugTrigger', type: type })
            .then(() => sendResponse({ success: true }))
            .catch(err => {
                console.warn('[Cure] Debug relay failed, tab may be stale:', err.message);
                sendResponse({ success: false, error: 'stale' });
            });
        return true;
    }

    if (request.action === 'trackLaunch') {
        const hostname = request.hostname;
        (async () => {
            try {
                const settings = await ensureSettings();
                const stats = await getDailyStats();
                const now = Date.now();

                // Merge triggers safely
                const hardTriggers = { ...DEFAULT_SETTINGS.hardLockTriggers, ...(settings.hardLockTriggers || {}) };
                const pauseTriggers = { ...DEFAULT_SETTINGS.pauseTriggers, ...(settings.pauseTriggers || {}) };
                const reminderTriggers = settings.reminderTriggers || {};

                // Determine which features are active for this hostname
                const hardLockActive = settings.masterHardLock !== false && hardTriggers.launchLimit?.enabled;
                const pauseActive = settings.masterPause !== false && pauseTriggers.launchLimit?.enabled;
                const reminderActive = settings.masterReminders !== false && reminderTriggers.launchLimit?.enabled;

                const trackingNeeded = hardLockActive || pauseActive || reminderActive;
                const config = hardTriggers.launchLimit;
                if (!stats.sites[hostname]) stats.sites[hostname] = { usageHistory: [], launches: [], lastActiveAt: 0, activeSession: null };
                let siteStats = stats.sites[hostname];
                if (!siteStats.launches) siteStats.launches = [];

                let isLocked = false;
                let currentSessionActive = false;

                // Use request window if provided (for reminders), else use config (for hard lock)
                const effectiveWindowSeconds = request.windowSeconds || config.windowSeconds || 3600;
                const windowMs = effectiveWindowSeconds * 1000;

                // 1. Check active session
                if (siteStats.activeSession) {
                    const inactivityElapsed = (now - siteStats.activeSession.lastActive) / 60000;
                    if (inactivityElapsed < 2) {
                        currentSessionActive = true;
                        siteStats.activeSession.lastActive = now;
                        siteStats.lastActiveAt = now;
                    } else {
                        siteStats.activeSession = null;
                    }
                }

                // Check Lock State (Async)
                const lockKey = `lock_${hostname}`;
                const lockRes = await storage.local.get(lockKey);
                const lockState = lockRes[lockKey];
                const isUnlocked = lockState && lockState.unlocked && (!lockState.expiresAt || now < lockState.expiresAt);

                if (isUnlocked) {
                    currentSessionActive = true;
                    if (!siteStats.activeSession) {
                        siteStats.activeSession = { startTime: now, lastActive: now, isReward: true };
                    } else {
                        siteStats.activeSession.lastActive = now;
                    }
                }

                // 2. Start new session OR record explicit new visit (Launch)
                // FIX 158/159/161: Intuitive & Iterative Launch. 
                // Record if tracking is needed and (fresh session OR explicit isNewVisit)
                if (trackingNeeded && (!currentSessionActive || request.isNewVisit)) {
                    // CALCULATE MAX WINDOW: We must prune based on the LARGEST active limit window
                    // to ensure long-window reminders (e.g. daily) aren't prematurely deleted by short-window locks (e.g. hourly).
                    const windows = [];
                    if (hardLockActive) windows.push(hardTriggers.launchLimit?.windowSeconds || 3600);
                    if (pauseActive) windows.push(pauseTriggers.launchLimit?.windowSeconds || 3600);
                    if (reminderActive) windows.push(reminderTriggers.launchLimit?.windowSeconds || 3600);
                    
                    const maxWindowSecs = Math.max(...windows, 3600); // Default to at least 1 hour
                    const maxWindowMs = maxWindowSecs * 1000;
                    
                    // Prune history
                    if (!siteStats.launches) siteStats.launches = [];
                    siteStats.launches = siteStats.launches.filter(ts => now - ts < maxWindowMs);

                    // RECORD LAUNCH: Increment every time, even if current count exceeds the limit.
                    // This satisfies the requirement to see "3 visits", "4 visits" while the overlay is showing.
                    siteStats.launches.push(now);
                    
                    if (!siteStats.activeSession) {
                        siteStats.activeSession = { startTime: now, lastActive: now };
                    }
                    siteStats.lastActiveAt = now;
                    currentSessionActive = true;

                    // If we just hit the hard lock limit, mark as locked immediately
                    if (hardLockActive && siteStats.launches.length >= hardTriggers.launchLimit.value) {
                        isLocked = true;
                    }
                }

                // 3. Info for UI (Calculate based on effective window)
                const history = (siteStats.launches || []).filter(ts => now - ts < windowMs);
                const remaining = (hardTriggers.launchLimit?.enabled) ? Math.max(0, hardTriggers.launchLimit.value - history.length) : 99;

                let waitTime = 0;
                if (isLocked && history.length > 0) {
                    const oldest = Math.min(...history);
                    waitTime = Math.ceil((windowMs - (now - oldest)) / 1000);
                }

                // Windowed Usage Stats (Merged for performance)
                const siteWinMs = (request.siteWindowSeconds || 86400) * 1000;
                const browserWinMs = (request.browserWindowSeconds || 86400) * 1000;

                const siteSeconds = (siteStats.usageHistory || [])
                    .filter(entry => now - entry.ts < siteWinMs)
                    .reduce((sum, entry) => sum + entry.dur, 0);

                const browserSeconds = (stats.browserUsageHistory || [])
                    .filter(entry => now - entry.ts < browserWinMs)
                    .reduce((sum, entry) => sum + entry.dur, 0);

                // FIX: Get global dismissal flags to return to content script
                const globalDismissals = {};
                if (chrome.storage.session) {
                    const allSession = await chrome.storage.session.get(null);
                    Object.keys(allSession).forEach(k => {
                        if (k.startsWith('cure_global_remind_dismissed_')) {
                            globalDismissals[k] = allSession[k];
                        }
                    });
                }

                // Save Updated Stats (Concurrent Safe)
                saveStats();
                
                sendResponse({
                    locked: isLocked,
                    reason: 'launchLimit',
                    sessionActive: currentSessionActive,
                    remaining: remaining,
                    total: config.value,
                    waitTime: waitTime,
                    currentLaunches: history.length,
                    browserSeconds: browserSeconds,
                    siteSeconds: siteSeconds,
                    globalDismissals: globalDismissals
                });
            } catch (e) {
                console.error('[Cure] trackLaunch handler error:', e);
                sendResponse({ locked: false, sessionActive: true, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'startRewardSession') {
        const hostname = request.hostname;
        (async () => {
            const stats = await getDailyStats();
            // Start logic...
            if (!stats.sites[hostname]) stats.sites[hostname] = { activeSeconds: 0, launches: [], lastActiveAt: 0, activeSession: null };
            
            const now = Date.now();
            stats.sites[hostname].activeSession = { startTime: now, lastActive: now, isReward: true };
            stats.sites[hostname].lastActiveAt = now;
            
            saveStats();
            sendResponse({ success: true });
        })();
        return true;
    }

    if (request.action === 'trackUsage') {
        const { hostname, deltaSiteSeconds, deltaBrowserSeconds } = request;
        (async () => {
             try {
                 await ensureSettings();
                 const stats = await getDailyStats();
                 const startHour = (g_settingsCache && g_settingsCache.dayStartHour) || 0;
                 const logicalDate = getLogicalDate(Date.now(), startHour);

                // Double check reset (Concurrent safety: if another tab triggered reset, g_dailyStats is already updated in memory)
                if (stats.date !== logicalDate) {
                    stats.date = logicalDate;
                    stats.sites = {};
                    stats.browserUsageHistory = [];
                }

                if (!stats.sites[hostname]) stats.sites[hostname] = { usageHistory: [], launches: [], activeSession: null };
                if (!stats.browserUsageHistory) stats.browserUsageHistory = [];

                const now = Date.now();
                stats.sites[hostname].lastActiveAt = now;
                if (stats.sites[hostname].activeSession) {
                    stats.sites[hostname].activeSession.lastActive = now;
                }

                 if (deltaSiteSeconds > 0) {
                    if (!stats.sites[hostname].usageHistory) stats.sites[hostname].usageHistory = [];
                    
                    // FIX 131: Deduplicate Usage (Wall-Clock Throttling)
                    // If multiple frames/tabs report usage simultaneously (e.g. iframe + main tab),
                    // we limit the record rate to ~1 tick per second to prevent double-counting.
                    const history = stats.sites[hostname].usageHistory;
                    const lastEntry = history.length > 0 ? history[history.length - 1] : null;
                    
                    // Allow update if:
                    // 1. No history
                    // 2. Last update was > 900ms ago (Standard 1s tick)
                    // 3. Current update is large (> 1s) (Throttled/Background update)
                    if (!lastEntry || (now - lastEntry.ts >= 900) || deltaSiteSeconds > 1) {
                        history.push({ ts: now, dur: deltaSiteSeconds });
                    }
                }

                if (deltaBrowserSeconds > 0) {
                    stats.browserUsageHistory.push({ ts: now, dur: deltaBrowserSeconds });
                }

                // Trim Logic (In Memory)
                const oneDayMs = 24 * 60 * 60 * 1000;
                // Optimize: Only trim occasionally? Or every time?
                // Every time is safer for memory, but iterating arrays is slow.
                // Let's do it every time for correct rolling window.
                stats.browserUsageHistory = stats.browserUsageHistory.filter(c => now - c.ts < oneDayMs);
                stats.sites[hostname].usageHistory = (stats.sites[hostname].usageHistory || []).filter(c => now - c.ts < oneDayMs);

                saveStats();
                sendResponse({ success: true });
            } catch (e) {
                console.error('[Cure] trackUsage failed:', e);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'getWindowedUsage') {
        const { hostname, siteWindowSeconds, browserWindowSeconds } = request;
        (async () => {
            try {
                const stats = await getDailyStats();
                const now = Date.now();
                let siteSum = 0;
                if (stats.sites[hostname] && stats.sites[hostname].usageHistory) {
                    const windowMs = siteWindowSeconds * 1000;
                    siteSum = stats.sites[hostname].usageHistory
                        .filter(c => now - c.ts < windowMs)
                        .reduce((acc, c) => acc + c.dur, 0);
                }
                let browserSum = 0;
                if (stats.browserUsageHistory) {
                    const windowMs = browserWindowSeconds * 1000;
                    browserSum = stats.browserUsageHistory
                        .filter(c => now - c.ts < windowMs)
                        .reduce((acc, c) => acc + c.dur, 0);
                }
                sendResponse({ siteSeconds: siteSum, browserSeconds: browserSum });
            } catch (e) {
                console.error('[Cure] getWindowedUsage failed:', e);
                sendResponse({ siteSeconds: 0, browserSeconds: 0, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'openTab') {
        chrome.tabs.create({ url: request.url });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'closeMyTab') {
        if (sender.tab && sender.tab.id) {
            chrome.tabs.remove(sender.tab.id);
        }
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'updateSettings') {
        const newSettings = request.settings;
        chrome.storage.sync.set({ settings: newSettings }, () => {
            if (chrome.runtime.lastError) {
                console.error('[Cure] Save Failed:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            g_settingsCache = newSettings; // Update live cache
            updateBlockingRules(newSettings?.blacklist || []);

            // Propagate updates to all active tabs
            chrome.tabs.query({}, (tabs) => {
                for (const tab of tabs) {
                    if (tab.id && tab.url) {
                        try {
                            const url = new URL(tab.url);
                            const tabHost = url.hostname.replace(/^www\./, '');
                            // AUTHORITATIVE BROADCAST: Send tab-specific frozen settings if locked.
                            const finalSettings = g_lockSnapshots[tabHost] || newSettings;
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'settingsUpdated',
                                settings: finalSettings
                            }).catch(() => {});
                        } catch (e) {
                            // Fallback for chrome:// etc
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'settingsUpdated',
                                settings: newSettings
                            }).catch(() => {});
                        }
                    }
                }
            });
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'trackPassiveReward') {
        const { deltaSeconds, threshold, reward } = request;
        chrome.storage.local.get('passiveData', (result) => {
            let data = result.passiveData || { accrual: 0, rewardBank: 0 };

            // Safety Cap: Max 2 hours (7200s) banked
            const MAX_BANK_SECONDS = 7200;

            if (data.rewardBank < MAX_BANK_SECONDS) {
                data.accrual += deltaSeconds;

                let earned = 0;
                if (data.accrual >= threshold) {
                    earned = Math.floor(data.accrual / threshold) * reward;
                    data.rewardBank += earned;

                    // Enforce cap after earning
                    if (data.rewardBank > MAX_BANK_SECONDS) {
                        data.rewardBank = MAX_BANK_SECONDS;
                    }

                    data.accrual = data.accrual % threshold;
                }

                chrome.storage.local.set({ passiveData: data }, () => {
                    sendResponse({ earned, totalBank: data.rewardBank, currentAccrual: data.accrual });
                });
            } else {
                // Already at cap
                sendResponse({ earned: 0, totalBank: data.rewardBank, currentAccrual: data.accrual });
            }
        });
        return true;
    }

    if (request.action === 'getPassiveData') {
        chrome.storage.local.get('passiveData', (result) => {
            sendResponse({ data: result.passiveData || { accrual: 0, rewardBank: 0 } });
        });
        return true;
    }

    if (request.action === 'consumeRewardBank') {
        chrome.storage.local.get('passiveData', (result) => {
            let data = result.passiveData || { accrual: 0, rewardBank: 0 };
            const consumed = data.rewardBank;
            data.rewardBank = 0;
            chrome.storage.local.set({ passiveData: data }, () => {
                sendResponse({ consumed });
            });
        });
        return true;
    }

    // --- LOCK STATE MANAGEMENT (Prevents refresh bypass) ---
    if (request.action === 'setLockState') {
        const { hostname, windowSeconds, reason } = request;
        const key = `lock_${hostname}`;
        const now = Date.now();

        // STICKY LOCK: Lock does NOT auto-expire based on window.
        // The lock persists until the user completes a protocol.
        // The 'windowSeconds' is stored for reference but not used for auto-expiry.
        const lockState = {
            lockedAt: now,
            windowSeconds: windowSeconds, // Store for reference only
            reason: reason || 'limit',
            unlocked: false
        };

        const cleanHost = hostname.replace(/^www\./, '');
        // REMOVED: snapshotting here. 
        // We now snapshot only in 'challengeStarted' to allow reactive whitelisting 
        // while on the Decision ("Time's Up") screen.

        chrome.storage.local.set({ [key]: lockState }, () => {
            sendResponse({ success: true, lockState });
        });
        return true;
    }

    if (request.action === 'getTabLockState') {
        const currentTabId = sender.tab?.id;
        if (!currentTabId) {
            sendResponse({ locked: false });
            return true;
        }

        // Check if ANY hostname is locked for this tab
        // We can look at the tab's top-level URL
        chrome.tabs.get(currentTabId, async (tab) => {
            if (chrome.runtime.lastError || !tab.url) {
                sendResponse({ locked: false });
                return;
            }
            try {
                const url = new URL(tab.url);
                const hostname = url.hostname.replace(/^www\./, '');
                const key = `lock_${hostname}`;
                const result = await storage.local.get([key]);
                const lockState = result[key];
                
                sendResponse({ 
                    locked: lockState && !lockState.unlocked, 
                    hostname: hostname,
                    reason: lockState?.reason 
                });
            } catch (e) {
                sendResponse({ locked: false });
            }
        });
        return true; // Async
    }

    if (request.action === 'getLockState') {
        const { hostname } = request;
        const key = `lock_${hostname}`;

        (async () => {
            try {
                const result = await storage.local.get([key]);
                const lockState = result[key];
                const settings = await ensureSettings();
                
                // FIX 105: Tab-Level Whitelisting for Iframes
                // If the parent tab is whitelisted, the iframe should be allowed too.
                let tabWhitelisted = false;
                if (sender.tab && sender.tab.url) {
                    try {
                        const tabUrl = new URL(sender.tab.url);
                        tabWhitelisted = isHostnameWhitelisted(tabUrl.hostname, settings.whitelist);
                    } catch (e) { /* Ignore invalid URLs */ }
                }

                if (!lockState) {
                    sendResponse({ locked: false, tabWhitelisted });
                    return;
                }

                // STICKY LOCK: Lock only clears if 'unlocked' is true (protocol completed)
                if (lockState.unlocked) {
                    sendResponse({ locked: false, unlocked: true, tabWhitelisted });
                    return;
                }

                // Still locked - user must complete a protocol
                sendResponse({
                    locked: true,
                    lockState,
                    tabWhitelisted
                });
            } catch (e) {
                console.error('[Cure] getLockState failed:', e);
                sendResponse({ locked: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'broadcastLockState') {
        const { hostname, locked } = request;
        const currentTabId = sender.tab?.id;

        const broadcastToAllFrames = (tabId) => {
            // FIX 127: Deep Broadcast. 
            // chrome.tabs.sendMessage only targets the TOP frame by default.
            // We use webNavigation to find all frames (including hidden Server 1/2 players).
            if (chrome.webNavigation) {
                chrome.webNavigation.getAllFrames({ tabId: tabId }, (frames) => {
                    if (chrome.runtime.lastError || !frames) return;
                    frames.forEach(frame => {
                        chrome.tabs.sendMessage(tabId, { 
                            action: 'forceMediaPause', 
                            locked: locked,
                            hostname: hostname 
                        }, { frameId: frame.frameId }).catch(() => {});
                    });
                });
            } else {
                // Fallback for missing webNavigation (though manifest has it)
                chrome.tabs.sendMessage(tabId, { 
                    action: 'forceMediaPause', 
                    locked: locked,
                    hostname: hostname 
                }).catch(() => {});
            }
        };

        // 1. Target CURRENT tab (Deep Broadcast)
        if (currentTabId) {
            broadcastToAllFrames(currentTabId);
        }

        // 2. Target OTHER tabs of the same hostname (multi-tab sync)
        if (hostname) {
            chrome.tabs.query({ url: "*://" + hostname + "/*" }, (tabs) => {
                if (chrome.runtime.lastError || !tabs) return;
                tabs.forEach(tab => {
                    if (tab.id && tab.id !== currentTabId) {
                        broadcastToAllFrames(tab.id);
                    }
                });
            });
        }
        sendResponse({ success: true });
        return true;
    }

    // FIX 128: Cross-Tab Reminder Broadcast
    // FIX 129: Extended to use deep frame broadcast like Strict Lock
    // Broadcasts reminder overlay show/dismiss to ALL tabs AND embedded iframes
    if (request.action === 'broadcastReminderState') {
        const { hostname, show, value, type } = request;
        const currentTabId = sender.tab?.id;
        const cleanHost = hostname.replace(/^www\./, '');

        const isGlobal = type === 'browser';

        // FIX 129/155: Track reminder state
        if (show) {
            if (isGlobal) {
                g_activeGlobalReminder = { value, type };
            } else {
                g_activeReminders.set(cleanHost, { value, type, active: true });
            }
        } else {
            if (isGlobal) {
                g_activeGlobalReminder = null;
            } else {
                g_activeReminders.delete(cleanHost);
            }
        }

        const broadcastToAllFrames = (tabId, isCurrentTab = false) => {
            if (chrome.webNavigation) {
                chrome.webNavigation.getAllFrames({ tabId: tabId }, (frames) => {
                    if (chrome.runtime.lastError || !frames) return;
                    frames.forEach(frame => {
                        // FIX: Media Kill Switch (Universal)
                        // We ALWAYS send a media action to EVERY frame in the tab, 
                        // bypassing hostname matching. This ensures cross-origin 
                        // iframes (like YouTube) pause their media.
                        chrome.tabs.sendMessage(tabId, {
                            action: 'tabMediaAction',
                            type: show ? 'pause' : 'resume'
                        }, { frameId: frame.frameId }).catch(() => {});

                        // Skip the sender frame (frameId 0 on the current tab)
                        if (isCurrentTab && frame.frameId === 0) return;
                        
                        // Check if frame URL matches the hostname for overlay display
                        try {
                            const frameUrl = new URL(frame.url);
                            const frameHost = frameUrl.hostname.replace(/^www\./, '');
                            
                            if (isGlobal || frameHost === cleanHost) {
                                if (show) {
                                    chrome.tabs.sendMessage(tabId, {
                                        action: 'forceReminderOverlay',
                                        hostname: isGlobal ? 'global' : cleanHost,
                                        value: value,
                                        type: type
                                    }, { frameId: frame.frameId }).catch(() => {});
                                } else {
                                    chrome.tabs.sendMessage(tabId, {
                                        action: 'dismissReminderOverlay',
                                        hostname: isGlobal ? 'global' : cleanHost
                                    }, { frameId: frame.frameId }).catch(() => {});
                                }
                            }
                        } catch (e) {
                            // Skip invalid URLs
                        }
                    });
                });
            }
        };

        // 1. Broadcast to ALL frames in the current tab (for embedded iframes)
        if (currentTabId) {
            broadcastToAllFrames(currentTabId, true);
        }

        // 2. Query ALL tabs and check all frames for matching hostname
        chrome.tabs.query({}, (tabs) => {
            if (chrome.runtime.lastError || !tabs) return;
            
            for (const tab of tabs) {
                if (tab.id && tab.id !== currentTabId) {
                    broadcastToAllFrames(tab.id, false);
                }
            }
        });
        
        sendResponse({ success: true });
        return true;
    }

    // FIX 129/155: Query for active reminder state (used by tabs/iframes on load)
    if (request.action === 'getReminderState') {
        const cleanHost = request.hostname?.replace(/^www\./, '');
        const siteState = g_activeReminders.get(cleanHost);
        const globalState = g_activeGlobalReminder;

        // Global reminder (if active) takes precedence for reporting
        if (globalState) {
            sendResponse({ active: true, value: globalState.value, type: globalState.type, isGlobal: true });
        } else if (siteState) {
            sendResponse({ active: true, value: siteState.value, type: siteState.type, isGlobal: false });
        } else {
            sendResponse({ active: false });
        }
        return true;
    }


    if (request.action === 'closeMyTab') {
        if (sender.tab?.id) {
            chrome.tabs.remove(sender.tab.id).catch(() => {});
        }
        return true;
    }

    if (request.action === 'markUnlocked') {
        const { hostname } = request;
        const key = `lock_${hostname}`;

        chrome.storage.local.get([key], (result) => {
            let lockState = result[key];
            if (lockState) {
                lockState.unlocked = true;
                chrome.storage.local.set({ [key]: lockState }, () => {
                    sendResponse({ success: true });
                });
            } else {
                sendResponse({ success: true });
            }
        });
        return true;
    }

    if (request.action === 'finishChallenge') {
        const { hostname } = request;
        const key = `lock_${hostname}`;

        // 1. Clear Global Registry First (The penalty flag)
        if (chrome.storage.session) {
            chrome.storage.session.remove('cure_typing_active_global');
        }

        // 2. Clear Local Site Lock
        chrome.storage.local.get([key, 'passiveData'], (result) => {
            const updates = {};
            
            // Mark hostname as unlocked
            let lockState = result[key];
            if (lockState) {
                lockState.unlocked = true;
                updates[key] = lockState;
            }

            // Consume reward bank
            let passiveData = result.passiveData || { accrual: 0, rewardBank: 0 };
            const consumed = passiveData.rewardBank;
            passiveData.rewardBank = 0;
            updates['passiveData'] = passiveData;

            // ANTI-CHEAT: Debt Paid. Clear the snapshot.
            const cleanHost = hostname.replace(/^www\./, '');
            delete g_lockSnapshots[cleanHost];
            saveSnapshots();

            chrome.storage.local.set(updates, () => {
                // FIX 98: Deep Broadcast. 
                // We must target ALL frames in ALL tabs to ensure iframes reveal content.
                chrome.tabs.query({}, (tabs) => {
                    if (chrome.runtime.lastError || !tabs) return;
                    for (const tab of tabs) {
                        if (tab.id) {
                            // Find all frames for this tab
                            chrome.webNavigation.getAllFrames({ tabId: tab.id }, (frames) => {
                                if (chrome.runtime.lastError || !frames) return;
                                frames.forEach(frame => {
                                    chrome.tabs.sendMessage(tab.id, { 
                                        action: 'challengeCompleted', 
                                        hostname: hostname 
                                    }, { frameId: frame.frameId }).catch(() => {});
                                });
                            });
                        }
                    }
                });

                sendResponse({ success: true, consumed });
            });
        });
        return true;
    }

    if (request.action === 'clearLockState') {
        const { hostname } = request;
        const key = `lock_${hostname}`;
        
        // Anti-Cheat: Also clear snapshot if explicitly cleared
        const cleanHost = hostname.replace(/^www\./, '');
        delete g_lockSnapshots[cleanHost];
        saveSnapshots();

        chrome.storage.local.remove(key, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'factoryReset') {
        // Fix: Rotate System Instance ID on reset to invalidate all other tabs
        g_systemInstanceId = Math.random().toString(36).substring(2, 15);
        chrome.storage.local.set({ systemInstanceId: g_systemInstanceId });

        // 1. Storage Sequence Closure (Flattened for safety)
        const finalizeReset = () => {
            chrome.storage.sync.set({ settings: DEFAULT_SETTINGS }, () => {
                g_settingsCache = { ...DEFAULT_SETTINGS };
                g_dailyStats = null;
                updateBlockingRules([]);
                
                sendResponse({ success: true });
            });
        };

        // 1. PRE-EMPTIVE STOP: Tell all tabs to freeze immediately
        chrome.tabs.query({}, (tabs) => {
            for (const tab of tabs) {
                if (tab.id) {
                    chrome.tabs.sendMessage(tab.id, { action: 'onFactoryReset' }).catch(() => {});
                }
            }

            // 2. DELAYED WIPE: Wait a moment for tabs to stop their loops, then clear everything
            setTimeout(() => {
                chrome.storage.local.clear(() => {
                    chrome.storage.sync.clear(() => {
                        if (chrome.storage.session) {
                            chrome.storage.session.clear(finalizeReset);
                        } else {
                            finalizeReset();
                        }
                    });
                });
            }, 200);
        });
        return true;
    }

    if (request.action === 'forceUnlockAll') {
        // 1. Get all keys from local storage
        chrome.storage.local.get(null, (items) => {
            const keysToRemove = [];
            // Find all lock keys
            Object.keys(items).forEach(key => {
                if (key.startsWith('lock_')) {
                    keysToRemove.push(key);
                }
            });

            // 2. Remove all lock keys
            if (keysToRemove.length > 0) {
                chrome.storage.local.remove(keysToRemove, () => {
                    // 3. Broadcast to all active tabs to unlock immediately
                    chrome.tabs.query({}, (tabs) => {
                        for (const tab of tabs) {
                            if (tab.id) {
                                chrome.tabs.sendMessage(tab.id, { action: 'forceGlobalUnlock' }).catch(() => {});
                            }
                        }
                    });
                    sendResponse({ success: true, count: keysToRemove.length });
                });
            } else {
                sendResponse({ success: true, count: 0 });
            }
        });
        return true;
    }

    if (request.action === 'forceUnlockSite') {
        const { hostname, tabId } = request;
        if (!hostname) {
            sendResponse({ success: false });
            return true;
        }

        const key = `lock_${hostname}`;
        const timerKey = `cure_timer_${hostname}`;

        // 1. Remove BOTH the lock state AND the accumulated time
        chrome.storage.local.remove([key, timerKey], () => {
            // 2. Clear Daily Stats for this site (Optional but cleaner for "Reset Progress")
            if (g_dailyStats && g_dailyStats.sites[hostname]) {
                delete g_dailyStats.sites[hostname];
                saveStats();
            }

            // 3. Broadcast challenge completion to ALL tabs of this site
            // This replaces the jittery reload logic with instant, dynamic unlocking.
            try {
                chrome.tabs.query({}, (tabs) => {
                    if (chrome.runtime.lastError || !tabs) return;
                    for (const tab of tabs) {
                        try {
                            // Only target tabs that match the hostname
                            const tabUrl = new URL(tab.url);
                            const tabHost = tabUrl.hostname.replace(/^www\./, '');
                            const targetHost = hostname.replace(/^www\./, '');
                            
                            if (tabHost === targetHost || tabHost.endsWith('.' + targetHost)) {
                                chrome.tabs.sendMessage(tab.id, { 
                                    action: 'challengeCompleted', 
                                    hostname: hostname 
                                }).catch(() => {});
                            }
                        } catch (e) {
                            // Skip non-standard URLs (chrome:// etc)
                        }
                    }
                });
            } catch (e) {
                console.warn('[Cure] Broadcast error in background:', e);
            }

            sendResponse({ success: true });
        });
        return true;
    }

});

// Helper to get formatted logical date (incorporating start hour)
function getLogicalDate(timestamp, startHour = 0) {
    const d = new Date(timestamp);
    if (d.getHours() < startHour) {
        d.setDate(d.getDate() - 1);
    }
    // Return YYYY-MM-DD
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Checks if a hostname matches the whitelist.
 * Logic mirrored from content.js for consistency.
 */
function isHostnameWhitelisted(hostname, whitelist) {
    if (!whitelist || !Array.isArray(whitelist)) return false;
    const currentHost = hostname.toLowerCase().trim();
    const currentHostNoWww = currentHost.replace(/^www\./, '');

    return whitelist.some(site => {
        if (!site) return false;
        let cleanSite = site.trim().toLowerCase();
        if (cleanSite.includes('://')) cleanSite = cleanSite.split('://')[1];
        cleanSite = cleanSite.split('/')[0];
        const cleanSiteNoWww = cleanSite.replace(/^www\./, '');
        if (!cleanSiteNoWww) return false;

        return currentHostNoWww === cleanSiteNoWww || 
               currentHostNoWww.endsWith('.' + cleanSiteNoWww);
    });
}

// Daily Reset Logic
async function checkDailyReset() {
    // getDailyStats already internally handles the stale date check and reset!
    // We just need to call it to trigger the check.
    const stats = await getDailyStats();
}
// Helper var to avoid constantly reading 'lastResetDate' from storage
let storedLogicalDate = null;


// Check on startup and periodically
chrome.runtime.onStartup.addListener(checkDailyReset);
checkDailyReset();
setInterval(checkDailyReset, 60 * 60 * 1000); // Every hour
// --- Robust Challenge Abandonment Detection ---
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // Only care about URL changes that navigate away from a hostname
    if (changeInfo.url) {
        handleTabAbandonment(tabId, changeInfo.url);
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    handleTabAbandonment(tabId, null);
});

async function handleTabAbandonment(tabId, newUrl) {
    if (!chrome.storage.session) return;
    const key = `cure_challenge_active_${tabId}`;
    const result = await chrome.storage.session.get(key);
    const activeHostname = result[key];

    if (activeHostname) {
        // Did we navigate to a DIFFERENT site?
        let isSameSite = false;
        if (newUrl) {
            try {
                const url = new URL(newUrl);
                // Subdomain insensitive check (e.g. www.youtube.com vs youtube.com)
                const newHost = url.hostname.replace('www.', '');
                const oldHost = activeHostname.replace('www.', '');
                if (newHost === oldHost) isSameSite = true;
            } catch (e) {
                // If it's not a valid URL (e.g. chrome://), it's definitely not the same site
            }
        }

        if (!isSameSite) {
            console.log(`[Cure] Challenge abandoned in tab ${tabId} on ${activeHostname}`);
            // Flag this hostname for a reset
            await chrome.storage.session.set({ [`cure_needs_reset_${activeHostname}`]: true });
            // Clear the active challenge for this tab
            await chrome.storage.session.remove(key);
        }
    }
}
