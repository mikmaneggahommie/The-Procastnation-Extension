// Cure Procrastination - The Engine
'use strict';

// FIX 82: Removed blocking iframe check to allow support for embedded content blocking.
// Instead, we use specific conditional checks within the class.

/**
 * Global Constants
 */
const TIMERS = {
    COUNTDOWN_INTERVAL_MS: 1000,
    TOAST_DURATION_MS: 5000,
    AUTO_SCROLL_MODULO: 30,
    SHAKE_ANIMATION_MS: 400,
    SAVE_INTERVAL_MS: 10000 // Throttle disk writes to every 10s
};

// CRITICAL: Singleton Pattern - Prevent Multiple Instances
// FIX 82: Aggressive cleanup of old instances to support extension reloads without page refresh
if (window.__CURE_VAULT_INSTANCE__) {
    try {
        console.log('[Cure] Cleaning up existing instance for reload...');
        if (typeof window.__CURE_VAULT_INSTANCE__.cleanup === 'function') {
            window.__CURE_VAULT_INSTANCE__.cleanup();
        }
    } catch (e) {
        console.warn('[Cure] Cleanup failed:', e);
    }
    window.__CURE_VAULT_INSTANCE__ = null;
}

/**
 * Sound Engine
 * Encapsulated audio context logic.
 */
const SoundEngine = {
    ctx: null,
    playChime(type = 'warning') {
        try {
            if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();

            // FIX: Check if user has interacted with the page before trying to play.
            if (navigator.userActivation && !navigator.userActivation.hasBeenActive) {
                return; // Silently abort if no interaction yet
            }

            if (this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => { });
            }

            const now = this.ctx.currentTime;

            // "Deep Gong" - Harmonic and soothing
            const fundamental = 100;
            const duration = 3.0;

            // Ratios: Fundamental, Perfect Fifth, Octave, Major Third
            const ratios = [1, 1.5, 2.0, 2.5];
            const gains = [0.4, 0.2, 0.1, 0.05];

            ratios.forEach((ratio, i) => {
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();

                osc.connect(gain);
                gain.connect(this.ctx.destination);

                osc.type = 'sine';
                osc.frequency.setValueAtTime(fundamental * ratio, now);

                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(gains[i], now + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

                osc.start(now);
                osc.stop(now + duration);
            });

        } catch (e) {
            console.error('[Cure] Sound error:', e);
        }
    }
};

/**
 * Media Controller
 * Pauses/Mutes all media on the page.
 */
const MediaController = {
    interval: null,
    enforcedElements: new Map(), // Use Map to store { muted, volume }
    handleMediaEvent(e) {
        const el = e.target;
        try {
            if (!el.paused) el.pause();
            el.muted = true;
            el.volume = 0;
        } catch (err) { /* Ignore */ }
    },
    findMediaDeep(root = document) {
        let found = [];
        // 1. Regular DOM
        found.push(...root.querySelectorAll('video, audio'));
        // 2. Shadow DOM
        const allElements = root.querySelectorAll('*');
        for (const el of allElements) {
            if (el.shadowRoot) {
                found.push(...this.findMediaDeep(el.shadowRoot));
            }
        }
        return found;
    },
    pauseAll() {
        this.findMediaDeep().forEach(el => {
            try {
                // Proactive Enforcement: Attach listeners if not already tracked
                if (!this.enforcedElements.has(el)) {
                    // Capture original state before we touch it
                    this.enforcedElements.set(el, {
                        muted: el.muted,
                        volume: el.volume
                    });
                    el.addEventListener('play', this.handleMediaEvent);
                    el.addEventListener('playing', this.handleMediaEvent);
                }

                if (!el.paused) el.pause();
                el.muted = true;
                el.volume = 0;
                
            } catch (e) { /* Ignore media interaction errors */ }
        });
    },
    startEnforcement() {
        if (this.interval) clearInterval(this.interval);
        
        // FIX 106 & 123: Integrity Guard. 
        // Never enforce media if site is whitelisted.
        // Also skip if site is not blacklisted UNLESS an active intervention or tab-level lock is active.
        // This ensures neutral sites (and their players) are paused when the parent tab is locked.
        const vault = window.__CURE_VAULT_INSTANCE__;
        const isInterventionActive = vault && (vault.activeIntervention || vault.tabLevelLockActive);
        const isWhitelisted = vault && vault.isWhitelisted();
        const isBlacklisted = vault && vault.isBlacklisted();

        if (isWhitelisted || (!isBlacklisted && !isInterventionActive)) {
            return;
        }

        this.pauseAll();
        // High frequency check to catch auto-resuming players that might bypass listeners
        this.interval = setInterval(() => {
            this.pauseAll();
        }, 200);
    },
    stopEnforcement() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        // Cleanup listeners AND RESTORE STATE
        this.enforcedElements.forEach((original, el) => {
            try {
                el.removeEventListener('play', this.handleMediaEvent);
                el.removeEventListener('playing', this.handleMediaEvent);
                
                // Restore original state
                el.muted = original.muted;
                el.volume = original.volume;
            } catch (e) { /* Ignore */ }
        });
        this.enforcedElements.clear();
    }
};

/**
 * Universal Text Normalization
 * Converts Smart Quotes and special dashes to neutral characters for robust typing comparison.
 */
function normalizeTypingText(str) {
    if (!str) return "";
    return str
        .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u02BC\u02BB\u02B9\u00B4\u0060\u2032\u2035\uFF07]/g, "'") // Nuclear Coverage: Smart Quotes, Primes, Fullwidth
        .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\uFF02]/g, '"') // Nuclear Coverage: Double Smart, Double Primes, Fullwidth
        .replace(/[\u2013\u2014\u2010\u2011\u2012\u2212]/g, "-") // En, Em, Hyphen, Non-breaking hyphen, Figure dash, Minus
        .replace(/\u00A0/g, " "); // Non-breaking spaces
}

class CureVault {
    constructor() {
        // Mark as singleton instance
        window.__CURE_VAULT_INSTANCE__ = this;

        this.settings = {};
        this.timerInterval = null;
        this.countdownInterval = null;
        this.activeSeconds = 0;
        this.mode = 'up'; // 'up' (browsing) or 'down' (reward countdown)
        this.lastSaveTime = Date.now();
        this.dailySeconds = 0; // Usage for this site TODAY
        this.browserSeconds = 0; // Total usage TODAY
        this.activeSeconds = 0; // Current sitting duration

        this._lastResetToastShown = false; // Fix 65: Track if we showed reset toast
        this.instanceId = Math.random().toString(36).substring(2, 11); // FIX 89: Identify this tab instance
        this.stateInitialized = false;

        this.lastSyncedDailySeconds = 0;
        this.lastSyncedBrowserSeconds = 0;
        this.windowedSiteSeconds = 0;
        this.windowedBrowserSeconds = 0;

        this.passiveDelta = 0; // Buffer for passive reward accrual
        this.lastPassiveSync = Date.now();
        this.PASSIVE_SYNC_MS = 60000; // Sync passive rewards every 60s

        // REWARD/UP SEAMLESS TRANSITION
        this.sessionBaseSeconds = 0; // Time spent before the lock
        this.originalRewardSeconds = 0; // Total reward granted
        this.lastLockMode = 'up'; // Track mode changes for transitions

        this.breathingRoomShownOnThisPage = false;
        this.suppressBreathingRoomOnce = false; // Flag to skip pause on whitelist/strict-lock-off
        this.lastMasterPauseState = null;
        
        this.activeIntervention = null; // Logical source of truth for UI vs Pill
        this.tabLevelLockActive = false; // Cross-domain sync
        this.hiddenAt = null; // Track when tab was backgrounded

        // High-precision Monotonic Timing
        this.lastTickTime = performance.now();
        this.lastEvaluationTime = Date.now(); // Used for clock jump detection

        this.stateInitialized = false; // Prevent rendering until baseline is established
        this.isTypingChallengeActive = false; // Dedicated flag for robust reset logic

        this.overlayId = 'cure-overlay-id';
        this.pillId = 'cure-pill';
        this.shadowHostId = 'cure-root'; // ID used by ensureShadow()
        this.shadowHost = null;
        this.shadowRoot = null;
        this._resetToastPending = false; 
        this._toastDebounce = false;
        this._lastDecisionKey = null; // Stability guard for UI re-renders
        this.lastRenderedReason = null; // Fix: Prevent rapid-fire re-rendering
        
        // FIX 86: Track iframe state for conditional logic
        // FIX 103: Simple Check. ancestorOrigins caused false positives on main sites.
        this.isIframe = (window.self !== window.top);

        this.handleUpdate = this.handleUpdate.bind(this);
        this.boundCleanup = this.cleanup.bind(this);
        this.processPendingToasts = this.processPendingToasts.bind(this);
        this.showToast = this.showToast.bind(this);
        this.dismissToast = this.dismissToast.bind(this);
        
        // FIX: Bound handlers for removeEventListener capability
        this.handleFocus = this.handleFocus.bind(this);
        this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
        this.handlePageShow = this.handlePageShow.bind(this);
        this.handleStorageChange = this.handleStorageChange.bind(this);
        this.handleDOMContentLoaded = this.handleDOMContentLoaded.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        
        // Fix 81: Final Registration Pass.
        // REMOVED: beforeunload and pagehide cleanup.
        // These were causing the extension to "commit suicide" during back/forward navigation,
        // allowing users to bypass the lock by navigating away and back.
        // We now rely on the Singleton pattern at the top of the file for re-injection cleanup.
        
        if (document.readyState === 'loading') {
            window.addEventListener('DOMContentLoaded', this.handleDOMContentLoaded);
        } else {
            this.init().catch(e => console.error('[Cure] Init error:', e));
        }

        chrome.runtime.onMessage.addListener(this.handleUpdate);
        chrome.storage.onChanged.addListener(this.handleStorageChange);
        window.addEventListener('focus', this.handleFocus);
        document.addEventListener('visibilitychange', this.handleVisibilityChange);
        window.addEventListener('pageshow', this.handlePageShow);

        this.setupProximity();
    }

    handleDOMContentLoaded() {
        this.init().catch(e => console.error('[Cure] Init error:', e));
    }

    handleFocus() {
        if (typeof this.evaluateAllTriggers !== 'function') return;
        this.evaluateAllTriggers().then(() => this.forceRefreshUI());
    }

    handleVisibilityChange() {
        if (typeof this.loadTimer !== 'function') return;
        if (!document.hidden) {
            this.loadTimer().then(() => {
                if (typeof this.evaluateAllTriggers !== 'function') return;
                this.evaluateAllTriggers().then(() => {
                    this.forceRefreshUI();
                    this.processPendingToasts?.();
                });
            });
        } else {
            // FIX: Redundant check for reset flag on visibility hide (Tab switch / Compose window)
            if (this.isTypingChallengeActive) {
                // Set both keys to be safe
                sessionStorage.setItem(`cure_needs_reset_${window.location.hostname}`, 'true');
                sessionStorage.setItem('cure_needs_reset', 'true');
            }
            this.saveTimer();
        }
    }

    handlePageShow(event) {
        // ALWAYS re-evaluate on pageshow to catch BFCache restorations and "soft" navigations
        if (typeof this.evaluateAllTriggers === 'function') {
            console.log('[Cure] Page revealed, re-evaluating state...');
            
            // Ensure monitor is running (in case it was stopped or throttled)
            if (!this.timerInterval) {
                this.stateMonitor();
            }

            this.evaluateAllTriggers().then(() => {
                this.forceRefreshUI();
            });
        }
    }

    handleStorageChange(changes, area) {
        if (area === 'local') {
            const key = `cure_timer_${window.location.hostname}`;
            if (changes[key]) {
                const { seconds, mode, timestamp } = changes[key].newValue || {};
                const timeoutMs = ((this.settings || {}).sessionTimeoutMins || 30) * 60 * 1000;
                if (timestamp && (Date.now() - timestamp < timeoutMs)) {
                    this.activeSeconds = seconds;
                    this.mode = mode || 'up';
                    this.updatePill?.();
                }
            }
        }
    }

    handleMouseMove(e) {
        const pill = this.shadowRoot?.getElementById(this.pillId);
        if (!pill) return;

        const thresholdX = 350; // Pixels from right
        const thresholdY = 180; // Pixels from bottom
        const x = window.innerWidth - e.clientX;
        const y = window.innerHeight - e.clientY;

        if (x < thresholdX && y < thresholdY) {
            pill.classList.add('cure-faded');
        } else {
            pill.classList.remove('cure-faded');
        }
    }

    // =========================================================================
    // REGRESSION GUARD: TOAST DISMISSAL LOGIC
    // CRITICAL: Any changes here will break the "Unlock -> Dismiss" flow.
    // 1. Must handle inline-styled elements (no class checks).
    // 2. Must be called explicitly in renderTypingLock.
    // =========================================================================
    dismissToast() {
        // FIX: Clear local reset flags when user acknowledges/starts over.
        sessionStorage.removeItem(`cure_needs_reset_${window.location.hostname}`);
        sessionStorage.removeItem('cure_needs_reset');
        
        if (!this.shadowRoot) return;
        const popout = this.shadowRoot.getElementById('cure-popout-notification');
        if (popout) {
            popout.style.opacity = '0';
            setTimeout(() => { if (popout.parentElement) popout.remove(); }, 300);
        }
    }

    // =========================================================================
    // REGRESSION GUARD: RESET TRIGGER LOGIC
    // CRITICAL: Controls when the Red Pill Toast appears.
    // 1. Must be guarded against typing challenge (must return if isTypingChallengeActive).
    // 2. Must clear sessionStorage flags to prevent loops.
    // 3. Must be called at top of renderDecisionScreen.
    // =========================================================================
    checkAndShowResetToast() {
        const resetKeySpecific = `cure_needs_reset_${window.location.hostname}`;
        const resetKeyGeneric = 'cure_needs_reset';
        
        const needsReset = (sessionStorage.getItem(resetKeySpecific) === 'true') || 
                           (sessionStorage.getItem(resetKeyGeneric) === 'true');
        
        if (needsReset || this._resetToastPending) {
            if (needsReset) {
                // FIX: PERSISTENCE STRATEGY
                // 1. Keep Local flags for persistence across reloads.
                // 2. Clear Global Flag via Proxy (to stop background nag)
                this.safeSendMessage({ action: 'clearResetFlag', hostname: window.location.hostname });

                this._resetToastPending = true;
                setTimeout(() => { this._resetToastPending = false; }, 2000);
            }
            
            this.currentChallengeText = null; 

            if (!this._toastDebounce) {
                this._toastDebounce = true;
                this.showToast('⚠️ Progress Reset: Stay on Tab', 'warning');
                setTimeout(() => { this._toastDebounce = false; }, 1000); 
            }
        }
    }


    processPendingToasts() {
        if (!this.isContextValid()) return;
        if (this.isIframe) return; // FIX 86: Never show toasts in iframes
        
        // Fix 90: Local reset logic moved to renderTypingLock to prevent async race conditions.
        // processPendingToasts is now deprecated/empty but kept for interface compatibility.
    }

    /**
     * Checks if a challenge was abandoned globally (on another tab).
     * Called when starting any unlock protocol.
     */
    async checkGlobalResets(forceTextReset = false) {
        if (this.isIframe || !this.isContextValid()) return;

        return new Promise(resolve => {
            this.safeSendMessage({ 
                action: 'sessionStorageProxy', 
                op: 'get', 
                key: 'cure_typing_active_global' 
            }, (res) => {
                const data = res?.value;
                
                if (data && data.hostname === window.location.hostname) {
                    if (data.owner !== this.instanceId) {
                        this.safeSendMessage({ 
                            action: 'sessionStorageProxy', 
                            op: 'remove', 
                            key: 'cure_typing_active_global' 
                        });
                        
                        if (forceTextReset) {
                            this.currentChallengeText = null;
                        }
                    }
                }
                
                this.safeSendMessage({ 
                    action: 'sessionStorageProxy', 
                    op: 'set', 
                    key: 'cure_typing_active_global',
                    value: { 
                        hostname: window.location.hostname, 
                        owner: this.instanceId 
                    } 
                });
                resolve();
            });
        });
    }

    cleanup() {
        // console.log('[Cure] Cleaning up intervals and listeners...');

        // Force save current state before exiting
        // Force save current state before exiting
        if (this.isTypingChallengeActive) {
            // FIX 116: Mirror of visibilitychange - always flag reset on exit
            // Set BOTH keys to be absolutely sure we catch it on return
            sessionStorage.setItem(`cure_needs_reset_${window.location.hostname}`, 'true');
            sessionStorage.setItem('cure_needs_reset', 'true');
            
            // FIX: Robust Sync to Background (YouTube Persistence)
            // sessionStorage is often lost or isolated. We normally can't send async messages in unload,
            // but we try anyway. If it fails, we rely on local flags.
            this.safeSendMessage({ action: 'setResetFlag', hostname: window.location.hostname });
        }
        
        this.saveTimer();
        this.flushPassiveRewards(); // Ensure we save any pending points
        this.syncDailyStats(); // Sync daily stats on cleanup

        // Fix 56: We also rely on the GLOBAL flag set in renderDecisionScreen.
        // It persists in chrome.storage.session.

        this.stopAllIntervals();
        window.removeEventListener('beforeunload', this.boundCleanup);
        window.removeEventListener('pagehide', this.boundCleanup);
        window.removeEventListener('DOMContentLoaded', this.handleDOMContentLoaded);
        window.removeEventListener('focus', this.handleFocus);
        document.removeEventListener('visibilitychange', this.handleVisibilityChange);
        window.removeEventListener('pageshow', this.handlePageShow);
        
        chrome.runtime.onMessage.removeListener(this.handleUpdate);
        chrome.storage.onChanged.removeListener(this.handleStorageChange);
        document.removeEventListener('mousemove', this.handleMouseMove);

        this.removeAllUI();
        window.__CURE_VAULT_INSTANCE__ = null;
    }

    stopAllIntervals() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
    }

    removeAllUI() {
        if (this.shadowHost) {
            this.shadowHost.remove();
            this.shadowHost = null;
            this.shadowRoot = null;
        }
        if (document.body) {
            document.body.style.overflow = '';
        }
        MediaController.stopEnforcement();
    }

    handleUpdate(request) {
        if (!this.isContextValid()) return;

        // DEBUG TRIGGERS (Work for both Main Tab and Iframes)
        if (request.action === 'debugTrigger') {
            // FIX 114: Restrict 'forceHardLock' to Main Frame only to prevent 
            // accidental locks of third-party domains (ads, widgets) within iframes.
            if (request.type === 'forceHardLock' && this.isIframe) return;

            // Use existing settings if available, otherwise fetch quickly
            const trigger = () => {
                if (request.type === 'forceHardLock') {
                    this.stateHardLock('limit', true);
                } else if (request.type === 'forceReminder') {
                    this.renderReminderOverlay(5, 'time', true);
                } else if (request.type === 'forceBreathing') {
                    this.stateBreathingRoom('manual_test', true);
                }
            };

            if (this.settings && Object.keys(this.settings).length > 0) {
                trigger();
            } else {
                this.getSettings().then(s => { this.settings = s; trigger(); });
            }
            return;
        }

        if (request.action === 'forceMediaPause') {
            // FIX 127: Cross-Domain Media Enforcement (Deep Broadcast)
            // If any frame in the tab is locked, ALL frames must pause media regardless of their own domain/settings.
            if (request.locked) {
                this.tabLevelLockActive = true;
                MediaController.startEnforcement();
            } else {
                this.tabLevelLockActive = false;
                MediaController.stopEnforcement();
                this.removeOverlay(); // Ensure overlay is removed on unlock
            }
            return;
        }

        if (request.action === 'challengeCompleted') {
            if (request.hostname === window.location.hostname) {
                // FIX 125: Handle cross-tab unlock for both Main Frame and Iframes
                this.stickyUnlocked = true;
                this._toastDebounce = false;
                this.removeOverlay();
                MediaController.stopEnforcement();
                if (!this.isIframe) {
                    this.stateMonitor();
                }
            }
            return;
        }

        if (this.isIframe) return; // Rest of logic is for main tabs only

        if (request.action === 'settingsUpdated') {
            const newSettings = request.settings || {};
            
            // Check if masterPause was just turned ON
            const oldPause = this.settings?.masterPause !== false;
            const newPause = newSettings.masterPause !== false;

            if (!oldPause && newPause) {
                this.breathingRoomShownOnThisPage = false;
            }

            // Detection of "Disabling Lock" or "Whitelisting" vs "Enabling"
            const oldStrictLock = this.settings?.masterHardLock !== false;
            const newStrictLock = newSettings.masterHardLock !== false;
            const oldWhitelisted = this.isWhitelisted();
            
            // Apply settings first so isWhitelisted() reflects the new state
            this.settings = newSettings;

            const newWhitelisted = this.isWhitelisted();

            // SUPPRESS OVERLAY: If we just whitelisted or turned OFF strict lock, 
            // the user almost certainly doesn't want to see a Breathing Room immediately.
            if ((!oldWhitelisted && newWhitelisted) || (oldStrictLock && !newStrictLock)) {
                this.suppressBreathingRoomOnce = true;
                
                // FIX 117: Focus Preservation.
                // If a Typing Challenge is active, we MUST keep the input focused.
                // Whitelisting the site shouldn't break the input if the user wants to finish the challenge.
                if (this.isTypingChallengeActive && this.shadowRoot) {
                    const input = this.shadowRoot.getElementById('cure-input');
                    if (input) {
                        setTimeout(() => input.focus(), 50);
                    }
                }
            }

            // FIX 118: Clear Sticky Unlock on Strict Lock Enable.
            // If the user enables Strict Lock (regardless of previous state), we must clear 
            // any lingering unlock state to ensure limits are enforced immediately.
            // This fixes the "Re-lock Bypass" where toggling the switch allowed a free pass.
            if (newStrictLock) {
                this.stickyUnlocked = false;
                sessionStorage.removeItem(`cure_sticky_unlocked_${window.location.hostname}`);
                sessionStorage.removeItem('cure_success_page_active');
            }

            // FIX 119: Timer Mode Restoration (Reward -> Session).
            // If the user disables Strict Lock or Whitelists the site while in Reward Mode,
            // we must immediately revert the timer to count UP from the total time spent.
            // (Total Time = Pre-Lock Time + Time Spent in Reward).
            if ((oldStrictLock && !newStrictLock) || (!oldWhitelisted && newWhitelisted)) {
                if (this.mode === 'down') {
                    const rewardSpent = Math.max(0, (this.originalRewardSeconds || 0) - this.activeSeconds);
                    this.activeSeconds = (this.sessionBaseSeconds || 0) + rewardSpent;
                    this.mode = 'up';
                    this.sessionBaseSeconds = 0;
                    this.originalRewardSeconds = 0;
                }
                // FIX 123: Always save timer when strict lock is disabled (even in 'up' mode)
                // This ensures the current time is persisted before overlay removal or page reload.
                this.saveTimer();
            }

            // SYNC UI REFRESH: authoritative flicker-free update
            this.forceRefreshUI();

            // 1. CLEAR CURRENT MONITOR to prevent race conditions
            if (this.timerInterval) {
                clearInterval(this.timerInterval);
                this.timerInterval = null;
            }

            // FIX 125: Nuclear Force Lock on Strict Lock Enable
            // If we just enabled Strict Lock and we are already OVER the limit, 
            // FORCE the lock immediately without relying on checkAnyTrigger's sticky logic.
            // This bypasses all the complex reward/sticky state and directly enforces the limit.
            if (newStrictLock && !this.isWhitelisted()) {
                const triggers = this.settings.hardLockTriggers || {};
                const sessionLimit = triggers.sessionLimit || {};
                if (sessionLimit.enabled) {
                    const limitSeconds = (sessionLimit.value || 1) * 60;
                    if (this.activeSeconds >= limitSeconds) {
                        // Clear any lingering reward state that might interfere
                        this.originalRewardSeconds = 0;
                        this.sessionBaseSeconds = 0;
                        this.saveTimer();
                        this.stateHardLock('limit');
                        return;
                    }
                }
            }

            // 2. IMMEDIATE TRIGGER CHECK (Low Latency)
            // If the user just modified a limit and exceeded it, lock INSTANTLY.
            const immediateTrigger = this.checkAnyTrigger();
            if (immediateTrigger) {
                this.stateHardLock(immediateTrigger === true ? null : immediateTrigger);
                this.saveTimer();
            }

            // 1. Definitively check for background-dependent states (Windowed limits, persistent locks)
            this.evaluateAllTriggers().then(() => {
                this.forceRefreshUI();
                this.stateMonitor();
            });
            return;
        }

        if (request.action === 'onFactoryReset') {
            // FIX 126: Absolute Kill-Switch and Wipe for Factory Reset
            this._resetGuard = true; 
            
            // 1. Stop all execution loops
            if (this.monitorInterval) clearInterval(this.monitorInterval);
            if (this.timerInterval) clearInterval(this.timerInterval);
            if (this.countdownInterval) clearInterval(this.countdownInterval);
            
            // 2. Wipe memory
            try {
                const keys = Object.keys(sessionStorage);
                keys.forEach(k => {
                    if (k.startsWith('cure_')) sessionStorage.removeItem(k);
                });
            } catch (e) {}

            // 3. Stop Media
            MediaController.stopEnforcement();
            
            // 4. Remove UI
            this.removeOverlay();
            this.removePill();
            
            console.debug('[Cure] Factory reset signal received. Tab is now dormant.');
            return;
        }

        if (request.action === 'dismissResetToast') {
            this.dismissToast();
            return;
        }

        if (request.action === 'forceRefresh') {
            this.evaluateAllTriggers().then(() => this.forceRefreshUI());
            return;
        }

        // TEST ZONE HANDLERS
        if (request.action === 'factoryResetComplete') {
            window.location.reload();
        }

        if (request.action === 'forceGlobalUnlock') {
            // Emulate a successful unlock
            this.stickyUnlocked = true;
            sessionStorage.setItem('cure_sticky_unlocked', 'true');
            this.removeOverlay();
            this.forceRefreshUI();
        }
    }

    /**
     * Synchronously refreshes the UI state based on current settings.
     * Prevents flickering by checking definitive states before touching the DOM.
     */
    // --- UI: TIMER PILL ---
    shouldShowPill() {
        if (!this.stateInitialized) return false;
        if (this.activeIntervention) return false;
        
        const root = this.shadowRoot;
        if (root && root.getElementById(this.overlayId)) return false;

        const isWhitelisted = this.isWhitelisted();
        const showPillSetting = this.settings.showTimerPill !== false;
        const canShowOnWhitelist = !isWhitelisted || this.settings.showPillOnWhitelist === true;

        // Fix 71: Previously we suppressed on all blacklisted sites. 
        // Now we ONLY suppress if it's currently being actively blocked (intervention active).
        // This allows the pill to show on blacklisted sites DURING reward time.
        return showPillSetting && canShowOnWhitelist;
    }

    forceRefreshUI() {
        if (!this.isContextValid() || !this.stateInitialized) return;
        const root = this.ensureShadow();
        if (!root) return;

        const isWhitelisted = this.isWhitelisted();
        const isBlacklisted = this.isBlacklisted();
        const hasOverlay = !!root.getElementById(this.overlayId);
        const strictLockOn = this.settings.masterHardLock !== false;
        
        // REWARD TRANSITION LOGIC
        // If we are in Reward Mode (down) but either the site is now whitelisted or strict lock is OFF,
        // we must transition back to Session Mode (up) and "keep" the time we already spent.
        if (this.mode === 'down' && (isWhitelisted || !strictLockOn)) {
            const rewardSpent = Math.max(0, (this.originalRewardSeconds || 0) - this.activeSeconds);
            // Restore: Time before lock + Time spent in reward
            this.activeSeconds = (this.sessionBaseSeconds || 0) + rewardSpent;
            this.mode = 'up';
            this.sessionBaseSeconds = 0;
            this.originalRewardSeconds = 0;
            this.saveTimer();
        }

        if (this.shouldShowPill()) {
            this.updatePill();
        } else {
            this.removePill();
        }
    }

    isContextValid() {
        if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return false;
        try {
            // This is the most reliable check - if the context is invalidated, 
            // even accessing getManifest() will throw an error.
            return !!chrome.runtime.getManifest();
        } catch (e) {
            return false;
        }
    }

    /**
     * Safely wraps chrome.runtime.sendMessage to catch "Extension context invalidated" errors.
     * Prevents the script from crashing when communication is attempted after an extension reload.
     */
    safeSendMessage(message, callback = null) {
        if (!this.isContextValid()) {
            // If the context is dead, don't even try to send
            if (callback) callback(null);
            return;
        }

        try {
            if (callback) {
                chrome.runtime.sendMessage(message, (response) => {
                    // Check for disconnection in the callback
                    if (chrome.runtime.lastError) {
                        // console.debug('[Cure] Communication suppressed (Context Invalid):', chrome.runtime.lastError.message);
                        callback(null);
                    } else {
                        callback(response);
                    }
                });
            } else {
                chrome.runtime.sendMessage(message);
            }
        } catch (e) {
            // console.debug('[Cure] Direct send failed (Context Invalid). Stopping execution.');
            if (callback) callback(null);
        }
    }

    async initIframe() {
        if (this.isWhitelisted()) return;

        // 1. Proactive Tab-Level Check (The "Nuclear" Fallback)
        this.safeSendMessage({ action: 'getTabLockState' }, (response) => {
            if (response && response.locked) {
                this.tabLevelLockActive = true;
                this.activeIntervention = 'locked';
                this.renderIframeBlocked(this.ensureShadow(), response.reason || 'limit');
            }
        });

        // 2. Initial Site-Level Check (Standard)
        this.safeSendMessage({
            action: 'getLockState',
            hostname: window.location.hostname
        }, (response) => {
            // FIX 105: Respect Tab-Level Whitelisting
            // If the parent tab is whitelisted, this iframe should be allowed.
            if (response && response.tabWhitelisted) {
                return; // Silent allowed
            }

            if (response && response.locked) {
                 this.activeIntervention = 'locked';
                 this.renderIframeBlocked(this.ensureShadow(), response.lockState?.reason || 'limit');
            }
        });

        // 2. Listen for Broadcasts (Dynamic Locking/Unlocking)
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            if (request.action === 'broadcastLockState') {
                if (request.hostname === window.location.hostname) {
                    if (request.locked) {
                        this.activeIntervention = 'locked';
                        this.renderIframeBlocked(this.ensureShadow(), 'limit');
                    } else {
                        this.activeIntervention = null;
                        this.removeOverlay();
                    }
                }
            }
            // FIX 98: Listen for challenge completion from other tabs
            if (request.action === 'challengeCompleted') {
                if (request.hostname === window.location.hostname) {
                    // Challenge was completed in another tab - unlock this iframe
                    this.activeIntervention = null;
                    this.removeOverlay();
                    MediaController.stopEnforcement();
                }
            }
            
            // FIX 109: Developer Test Triggers moved to shared handleUpdate
        });
    }

    async init() {
        this._toastDebounce = false;
        this._resetToastPending = false;
        if (!this.isContextValid()) return;
        
        // FIX 86: Branch for Iframe logic
        if (this.isIframe) {
            return this.initIframe();
        }

        // AGGRESSIVE CLEANUP: Remove ANY existing shadow hosts (Zombie Pills) from old/orphaned scripts
        const oldHosts = document.querySelectorAll('#cure-root');
        oldHosts.forEach(host => host.remove());

        this.settings = await this.getSettings();
        
        await this.loadTimer();
        
        
        // Clean init - no penalty check needed, renderDecisionScreen handles it

        // Authoritative sequence: evaluation MUST complete before starting the regular monitor/UI loop
        const initTimeout = new Promise(resolve => setTimeout(() => {
            console.debug('[Cure] Initialization taking longer than expected, proceeding with defaults.');
            resolve();
        }, 3000));

        await Promise.race([
            this.evaluateAllTriggers(),
            initTimeout
        ]);

        this.stateInitialized = true;
        
        // Fix 77: Check for reset toasts on cold load
        this.processPendingToasts?.();

        // Fix 60: Fetch initial windowed usage stats IMMEDIATELY.
        // Prevents the "10-second loophole" where rolling limits are ignored on fresh load.
        // FIX 95: Wrap in try-catch so failure (e.g. on restricted embed pages) doesn't block the lock.
        try {
            await this.syncDailyStats();
        } catch (e) {
             console.warn('[Cure] Stats sync failed, proceeding with monitor:', e);
        }

        this.stateMonitor();
        this.forceRefreshUI();

    }

    /**
     * Re-evaluates all blocking triggers (Hard Lock, Pause, Reminders).
     * Returns a promise that resolves when the evaluation (and potential UI change) is complete.
     */
    evaluateAllTriggers() {
        if (!this.isContextValid()) return Promise.resolve();

        // FIX: Immediate Whitelist Shortcut.
        // On whitelisted sites, we don't need to check reset status or lock status from background.
        // This prevents timeouts on sites like Google/GitHub.
        if (this.isWhitelisted()) {
            this.removeOverlay();
            return Promise.resolve();
        }

        // FIX 107/YouTube: Background-Enforced Reset (Iframe Isolation).
        if (!this.isIframe) {
            return new Promise(resolve => {
                this.safeSendMessage({ action: 'checkResetStatus', hostname: window.location.hostname }, (res) => {
                    if (res && res.needsReset) {
                        // FIX: Restore absolute flag sync. 
                        // If background says we need reset, we must set the flags so renderDecisionScreen sees them.
                        sessionStorage.setItem('cure_needs_reset', 'true');
                        sessionStorage.setItem(`cure_needs_reset_${window.location.hostname}`, 'true');
                        
                        this.stateHardLock('limit', true);
                        resolve();
                    } else {
                        // Continue to regular lock checks
                        this._continueTriggerEvaluation(resolve);
                    }
                });
            });
        }

        return this._continueTriggerEvaluation();
    }

    _continueTriggerEvaluation(resolve = null) {
        const outerResolve = resolve;
        return new Promise(resolve => {
            const finalResolve = (val) => {
                if (outerResolve) outerResolve(val);
                resolve(val);
            };

            this.safeSendMessage({
                action: 'getLockState',
                hostname: window.location.hostname
            }, (lockResponse) => {
                // FIX 105: Tab-Level Whitelisting (Sub-Frame respect)
                if (lockResponse && lockResponse.tabWhitelisted && this.isIframe) {
                    this.removeOverlay();
                    return resolve();
                }
            // FIX 81: Verify reward time is still valid before restoring unlock protection.
            // If the background says unlocked but reward time is consumed, clear it.
            if (lockResponse && lockResponse.unlocked === true) {
                const rewardSecondsGranted = this.originalRewardSeconds || 0;
                const rewardConsumed = rewardSecondsGranted > 0 && this.activeSeconds >= rewardSecondsGranted;
                
                if (rewardConsumed) {
                    // Reward time used up - clear the unlock state and check triggers
                    this.stickyUnlocked = false;
                    sessionStorage.removeItem('cure_sticky_unlocked');
                    sessionStorage.removeItem('cure_success_page_active');
                    this.originalRewardSeconds = 0;
                    this.sessionBaseSeconds = 0;
                    this.safeSendMessage({ action: 'clearLockState', hostname: window.location.hostname });
                    // Don't return - fall through to check triggers below
                } else {
                    // Reward still valid - restore protection
                    this.stickyUnlocked = true;
                    sessionStorage.setItem(`cure_sticky_unlocked_${window.location.hostname}`, 'true');

                    // Fix 73: If we were on the success screen and navigated away/back,
                    // re-render the success screen instead of just showing the site.
                    if (sessionStorage.getItem('cure_success_page_active') === 'true') {
                        this.renderSuccess(this.settings.unlockReward || 5);
                        return resolve();
                    }

                    // If we were showing an overlay, remove it.
                    const root = this.ensureShadow();
                    const hasOverlay = root && root.getElementById(this.overlayId);
                    if (hasOverlay) this.removeOverlay();
                    
                    if (!this.timerInterval) this.stateMonitor();
                    return resolve();
                }
            } else {
                 if (this.isIframe && lockResponse.unlocked) {
                     this.removeOverlay();
                 }
            }

                // If actively locked (Sticky: not beaten yet), go straight to hard lock 
                if (lockResponse && lockResponse.locked) {
                    this.stateHardLock(lockResponse.lockState?.reason || 'limit', true);
                    return resolve();
                }

                const isWhitelisted = this.isWhitelisted();
                const anyFeatureOn = this.settings.masterHardLock !== false || 
                                     this.settings.masterPause !== false || 
                                     this.settings.masterReminders !== false;

                if (!anyFeatureOn) {
                    this.removeOverlay();
                    return resolve();
                }

                if (isWhitelisted && !this.settings.pauseWhitelist && !this.settings.reminderWhitelist) {
                    this.removeOverlay();
                    return resolve();
                }

                // 3. Fetch latest usage stats and check dynamic triggers
                this.safeSendMessage({
                    action: 'getWindowedUsage',
                    hostname: window.location.hostname,
                    siteWindowSeconds: this.settings.hardLockTriggers?.sessionLimit?.windowSeconds || 0,
                    browserWindowSeconds: this.settings.hardLockTriggers?.browserLimit?.windowSeconds || 86400
                }, (res) => {
                    if (res) {
                        this.windowedSiteSeconds = res.siteSeconds;
                        this.windowedBrowserSeconds = res.browserSeconds;
                    }
                    
                    // ALSO Fetch/Verify Launch Status for complete evaluation
                    this.safeSendMessage({ 
                        action: 'trackLaunch', 
                        hostname: window.location.hostname 
                    }, (launchRes) => {
                        const combined = { ...(res || {}), ...(launchRes || {}) };
                        const response = combined; // Rename for consistency with original code

                        // Update our local windowed logic with ground truth from background
                        if (response) {
                            this.windowedSiteSeconds = response.siteSeconds || 0;
                            this.windowedBrowserSeconds = response.browserSeconds || 0;
                        }

                        const triggerReason = this.checkAnyTrigger();
                        if (triggerReason) {
                            localStorage.removeItem('cure_reminder_active');
                            this.stateHardLock(triggerReason === true ? null : triggerReason);
                            return resolve();
                        }

                        // 3. Check Reminder State
                        const masterRemindersOn = this.settings.masterReminders !== false;
                        const reminderActive = localStorage.getItem('cure_reminder_active') === '1';

                        if (!masterRemindersOn && reminderActive) {
                            localStorage.removeItem('cure_reminder_active');
                            this.removeOverlay();
                        }

                        if (masterRemindersOn && reminderActive) {
                            // FIX 121: Respect reminderWhitelist setting on reminder re-render
                            const isWhitelisted = this.isWhitelisted();
                            const allowOnWhitelist = !!this.settings.reminderWhitelist;
                            
                            if (!isWhitelisted || allowOnWhitelist) {
                                const mins = Math.floor(this.activeSeconds / 60);
                                this.renderReminderOverlay(mins);
                            } else {
                                // Whitelisted and setting is off - clear the reminder state
                                localStorage.removeItem('cure_reminder_active');
                            }
                            return resolve();
                        }

                        // 4. Check Pause Triggers (Launch & Browser)
                        const pauseTriggers = this.settings.pauseTriggers || {};
                        const currentLaunches = response?.currentLaunches || 0;
                        const browserSecs = response?.browserSeconds || 0;
                        const canShowPause = !this.isWhitelisted() || !!this.settings.pauseWhitelist;

                        if (canShowPause && this.settings.masterPause !== false) {
                            if (pauseTriggers.launchLimit?.enabled && currentLaunches >= pauseTriggers.launchLimit.value) {
                                this.stateBreathingRoom('launch');
                                return resolve();
                            }
                            if (pauseTriggers.browserLimit?.enabled && browserSecs >= (pauseTriggers.browserLimit.value * 60)) {
                                this.stateBreathingRoom('browser');
                                return resolve();
                            }
                        }

                        // 5. Standard Frequency Pause
                        if (this.settings.masterPause !== false && this.shouldShowBreathingRoom(response)) {
                            this.stateBreathingRoom('freq');
                            return resolve();
                        } else {
                            // Only start monitor if not already running AND no overlay is active
                            const root = this.ensureShadow();
                            const hasOverlay = root && root.getElementById(this.overlayId);
                            if (!this.timerInterval && !hasOverlay) {
                                this.stateMonitor();
                            }
                            return resolve();
                        }
                    });
                });
            });
        });
    }

    checkAnyTrigger() {
        // Ultimate overrides: never block if allowlisted or master switch is OFF
        if (this.isWhitelisted() || this.settings.masterHardLock === false) return false;

        // If Reward Time is counting down
        if (this.mode === 'down') {
            if (this.activeSeconds <= 0) return true; // Earned time is up
            return false; // Still have earned time
        }

        // FIX 81/122: stickyUnlocked should ONLY protect during active reward usage.
        // Once the user is in 'up' mode AND has exceeded their originalRewardSeconds,
        // their reward time is consumed and they should be subject to limits again.
        // FIX 122: If no reward was granted (rewardSecondsGranted === 0), 
        // stickyUnlocked should NOT provide infinite protection.
        // It should only persist for session/unlimited types when mode is 'up' from a legitimate unlock.
        if (this.stickyUnlocked) {
            const rewardSecondsGranted = this.originalRewardSeconds || 0;
            const rewardType = this.settings.unlockRewardType || 'time';
            
            if (rewardSecondsGranted > 0 && this.activeSeconds >= rewardSecondsGranted) {
                // Reward time is used up - clear protection
                this.stickyUnlocked = false;
                sessionStorage.removeItem(`cure_sticky_unlocked_${window.location.hostname}`);
                sessionStorage.removeItem('cure_success_page_active');
                this.originalRewardSeconds = 0;
                this.sessionBaseSeconds = 0;
                this.saveTimer();
                // Also clear the background lock state so it doesn't re-set stickyUnlocked
                if (this.isContextValid()) {
                    this.safeSendMessage({ action: 'clearLockState', hostname: window.location.hostname });
                }
                // Fall through to check limits
            } else if (rewardSecondsGranted === 0 && (rewardType === 'session' || rewardType === 'unlimited')) {
                // Session/Unlimited type with no time-based reward - stickyUnlocked persists
                // until the user leaves or session times out
                return false;
            } else if (rewardSecondsGranted === 0) {
                // FIX 122: No reward was granted and NOT session/unlimited type.
                // This means strict lock was OFF when they unlocked - NO protection.
                // Clear the flag and check limits normally.
                this.stickyUnlocked = false;
                sessionStorage.removeItem('cure_sticky_unlocked');
                sessionStorage.removeItem('cure_success_page_active');
                // Fall through to check limits
            } else {
                // Still within reward time in 'up' mode - protected
                return false;
            }
        }

        // Move Blacklist Check AFTER reward/sticky checks
        if (this.isBlacklisted()) return 'blocked';

        const triggers = this.settings.hardLockTriggers || {
            sessionLimit: { enabled: true, value: this.settings.hardLockDuration || 30 }
        };

        // Site Activity Limit
        if (triggers.sessionLimit?.enabled) {
            const limit = triggers.sessionLimit.value * 60;
            const window = triggers.sessionLimit.windowSeconds || 0;

            if (window === 0) {
                // Standard: Reset on site close
                if (this.activeSeconds >= limit) return 'limit';
            } else {
                // Rolling: Total time in window (Cold Turkey style)
                // Fix 59: windowedSiteSeconds is ALREADY incremented in stateMonitor every tick.
                // Do NOT add (this.dailySeconds - this.lastSyncedDailySeconds) again.
                if ((this.windowedSiteSeconds || 0) >= limit) return 'limit';
            }
        }

        // 2. Browser Screen Time (Global Rolling Window)
        if (triggers.browserLimit?.enabled) {
            const limit = triggers.browserLimit.value * 60;
            // Fix 59: windowedBrowserSeconds is ALREADY incremented in stateMonitor every tick.
            if ((this.windowedBrowserSeconds || 0) >= limit) return 'browserLimit';
        }

        return false;
    }

    shouldShowBreathingRoom(launchResponse) {
        // First check standard frequency
        const freq = this.settings.breathingFreq || 'always';
        const isWhitelisted = this.isWhitelisted();
        const pauseAllowedOnWhitelist = !!this.settings.pauseWhitelist;

        // If allowlisted and NOT allowed, never show
        if (isWhitelisted && !pauseAllowedOnWhitelist) return false;

        // FIX 123: Blacklist Enforcement.
        // Breathing Room (Take a Breath) should ONLY trigger on procrastination sites.
        if (!this.isBlacklisted()) return false;

        // Suppress if the user just disabled a lock or whitelisted
        if (this.suppressBreathingRoomOnce) {
            this.suppressBreathingRoomOnce = false;
            this.breathingRoomShownOnThisPage = true; // Count this "skipped" one as shown
            return false;
        }

        if (freq === 'always') {
            return !this.breathingRoomShownOnThisPage;
        }

        const hostname = window.location.hostname;
        const sessionKey = `cure_breathing_shown_${hostname}`;

        if (freq === 'first_visit') {
            if (sessionStorage.getItem(sessionKey)) return false;
            sessionStorage.setItem(sessionKey, '1');
            return true;
        }

        if (freq === 'skipping_reloads') {
            try {
                // Check if this navigation was a reload
                const nav = performance.getEntriesByType("navigation")[0];
                if (nav && nav.type === 'reload') {
                    return false; // Skip if reloading
                }
            } catch (e) {
                console.log('[Cure] Nav check failed', e);
            }
            return !this.breathingRoomShownOnThisPage;
        }

        return true;
    }


    getSettings() {
        return new Promise((resolve) => {
            if (!this.isContextValid()) return resolve({});
            this.safeSendMessage({ action: 'getSettings' }, (response) => {
                if (response && response.settings) {
                    resolve(response.settings);
                } else {
                    // Fallback to minimal safety defaults if background is slow
                    resolve({ masterPause: false, masterHardLock: true });
                }
            });
        });
    }

    isWhitelisted() {
        if (!this.settings?.whitelist || !Array.isArray(this.settings.whitelist)) return false;
        try {
            const currentHost = window.location.hostname.toLowerCase().trim();
            const currentHostNoWww = currentHost.replace(/^www\./, '');

            return this.settings.whitelist.some(site => {
                if (!site) return false;
                let cleanSite = site.trim().toLowerCase();
                // Remove protocol if present
                if (cleanSite.includes('://')) cleanSite = cleanSite.split('://')[1];
                // Remove path if present
                cleanSite = cleanSite.split('/')[0];
                // Remove www.
                const cleanSiteNoWww = cleanSite.replace(/^www\./, '');

                if (!cleanSiteNoWww) return false;

                // Match exact, match as subdomain, or match as parent domain
                return currentHostNoWww === cleanSiteNoWww ||
                    currentHostNoWww.endsWith('.' + cleanSiteNoWww) ||
                    cleanSiteNoWww.endsWith('.' + currentHostNoWww);
            });
        } catch (e) {
            console.error('[Cure] Whitelist check error:', e);
            return false;
        }
    }

    isBlacklisted() {
        if (!this.settings?.blacklist || !Array.isArray(this.settings.blacklist)) return false;
        try {
            const currentHost = window.location.hostname.toLowerCase().trim();
            const currentHostNoWww = currentHost.replace(/^www\./, '');

            return this.settings.blacklist.some(site => {
                if (!site) return false;
                let cleanSite = site.trim().toLowerCase();
                if (cleanSite.includes('://')) cleanSite = cleanSite.split('://')[1];
                cleanSite = cleanSite.split('/')[0];
                const cleanSiteNoWww = cleanSite.replace(/^www\./, '');

                if (!cleanSiteNoWww) return false;

                return currentHostNoWww === cleanSiteNoWww ||
                    currentHostNoWww.endsWith('.' + cleanSiteNoWww) ||
                    cleanSiteNoWww.endsWith('.' + currentHostNoWww);
            });
        } catch (e) {
            console.error('[Cure] Blacklist check error:', e);
            return false;
        }
    }

    isProductiveSite() {
        if (this.isWhitelisted()) return true;

        if (!this.settings?.shortcuts || !Array.isArray(this.settings.shortcuts)) return false;
        try {
            const currentUrl = window.location.href.toLowerCase();
            return this.settings.shortcuts.some(s => {
                if (!s?.url) return false;
                let cleanUrl = s.url.trim().toLowerCase();
                // Check if URL matches (very basic check)
                return currentUrl.includes(cleanUrl);
            });
        } catch (e) {
            return false;
        }
    }

    getSiteName() {
        let host = window.location.hostname;
        host = host.replace('www.', '');
        const parts = host.split('.');
        if (parts.length > 0) {
            return parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
        }
        return host;
    }

    getRandomQuote() {
        const quotes = [
            "You don't have to see the whole staircase, just take the first step.",
            "Done is better than perfect.",
            "One day or day one. You decide.",
            "Your future self is watching you right now through memories.",
            "Stop scrolling. Start living.",
            "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.",
            "Small daily improvements are the key to staggering long-term results.",
            "The way to get started is to quit talking and begin doing.",
            "A year from now you may wish you had started today.",
            "Action is the foundational key to all success."
        ];
        return quotes[Math.floor(Math.random() * quotes.length)];
    }

    getRandomChallenge(targetWords) {
        const challenges = [
            "The only way to do great work is to love what you do.",
            "Perseverance is not a long race; it is many short races one after the other.",
            "Success is stumbling from failure to failure with no loss of enthusiasm.",
            "What we achieve inwardly will change outer reality.",
            "Focus on being productive instead of busy.",
            "Amateurs sit and wait for inspiration, the rest of us just get up and go to work.",
            "Self-discipline is the magic power that makes you virtually unstoppable.",
            "Your time is limited, so don't waste it living someone else's life.",
            "Do what you have to do until you can do what you want to do.",
            "Discipline is the bridge between goals and accomplishment.",
            "The future depends on what you do today.",
            "Don't watch the clock; do what it does. Keep going.",
            "You cannot escape the responsibility of tomorrow by evading it today.",
            "It is always the simple that produces the marvelous.",
            "Action is the foundational key to all success."
        ];

        // Fix 78: Precise Word Count Generation.
        // Pool random sentences together, then slice to EXACTLY targetWords.
        let wordPool = [];
        while (wordPool.length < targetWords) {
            const randomSentence = challenges[Math.floor(Math.random() * challenges.length)];
            const sentenceWords = randomSentence.split(/\s+/);
            wordPool.push(...sentenceWords);
        }

        // Slice to exact length and join
        const finalized = wordPool.slice(0, targetWords).join(' ');
        return normalizeTypingText(finalized);
    }

    // --- STATE 1: BREATHING ROOM ---
    stateBreathingRoom(reason = 'standard', forced = false) {
        let message = "Take a breath.";
        if (reason === 'launch') message = `Pause: You've visited ${this.settings.pauseTriggers?.launchLimit?.value || 5} times recently.`;
        if (reason === 'browser') message = `Pause: You've been browsing for over ${this.settings.pauseTriggers?.browserLimit?.value || 120} mins today.`;

        // Mark as shown for the frequency-based triggers to avoid re-triggering on settings update
        if (reason === 'freq' || reason === 'standard') {
            this.breathingRoomShownOnThisPage = true;
        }

        this.renderOverlay('breathing', message, forced);
        MediaController.pauseAll(); // Pause media immediately

        const duration = this.settings.breathingRoomDuration || 7;
        
        // RELOAD LOOP PREVENTION
        // Persist start time to allow reloads without resetting the timer
        const storageKey = `cure_breath_start_${window.location.hostname}`;
        const now = Date.now();
        let startTime = parseInt(sessionStorage.getItem(storageKey));

        // If no start time, or previously finished (elapsed > duration), start fresh
        // but if it's a reload during countdown, we resume.
        let elapsed = 0;
        if (startTime) {
            elapsed = Math.floor((now - startTime) / 1000);
        }

        // If elapsed is invalid or complete, reset
        if (!startTime || elapsed >= duration) {
            startTime = now;
            elapsed = 0;
            sessionStorage.setItem(storageKey, startTime.toString());
        }

        let timeLeft = Math.max(0, duration - elapsed);


        if (!this.shadowRoot) return;
        const btnText = this.shadowRoot.getElementById('cure-btn-text');
        const fill = this.shadowRoot.getElementById('cure-progress-fill');
        const btn = this.shadowRoot.getElementById('cure-continue-btn');

        if (btnText) btnText.textContent = `Continue in ${timeLeft}`;
        if (fill) {
             const pct = ((duration - timeLeft) / duration) * 100;
             fill.style.width = `${pct}%`;
        }

        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }

        this.countdownInterval = setInterval(() => {
            // Recalculate based on real time to avoid drift
            const realElapsed = Math.floor((Date.now() - startTime) / 1000);
            timeLeft = Math.max(0, duration - realElapsed);

            if (btnText) btnText.textContent = `Continue in ${timeLeft}`;

            if (fill) {
                const pct = ((duration - timeLeft) / duration) * 100;
                fill.style.width = `${pct}%`;
            }

            if (timeLeft <= 0) {
                clearInterval(this.countdownInterval);
                this.countdownInterval = null;

                if (btnText) btnText.textContent = `Continue to ${this.getSiteName()}`;
                if (btn) {
                    btn.classList.remove('counting');
                    btn.onclick = async () => {
                        this.removeOverlay();
                        this.stateMonitor();
                    };
                }
            }
        }, TIMERS.COUNTDOWN_INTERVAL_MS);
    }

    // --- PERSISTENCE ---
    async loadTimer() {
        if (!this.isContextValid()) return;
        const key = `cure_timer_${window.location.hostname}`;

        return new Promise(resolve => {
            chrome.storage.local.get([key], (result) => {
                const saved = result[key];
                if (saved) {
                    try {
                        const { timestamp, seconds, mode } = saved;
                        const timeoutMs = ((this.settings || {}).sessionTimeoutMins || 30) * 60 * 1000;
                        // Restore if session is recent
                        if (Date.now() - timestamp < timeoutMs) {
                            this.activeSeconds = saved.seconds || 0;
                            this.mode = saved.mode || 'up';
                            this.sessionBaseSeconds = saved.sessionBaseSeconds || 0;
                            this.originalRewardSeconds = saved.originalRewardSeconds || 0;
                        }

                        // Fix 74: Load sticky success from session storage for instant reload protection
                        if (sessionStorage.getItem('cure_sticky_unlocked') === 'true') {
                            this.stickyUnlocked = true;
                        }
                    } catch (e) {
                        console.error('[Cure] Load timer error:', e);
                    }
                }
                resolve();
            });
        });
    }

    saveTimer() {
        if (!this.isContextValid()) return;
        if (this.isIframe) return; // FIX 86: No timer saving in iframes
        if (this._resetGuard) return; // FIX 126: Prevent zombie state saving during reset
        const key = `cure_timer_${window.location.hostname}`;
        const now = Date.now();

        const data = {
            timestamp: now,
            seconds: this.activeSeconds,
            mode: this.mode,
            sessionBaseSeconds: this.sessionBaseSeconds,
            originalRewardSeconds: this.originalRewardSeconds
        };

        chrome.storage.local.set({ [key]: data });
        this.lastSaveTime = now;
    }

    flushPassiveRewards() {
        if (!this.passiveDelta || this.passiveDelta <= 0) return;

        const pr = this.settings.passiveReward;
        if (!pr || !pr.enabled) {
            this.passiveDelta = 0;
            return;
        }

        this.safeSendMessage({
            action: 'trackPassiveReward',
            deltaSeconds: this.passiveDelta,
            threshold: pr.threshold || 1800,
            reward: pr.reward || 300
        }, (response) => {
            // Only show toast if actually earned something
            if (response && response.earned > 0) {
                const mins = Math.ceil(response.earned / 60);
                this.showToast(`+${mins}m Earned 🍏`, 'success');
            }
        });

        this.passiveDelta = 0;
        this.lastPassiveSync = Date.now();
    }

    syncDailyStats() {
        if (!this.isContextValid()) return Promise.resolve();
        const host = window.location.hostname;
        const settings = this.settings || {};

        if (this.lastSyncedDailySeconds === undefined) this.lastSyncedDailySeconds = this.dailySeconds;
        if (this.lastSyncedBrowserSeconds === undefined) this.lastSyncedBrowserSeconds = this.browserSeconds;

        const deltaDaily = this.dailySeconds - this.lastSyncedDailySeconds;
        const deltaBrowser = this.browserSeconds - this.lastSyncedBrowserSeconds;

        if (deltaDaily > 0 || deltaBrowser > 0) {
            this.safeSendMessage({
                action: 'trackUsage',
                hostname: host,
                deltaSiteSeconds: deltaDaily,
                deltaBrowserSeconds: deltaBrowser
            });
            this.lastSyncedDailySeconds = this.dailySeconds;
            this.lastSyncedBrowserSeconds = this.browserSeconds;
        }

        const triggers = settings.hardLockTriggers || {};
        return new Promise(resolve => {
            // Fetch Windowed Usage
            this.safeSendMessage({
                action: 'getWindowedUsage',
                hostname: host,
                siteWindowSeconds: triggers.sessionLimit?.windowSeconds || 0,
                browserWindowSeconds: triggers.browserLimit?.windowSeconds || 86400
            }, (res) => {
                if (res) {
                    this.windowedSiteSeconds = res.siteSeconds;
                    this.windowedBrowserSeconds = res.browserSeconds;
                }
                
                // ALSO Fetch/Verify Launch Status for complete evaluation
                this.safeSendMessage({ 
                    action: 'trackLaunch', 
                    hostname: window.location.hostname 
                }, (launchRes) => {
                    const combined = { ...(res || {}), ...(launchRes || {}) };
                    resolve(combined);
                });
            });
        });
    }

    // --- STATE 2: THE MONITOR ---
    /**
     * The heartbeat of the extension. Tracks time and enforces limits.
     * Reactive: Dynamically adapts to whitelist/settings changes without restarting.
     */
    stateMonitor() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        const runTick = () => {
            if (document.hidden) {
                this.lastTickTime = performance.now(); // Reset baseline when hidden
                return;
            }
            // Calculate precise delta using monotonic clock
            const nowTick = performance.now();
            const deltaMs = nowTick - (this.lastTickTime || nowTick);

            // Convert to seconds (cumulative if delta > 1s due to throttling)
            const deltaSecs = Math.floor(deltaMs / 1000);
            
            if (deltaSecs >= 1) {
                // Update baseline by consumed seconds to maintain precision and prevent drift
                this.lastTickTime += deltaSecs * 1000;

                // --- TRACKING ---
                this.dailySeconds += deltaSecs;
                this.browserSeconds += deltaSecs;

                if (this.mode === 'up') {
                    this.activeSeconds += deltaSecs;
                } else {
                    // REWARD MODE
                    this.activeSeconds -= deltaSecs;
                    // FIX 81: Clamp to 0 to prevent negative display (lock check happens below)
                    if (this.activeSeconds < 0) this.activeSeconds = 0;
                }
            }

            // --- REACTIVE STATE EVALUATION ---
            const isWhitelisted = this.isWhitelisted();
            const masterHardLockOn = this.settings.masterHardLock !== false;
            const masterPauseOn = this.settings.masterPause !== false;
            
            // Hard Lock is effective if not whitelisted and master switch is ON
            const hardLockEffective = !isWhitelisted && masterHardLockOn;
            // Pause is effective if (not whitelisted OR pauseWhitelist is TRUE) and master switch is ON
            const pauseEffective = ( !isWhitelisted || !!this.settings.pauseWhitelist ) && masterPauseOn;

            // Global flags for tracking/blocking logic
            const blockingEnabled = hardLockEffective;

            // --- TRIGGER CHECK (Every Tick for High Precision) ---
            
            // FIX 93/YouTube: Fail-safe Polling for Progress Reset
            // If visibilitychange failed to re-render, this will catch it.
            if (this.isTypingChallengeActive && !this.isIframe) {
                this.safeSendMessage({ action: 'checkResetStatus', hostname: window.location.hostname }, (res) => {
                    if (res && res.needsReset) {
                        this.stateHardLock('limit', true);
                    }
                });
            }

            if (blockingEnabled && this.mode === 'up') {
                // Update local windowed counts for instant second-level precision (especially for rolling windows)
                if (deltaSecs >= 1) {
                    this.windowedSiteSeconds = (this.windowedSiteSeconds || 0) + deltaSecs;
                    this.windowedBrowserSeconds = (this.windowedBrowserSeconds || 0) + deltaSecs;
                }

                // FIX: Stability Guard. 
                // Skip trigger checks (re-renders) if the user is in the middle of a typing challenge.
                // This prevents the "heartbeat" from erasing their progress.
                if (this.isTypingChallengeActive) return;

                const trigger = this.checkAnyTrigger();
                if (trigger) {
                    // console.log('[Cure] Trigger Found:', trigger);
                    this.stateHardLock(trigger === true ? null : trigger);
                    return;
                }
            } else if (blockingEnabled && this.mode === 'down' && this.activeSeconds <= 0) {
                 // FIX 81: Clear sticky unlock flags so reward expiry can trigger lock
                 this.stickyUnlocked = false;
                 sessionStorage.removeItem(`cure_sticky_unlocked_${window.location.hostname}`);
                 sessionStorage.removeItem('cure_success_page_active');
                 // Reset mode to up and clear reward tracking
                 this.mode = 'up';
                 this.activeSeconds = 0;
                 this.sessionBaseSeconds = 0;
                 this.originalRewardSeconds = 0;
                 this.saveTimer();
                 // Clear background lock state too
                 if (this.isContextValid()) {
                     this.safeSendMessage({ action: 'clearLockState', hostname: window.location.hostname });
                 }
                 
                 this.stateHardLock('rewardExpired');
                 return;
            }

            // --- HEARTBEAT SYNC (Every 10s) ---
            if (deltaSecs >= 1 && (this.activeSeconds % 10 === 0 || Date.now() - (this.lastSyncTimestamp || 0) > 10000)) {
                this.lastSyncTimestamp = Date.now();
                this.syncDailyStats();
            }

            // --- REACTIVE UI SYNC ---
            this.forceRefreshUI();

            // Special case: If we are currently showing a block overlay but it's now "Safe", remove it instantly
            const root = this.ensureShadow();
            const hasOverlay = root && root.getElementById(this.overlayId);

            if (hasOverlay && !hardLockEffective && !pauseEffective) {
                this.safeSendMessage({ action: 'getLockState', hostname: window.location.hostname }, (res) => {
                    if (!res || !res.locked) {
                        this.removeOverlay();
                        this.updatePill(); // Ensure pill is restored after overlay removal
                    }
                });
            }

            // --- PASSIVE REWARD ACCRUAL (BATCHED) ---
            const pr = (this.settings || {}).passiveReward;
            if (pr && pr.enabled && this.isProductiveSite() && deltaSecs >= 1) {
                this.passiveDelta += deltaSecs; 
                if (Date.now() - this.lastPassiveSync > this.PASSIVE_SYNC_MS) {
                    this.flushPassiveRewards();
                }
            }

            // Sync stats occasionally
            if (Date.now() - this.lastSaveTime > TIMERS.SAVE_INTERVAL_MS && deltaSecs >= 1) {
                this.saveTimer();
                if (blockingEnabled) this.syncDailyStats();
            }

            // --- FOCUS REMINDERS ---
            const remindersOn = (this.settings || {}).masterReminders !== false;
            if (remindersOn && deltaSecs >= 1) {
                let rInt = (this.settings.reminderInterval || 15) * 60;
                if (rInt < 60) rInt = 60;

                if (this.mode === 'up' && this.activeSeconds > 0 && this.activeSeconds % rInt === 0) {
                    const mins = Math.floor(this.activeSeconds / 60);
                    const rStyle = this.settings.reminderStyle || 'overlay';
                    const allowWhite = !!this.settings.reminderWhitelist;

                    if (!isWhitelisted || allowWhite) {
                        if (rStyle === 'overlay') {
                            this.renderReminderOverlay(mins, 'time');
                            MediaController.pauseAll();
                        } else {
                            const site = this.getSiteName();
                            this.showToast(`${site}: ${mins}m ⚠️`, 'warning');
                        }
                    }
                }

                // Global Reminders check (Browser/Launch)
                if (this.activeSeconds % 30 === 0 && this.isContextValid()) {
                    this.safeSendMessage({ action: 'trackLaunch', hostname: window.location.hostname }, (launchRes) => {
                        if (!launchRes) return;
                        const rTriggers = this.settings.reminderTriggers || {};
                        const rStyle = this.settings.reminderStyle || 'overlay';
                        
                        // Reminders for Browser Limit
                        if (rTriggers.browserLimit?.enabled && launchRes.browserSeconds) {
                            const limitSecs = rTriggers.browserLimit.value * 60;
                            const hasShown = sessionStorage.getItem('cure_remind_browser_shown');
                            if (launchRes.browserSeconds >= limitSecs && !hasShown) {
                                if (isWhitelisted && !this.settings.reminderWhitelist) return;

                                if (rStyle === 'overlay') {
                                    this.renderReminderOverlay(Math.floor(launchRes.browserSeconds / 60), 'browser');
                                    MediaController.pauseAll();
                                } else {
                                    this.showToast('Daily Limit! ⚠️', 'warning');
                                }
                                sessionStorage.setItem('cure_remind_browser_shown', '1');
                            }
                        }

                        // Reminders for Launch Limit
                        if (rTriggers.launchLimit?.enabled && launchRes.currentLaunches) {
                            const limit = rTriggers.launchLimit.value;
                            const hasShown = sessionStorage.getItem('cure_remind_launch_shown');
                            if (launchRes.currentLaunches >= limit && !hasShown) {
                                if (isWhitelisted && !this.settings.reminderWhitelist) return;

                                if (rStyle === 'overlay') {
                                    this.renderReminderOverlay(launchRes.currentLaunches, 'launch');
                                    MediaController.pauseAll();
                                } else {
                                    this.showToast('Visit Limit! ⚠️', 'warning');
                                }
                                sessionStorage.setItem('cure_remind_launch_shown', '1');
                            }
                        }
                    });
                }
            }
        };

        this.lastTickTime = performance.now();
        runTick(); // Immediate execution for responsive UI
        this.timerInterval = setInterval(runTick, 1000);
    }

    abortTimerChallenge() {
        this.isTypingChallengeActive = false;
        // Notify background to clear BOTH tab tracking and hostname reset flags
        this.safeSendMessage({ action: 'challengeFinished', hostname: window.location.hostname });
        sessionStorage.removeItem('cure_typing_active_session');
    }

    unlockSession(mins) {
        // Fix 70/72/74: Atomic Background Victory.
        // We send ONE message that clears the lock, clears the penalty flag, and consumes rewards.
        this.abortTimerChallenge();
        
        if (this.isContextValid()) {
            // Fix 74: Set local flag FIRST so immediate evaluateAllTriggers (on next tick) knows we are safe.
            this.stickyUnlocked = true;
            sessionStorage.setItem('cure_success_page_active', 'true');
            sessionStorage.setItem('cure_sticky_unlocked', 'true');

            this.safeSendMessage({ action: 'finishChallenge', hostname: window.location.hostname }, (response) => {
                const extraSeconds = (response && response.consumed) || 0;

                // Prepare timer mode locally
                // FIX 120: Timer Preservation - Don't reset to 0, keep the time spent.
                if (this.settings.masterHardLock === false || this.isWhitelisted()) {
                    // Strict Lock is OFF or site is whitelisted - just continue counting up.
                    // DO NOT reset activeSeconds, keep the time already accumulated.
                    this.mode = 'up';
                    // FIX 124: Clear reward tracking so it doesn't interfere when re-locking later
                    this.sessionBaseSeconds = 0;
                    this.originalRewardSeconds = 0;
                } else if (this.settings.unlockRewardType === 'session' || this.settings.unlockRewardType === 'unlimited') {
                    // Session/Unlimited mode - also just count up, but from 0 as a new "session" conceptually.
                    // For these, resetting makes sense as they're session-based, not time-based.
                    this.mode = 'up'; 
                    this.activeSeconds = 0;
                } else {
                    // Time-based reward: Switch to countdown mode
                    this.sessionBaseSeconds = this.activeSeconds;
                    this.originalRewardSeconds = (mins * 60) + extraSeconds;
                    this.activeSeconds = this.originalRewardSeconds;
                    this.mode = 'down';
                }
                this.saveTimer();
                
                // FIX 125: Broadcast unlock locally to catch any frames currently enforcing media
                this.safeSendMessage({
                    action: 'broadcastLockState',
                    locked: false,
                    hostname: window.location.hostname
                });
            });
        }

        this.renderSuccess(mins);
    }

    resetTempUnlockStates() {
        this.tempDelayComplete = false;
        this.tempDelayStart = null;
        this.tempPasswordComplete = false;
    }

    confirmUnlock(mins) {
        if (!this.isContextValid()) {
            this.removeOverlay();
            location.reload();
            return;
        }

        // Fix 72/73: The unlocking already happened in unlockSession.
        // This button now just cleans up the UI.
        sessionStorage.removeItem('cure_success_page_active');

        // FIX: Auto-Close Challenge Tab
        // If this tab was opened specifically to unlock a video embed,
        // we close it automatically to keep the workspace clean.
        if (window.location.search.includes('cure_challenge=true')) {
            this.renderOverlay('locked', 'Closing challenge tab...');
            const msg = document.createElement('div');
            msg.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); color:white; font-size:24px; z-index:2147483647; text-align:center;';
            msg.innerHTML = '✨ Success! <br><span style="font-size:16px; opacity:0.8;">Returning you to your page...</span>';
            document.body.appendChild(msg);

            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'closeMyTab' });
            }, 1500);
            return;
        }
        
        if (this.settings.unlockRewardType === 'session' || this.settings.unlockRewardType === 'unlimited') {
             this.safeSendMessage({ action: 'startRewardSession', hostname: window.location.hostname }, () => {
                this.mode = 'up'; 
                this.activeSeconds = 0;
                location.reload(); 
            });
        } else {
            this.resetTempUnlockStates();
            this.removeOverlay();
            this.stateMonitor();
        }
    }


    stateHardLock(reason = 'limit', forced = false) {
        if (!this.isContextValid()) return;
        
        // FIX: Idempotency Guard. 
        // Prevents the "heartbeat" gong sound and screen flicker every 1 second.
        if (this.activeIntervention === 'locked' && !forced) return;
        
        // Fix 94: Play sound ONLY on initialization, not on every heartbeat tick.
        if (this.settings.soundEnabled !== false) SoundEngine.playChime('error');

        // FIX 81: Removed stickyUnlocked check here.
        // The proper protection logic is now in checkAnyTrigger(),
        // which clears stickyUnlocked when reward time is consumed.

        // Fix 63: Idempotency check.
        // Ultimate safeguard: never show strict lock if allowlisted or master switch is OFF
        // UNLESS it is a forced sticky lock (user must complete challenge)
        if (!forced) {
            if (this.isWhitelisted() || this.settings.masterHardLock === false) {
                this.removeOverlay();
                return;
            }
        }

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.countdownInterval) {
            clearInterval(this.countdownInterval);
            this.countdownInterval = null;
        }
        this.removePill(); // Authority safeguard: pill MUST be gone

        // PERSIST LOCK STATE (Prevents refresh bypass)
        const triggers = this.settings.hardLockTriggers || {};
        const windowSeconds = triggers.sessionLimit?.windowSeconds || 86400;

        this.safeSendMessage({
            action: 'setLockState',
            hostname: window.location.hostname,
            windowSeconds: windowSeconds,
            reason: reason || 'limit'
        });

        // BROADCAST to other frames (Cross-frame Media Pause)
        this.safeSendMessage({
            action: 'broadcastLockState',
            locked: true,
            hostname: window.location.hostname
        });

        const hardLimitMins = (this.settings.hardLockDuration || 30);
        this.activeIntervention = 'locked';
        MediaController.startEnforcement();

        this.renderOverlay('locked', reason, forced);
    }

    // --- STYLES (SHADOW DOM) ---
    // =========================================================================
    // REGRESSION GUARD: VISUAL TOAST RENDERER ("NUCLEAR OPTION")
    // CRITICAL: Uses inline styles to bypass Shadow DOM isolation issues.
    // 1. Do NOT move CSS to external file.
    // 2. Do NOT change z-index (must be max).
    // 3. Animation keyframes must be injected into Shadow Root.
    // =========================================================================
    /* SURGICAL FEATURE: TOAST_UI (The Global Notification System) */
    showToast(msg, type = 'info') {
        // FIX 115: Removed isIframe check. 
        const root = this.ensureShadow();

        // Remove existing popout if any
        const existing = root.getElementById('cure-popout-notification');
        if (existing) existing.remove();

        const popout = document.createElement('div');
        popout.id = 'cure-popout-notification';
        popout.dataset.type = type;

        // Inject Keyframes for Pulse INSIDE Shadow Root for isolation success
        if (!root.getElementById('cure-pulse-style-final')) {
            const style = document.createElement('style');
            style.id = 'cure-pulse-style-final';
            // FIX: Trusted Types compatibility (use textContent)
            style.textContent = `
                @keyframes cure-pulse-nuclear {
                    0% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.7); transform: translateX(-50%) scale(1); }
                    70% { box-shadow: 0 0 0 15px rgba(255, 59, 48, 0); transform: translateX(-50%) scale(1.02); }
                    100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); transform: translateX(-50%) scale(1); }
                }
            `;
            root.appendChild(style);
        }

        popout.style.cssText = `
            position: fixed;
            bottom: 35px;
            left: 50%;
            transform: translateX(-50%);
            background: ${ (type === 'warning' || type === 'error') ? '#FF3B30' : '#007AFF' };
            color: white;
            padding: 8px 16px;
            border-radius: 50px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 10px;
            opacity: 0; 
            transition: opacity 0.3s ease, transform 0.3s ease;
            white-space: nowrap;
            pointer-events: auto;
            animation: cure-pulse-nuclear 2s infinite;
        `;


        // Inner HTML replaced with DOM construction for Trusted Types (YouTube Fix)
        const msgSpan = document.createElement('span');
        msgSpan.textContent = msg;
        popout.appendChild(msgSpan);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        closeBtn.style.cssText = "background:rgba(255,255,255,0.2); border:none; width:20px; height:20px; border-radius:50%; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:12px; flex-shrink:0;";
        
        // Handle Close Button Click
        closeBtn.onclick = () => {
            popout.style.opacity = '0';
            setTimeout(() => { if (popout.parentElement) popout.remove(); }, 300);
        };
        popout.appendChild(closeBtn);

        // Fix 113: Always append as last child
        root.appendChild(popout);
        
        // Animate in
        setTimeout(() => {
            popout.style.opacity = '1';
        }, 50);

        // FIX: REMOVE AUTO-DISMISS. 
        // User requested it to NOT disappear automatically ("As if I pressed X").
        // It stays until they dismiss it or start typing (which calls dismissToast).


    }


    /* SURGICAL FEATURE: SHADOW_DOM (Styles and Foundation) */
    ensureShadow() {
        // Ensure host is still connected to the DOM
        if (this.shadowHost && !document.contains(this.shadowHost)) {
            this.shadowHost = null;
            this.shadowRoot = null;
        }

        if (this.shadowRoot) return this.shadowRoot;

        // Wait for body to exist
        if (!document.body) return null;

        let host = document.getElementById('cure-root');
        if (!host) {
            host = document.createElement('div');
            host.id = 'cure-root';
            // Fix 67/68: Use full-screen click-through host. pointer-events: none is critical!
            host.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 100%; height: 100%; z-index: 2147483647; pointer-events: none; opacity: 1;';
            document.body.appendChild(host);
        }
        
        // Fix 71: Stacking Reinforcement.
        // On sites like Gmail/YouTube, new elements can be appended after us with high Z-indices.
        // We ensure we are always the last child of the body to win the stacking context tie-breaker.
        if (host.nextElementSibling) {
            document.body.appendChild(host); 
        }

        // Fix 68: Ultra-lazy check for style integrity.
        if (host.style.position !== 'fixed' || 
            host.style.width !== '100%' || 
            host.style.height !== '100%' || 
            host.style.pointerEvents !== 'none' || 
            host.style.opacity !== '1' ||
            host.style.zIndex !== '2147483647') {
            
            host.style.position = 'fixed';
            host.style.width = '100%';
            host.style.height = '100%';
            host.style.pointerEvents = 'none';
            host.style.opacity = '1';
            host.style.zIndex = '2147483647';
        }
        this.shadowHost = host;

        if (!host.shadowRoot) {
            this.shadowRoot = host.attachShadow({ mode: 'open' });

            // Inject Styles
            try {
                if (!this.isContextValid()) return this.shadowRoot;
                const link = document.createElement('link');
                link.setAttribute('rel', 'stylesheet');
                // Cache bust to ensure latest styles are loaded
                link.setAttribute('href', chrome.runtime.getURL(`overlay.css?t=${Date.now()}`));

                // Show host only after styles are ready
                link.onload = () => { host.style.opacity = '1'; };
                link.onerror = () => { host.style.opacity = '1'; }; // Fallback

                this.shadowRoot.appendChild(link);
            } catch (e) {
                // Ignore context invalidated across updates
                if (!e.message?.includes('context invalidated')) {
                    console.error('[Cure] Style injection failed:', e);
                }
                host.style.opacity = '1'; // Fallback
            }
        } else {
            this.shadowRoot = host.shadowRoot;
            host.style.opacity = '1';
        }

        return this.shadowRoot;
    }

    // --- HELPER: REMOVE OVERLAY --
    removeOverlay() {
        if (this.shadowRoot) {
            const o = this.shadowRoot.getElementById(this.overlayId);
            if (o) o.remove();

            // IMMEDIATELY restore pill if we are no longer blocking
            const settings = this.settings || {};
            if (settings.showTimerPill !== false && !this.isBlacklisted()) {
                this.activeIntervention = null;
                this.updatePill();
            }
        }
        document.body.style.overflow = '';
        this.handleChallengeBeaten();
    }

    handleChallengeBeaten(mins = 5) {
        this.activeIntervention = null;
        this.abortTimerChallenge();
        // Fix 77: Removed redundant flag reset here.
        MediaController.stopEnforcement();
    }

    renderIframeBlocked(root, reason = null) {
        if (!root) return;
        
        // FIX: Re-render Guard for Iframes.
        // Prevents the heartbeat from wiping the button while you are trying to click it.
        const existing = root.getElementById(this.overlayId);
        if (existing && existing.dataset.mode === 'locked' && existing.dataset.reason === (reason || 'limit')) {
            return;
        }

        this.activeIntervention = 'locked';
        // Stop media immediately
        MediaController.startEnforcement();

        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.id = this.overlayId;
        overlay.dataset.mode = 'locked';
        overlay.dataset.reason = reason || 'limit';
        // Responsive Layout for embeds (often small)
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(245, 245, 247, 0.98); 
            backdrop-filter: blur(10px);
            z-index: 2147483648;
            pointer-events: auto;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            padding: 10px; box-sizing: border-box; text-align: center;
            color: #1d1d1f; user-select: none;
        `;
        
        // Reason-based labels
        let label = "Session Limit Reached";
        if (reason === 'blocked') label = "Site Blocked";
        else if (reason === 'launchLimit') label = "Launch Limit Reached";
        else if (reason === 'browserLimit') label = "Browser Limit Reached";
        else if (reason === 'pause') label = "Take a Breath";
        
        overlay.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
                <div style="font-size: min(40px, 10vw); margin-bottom: 8px;">🔒</div>
                <div style="font-size: min(16px, 4vw); font-weight: 700; line-height: 1.2; padding: 0 5px;">${label}</div>
                <div class="cure-iframe-hide-small" style="font-size: 11px; opacity: 0.6; margin-top: 6px;">Complete challenge in new tab to unlock</div>
                <button id="cure-iframe-unlock-btn" style="
                    margin-top: 12px; font-size: min(13px, 3.5vw); color: #ffffff;
                    font-weight: 600; background: #1d1d1f; padding: 8px 16px; border-radius: 12px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.15); border: none; cursor: pointer;
                    transition: all 0.2s ease;
                ">Unlock →</button>
                <style>
                    @media (max-height: 120px) {
                        .cure-iframe-hide-small { display: none !important; }
                    }
                </style>
            </div>
        `;
        
        root.appendChild(overlay);
        
        const btn = overlay.querySelector('#cure-iframe-unlock-btn');
        if (btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const originalText = btn.innerText;
                btn.innerText = "Opening Challenge...";
                btn.style.opacity = "0.7";
                btn.disabled = true;
                
                // Extract the base site URL from iframe src
                const hostname = window.location.hostname;
                let targetUrl = `https://${hostname}`;

                // FIX: Deep-Link Unlocking for YouTube
                // If this is a YouTube embed, open the specific video instead of the homepage.
                if (hostname.includes('youtube.com') || hostname.includes('youtube-nocookie.com')) {
                    const path = window.location.pathname;
                    const match = path.match(/\/embed\/([^/?]+)/);
                    if (match && match[1]) {
                        targetUrl = `https://www.youtube.com/watch?v=${match[1]}`;
                    }
                }

                // Add the auto-close flag to the URL
                const joinChar = targetUrl.includes('?') ? '&' : '?';
                targetUrl += `${joinChar}cure_challenge=true`;
                
                // FIX 102: Always use background script to open tab.
                // This bypasses iframe sandbox restrictions (allow-popups) and popup blockers.
                try {
                    chrome.runtime.sendMessage({ 
                        action: 'openTab', 
                        url: targetUrl 
                    }, (res) => {
                        if (chrome.runtime.lastError) {
                            btn.innerText = "Error - Refresh!";
                            console.error('[Cure] Iframe unlock failed:', chrome.runtime.lastError);
                        }
                    });
                } catch (err) {
                    btn.innerText = "Error!";
                    console.error('[Cure] Runtime connection lost:', err);
                }

                // Fallback: If no response in 3s, reset button
                setTimeout(() => {
                    if (btn.innerText === "Opening Challenge...") {
                        btn.innerText = originalText;
                        btn.style.opacity = "1";
                        btn.disabled = false;
                    }
                }, 3000);
            };
        }
    }

    removePill() {
        if (this.shadowRoot) {
            const p = this.shadowRoot.getElementById(this.pillId);
            if (p) p.remove();
        }
    }

    renderPill() {
        if (!this.isContextValid()) return;
        const root = this.ensureShadow();
        if (!root || root.getElementById(this.pillId)) return;
        const pill = document.createElement('div');
        pill.id = this.pillId;
        pill.innerHTML = `<span style="font-size:14px;">⏳</span> <span id="cure-time-text">0min 00sec</span>`;
        root.appendChild(pill);
    }

    updatePill() {
        if (window.self !== window.top || !this.stateInitialized) return;

        // Authority: Check visibility logic before doing ANY rendering
        if (!this.shouldShowPill()) {
            this.removePill();
            return;
        }

        // Ensure shadow host and root exist
        const root = this.ensureShadow();
        if (!root) return;

        // Render pill structure if missing
        this.renderPill();
        if (!this.shadowRoot) return;
        const timeSpan = this.shadowRoot.getElementById('cure-time-text');
        if (!timeSpan) return;

        const val = this.activeSeconds;
        const absVal = Math.abs(val);
        const days = Math.floor(absVal / 86400);
        const hrs = Math.floor((absVal % 86400) / 3600);
        const mins = Math.floor((absVal % 3600) / 60);
        const secs = absVal % 60;

        // NEW FORMAT: 1d 2h 3m 4s
        let timeStr = "";
        if (days > 0) timeStr += `${days}d `;
        if (hrs > 0 || days > 0) timeStr += `${hrs}h `;
        timeStr += `${mins}m ${secs.toString().padStart(2, '0')}s`;

        timeSpan.classList.remove('cure-time-neutral', 'cure-time-safe', 'cure-time-warn', 'cure-time-danger', 'cure-anim-pulse');

        if (this.mode === 'up') {
            timeSpan.textContent = `+${timeStr}`;

            const triggers = this.settings.hardLockTriggers || {};
            const sessionTrigger = triggers.sessionLimit || { enabled: false, value: 30 };
            const browserTrigger = triggers.browserLimit || { enabled: false, value: 480 };

            // NEUTRAL STATE: Master off, Whitelisted, or NO triggers enabled for this site
            const isWhitelisted = this.isWhitelisted();
            const isBlacklisted = this.isBlacklisted();
            const anyLimitEnabled = sessionTrigger.enabled || browserTrigger.enabled || isBlacklisted;

            if (this.settings.masterHardLock === false || isWhitelisted || !anyLimitEnabled) {
                timeSpan.classList.add('cure-time-neutral');
                return;
            }

            // Launch Count Status
            const launchConfig = triggers.launchLimit || {};
            if (launchConfig.enabled && this.lastLaunchResponse) {
                const res = this.lastLaunchResponse;
                if (res.sessionActive) {
                    timeSpan.textContent = `Launch [${res.remaining}/${res.total}]`;
                    timeSpan.classList.add('cure-time-safe');
                    return;
                }
            }

            // Calculate progress towards the most imminent limit
            let maxPct = 0;
            if (sessionTrigger.enabled) {
                const sPct = (val / (sessionTrigger.value * 60)) * 100;
                maxPct = Math.max(maxPct, sPct);
            }
            if (browserTrigger.enabled) {
                // browserSeconds is total today, windowedBrowserSeconds is rolling
                const bVal = (browserTrigger.windowSeconds === 86400) ? this.browserSeconds : this.windowedBrowserSeconds;
                const bPct = (bVal / (browserTrigger.value * 60)) * 100;
                maxPct = Math.max(maxPct, bPct);
            }

            if (maxPct >= 90) timeSpan.classList.add('cure-time-danger', 'cure-anim-pulse');
            else if (maxPct >= 80) timeSpan.classList.add('cure-time-danger');
            else if (maxPct >= 50) timeSpan.classList.add('cure-time-warn');
            else timeSpan.classList.add('cure-time-safe');

        } else {
            // Reward Time Mode (Counting down)
            timeSpan.textContent = `-${timeStr}`;

            // If whitelisted, reward time is just a passive counter
            if (this.isWhitelisted()) {
                timeSpan.classList.add('cure-time-neutral');
                return;
            }

            // Stay green longer (until last 2 mins), warn at 1 min, pulse in last 30s
            if (val > 120) timeSpan.classList.add('cure-time-safe');
            else if (val > 60) timeSpan.classList.add('cure-time-warn');
            else if (val > 30) timeSpan.classList.add('cure-time-danger');
            else timeSpan.classList.add('cure-time-danger', 'cure-anim-pulse');
        }
    }

    renderOverlay(mode, message = "Take a breath.", forced = false) {
        // FIX 108: Ultimate Whitelist Safety
        if (this.isWhitelisted() && !forced) {
            this.removeOverlay();
            return;
        }

        // FIX 100: Iframes should COMPLETELY SKIP pause/breathing/reminder screens.
        // These are mindfulness prompts for when you first visit a site - irrelevant for embedded content.
        // Only hard lock (mode === 'locked') is meaningful for iframes.
        if (this.isIframe) {
            if (mode === 'locked') {
                this.renderIframeBlocked(this.ensureShadow(), 'limit');
            }
            return;
        }
        
        this.activeIntervention = mode;
        this.removePill(); // Aggressive safety
        MediaController.startEnforcement();

        // Check for toasts on cold start/refresh
        this.processPendingToasts?.();

        const root = this.ensureShadow();
        if (!root) return;
        if (!root.getElementById(this.overlayId)) {
            const overlay = document.createElement('div');
            overlay.id = this.overlayId;
            overlay.dataset.mode = mode; // Store mode for UI state logic
            root.appendChild(overlay);
        }

        const overlay = root.getElementById(this.overlayId);
        overlay.dataset.mode = mode; // Ensure mode is synced if element already existed
        overlay.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: #F5F5F7; z-index: 2147483640;
            overflow-y: auto;
        `;

        document.body.style.overflow = 'hidden';

        if (mode === 'breathing') {
            this.renderBreathing(overlay, message, forced);
        } else if (mode === 'locked') {
            this.renderDecisionScreen(this.settings.hardLockDuration || 30, message, forced);
        } else {
            this.renderBreathing(overlay, message, forced);
        }
    }

    renderReminderOverlay(value, type = 'time', forced = false) {
        // FIX 100: Reminders are not relevant for iframes - just silently skip
        if (this.isIframe && !forced) return;

        let message = `You've been here for <span style="color:#FF3B30">${value}</span> mins.`;
        if (type === 'browser') message = `Daily browsing limit reached (<span style="color:#FF3B30">${value}</span> mins).`;
        if (type === 'launch') message = `Visit limit reached (<span style="color:#FF3B30">${value}</span> visits).`;

        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (this.settings.soundEnabled !== false) {
            try { SoundEngine.playChime('warning'); } catch (e) { }
        }

        localStorage.setItem('cure_reminder_active', '1');
        this.renderOverlay('breathing', message, forced);

        if (!this.shadowRoot) return;
        const overlay = this.shadowRoot.getElementById(this.overlayId);
        if (!overlay) return;

        overlay.innerHTML = `
            <div class="cure-overlay-container" style="padding-top: 40px;">
                <div class="cure-header">
                    <div style="font-size:42px; margin-bottom:4px;">⏰</div>
                    <h1 class="cure-title-large">Productivity Check</h1>
                    <p class="cure-subtitle" style="display: flex; flex-direction: column; align-items: center; gap: 8px;">
                       ${message}
                    </p>
                </div>

                <div style="margin-top: 30px; text-align: center;">
                    <p style="color:#1D1D1F; font-size:18px; font-weight: 500; margin-bottom: 24px;">
                        Are you being productive, or just scrolling?
                    </p>
                    <button id="cure-reminder-continue-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #D1D1D6; color:#86868B; box-shadow:none; margin: 0 auto;">
                        Continue Wasting Time
                    </button>
                </div>
            </div>
        `;

        const btn = this.shadowRoot.getElementById('cure-reminder-continue-btn');
        if (btn) {
            btn.onclick = () => {
                localStorage.removeItem('cure_reminder_active');
                this.removeOverlay();
                document.body.style.overflow = '';
                this.stateMonitor();
            };
        }
    }

    renderDecisionScreen(reason = null, message = null, forced = false) {
        const root = this.ensureShadow();
        if (!root) return;

        // FIX: TOAST PRIORITY. Always check for reset notice FIRST before doing potentially buggy UI work.
        this.checkAndShowResetToast();
        
        this.activeIntervention = 'locked';
        // FIX 97: Robust check for spoofed iframes in Decision screen too.
        let isIframe = window.self !== window.top;
        try {
             if (location.ancestorOrigins && location.ancestorOrigins.length > 0) isIframe = true;
        } catch(e) { isIframe = true; }

        // REMOVED diversion: Allow Decision Screen in Iframes with Responsive UI
        /*
        if (isIframe && !forced) {
            this.renderIframeBlocked(root, reason);
            return;
        }
        */

        this.activeIntervention = 'locked';
        const overlay = root.getElementById(this.overlayId);
        if (!overlay) return;

        // FIX: STABLE RENDERING. 
        // We use a specific key to track if we've already rendered this exact screen.
        const currentDecisionKey = `${reason || 'expire'}_${forced ? 'f' : 'n'}`;
        const existingContent = overlay.innerHTML.trim();
        
        if (existingContent !== "" && this._lastDecisionKey === currentDecisionKey) {
            // Screen is already correct. Just pulse the toast check and exit.
            this.checkAndShowResetToast();
            return;
        }
        this._lastDecisionKey = currentDecisionKey;

        MediaController.startEnforcement();

        let title = "Time's Up";
        let subtitle = "Your session time has expired. What would you like to do?";
        let emoji = "🛑";

        if (reason === 'launchLimit') {
            const res = this.lastLaunchResponse || {};
            if (res.locked) {
                title = "Launch Limit Reached";
                const waitStr = res.waitTime ? ` Available in ${Math.ceil(res.waitTime / 60)}m.` : "";
                subtitle = `You've used all ${res.total} allowed launches.${waitStr}`;
                emoji = "🔒";
            } else if (res.sessionActive) {
                // If it's active but we are here, it means some OTHER trigger is blocking (like time)
                title = "Time's Up";
            } else {
                title = "Launch Balance";
                subtitle = `Opening this site uses 1 launch. You have ${res.remaining} left.`;
                emoji = "🚀";
            }
        }

        const shortcuts = (this.settings.shortcuts || []).slice(0, 6).map(s => {
            const iconUrl = this.getFaviconUrl(s.url);
            let hostname = '';
            try {
                hostname = new URL(s.url).hostname;
            } catch (e) {
                console.warn("Invalid shortcut URL:", s.url, e);
                // Fallback or skip this shortcut if URL is invalid
                return ''; 
            }
            return `<a href="${s.url}" class="cure-shortcut-card">
                <img src="${iconUrl}" class="cure-shortcut-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${hostname}&sz=64'"> 
                <span class="cure-shortcut-name">${s.name}</span>
            </a>`;
        }).join('');

        overlay.innerHTML = `
            <div class="cure-overlay-container">
                <div class="cure-header" style="margin-bottom: 24px;">
                    <div style="font-size:42px; margin-bottom:10px;">${emoji}</div>
                    <h1 class="cure-title-large">${title}</h1>
                    <p class="cure-subtitle">${subtitle}</p>
                </div>

                <div class="cure-shortcuts-container" style="margin-bottom: 32px;">
                    <div class="cure-shortcuts-label">Productive Alternatives</div>
                    <div class="cure-hand-pointer">👇</div>
                    <div class="cure-shortcuts-row">
                        ${shortcuts}
                    </div>
                </div>

                <div style="margin-top: 20px;">
                     <button id="cure-unlock-decision-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #E5E5EA; color:#86868B; box-shadow:none;">
                        I want to procrastinate (Unlock)
                     </button>
                </div>
            </div>
        `;

        if (this.shadowRoot) {
            const unlockBtn = this.shadowRoot.getElementById('cure-unlock-decision-btn');
            if (unlockBtn) {
                unlockBtn.onclick = async () => {
                    this._lastDecisionKey = null; // Reset key to allow future renders
                    this.dismissToast();
                    
                    // Fix 70: Set GLOBAL flag immediately when they COMMIT to unlocking.
                    // This protects the entire protocol sequence (Delay -> Password -> Typing).
                    // FIX 83/89: Only clear the toast guard on new entry. 
                    // Global flag is now set in the protocol screens (renderTypingLock)
                    if (this.isContextValid()) {
                        this._lastResetToastShown = false;
                    }
                    
                    if (this.isIframe) {
                        const originalText = unlockBtn.innerText;
                        unlockBtn.innerText = "Opening Challenge...";
                        unlockBtn.style.opacity = "0.7";
                        unlockBtn.disabled = true;

                        const hostname = window.location.hostname;
                        const targetUrl = `https://${hostname}`;
                        
                        chrome.runtime.sendMessage({ action: 'openTab', url: targetUrl }, (res) => {
                            if (chrome.runtime.lastError) {
                                unlockBtn.innerText = "Error - Refresh!";
                                console.error("[Cure] Iframe unlock failed:", chrome.runtime.lastError);
                            }
                        });
                        
                        // Fallback: If no response in 3s, reset button
                        setTimeout(() => {
                            if (unlockBtn.innerText === "Opening Challenge...") {
                                unlockBtn.innerText = originalText;
                                unlockBtn.style.opacity = "1";
                                unlockBtn.disabled = false;
                            }
                        }, 3000);
                    } else {
                        await this.renderHardLock(overlay);
                    }
                };
            }
        }

        // FIX 104: Restoration of Progress Reset Toast on Decision Screen.
        // This line is now moved to the top of the function.
    }


    // NOTE: renderIframeBlocked is defined earlier (around line 1693)

    renderBreathing(overlay, message = "Take a breath.", forced = false) {
        // FIX 100: Breathing/Pause screens are not relevant for iframes - just silently skip
        if (this.isIframe && !forced) return;

        const quote = this.getRandomQuote();
        const shortcuts = (this.settings.shortcuts || []).slice(0, 6).map(s => {
            const iconUrl = this.getFaviconUrl(s.url);
            return `<a href="${s.url}" class="cure-shortcut-card">
                <img src="${iconUrl}" class="cure-shortcut-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=64'"> 
                <span class="cure-shortcut-name">${s.name}</span>
            </a>`;
        }).join('');

        overlay.innerHTML = `
        <div class="cure-overlay-container" style="padding-bottom: 80px;">
            <div class="cure-logo">🧘‍♂️</div> 
            <h1 class="cure-title-large">Cure Procrastination</h1>
            <p class="cure-subtitle" style="margin-top: 4px; color: #86868B;">${message}</p>
            <p class="cure-quote-medium" style="margin-top: 12px;">"${quote}"</p>
            
            <div class="cure-action-wrapper">
                <button id="cure-continue-btn" class="cure-btn-unlock counting" style="margin:0 auto;">
                    <div id="cure-progress-fill" class="cure-progress-fill-anim"></div>
                    <span id="cure-btn-text" class="cure-btn-content">Readying...</span>
                </button>
            </div>

            <div class="cure-shortcuts-container" style="margin-bottom: 32px;">
                <div class="cure-shortcuts-label">Productive Alternatives</div>
                <div class="cure-hand-pointer">👇</div>
                <div class="cure-shortcuts-row">${shortcuts}</div>
            </div>
        </div >
            `;
    }

    // --- STATE 3: HARD LOCK (ADVANCED) ---
    async renderHardLock(overlay) {
        const root = this.ensureShadow();
        
        // FIX 85: Premature activation bug.
        // We no longer set isTypingChallengeActive here, as we haven't entered a protocol yet.
        // It's now set in renderDelayLock, renderPasswordLock, and renderTypingLock.

        // Protocols: God Mode > Delay > Password > Typing
        const p = this.settings.unlockProtocols || {};
        
        // Notify background that a challenge has officially started on this tab
        this.safeSendMessage({ action: 'challengeStarted', hostname: window.location.hostname });

        if (p.godMode) {
            this.renderGodMode(overlay);
            return;
        }

        // State Machine for Sequential Unlocks
        // We use a temporary state tracker in memory
        if (p.delay && p.delay.enabled && !this.tempDelayComplete) {
            await this.renderDelayLock(overlay, p.delay.duration || 5);
            return;
        }


        if (p.password && p.password.enabled && !this.tempPasswordComplete) {
            await this.renderPasswordLock(overlay);
            return;
        }

        if (p.typing && p.typing.enabled) {
            await this.renderTypingLock(overlay);
            return;
        }

        // If no protocols remain (or all passed), unlock.
        this.unlockSession(this.settings.unlockReward || 5);
    }

    renderGodMode(overlay) {
        overlay.innerHTML = `
            <div class="cure-overlay-container" style="justify-content: flex-start; padding-top: 80px;">
                <div style="font-size:80px; margin-bottom:20px;">⛔</div>
                <h1 class="cure-title-large">Locked Until Reset</h1>
                <p class="cure-subtitle" style="margin-top:10px; max-width:400px; text-align:center;">
                    You chose "None" mode. There is no way to unlock this site until your session resets tomorrow.
                </p>
                <div style="margin-top:30px; font-weight:600; color:#FF3B30; font-size:18px;">
                    No Unlocking Allowed.
                </div>
                <p style="margin-top:20px; color:#86868B; font-size:13px; max-width:350px; text-align:center;">
                    Close this tab and do something productive.
                </p>
            </div>
        `;
    }


    async renderDelayLock(overlay, minutes = 5) {
        this.isTypingChallengeActive = true;
        await this.checkGlobalResets(); // FIX 89: Check for resets when starting
        this.removePill();
        // Init timestamp if fresh
        if (!this.tempDelayStart) this.tempDelayStart = Date.now();
        const totalMs = minutes * 60 * 1000;
        const targetTime = this.tempDelayStart + totalMs;

        // SVG Circle Vars
        const radius = 70;
        const circumference = 2 * Math.PI * radius;

        overlay.innerHTML = `
            <div class="cure-overlay-container" style="justify-content: flex-start; padding-top: 80px;">
                <div style="font-size:60px; margin-bottom:16px;">⏳</div>
                <h1 class="cure-title-large">Patience is Key</h1>
                <p class="cure-subtitle" style="margin-top:8px; margin-bottom:30px;">You must wait before attempting to unlock.</p>
                
                <!-- Circular Timer -->
                <div style="position:relative; width:160px; height:160px; margin: 0 auto 30px auto;">
                    <svg width="160" height="160" viewBox="0 0 160 160" style="transform: rotate(-90deg);">
                        <circle cx="80" cy="80" r="${radius}" stroke="#E5E5EA" stroke-width="8" fill="none"></circle>
                        <circle id="cure-timer-ring" cx="80" cy="80" r="${radius}" stroke="#1D1D1F" stroke-width="8" fill="none" 
                                stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="0"
                                style="transition: stroke-dashoffset 1s linear;"></circle>
                    </svg>
                    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; padding: 0 10px;">
                        <span id="cure-delay-timer" style="font-size:24px; font-weight:700; color:#1D1D1F; font-variant-numeric: tabular-nums; text-align: center; line-height: 1.2;">--:--</span>
                    </div>
                </div>
                
                <p style="color:#86868B; font-size:13px;">Use this time to reconsider your choices.</p>
            </div>
        `;

        if (this.delayInterval) clearInterval(this.delayInterval);
        if (!this.shadowRoot) return;
        
        const timerEl = this.shadowRoot.getElementById('cure-delay-timer');
        const ringEl = this.shadowRoot.getElementById('cure-timer-ring');

        this.delayInterval = setInterval(() => {
            const diff = targetTime - Date.now();
            if (diff <= 0) {
                clearInterval(this.delayInterval);
                this.tempDelayComplete = true;
                this.renderHardLock(overlay); // Proceed to next step
                return;
            }
            const d = Math.floor(diff / 86400000);
            const h = Math.floor((diff % 86400000) / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            const s = Math.floor((diff % 60000) / 1000);

            let displayStr = "";
            if (d > 0) displayStr += `${d}d\n`;
            if (h > 0 || d > 0) displayStr += `${h}h `;
            displayStr += `${m}m ${s}s`;

            if (timerEl) {
                timerEl.style.whiteSpace = 'pre-line';
                timerEl.textContent = displayStr;
            }

            // Update Ring
            if (ringEl) {
                const offset = circumference * (1 - (diff / totalMs));
                ringEl.style.strokeDashoffset = offset;
            }
        }, 1000);
    }

    async renderPasswordLock(overlay) {
        this.isTypingChallengeActive = true;
        await this.checkGlobalResets(); // FIX 89: Check for resets when starting
        const correctPassword = this.settings.unlockProtocols.password.value;
        overlay.innerHTML = `
            <div class="cure-overlay-container" style="justify-content: flex-start; padding-top: 60px;">
                <div style="font-size:42px; margin-bottom:12px;">🔑</div>
                <h1 class="cure-title-large">Password Required</h1>
                <p class="cure-subtitle" style="margin-top:4px;">Enter your secret key to proceed.</p>
                
                <div style="width:100%; max-width:300px; margin-top:30px;">
                    <div class="cure-pass-container">
                        <input type="password" id="cure-pass-input" class="cure-typing-input" placeholder="Enter password..." style="height:56px; text-align:center; font-size:18px; padding-right: 50px;">
                        <button id="cure-pass-toggle" class="cure-pass-toggle" type="button" title="Show/Hide Password">👁️</button>
                    </div>
                    <div id="cure-pass-error" style="color:#FF3B30; margin-top:12px; opacity:0; font-size:14px; font-weight:600; text-align:center;">
                        Incorrect Password
                    </div>
                    <button id="cure-pass-submit" class="cure-btn-unlock" style="margin-top:16px; width:100%;">
                        Unlock
                    </button>
                </div>
                
                <p style="margin-top:24px; color:#86868B; font-size:12px; max-width:280px; text-align:center;">
                    💡 Forgot it? Ask whoever you gave it to.
                </p>
            </div>
        `;

        if (!this.shadowRoot) return;
        const input = this.shadowRoot.getElementById('cure-pass-input');
        const submit = this.shadowRoot.getElementById('cure-pass-submit');
        const err = this.shadowRoot.getElementById('cure-pass-error');
        const toggle = this.shadowRoot.getElementById('cure-pass-toggle');

        if (!input || !submit) return;

        if (toggle) {
            toggle.onclick = () => {
                const isPass = input.type === 'password';
                input.type = isPass ? 'text' : 'password';
                toggle.textContent = isPass ? '🔒' : '👁️';
            };
        }

        const check = () => {
            if (input.value === correctPassword) {
                this.tempPasswordComplete = true;
                this.renderHardLock(overlay);
            } else {
                err.style.opacity = '1';
                input.classList.add('shake'); // Use the 'shake' class already in css
                setTimeout(() => input.classList.remove('shake'), 400);
            }
        };

        submit.onclick = check;
        input.onkeydown = (e) => {
            e.stopPropagation(); // Prevent site hotkeys (like Space) from interfering
            if (e.key === 'Enter') check();
        };
        input.focus();
    }

    async renderTypingLock(overlay) {
        this.isTypingChallengeActive = true; 
        this.dismissToast(); 
        
        // FIX: Ensure media remains paused during Typing Challenge
        MediaController.startEnforcement();
        
        // Wait for global check to ensure currentChallengeText is cleared if needed
        await this.checkGlobalResets(true); 
        
        sessionStorage.setItem('cure_typing_active_session', 'true');

        // Progress reset toast logic moved to renderDecisionScreen for historical accuracy and UX.


        const reward = this.settings.unlockReward || 5;
        const difficulty = this.settings.unlockProtocols?.typing?.difficulty || this.settings.typingDifficulty || 50;

        overlay.innerHTML = `
            <div class="cure-overlay-container" style="padding-top: 30px;">
                <div class="cure-header" style="margin-bottom: 8px;">
                    <div style="font-size:42px; margin-bottom:4px;">🔒</div>
                    <h1 class="cure-title-large">Strict Lock Active</h1>
                    <p class="cure-subtitle">Type the text below perfectly to unlock ${reward} minutes.</p>
                </div>

                <div class="cure-card" style="margin-bottom: 8px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; width:100%;">
                        <span style="font-size:20px;">📖</span>
                        <span style="font-weight:600; color:#1D1D1F; font-size: 16px;">Text to Type</span>
                    </div>
                    <div id="cure-text-container" class="cure-text-display">Loading...</div>
                </div>

                <div class="cure-card" style="margin-bottom: 0px;">
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px; width:100%;">
                        <span style="font-size:20px;">⌨️</span>
                        <span style="font-weight:600; color:#1D1D1F; font-size: 16px;">Your Typing</span>
                        <div style="flex-grow:1;"></div>
                        <span id="cure-count" style="font-size:14px; color:#86868B; font-weight:500;">0 Words</span>
                    </div>
                    <textarea id="cure-input" class="cure-typing-input" placeholder="Start typing here..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
                    
                    <div class="cure-shortcuts-container" style="margin-top: 12px;">
                        <button id="cure-give-up-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #E5E5EA; color:#86868B; font-size:16px; padding:16px 32px; height:56px; border-radius: 12px; width: 100%; box-shadow:none;">
                            I'd rather be productive
                        </button>
                    </div>
                </div>
            </div>
        `;

        if (this.shadowRoot) {
            const giveUpBtn = this.shadowRoot.getElementById('cure-give-up-btn');
            if (giveUpBtn) {
                giveUpBtn.onclick = () => {
                    // Fix 64: User explicitly abandoned. Clear global flag so they don't get a "Reset" toast.
                    if (this.isContextValid()) {
                        this.safeSendMessage({ 
                            action: 'sessionStorageProxy', 
                            op: 'remove', 
                            key: 'cure_typing_active_global' 
                        });
                        this.safeSendMessage({ 
                            action: 'sessionStorageProxy', 
                            op: 'remove', 
                            key: 'cure_typing_active_global' 
                        });
                        // 🛑 CRITICAL: Clear the Global Reset Flag
                        // Since they are voluntarily exiting, we don't need to warn them.
                        this.safeSendMessage({ action: 'clearResetFlag', hostname: window.location.hostname });
                    }
                    this.renderDecisionScreen(this.settings.hardLockDuration || 30); // Go back
                };
            }
        }

        this.currentTypingDifficulty = difficulty;
        this.setupTypist(difficulty); 
    }

    // Updated fetch to use word count argument
    fetchChallengeText(wordCount) {
        // If wordCount arg is missing, fallback to settings
        const count = wordCount || 50;
        return Promise.resolve(this.getRandomChallenge(count));
    }

    setupTypist(difficulty) {
        const root = this.ensureShadow();
        const input = root.getElementById('cure-input');
        const display = root.getElementById('cure-text-container');
        const count = root.getElementById('cure-count');
        if (!input || !display) return;

        input.value = '';
        input.disabled = true;

        // Anti-Cheat: Block Copy/Paste & Drag/Drop
        /* SURGICAL FEATURE: ANTI_CHEAT (Block Copy/Paste) */
        const blockCheat = (e) => {
            e.preventDefault();
            this.showToast('🚨 No Copy/Paste Allowed', 'error');
        };
        input.onpaste = blockCheat;
        input.ondrop = blockCheat;
        // Optional: Block context menu to hide "Paste" option visually
        input.oncontextmenu = (e) => e.preventDefault();

        this.fetchChallengeText(difficulty).then(rawText => {
            const text = normalizeTypingText(rawText);
            const chars = text.split('').map(c => `<span class="cure-char">${c}</span>`).join('');
            display.innerHTML = chars;
            input.disabled = false;
            input.focus();

            if (count) count.textContent = `0 / ${text.split(' ').length} words`;

            // CRITICAL: Stop event propagation to prevent site hotkeys from stealing focus
            input.onkeydown = (e) => {
                e.stopPropagation();
            };

            input.oninput = (e) => {
                this.dismissToast(); // Hide "Tab Reset" warning as soon as they type
                
                // --- UNIVERSAL NORMALIZATION: Handle MacOS "Smart Quotes" & Unicode mismatches ---
                // FIX: In-place input sanitization. 
                // We normalize the value immediately so the cursor doesn't jump and the logic is consistent.
                const rawVal = input.value;
                const normalizedVal = normalizeTypingText(rawVal);
                if (rawVal !== normalizedVal) {
                    const start = input.selectionStart;
                    const end = input.selectionEnd;
                    input.value = normalizedVal;
                    input.setSelectionRange(start, end);
                }
                
                let val = normalizedVal;
                
                const charSpans = display.querySelectorAll('.cure-char');
                let error = false;

                charSpans.forEach((span, i) => {
                    if (i < val.length) {
                        if (val[i] === text[i]) {
                            span.className = 'cure-char correct';
                        } else {
                            span.className = 'cure-char error';
                            error = true;
                        }
                    } else if (i === val.length) {
                        span.className = 'cure-char current';
                    } else {
                        span.className = 'cure-char';
                    }
                });

                // Scroll Logic
                const current = display.querySelector('.cure-char.current') || display.querySelector('.cure-char.error:last-of-type');
                if (current) {
                    current.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }

                if (count) {
                    const typedWords = val.trim().split(/\s+/).filter(w => w.length > 0).length;
                    const targetWords = text.trim().split(/\s+/).length;
                    count.textContent = `${typedWords} / ${targetWords} words`;
                }

                if (error) {
                    if (!input.classList.contains('shake')) {
                        input.classList.add('shake');
                        if (navigator.vibrate) navigator.vibrate(200);
                        setTimeout(() => input.classList.remove('shake'), TIMERS.SHAKE_ANIMATION_MS);
                    }
                }

                if (val === text) {
                    try { SoundEngine.playChime('success'); } catch (e) { }
                    this.unlockSession(this.settings.unlockReward || 5);
                }
            };
        });
    }

    renderSuccess(mins) {
        // Fix 72: Clear global typing flag immediately on reaching success screen.
        // This is a redundant safety layer to prevent the "Progress Reset" toast on reload.
        if (this.isContextValid()) {
            this.safeSendMessage({ 
                action: 'sessionStorageProxy', 
                op: 'remove', 
                key: 'cure_typing_active_global' 
            });
            this.safeSendMessage({ 
                action: 'sessionStorageProxy', 
                op: 'remove', 
                key: 'cure_typing_active_global' 
            });
            // 🛑 CRITICAL: Clear Global Reset Flag on Success
            // This is the ONLY safe place to clear it.
            this.safeSendMessage({ action: 'clearResetFlag', hostname: window.location.hostname });

            // FIX: Silent Auto-Close for Challenges
            // Immediately trigger close if the URL flag is present.
            if (window.location.search.includes('cure_challenge=true')) {
                setTimeout(() => {
                    chrome.runtime.sendMessage({ action: 'closeMyTab' });
                }, 1500);
            }
        }

        if (!this.shadowRoot) return;
        const overlay = this.shadowRoot.getElementById(this.overlayId);
        if (!overlay) return;

        const shortcuts = (this.settings.shortcuts || []).slice(0, 6).map(s => {
            const iconUrl = this.getFaviconUrl(s.url);
            return `<a href="${s.url}" class="cure-shortcut-card">
                <img src="${iconUrl}" class="cure-shortcut-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${new URL(s.url).hostname}&sz=64'"> 
                <span class="cure-shortcut-name">${s.name}</span>
            </a>`;
        }).join('');

        const isAutoClose = window.location.search.includes('cure_challenge=true');
        const subtitle = isAutoClose 
            ? `✨ Success! Returning you to your page in 2s...` 
            : `You have unlocked <b style="color:#1D1D1F;">${mins}min</b>.<br>The clock is ticking backwards now.`;

        overlay.innerHTML = `
            <div class="cure-overlay-container">
                <div class="cure-header">
                    <div style="font-size:42px; margin-bottom:4px;">${isAutoClose ? '✨' : '🔓'}</div>
                    <h1 class="cure-title-large">${isAutoClose ? 'Task Complete' : 'Strict Lock Lifted'}</h1>
                    <p class="cure-subtitle" style="max-width:400px; margin: 4px auto 0 auto;">
                        ${subtitle}
                    </p>
                </div>

                <div class="cure-shortcuts-container" style="margin-bottom: 32px;">
                    <div class="cure-shortcuts-label">Productive Alternatives</div>
                    <div class="cure-hand-pointer">👇</div>
                    <div class="cure-shortcuts-row">${shortcuts}</div>
                </div>

                <div class="cure-action-wrapper">
                    <button id="cure-finished-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #E5E5EA; color:#86868B; box-shadow:none; height: 56px;">Continue to Site</button>
                </div>
            </div>
            </div>
            `;


        if (this.shadowRoot) {
            const finBtn = this.shadowRoot.getElementById('cure-finished-btn');
            if (finBtn) {
                finBtn.onclick = () => {
                    this.confirmUnlock(mins);
                };
            }
        }
    }

    async fetchChallengeText() {
        const targetLength = this.settings.typingDifficulty || 150;
        return this.getRandomChallenge(targetLength);
    }

    getFaviconUrl(u) {
        try {
            return `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(u)}&size=64`;
        } catch (e) {
            return '';
        }
    }

    setupProximity() {
        document.addEventListener('mousemove', this.handleMouseMove);
    }
}
// Instantiate
new CureVault();
