// Cure Procrastination - Settings Manager
'use strict';

// GLOBAL STATE CACHE (Concurrency Fix)
let g_dailyStats = null;
let g_settingsCache = null;

async function ensureSettings() {
    if (g_settingsCache) return g_settingsCache;
    return new Promise(resolve => {
        chrome.storage.sync.get('settings', (res) => {
            g_settingsCache = { ...DEFAULT_SETTINGS, ...(res.settings || {}) };
            // Deep merge details if needed, but shallow merge of top keys is usually enough for backend logic
            // We'll rely on the existing extensive merge in 'getSettings' handler for full config
            resolve(g_settingsCache);
        });
    });
}

async function getDailyStats() {
    if (g_dailyStats) return g_dailyStats;
    await ensureSettings();
    const startHour = (g_settingsCache && g_settingsCache.dayStartHour) || 0;
    
    return new Promise(resolve => {
        chrome.storage.local.get(['dailyStats'], (result) => {
            const logicalDate = getLogicalDate(Date.now(), startHour);
            g_dailyStats = result.dailyStats || { date: logicalDate, sites: {}, browserSeconds: 0 };
            
            // Check for stale date immediately on load
            // Only reset if moving FORWARD in time (lexicographical comparison)
            if (g_dailyStats.date < logicalDate) {
               console.log('[Cure] Loaded stale stats (new day), resetting in memory.');
               g_dailyStats = { date: logicalDate, sites: {}, browserUsageHistory: [] };
            }
            resolve(g_dailyStats);
        });
    });
}

async function saveStats() {
    if (g_dailyStats) {
        // Fire and forget, but maybe catch error
        chrome.storage.local.set({ dailyStats: g_dailyStats });
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
        { name: 'Notion', url: 'https://notion.so' }
    ],
    breathingRoomDuration: 15,
    sessionTimeoutMins: 30, // Reset session index if away for 30 min
    hardLockDuration: 30, // Minutes
    unlockReward: 5, // Minutes
    unlockRewardType: 'time', // or 'session'
    reminderInterval: 15, // Minutes
    typingDifficulty: 50, // Characters (Legacy)
    reminderStyle: 'overlay', // Changed to overlay by default
    soundEnabled: true,
    showTimerPill: true,
    showPillOnWhitelist: true,
    unlockProtocols: {
        typing: { enabled: true, difficulty: 50 }, // Difficulty is now in Words
        password: { enabled: false, value: "1234" },
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
            console.log('[Cure] Default settings initialized.');
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
        console.log(`[Cure] NetRequest rules updated: ${rules.length} domains blocked at network level.`);
    } catch (e) {
        console.error('[Cure] Failed to update NetRequest rules:', e);
    }
}

// Handle messages from content scripts/popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'getSettings') {
        chrome.storage.sync.get('settings', (result) => {
            if (chrome.runtime.lastError) {
                console.error('[Cure] Storage Internal Error:', chrome.runtime.lastError);
                sendResponse({ settings: DEFAULT_SETTINGS }); // Fallback
                return;
            }
            const settings = { ...DEFAULT_SETTINGS, ...result.settings };
            
            // Deep merge nested structures to preserve keys
            if (result.settings?.unlockProtocols) {
                settings.unlockProtocols = { ...DEFAULT_SETTINGS.unlockProtocols, ...result.settings.unlockProtocols };
            }
            if (result.settings?.hardLockTriggers) {
                settings.hardLockTriggers = { ...DEFAULT_SETTINGS.hardLockTriggers, ...result.settings.hardLockTriggers };
            }
            if (result.settings?.pauseTriggers) {
                settings.pauseTriggers = { ...DEFAULT_SETTINGS.pauseTriggers, ...result.settings.pauseTriggers };
            }
            if (result.settings?.reminderTriggers) {
                settings.reminderTriggers = { ...DEFAULT_SETTINGS.reminderTriggers, ...result.settings.reminderTriggers };
            }
            if (result.settings?.passiveReward) {
                settings.passiveReward = { ...DEFAULT_SETTINGS.passiveReward, ...result.settings.passiveReward };
            }
            
            sendResponse({ settings });
        });
        return true; // Keep channel open for async response
    }

    if (request.action === 'trackLaunch') {
        const hostname = request.hostname;
        (async () => {
            await ensureSettings();
            const stats = await getDailyStats();
            const settings = g_settingsCache;

            // Merge triggers safely
            const triggers = { ...DEFAULT_SETTINGS.hardLockTriggers, ...(settings.hardLockTriggers || {}) };

            // GLOBAL KILL-SWITCH
            if (settings.masterHardLock === false) {
                sendResponse({ locked: false, sessionActive: true, reason: 'masterDisabled' });
                return;
            }

            const config = triggers.launchLimit;
            if (!stats.sites[hostname]) stats.sites[hostname] = { activeSeconds: 0, launches: [], lastActiveAt: 0, activeSession: null };
            let siteStats = stats.sites[hostname];
            if (!siteStats.launches) siteStats.launches = [];

            const now = Date.now();
            let isLocked = false;
            let currentSessionActive = false;

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
            chrome.storage.local.get(lockKey, (lockRes) => {
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

                // 2. Start new session if needed
                if (!currentSessionActive && config.enabled) {
                    const windowMs = (config.windowSeconds || 3600) * 1000;
                    siteStats.launches = (siteStats.launches || []).filter(ts => now - ts < windowMs);

                    if (siteStats.launches.length < config.value) {
                        siteStats.launches.push(now);
                        siteStats.activeSession = { startTime: now, lastActive: now };
                        siteStats.lastActiveAt = now;
                        currentSessionActive = true;
                    } else {
                        isLocked = true;
                    }
                }

                // 3. Info for UI
                const windowMs = (config.windowSeconds || 3600) * 1000;
                const history = (siteStats.launches || []).filter(ts => now - ts < windowMs);
                const remaining = config.enabled ? Math.max(0, config.value - history.length) : 99;

                let waitTime = 0;
                if (isLocked && history.length > 0) {
                    const oldest = Math.min(...history);
                    waitTime = Math.ceil((windowMs - (now - oldest)) / 1000);
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
                    browserSeconds: stats.browserUsageHistory ? stats.browserUsageHistory.reduce((a, c) => a + c.dur, 0) : 0
                });
            });
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
                stats.sites[hostname].usageHistory.push({ ts: now, dur: deltaSiteSeconds });
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
        })();
        return true;
    }

    if (request.action === 'getWindowedUsage') {
        const { hostname, siteWindowSeconds, browserWindowSeconds } = request;
        (async () => {
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
        })();
        return true;
    }

    if (request.action === 'openTab') {
        chrome.tabs.create({ url: request.url });
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'updateSettings') {
        chrome.storage.sync.set({ settings: request.settings }, () => {
            if (chrome.runtime.lastError) {
                console.error('[Cure] Save Failed:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            // Sync Network Blocking Rules
            updateBlockingRules(request.settings?.blacklist || []);

            // Propagate updates to all active tabs
            chrome.tabs.query({}, (tabs) => {
                for (const tab of tabs) {
                    if (tab.id) {
                        chrome.tabs.sendMessage(tab.id, {
                            action: 'settingsUpdated',
                            settings: request.settings
                        }).catch(() => {
                            // Suppress errors for inactive/restricted tabs (expected behavior)
                        });
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

        chrome.storage.local.set({ [key]: lockState }, () => {
            sendResponse({ success: true, lockState });
        });
        return true;
    }

    if (request.action === 'getLockState') {
        const { hostname } = request;
        const key = `lock_${hostname}`;

        chrome.storage.local.get([key], async (result) => {
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
        });
        return true;
    }

    if (request.action === 'broadcastLockState') {
        const { hostname } = request;
        if (!hostname) {
             sendResponse({ success: false });
             return true;
        }

        // Relay to all tabs to ensure cross-frame media pause is enforced
        // Wrap in try-catch to handle synchronous pattern errors
        try {
            chrome.tabs.query({ url: "*://" + hostname + "/*" }, (tabs) => {
                if (chrome.runtime.lastError || !tabs) {
                    // Ignore invalid patterns
                    return;
                }
                for (const tab of tabs) {
                    chrome.tabs.sendMessage(tab.id, { action: 'forceMediaPause' }).catch(() => {});
                }
            });
        } catch (e) {
            console.warn('[Cure] Broadcast pattern error:', e);
        }
        sendResponse({ success: true });
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

            chrome.storage.local.set(updates, () => {
                // FIX 98: Broadcast challenge completion to all tabs (for iframes)
                try {
                    chrome.tabs.query({}, (tabs) => {
                        if (chrome.runtime.lastError || !tabs) return;
                        for (const tab of tabs) {
                            if (tab.id) {
                                chrome.tabs.sendMessage(tab.id, { 
                                    action: 'challengeCompleted', 
                                    hostname: hostname 
                                }).catch(() => {});
                            }
                        }
                    });
                } catch (e) {
                    console.warn('[Cure] Challenge broadcast error:', e);
                }

                sendResponse({ success: true, consumed });
            });
        });
        return true;
    }

    if (request.action === 'clearLockState') {
        const { hostname } = request;
        const key = `lock_${hostname}`;
        chrome.storage.local.remove(key, () => {
            sendResponse({ success: true });
        });
        return true;
    }

    if (request.action === 'factoryReset') {
        // 1. Clear ALL storage
        chrome.storage.local.clear(() => {
            chrome.storage.sync.clear(() => {
                // 2. Reset to Defaults
                chrome.storage.sync.set({ settings: DEFAULT_SETTINGS }, () => {
                    // 3. Clear Cache
                    g_settingsCache = null;
                    g_dailyStats = null;
                    
                    // 4. Update Blocking Rules (Clear them)
                    updateBlockingRules([]);

                    // 5. Notify all tabs to reload/reset
                    chrome.tabs.query({}, (tabs) => {
                        for (const tab of tabs) {
                            if (tab.id) {
                                chrome.tabs.sendMessage(tab.id, { action: 'factoryResetComplete' }).catch(() => {});
                            }
                        }
                    });

                    sendResponse({ success: true });
                });
            });
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
        // 1. Remove the lock key
        chrome.storage.local.remove(key, () => {
            // 2. Direct unlock to the requesting tab (Fastest feedback)
            if (tabId) {
                chrome.tabs.sendMessage(tabId, { 
                    action: 'forceGlobalUnlock',
                    hostname: hostname 
                }).catch(() => { /* Tab might be closed or restricted */ });
            }

            // 3. Broadcast to all other tabs of this site (Consistency)
            // Wrapped in try-catch for safety
            try {
                chrome.tabs.query({ url: "*://" + hostname + "/*" }, (tabs) => {
                    if (chrome.runtime.lastError) {
                        // Pattern might be invalid for some hostnames (e.g. localhost with port)
                        console.warn('[Cure] Broadcast query failed:', chrome.runtime.lastError);
                        return;
                    }
                    for (const tab of tabs) {
                        if (tab.id && tab.id !== tabId) { // Skip already messaged tab
                            chrome.tabs.sendMessage(tab.id, { 
                                action: 'forceGlobalUnlock',
                                hostname: hostname 
                            }).catch(() => {});
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
