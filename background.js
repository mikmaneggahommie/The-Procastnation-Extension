// Cure Procrastination - Settings Manager
'use strict';

// GLOBAL STATE CACHE (Concurrency Fix)
let g_dailyStats = null;
let g_settingsCache = null;
let g_lockSnapshots = {}; // Persistent Rule Snapshots for anti-cheat
let g_systemInstanceId = null; // Fix: Unique ID to invalidate stale sessionStorage on reinstall/reset
let g_activeReminders = new Map(); // FIX 129: Track active reminders per hostname for iframe queries
let g_activeGlobalReminder = null; // FIX 155: Track active global reminder (browser-wide)
let g_activeTrackers = new Map(); // FIX 131: Strict Tracker Authority (Hostname -> { tabId, lastSeen })
let g_settingsChangedAt = 0; // FIX: Cooldown guard to prevent stale evaluations after settings change
let g_reminderStateRestored = false; // FIX: Ensure we don't init baselines before storage is loaded

// Helper: Persist Snapshots
const saveSnapshots = () => chrome.storage.local.set({ lockSnapshots: g_lockSnapshots });

// FIX 129/201: Persistent Reminder State
const saveReminderSnapshots = () => {
    const serializedReminders = Array.from(g_activeReminders.entries());
    chrome.storage.local.set({ 
        activeReminders: serializedReminders,
        activeGlobalReminder: g_activeGlobalReminder
    });
};

const loadReminderSnapshots = () => {
    return new Promise(resolve => {
        chrome.storage.local.get(['activeReminders', 'activeGlobalReminder'], res => {
            if (res.activeReminders) {
                g_activeReminders = new Map(res.activeReminders);
                console.log(`[Cure] Restored ${g_activeReminders.size} active reminders.`);
            }
            if (res.activeGlobalReminder) {
                g_activeGlobalReminder = res.activeGlobalReminder;
                console.log('[Cure] Restored active global reminder.');
            }
            g_reminderStateRestored = true;
            resolve();
        });
    });
};

// Helper: Standardize hostname (strip www.)
const cleanHost = (host) => host ? host.replace(/^www\./, '') : '';

const ensureRestored = () => {
    if (g_reminderStateRestored) return Promise.resolve();
    return new Promise(resolve => {
        const check = () => {
            if (g_reminderStateRestored) resolve();
            else setTimeout(check, 50);
        };
        check();
    });
};

/**
 * Centrally evaluates reminders based on current site and browser usage.
 * Broadcasts to all tabs if a threshold is crossed.
 */

function evaluateReminders(stats, hostname, sittingSeconds, now, source = 'usage', isNewLaunch = false) {
    if (!g_settingsCache || g_settingsCache.masterReminders === false) return;

    // FIX: Cooldown guard — skip evaluation for 1500ms after a settings change.
    // This prevents stale trackUsage/trackLaunch responses from triggering reminders
    // during the async broadcast gap where old 'show:true' messages are still in flight.
    if (now - g_settingsChangedAt < 1500) return;

    // 0. Wait for Persistent State Restoration
    if (!g_reminderStateRestored) return;

    const siteStats = stats.sites[hostname];
    if (!siteStats) return;

    const rTriggers = g_settingsCache.reminderTriggers || {};
    const rStyle = g_settingsCache.reminderStyle || 'overlay';
    const mins = Math.floor(sittingSeconds / 60);
    
    // 1. Site Activity Reminder
    if (g_settingsCache.reminderIntervalEnabled !== false) {
        const rInt = (g_settingsCache.reminderInterval || 30) * 60;
        const intervalMins = rInt / 60;
        const rType = g_settingsCache.reminderIntervalType || 'repeating';
        const rWindow = g_settingsCache.reminderIntervalWindow || '0';
        const isPerVisit = String(rWindow) === '0';
        const configHash = `site_${rType}_${intervalMins}_${rWindow}`;
        const reminderKey = `${hostname}_time`;
        
        let state = g_activeReminders.get(reminderKey);

        // ATOMIC INITIALIZATION
        // We allow initialization from 'launch' or 'usage', but we must have data.
        if (!state || state.configHash !== configHash) {
            // AUTHORITATIVE BASELINE: Use snapshot if available, otherwise current time.
            // This ensures any settings switch (e.g. Every -> Once) starts relative to your current time.
            const initialBaseline = Math.max(siteStats.cumulativeSeconds || 0, sittingSeconds);
            
            // LAZY INIT: If data is 0 (lagging or fresh start), wait for 1s of usage before establishing baseline.
            // This prevents "Laggy Resumes" or "Quick Settings Changes" from accidentally setting a 0 baseline.
            if (isPerVisit && initialBaseline < 1) return;

            const wasActive = state && state.active;
            state = {
                configHash,
                baselineSecs: initialBaseline, 
                lastTriggeredOffset: 0,
                lastHeartbeat: mins,
                onceTriggered: false,
                rType: rType,
                type: 'time',
                active: false 
            };
            g_activeReminders.set(reminderKey, state);
            console.log(`[Cure] Established Precision Baseline for ${hostname}: ${initialBaseline}s (Source: ${source})`);
            
            if (wasActive) {
                broadcastReminderStateCentral({ hostname: hostname, show: false, type: 'time' });
            }
        }
        
        // FIX: Per-Visit Baseline Reset
        // When "per visit" is selected, reset the reminder baseline ONLY on a fresh launch (New Visit).
        if (state && isPerVisit && isNewLaunch) {
            // Guard: Use snapshot to ensure we don't reset to 0 if data is lagging.
            const targetBaseline = Math.max(siteStats.cumulativeSeconds || 0, sittingSeconds);
            
            // If data is genuinely 0 (e.g. fresh Day), we reset to 0.
            // But if snapshot exists (e.g. resumed Visit), we reset to snapshot.
            state.baselineSecs = targetBaseline;
            state.lastTriggeredOffset = 0;
            state.onceTriggered = false;
            state.active = false; 
            broadcastReminderStateCentral({ hostname: hostname, show: false, type: 'time' });
        }
        
        if (!state) return;

        const effectiveSecs = sittingSeconds - state.baselineSecs;
        const currentMins = Math.floor(sittingSeconds / 60);

        if (state.rType === 'once') {
            if (!state.active && !state.onceTriggered && effectiveSecs >= rInt) {
                state.onceTriggered = true;
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: true,
                    value: currentMins, 
                    type: 'time',
                    reminderStyle: rStyle,
                    rMode: 'once'
                });
            } else if (state.active && rStyle === 'toast' && currentMins > (state.lastHeartbeat || 0)) {
                state.lastHeartbeat = currentMins;
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: true,
                    value: currentMins,
                    type: 'time',
                    reminderStyle: 'toast',
                    rMode: 'once'
                });
            }
        } else {
            // REPEATING
            const currentOffset = Math.floor(effectiveSecs / rInt) * rInt;
            if (currentOffset > 0 && currentOffset > state.lastTriggeredOffset) {
                state.lastTriggeredOffset = currentOffset;
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: true,
                    value: currentMins,
                    type: 'time',
                    reminderStyle: rStyle,
                    rMode: 'repeating'
                });
            } else if (state.active && rStyle === 'toast' && currentMins > (state.lastHeartbeat || 0)) {
                state.lastHeartbeat = currentMins;
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: true,
                    value: currentMins,
                    type: 'time',
                    reminderStyle: 'toast',
                    rMode: 'repeating'
                });
            }
        }
    }

    // 2. Global: Daily Screen Time (Browser Limit)
    if (rTriggers.browserLimit?.enabled && stats.browserUsageHistory) {
        const browserSeconds = stats.browserUsageHistory.reduce((sum, entry) => sum + entry.dur, 0);
        const minsSpent = Math.floor(browserSeconds / 60);
        const rType = g_settingsCache.reminderBrowserType || 'once';
        const limitGlobalSecs = (rTriggers.browserLimit.value || 120) * 60;
        const configHash = `global_${rType}_${limitGlobalSecs}`;
        
        if (!g_activeGlobalReminder || g_activeGlobalReminder.configHash !== configHash) {
            const wasActive = g_activeGlobalReminder && g_activeGlobalReminder.active;
            g_activeGlobalReminder = {
                configHash,
                baselineSecs: browserSeconds, // PRECISION: Store raw seconds
                lastTriggeredOffset: 0,
                onceTriggered: false,
                rMode: rType,
                type: 'browser',
                reminderStyle: rStyle,
                active: false 
            };

            if (wasActive) {
                broadcastReminderStateCentral({ hostname: 'global', show: false, type: 'browser' });
            }
        }

        const effectiveSecs = browserSeconds - g_activeGlobalReminder.baselineSecs;

        if (g_activeGlobalReminder.rMode === 'once') {
            if (!g_activeGlobalReminder.active && !g_activeGlobalReminder.onceTriggered && effectiveSecs >= limitGlobalSecs) {
                g_activeGlobalReminder.onceTriggered = true;
                broadcastReminderStateCentral({
                    hostname: 'global',
                    show: true,
                    value: minsSpent,
                    type: 'browser',
                    reminderStyle: rStyle,
                    rMode: 'once'
                });
            } else if (g_activeGlobalReminder.active && rStyle === 'toast' && minsSpent > (g_activeGlobalReminder.lastHeartbeat || 0)) {
                g_activeGlobalReminder.lastHeartbeat = minsSpent;
                broadcastReminderStateCentral({
                    hostname: 'global',
                    show: true,
                    value: minsSpent,
                    type: 'browser',
                    reminderStyle: 'toast',
                    rMode: 'once'
                });
            }
        } else {
            // REPEATING
            const currentOffset = Math.floor(effectiveSecs / limitGlobalSecs) * limitGlobalSecs;
            if (currentOffset > 0 && currentOffset > g_activeGlobalReminder.lastTriggeredOffset) {
                g_activeGlobalReminder.lastTriggeredOffset = currentOffset;
                g_activeGlobalReminder.active = true; // Ensure re-activated on new bucket
                broadcastReminderStateCentral({
                    hostname: 'global',
                    show: true,
                    value: minsSpent,
                    type: 'browser',
                    reminderStyle: rStyle,
                    rMode: 'repeating'
                });
            } else if (g_activeGlobalReminder.active && rStyle === 'toast' && minsSpent > (g_activeGlobalReminder.lastHeartbeat || 0)) {
                g_activeGlobalReminder.lastHeartbeat = minsSpent;
                broadcastReminderStateCentral({
                    hostname: 'global',
                    show: true,
                    value: minsSpent,
                    type: 'browser',
                    reminderStyle: 'toast',
                    rMode: 'repeating'
                });
            }
        }
    }

    // 3. Launch Limit Reminder
    if (rTriggers.launchLimit?.enabled && siteStats.launches) {
        const limit = rTriggers.launchLimit.value || 5;
        const rType = rTriggers.launchLimit.type || 'repeating';
        const configHash = `launch_${rType}_${limit}`;
        const reminderKey = `${hostname}_launch`;
        
        let state = g_activeReminders.get(reminderKey);
        if (!state || state.configHash !== configHash) {
            const wasActive = state && state.active;
            state = {
                configHash,
                baselineCount: siteStats.launches.length, 
                lastTriggeredOffset: 0,
                onceTriggered: false,
                rType: rType,
                type: 'launch',
                active: false // Force inactive for Clean Slate
            };
            g_activeReminders.set(reminderKey, state);

            if (wasActive) {
                // Force dismissal of the old launch reminder
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: false,
                    type: 'launch'
                });
            }
        }

        const effectiveLaunches = siteStats.launches.length - state.baselineCount;

        if (state.rType === 'once') {
            if (!state.active && !state.onceTriggered && effectiveLaunches >= limit) {
                state.onceTriggered = true;
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: true,
                    value: siteStats.launches.length, // total absolute for display
                    type: 'launch',
                    reminderStyle: rStyle,
                    rMode: 'once'
                });
            }
        } else {
            // REPEATING
            const currentOffset = Math.floor(effectiveLaunches / limit) * limit;
            if (currentOffset > 0 && currentOffset > state.lastTriggeredOffset) {
                state.lastTriggeredOffset = currentOffset;
                broadcastReminderStateCentral({
                    hostname: hostname,
                    show: true,
                    value: siteStats.launches.length,
                    type: 'launch',
                    reminderStyle: rStyle,
                    rMode: 'repeating'
                });
            }
        }
    }
}

/**
 * Reusable broadcast helper with deep-frame media enforcement
 */
function broadcastReminderStateCentral(payload, excludeTabId = null) {
    const { hostname, show, value, type, reminderStyle, rMode } = payload;
    const cleanedHostname = cleanHost(hostname);
    const isGlobal = type === 'browser' || hostname === 'global';

    // 1. Update Internal Auth State
    const compositeKey = isGlobal ? 'global' : `${cleanedHostname}_${type}`;
    if (show) {
        if (isGlobal) {
            g_activeGlobalReminder = { 
                ...(g_activeGlobalReminder || {}),
                value, type, reminderStyle, rMode,
                active: true
            };
        } else {
            const existing = g_activeReminders.get(compositeKey);
            g_activeReminders.set(compositeKey, { 
                ...(existing || {}),
                value, type, active: true, reminderStyle, rType: rMode 
            });
        }
    } else {
        const now = Date.now();
        if (isGlobal) {
            if (g_activeGlobalReminder) {
                g_activeGlobalReminder.active = false;
                g_activeGlobalReminder.lastDismissedTime = now;
            }
        } else {
            const existing = g_activeReminders.get(compositeKey);
            if (existing) {
                g_activeReminders.set(compositeKey, { 
                    ...existing, 
                    active: false, 
                    lastDismissedTime: now 
                });
            }
        }
    }

    // FIX 129/201: Always persist state changes immediately
    saveReminderSnapshots();

    // 2. Broadcast Function
    const broadcastToTab = (tabId) => {
        const performMessaging = (frameId = null) => {
            const options = frameId !== null ? { frameId } : {};
            
            // Media Enforcement (Pause/Resume)
            // FIX 177: Toasts should not pause media.
            if (reminderStyle !== 'toast') {
                chrome.tabs.sendMessage(tabId, {
                    action: 'tabMediaAction',
                    type: show ? 'pause' : 'resume'
                }, options).catch(() => {});
            }

            // UI Instruction
            if (show) {
                chrome.tabs.sendMessage(tabId, {
                    action: reminderStyle === 'toast' ? 'forceReminderToast' : 'forceReminderOverlay',
                    hostname: isGlobal ? 'global' : cleanedHostname,
                    value, type, reminderStyle
                }, options).catch(() => {});
            } else {
                chrome.tabs.sendMessage(tabId, {
                    action: 'dismissReminderOverlay',
                    hostname: (hostname === 'all') ? 'all' : (isGlobal ? 'global' : cleanedHostname)
                }, options).catch(() => {});
            }
        };

        if (chrome.webNavigation) {
            chrome.webNavigation.getAllFrames({ tabId }, (frames) => {
                if (chrome.runtime.lastError || !frames || frames.length === 0) {
                    performMessaging(); // Fallback to top frame
                } else {
                    frames.forEach(f => performMessaging(f.frameId));
                }
            });
        } else {
            performMessaging();
        }
    };

    // 3. Target all tabs (including sender to reach its iframes)
    chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
            // FIX: Exclude the initiator tab to prevent redundant logic cycles 
            // BUT: If it's an overlay dismissal, we might WANT to send it to same-tab iframes?
            // Actually, safeSendMessage in initiator handles local update.
            if (tab.id && tab.id !== excludeTabId) {
                broadcastToTab(tab.id);
            }
        });
    });
}

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
    
    // FIX 129/201: Restore active reminders after ID/Settings sync
    loadReminderSnapshots();
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

async function saveStats(force = false) {
    if (!g_dailyStats) return;
    
    if (g_saveTimeout) clearTimeout(g_saveTimeout);
    
    if (force) {
        await storage.local.set({ dailyStats: g_dailyStats });
        g_saveTimeout = null;
    } else {
        // Debounce High-Frequency I/O
        g_saveTimeout = setTimeout(async () => {
            if (g_dailyStats) {
                await storage.local.set({ dailyStats: g_dailyStats });
            }
            g_saveTimeout = null;
        }, 1000); // Reduced to 1s for better responsiveness
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
    sessionTimeoutMins: 30, // Gap to reset visits (Per Visit mode) and session resurrected floor
    hardLockDuration: 30, // Minutes
    unlockReward: 5, // Minutes
    unlockRewardType: 'time', // or 'session'
    reminderInterval: 30, // Minutes
    reminderIntervalEnabled: true,
    reminderIntervalType: 'repeating',
    reminderBrowserType: 'repeating', 
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
        const rawHost = request.hostname;
        const hostname = cleanHost(rawHost);
        const tabId = sender.tab?.id;
        if (hostname && tabId && chrome.storage.session) {
            // Track this challenge extension-wide
            chrome.storage.session.set({ [`cure_challenge_active_${tabId}`]: hostname });
            
            // ANTI-CHEAT: Snapshot rules NOW. 
            // The site is now stuck with these until the challenge is finished.
            if (!g_lockSnapshots[hostname]) {
                g_lockSnapshots[hostname] = JSON.parse(JSON.stringify(g_settingsCache || DEFAULT_SETTINGS));
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
        const hostname = cleanHost(request.hostname);
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
        const hostname = cleanHost(request.hostname);
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
        const hostname = cleanHost(request.hostname);
        if (chrome.storage.session) {
            chrome.storage.session.remove(`cure_needs_reset_${hostname}`);
            // Also notify tabs on this hostname to stop showing the toast
            chrome.tabs.query({}, (tabs) => {
                tabs.forEach(t => {
                    try {
                        if (t.url && cleanHost(new URL(t.url).hostname) === hostname) {
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
        const hostname = cleanHost(request.hostname);
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
            let rawHost = request.hostname;
            if (!rawHost && sender.tab && sender.tab.url) {
                try {
                    rawHost = new URL(sender.tab.url).hostname;
                } catch (e) {}
            }
            const hostname = cleanHost(rawHost);
            
            let finalSettings = currentSettings || DEFAULT_SETTINGS;
            if (hostname) {
                // AUTHORITATIVE SNAPSHOT: If locked, site ONLY sees the frozen rules.
                if (g_lockSnapshots[hostname]) {
                    finalSettings = g_lockSnapshots[hostname];
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
        // FIX: Ignore iframes triggering trackLaunch.
        // If specific iframes (ads, widgets) trigger this, it can spam launch counts
        // and cause the "Per Visit" reminder to strobe/reset repeatedly.
        if (sender.frameId !== 0) return;

        const hostname = cleanHost(request.hostname);
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
                let sessionResumed = false; // Flag for Smart Reset

                // Use request window if provided (for reminders), else use config (for hard lock)
                const effectiveWindowSeconds = request.windowSeconds || config.windowSeconds || 3600;
                const windowMs = effectiveWindowSeconds * 1000;

                // 1. Check active session
                if (siteStats.activeSession) {
                    const timeoutMins = (g_settingsCache && g_settingsCache.sessionTimeoutMins) || 30;
                    const inactivityElapsed = (now - siteStats.activeSession.lastActive) / 60000;
                    if (inactivityElapsed < timeoutMins) { // Use configurable session timeout logic
                        currentSessionActive = true;
                        sessionResumed = true;
                        siteStats.activeSession.lastActive = now;
                        siteStats.lastActiveAt = now;
                    } else {
                        siteStats.activeSession = null;
                        // FIX: Snapshots now persist for the FULL DAY. 
                        // Do not clear siteStats.cumulativeSeconds here; it is our safety net for "Per Day" robustness.
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
                    // FIX: "Post-Unlock Grace". If we just unlocked, don't increment until a NEW session starts.
                    if (siteStats.activeSession?.unlocked && !request.isNewVisit) {
                        // Just update activity timestamp, don't push a launch
                        siteStats.activeSession.lastActive = now;
                    } else {
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
                        // FIX: Session Resurrection
                        // If activeSession is lost (expired/cleared) but we have a snapshot, usage it to RESUME!
                        if ((siteStats.cumulativeSeconds || 0) > 5) {
                             const recoveredSecs = siteStats.cumulativeSeconds;
                             const estimatedStart = now - (recoveredSecs * 1000);
                             siteStats.activeSession = { startTime: estimatedStart, lastActive: now };
                             sessionResumed = true; // Treat as resume
                             console.log(`[Cure] Resurrected session from snapshot: ${recoveredSecs}s`);
                        } else {
                             siteStats.activeSession = { startTime: now, lastActive: now };
                        }
                    } else {
                            // If we had a session but it was nullified/cleared, ensure lastActive is updated
                            siteStats.activeSession.lastActive = now;
                        }
                    }
                    siteStats.lastActiveAt = now;
                    currentSessionActive = true;

                    // If we just hit the hard lock limit, mark as locked immediately
                    if (hardLockActive && siteStats.launches.length >= (hardTriggers.launchLimit?.value || 3)) {
                        isLocked = true;
                    }
                }

                // --- REMINDER EVALUATION (Centralized) ---
                let sittingSeconds = 0;
                if (siteStats.activeSession && siteStats.activeSession.startTime) {
                    sittingSeconds = (siteStats.usageHistory || [])
                    .filter(c => c.ts >= siteStats.activeSession.startTime - 1000) // FIX: Buffer for timestamp skew
                    .reduce((acc, c) => acc + (c.dur || 0), 0);
                
                // FIX: Use Persistent Snapshot as a universal floor during launch.
                // This ensures "Per Day" reminders never lose time due to data lags, 
                // and "Per-Visit" correctly establishes a baseline against actual usage.
                sittingSeconds = Math.max(sittingSeconds, siteStats.cumulativeSeconds || 0);
            }

            // FIX: Robust Reset Logic
            // A reset should occur if explicitly requested (isNewVisit) OR if the session expired (!sessionResumed).
            const shouldReset = request.isNewVisit || !sessionResumed;

            evaluateReminders(stats, hostname, sittingSeconds, now, 'launch', shouldReset);
                
                // FIX: Robust Persistence
                // Ensure launch/session updates are saved immediately, preventing data loss on rapid close.
                saveStats();

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
        const hostname = cleanHost(request.hostname);
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
        const { hostname: rawHost, deltaSiteSeconds, deltaBrowserSeconds } = request;
        const hostname = cleanHost(rawHost);
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
                    
                    // FIX 131: Strict Tracker Authority (Double Counting Fix)
                    // We elect ONE tab to be the "Active Tracker" for this hostname.
                    // Only the Active Tracker is allowed to increment the usage history.
                    // If the Active Tracker goes silent (> 5s), we elect the current sender.
                    
                    const senderTabId = sender.tab?.id;
                    const now = Date.now();
                    let tracker = g_activeTrackers.get(hostname);

                    // Election Logic:
                    // 1. No tracker exists
                    // 2. Current tracker is stale (> 2000ms silence)
                    // 3. Current tracker IS the sender (keep authority)
                    if (!tracker || (now - tracker.lastSeen > 2000) || tracker.tabId === senderTabId) {
                        g_activeTrackers.set(hostname, { tabId: senderTabId, lastSeen: now });
                        tracker = g_activeTrackers.get(hostname);
                    }

                    // Strict Enforcement:
                    // Only accept delta if sender IS the elected tracker.
                    if (tracker.tabId === senderTabId) {
                        tracker.lastSeen = now; // Renew lease

                        // Standard De-duplication (Throttle to 1s)
                        const history = stats.sites[hostname].usageHistory;
                        const lastEntry = history.length > 0 ? history[history.length - 1] : null;

                        // Allow update if:
                        // 1. No history
                        // 2. Last update was > 900ms ago
                        // 3. Current update is large (> 1s) (Throttled/Background update)
                        if (!lastEntry || (now - lastEntry.ts >= 900) || deltaSiteSeconds > 1) {
                            history.push({ ts: now, dur: deltaSiteSeconds });
                        }
                    } else {
                        // Non-authoritative tab: IGNORE delta for accumulation.
                        // But we still return proper sittingSeconds below so the UI stays synced.
                        // console.debug(`[Cure] Ignored usage from non-authority tab ${senderTabId} (Active: ${tracker.tabId})`);
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

                // FIX 192: Calculate authoritative session duration (sitting duration)
                // This allows all tabs (main and iframe) to snap to the exact same second.
                // FIX: Use Session Start Time instead of Rolling Window to prevent "Time Travel"/Cap at 30m.
                let sittingSeconds = 0;
                const siteStats = stats.sites[hostname]; 
                
                if (siteStats.activeSession && siteStats.activeSession.startTime) {
                    // Calculate total duration of this specific session
                    // We can use usageHistory to get precise seconds, but we must filter by session start
                    const sessionStart = siteStats.activeSession.startTime;
                    const history = stats.sites[hostname].usageHistory || [];
                    sittingSeconds = history
                        .filter(c => c.ts >= sessionStart - 1000) // FIX: Buffer for timestamp skew
                        .reduce((acc, c) => acc + (c.dur || 0), 0);
                    
                    // DEBUG: Log calculation
                    // console.log(`[Cure] Session Calc: Host=${hostname} Start=${sessionStart} HistoryLen=${history.length} Sitting=${sittingSeconds}`);
                } else {
                    // Fallback to rolling window if no active session
                    const timeoutMins = (g_settingsCache && g_settingsCache.sessionTimeoutMins) || 30;
                    const timeoutMs = timeoutMins * 60 * 1000;
                    sittingSeconds = (siteStats?.usageHistory || [])
                        .filter(c => now - c.ts < timeoutMs)
                        .reduce((acc, c) => acc + (c.dur || 0), 0);
                    
                     // DEBUG: Log fallback
                     // console.log(`[Cure] Rolling Calc: Host=${hostname} HistoryLen=${history.length} Sitting=${sittingSeconds}`);
                }

                 // --- REMINDER EVALUATION (Centralized) ---
                 if (siteStats.activeSession) {
                     siteStats.activeSession.lastActive = now; // FIX: Update lastActive so session doesn't expire prematurely
                 }
                 
                 // PROTECT SNAPSHOT: Only update if authoritative (session active) or time is increasing.
                 // This prevents data lags from overwriting a good snapshot with 0.
                 if (siteStats.activeSession || sittingSeconds > (siteStats.cumulativeSeconds || 0)) {
                     siteStats.cumulativeSeconds = sittingSeconds; // Save snapshot for robust resume
                 }
                 
                 evaluateReminders(stats, hostname, sittingSeconds, now, 'usage');

                saveStats();
                
                // NEW: Broadcast authoritative time to all tabs for this host
                // This ensures "Instant Sync" across all open tabs/iframes
                chrome.tabs.query({}, (tabs) => {
                    tabs.forEach(t => {
                        try {
                            if (t.url && cleanHost(new URL(t.url).hostname) === hostname) {
                                chrome.tabs.sendMessage(t.id, { 
                                    action: 'timerUpdate', 
                                    seconds: sittingSeconds,
                                    hostname: hostname
                                }).catch(() => {});
                            }
                        } catch(e) {}
                    });
                });

                sendResponse({ success: true, sittingSeconds });
            } catch (e) {
                console.error('[Cure] trackUsage failed:', e);
                sendResponse({ success: false, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'getTimerState') {
        const hostname = cleanHost(request.hostname);
        (async () => {
            try {
                const stats = await getDailyStats();
                const now = Date.now();
                let sittingSeconds = 0;
                const siteStats = stats.sites[hostname];

                if (siteStats && siteStats.activeSession && siteStats.activeSession.startTime) {
                     const sessionStart = siteStats.activeSession.startTime;
                     sittingSeconds = (siteStats.usageHistory || [])
                        .filter(c => c.ts >= sessionStart)
                        .reduce((acc, c) => acc + (c.dur || 0), 0);
                } else {
                    const timeoutMins = (g_settingsCache && g_settingsCache.sessionTimeoutMins) || 30;
                    const timeoutMs = timeoutMins * 60 * 1000;
                    sittingSeconds = (siteStats?.usageHistory || [])
                        .filter(c => now - c.ts < timeoutMs)
                        .reduce((acc, c) => acc + (c.dur || 0), 0);
                }
                    
                sendResponse({ seconds: sittingSeconds });
            } catch (e) {
                sendResponse({ seconds: 0, error: e.message });
            }
        })();
        return true;
    }

    if (request.action === 'getWindowedUsage') {
        const { hostname: rawHost, siteWindowSeconds, browserWindowSeconds } = request;
        const hostname = cleanHost(rawHost);
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
                const res = { siteSeconds: siteSum, browserSeconds: browserSum };
                
                // FIX 188: Provide the current reminder state so tabs can sync their thresholds
                const siteState = g_activeReminders.get(`${hostname}_time`);
                if (siteState) {
                    res.reminderActive = siteState.active;
                    res.reminderValue = siteState.value; // Authoritative absolute value
                    res.reminderStyle = siteState.reminderStyle;
                }
                
                sendResponse(res);
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

        // 🛑 ABSOLUTE CLEAN SLATE (SYNCHRONOUS AUTHORITY) 🛑
        // Synchronously clear memory and update cache BEFORE any async storage calls.
        // This ensures the VERY NEXT evaluateReminders call sees the new rules.
        g_settingsChangedAt = Date.now(); // FIX: Arm cooldown guard FIRST
        g_settingsCache = newSettings;
        updateBlockingRules(newSettings?.blacklist || []);

        // 1. Force dismissal of any currently visible reminders extension-wide
        broadcastReminderStateCentral({ hostname: 'all', show: false });

        // 2. Wipe memory
        g_activeReminders.clear();
        g_activeGlobalReminder = null;

        // 3. Proactively establish precision baselines SYNCHRONOUSLY
        // FIX: Removed inaccurate proactive baseline calculation (Fix 195).
        // relying on accurate live data from evaluateReminders lazy init is safer.
        // The g_activeReminders.clear() above ensures a clean slate.

        chrome.storage.sync.set({ settings: newSettings }, async () => {
            if (chrome.runtime.lastError) {
                console.error('[Cure] Save Failed:', chrome.runtime.lastError);
                sendResponse({ success: false, error: chrome.runtime.lastError.message });
                return;
            }

            // Propagate updates to all active tabs
            chrome.tabs.query({}, (tabs) => {
                for (const tab of tabs) {
                    if (tab.id && tab.url) {
                        try {
                            const url = new URL(tab.url);
                            const tabHost = cleanHost(url.hostname);
                            const finalSettings = g_lockSnapshots[tabHost] || newSettings;
                            chrome.tabs.sendMessage(tab.id, {
                                action: 'settingsUpdated',
                                settings: finalSettings
                            }).catch(() => {});
                        } catch (e) {
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
        const { hostname: rawHost, windowSeconds, reason } = request;
        const hostname = cleanHost(rawHost);
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
                const hostname = cleanHost(url.hostname);
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
        const hostname = cleanHost(request.hostname);
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
        const hostname = cleanHost(request.hostname);
        const locked = request.locked;
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

    // FIX 128/201: Generalized Cross-Tab Reminder Broadcast
    if (request.action === 'broadcastReminderState') {
        broadcastReminderStateCentral(request, sender.tab?.id);
        sendResponse({ success: true });
        return true;
    }

    if (request.action === 'getReminderState') {
        (async () => {
            await ensureRestored();
            const hostname = cleanHost(request.hostname);
            const globalState = g_activeGlobalReminder;
            
            // Priority 1: Global Reminder (Active Browser-wide)
            if (globalState && globalState.active) {
                return sendResponse({ 
                    active: true, 
                    value: globalState.value, 
                    type: globalState.type, 
                    isGlobal: true, 
                    reminderStyle: globalState.reminderStyle 
                });
            }

            // Priority 2: Site Activity (Time) Reminder
            const timeKey = `${hostname}_time`;
            const timeState = g_activeReminders.get(timeKey);
            if (timeState && timeState.active) {
                return sendResponse({ 
                    active: true, 
                    value: timeState.value, 
                    type: 'time', 
                    isGlobal: false, 
                    hostname: hostname, 
                    reminderStyle: timeState.reminderStyle,
                    lastDismissedTime: timeState.lastDismissedTime
                });
            }

            // Priority 3: Launch Limit Reminder
            const launchKey = `${hostname}_launch`;
            const launchState = g_activeReminders.get(launchKey);
            if (launchState && launchState.active) {
                return sendResponse({ 
                    active: true, 
                    value: launchState.value, 
                    type: 'launch', 
                    isGlobal: false, 
                    hostname: hostname, 
                    reminderStyle: launchState.reminderStyle,
                    lastDismissedTime: launchState.lastDismissedTime
                });
            }

            sendResponse({ active: false });
        })();
        return true;
    }

    // FIX 168: Clear launch history when user unlocks a launch reminder
    // This creates a "clean slate" so the next reminder triggers after another full cycle
    if (request.action === 'clearLaunchHistory') {
        const hostname = cleanHost(request.hostname);
        console.log('[Cure] clearLaunchHistory called for:', hostname);
        if (hostname) {
            (async () => {
                const stats = await getDailyStats();
                if (stats.sites[hostname]) {
                    console.log('[Cure] Clearing stats for:', hostname);
                    stats.sites[hostname].launches = [];
                    // Preserve session but mark as "post-reset" so trackLaunch doesn't immediately re-count?
                    // Actually, just clearing launches is enough if trackLaunch is guarded.
                    stats.sites[hostname].activeSession = { startTime: Date.now(), lastActive: Date.now(), unlocked: true }; 
                    await saveStats(true); 
                } else {
                    // Site might not be in stats yet, but we want a clean slate for it
                    stats.sites[hostname] = { usageHistory: [], launches: [], lastActiveAt: Date.now(), activeSession: { startTime: Date.now(), lastActive: Date.now(), unlocked: true } };
                    await saveStats(true);
                }
                sendResponse({ success: true });
            })();
        } else {
            sendResponse({ success: false });
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
        const hostname = cleanHost(request.hostname);
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
        const hostname = cleanHost(request.hostname);
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
            const hostnameClean = cleanHost(hostname);
            delete g_lockSnapshots[hostnameClean];
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
        const hostname = cleanHost(request.hostname);
        const key = `lock_${hostname}`;
        
        // Anti-Cheat: Also clear snapshot if explicitly cleared
        delete g_lockSnapshots[hostname];
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
        const rawHost = request.hostname;
        const tabId = request.tabId;
        if (!rawHost) {
            sendResponse({ success: false });
            return true;
        }

        const hostname = cleanHost(rawHost);
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
                            const tabHost = cleanHost(tabUrl.hostname);
                            
                            if (tabHost === hostname || tabHost.endsWith('.' + hostname)) {
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
                const newHost = cleanHost(url.hostname);
                const oldHost = cleanHost(activeHostname);
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
