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
    SAVE_INTERVAL_MS: 1000 // Real-time sync for global timer (Fix jitter)
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
    async playChime(type = 'warning') {
        try {
            // FIX: Sound Deduplication (Deafening Sound Fix)
            // Ask Background (The Gatekeeper) if we are allowed to play.
            // This prevents 100 tabs from screaming in unison.
            const response = await new Promise(resolve => {
                chrome.runtime.sendMessage({ action: 'canPlaySound' }, (res) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(res);
                });
            });

            if (!response || !response.canPlay) return;

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
    observer: null,
    isActive: false, // FIX: Global Kill Switch Flag
    enforcedElements: new Set(), // Use Set for pause-only enforcement
    handleMediaEvent(e) {
        // FIX: Global Kill Switch.
        // If enforcement is stopped, ignore this event completely.
        // We use 'MediaController' directly because 'this' is the element during event callback.
        if (!MediaController.isActive) return;

        const el = e.target;
        try {
            if (!el.paused) el.pause();
        } catch (err) { /* Ignore */ }
    },
    // FIX: Performance Optimization. 
    // Avoid querySelectorAll('*') which is O(N) where N is total DOM elements.
    // Instead only target elements that can be media or have shadow roots.
    findMediaDeep(root = document) {
        let found = [];
        // 1. Target media elements directly (Fast)
        found.push(...root.querySelectorAll('video, audio'));
        
        // 2. Recursively check Shadow DOMs (Optimized)
        // We iterate specifically known shadow hosts if possible, or fall back to a safer tree walker if needed.
        // For now, we trust the MutationObserver to catch new shadow roots, and we only 
        // scan top-level elements or known containers to find shadow roots.
        // removing the O(N) full scan.
        return found;
    },
    enforceElement(el) {
        try {
            if (!this.enforcedElements.has(el)) {
                this.enforcedElements.add(el);
                el.addEventListener('play', this.handleMediaEvent);
                el.addEventListener('playing', this.handleMediaEvent);
            }
            if (!el.paused) el.pause();
        } catch (e) { /* Ignore */ }
    },
    pauseAll() {
        this.findMediaDeep().forEach(el => this.enforceElement(el));
    },
    startEnforcement(force = false) {
        if (this.interval) clearInterval(this.interval);
        if (this.observer) this.observer.disconnect();

        const vault = window.__CURE_VAULT_INSTANCE__;
        const isInterventionActive = vault && (vault.activeIntervention || vault.tabLevelLockActive);
        const isWhitelisted = vault && vault.isWhitelisted();
        const isBlacklisted = vault && vault.isBlacklisted();

        if (!force && (isWhitelisted || (!isBlacklisted && !isInterventionActive))) return;

        this.isActive = true; // Enable Flag only if we pass the guard

        // 1. Initial Sweep
        this.pauseAll();

        // 2. Event-Driven Enforcement (MutationObserver)
        // This is extremely efficient compared to high-frequency polling.
        this.observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === 1) { // Element
                        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
                            this.enforceElement(node);
                        } else {
                            // Elements inside the tree might be media
                            node.querySelectorAll('video, audio').forEach(el => this.enforceElement(el));
                        }
                    }
                });
            }
        });
        this.observer.observe(document.documentElement, { childList: true, subtree: true });

        // 3. Low-Frequency Fail-safe (2000ms)
        // Only checks already known elements.
        this.interval = setInterval(() => {
            this.enforcedElements.forEach((el) => {
                if (!el.paused) el.pause();
            });
            // FIX: Removed expensive random full-page scan. 
            // We rely on MutationObserver for new elements.
        }, 2000);
    },
    stopEnforcement() {
        this.isActive = false; // Disable flag immediately
        
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        // Restore state
        this.enforcedElements.forEach((el) => {
            try {
                el.removeEventListener('play', this.handleMediaEvent);
                el.removeEventListener('playing', this.handleMediaEvent);
                // FIX: Aggressive cleanup
                el.onplay = null;
                el.onplaying = null;
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
        // Single Quote variants (Nuclear Coverage: Smart Quotes, Primes, Fullwidth, Modified Letters, Ticks, Grave)
        .replace(/[\u2018\u2019\u201A\u201B\u2039\u203A\u02BC\u02BB\u02B9\u00B4\u0060\u2032\u2035\uFF07\u02BD\u02C8\u02CA\u02CB\u02F4\u0301]/g, "'")
        // Double Quote variants (Nuclear Coverage: Double Smart, Double Primes, Fullwidth, Chevrons)
        .replace(/[\u201C\u201D\u201E\u201F\u00AB\u00BB\u2033\u2036\uFF02\u201F]/g, '"')
        // Dash/Hyphen variants (En, Em, Hyphen, Non-breaking hyphen, Figure dash, Minus)
        .replace(/[\u2013\u2014\u2010\u2011\u2012\u2212]/g, "-")
        .replace(/\u00A0/g, " "); // Non-breaking spaces
}

class CureVault {
    constructor() {
        // Mark as singleton instance
        if (window.__CURE_VAULT_INSTANCE__) {
            window.__CURE_VAULT_INSTANCE__.cleanup();
        }
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
        
        // FIX 185: Threshold Tracking
        this._lastReminderThreshold = 0;
        this._lastHeartbeatMinute = 0;
        
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
        this._launchCounted = false; // FIX: In-memory launch tracking
        this._toastDebounce = false;
        this._lastDecisionKey = null; // Stability guard for UI re-renders
        this.lastRenderedReason = null; // Fix: Prevent rapid-fire re-rendering
        this._pEvaluation = null; // Concurrency guard for trigger checks
        this._pendingReEval = false; // Queue for follow-up evaluations
        
        // --- QUEUE & STACKING (Restored Baseline) ---
        this.interventionQueue = [];
        this.queueSnapshot = [];
        this._dismissedToasts = {};

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

        // FIX: Universal SPA Navigation Support
        const handleNav = () => {
            this._launchCounted = false; // Allow new "visit" on SPA nav
            this.evaluateAllTriggers().then(() => this.forceRefreshUI());
        };
        window.addEventListener('popstate', handleNav);
        window.addEventListener('hashchange', handleNav);
    }

    handleDOMContentLoaded() {
        this.init().catch(e => console.error('[Cure] Init error:', e));
    }

    handleFocus() {
        if (typeof this.evaluateAllTriggers !== 'function') return;
        // FIX: Instant Sync (Pull-on-Visible)
        // Immediately fetch latest timer from background (Single Source of Truth)
        if (typeof this.checkAuthoritativeTime === 'function') {
            this.checkAuthoritativeTime().then(() => {
                this.updatePill?.(); // Instant visual update
                this.evaluateAllTriggers().then(() => this.forceRefreshUI());
            });
        } else {
            this.evaluateAllTriggers().then(() => this.forceRefreshUI());
        }
    }

    handleVisibilityChange() {
        // if (typeof this.loadTimer !== 'function') return; // Deprecated loadTimer check
        if (!document.hidden) {
            // FIX: Instant Sync (Pull-on-Visible)
            if (typeof this.checkAuthoritativeTime === 'function') {
                this.checkAuthoritativeTime().then(() => {
                    this.updatePill?.(); // Instant visual update
                    if (typeof this.evaluateAllTriggers !== 'function') return;
                    this.evaluateAllTriggers().then(() => {
                        this.forceRefreshUI();
                        this.processPendingToasts?.();
                    });
                });
            }
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
            // console.debug('[Cure] Page revealed, re-evaluating state...');
            
            // Ensure monitor is running (in case it was stopped or throttled)
            if (!this.timerInterval) {
                this.stateMonitor();
            }

            // FIX: Instant Sync (Pull-on-Visible)
            if (typeof this.checkAuthoritativeTime === 'function') {
                this.checkAuthoritativeTime().then(() => {
                    this.updatePill?.();
                    this.evaluateAllTriggers().then(() => {
                        this.forceRefreshUI();
                    });
                });
            } else {
                this.evaluateAllTriggers().then(() => {
                    this.forceRefreshUI();
                });
            }
        }
    }

    // FIX: Standardize Hostname (Remove www.)
    cleanHost(hostname) {
        if (!hostname) return '';
        return hostname.toLowerCase().trim().replace(/^www\./, '');
    }

    handleStorageChange(changes, area) {
        if (area === 'local') {
            // FIX 194: Standardize Key (www. vs non-www.)
            const host = this.cleanHost(window.location.hostname);
            const key = `cure_timer_${host}`;

            if (changes[key]) {
                const { seconds, mode, timestamp } = changes[key].newValue || {};
                const timeoutMs = ((this.settings || {}).sessionTimeoutMins || 30) * 60 * 1000;
                
                if (timestamp && (Date.now() - timestamp < timeoutMs)) {
                    // FIX 191: Monotonic Sync. 
                    // Prevent "Time Warp" rollbacks from background tabs with stale usage.
                    const isNewMode = mode !== this.mode;
                    let shouldUpdate = isNewMode;
                    
                    if (!isNewMode) {
                        if (this.mode === 'up') {
                            // Up mode: Only accept GREATER seconds
                            shouldUpdate = seconds > this.activeSeconds;
                        } else {
                            // Down mode (Reward): Only accept SMALLER seconds (further along)
                            shouldUpdate = seconds < this.activeSeconds;
                        }
                    }

                    if (shouldUpdate) {
                        this.activeSeconds = seconds;
                        this.mode = mode || 'up';
                        this.updatePill?.();
                    }
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
        sessionStorage.removeItem(`cure_needs_reset_${window.location.hostname}`);
        sessionStorage.removeItem('cure_needs_reset');
        
        if (!this.shadowRoot) return;
        const root = this.shadowRoot;
        const toasts = root.querySelectorAll('[id^="cure-popout-notification"]');
        toasts.forEach(t => {
            t.style.opacity = '0';
            setTimeout(() => { if (t.parentElement) t.remove(); }, 300);
        });
        setTimeout(() => this.repositionToasts(), 350);
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
                // FIX: IMMEDIATE LOCAL CLEANUP to prevent infinite loop
                sessionStorage.removeItem(resetKeySpecific);
                sessionStorage.removeItem(resetKeyGeneric);
                
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

        // NEW: Global Timer Sync (Authoritative Broadcast)
        if (request.action === 'timerUpdate') {
            const currentHost = this.cleanHost ? this.cleanHost(window.location.hostname) : window.location.hostname.replace(/^www\./, '');
            if (this.mode === 'up' && request.hostname === currentHost) {
                // Monotonic Sync: Only accept if greater (prevents travel back)
                // OR if the difference is significant (e.g. a reset happened)
                 if (request.seconds > this.activeSeconds) {
                    this.activeSeconds = request.seconds;
                    this.updatePill?.();
                } else if (this.activeSeconds - request.seconds > 10) {
                    // Critical Drift Correction (e.g. Reset or Reward expiry)
                    // If we are way ahead of background, we might be the one drifting or a reset happened.
                    // We trust background.
                     this.activeSeconds = request.seconds;
                     this.updatePill?.();
                }
            }
            return;
        }

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
                    const currentMins = Math.floor(this.activeSeconds / 60);
                    this.renderReminderOverlay(currentMins, 'time', true);
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
                
                // FIX 132: Render Overlay in Iframes (Visual Feedback)
                // If this specific iframe matches the locked hostname, show the lock screen.
                // Otherwise (embedded on another site), just pause media (Strict Lock behavior).
                if (this.isIframe) {
                    const myHost = window.location.hostname.replace(/^www\./, '');
                    const lockedHost = request.hostname?.replace(/^www\./, '');
                    if (myHost === lockedHost) {
                        this.renderIframeBlocked(this.ensureShadow(), 'limit');
                    }
                }
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

        // FIX: Universal Media Kill Switch
        // Allows the main tab to pause ALL media in ALL frames (regardless of origin)
        if (request.action === 'tabMediaAction') {
            if (request.type === 'pause') {
                MediaController.startEnforcement(true); // Force enforcement
            } else {
                MediaController.stopEnforcement();
            }
            return;
        }

        // FIX 187: Consolidated reminder handler with QUEUE support
        if (request.action === 'forceReminderOverlay' || request.action === 'forceReminderToast') {
            if (this._settingsChangedAt && (Date.now() - this._settingsChangedAt < 2000)) return;

            const isGlobal = request.hostname === 'global';
            if (isGlobal || request.hostname === window.location.hostname.replace(/^www\./, '')) {
                // ADD TO QUEUE instead of immediate render
                const reminderStyle = request.reminderStyle || (request.action === 'forceReminderToast' ? 'toast' : 'overlay');
                this.interventionQueue = (this.interventionQueue || []).filter(item => item.type !== request.type);
                this.interventionQueue.push({
                    type: request.type,
                    value: request.value,
                    style: reminderStyle,
                    hostname: request.hostname,
                    ts: Date.now()
                });
                
                this.processInterventionQueue();
            }
            return;
        }

        // FIX 128/156: Cross-Tab Reminder Dismissal
        // FIX 129: Extended to handle iframes properly
        if (request.action === 'dismissReminderOverlay') {
            const isGlobal = request.hostname === 'global' || request.hostname === 'all';
            if (isGlobal || request.hostname === window.location.hostname.replace(/^www\./, '')) {
                sessionStorage.removeItem('cure_reminder_active');
                
                // FIX 129: Stop media enforcement for iframes
                MediaController.stopEnforcement();
                
                this.removeOverlay();
                document.body.style.overflow = '';

                // FIX 171: Also remove any active toast
                const root = this.shadowRoot;
                if (root) {
                    const toast = root.getElementById('cure-popout-notification');
                    if (toast) {
                        toast.style.opacity = '0';
                        setTimeout(() => { if (toast.parentElement) toast.remove(); }, 300);
                    }
                }

                // FIX 169/191/192: Force save timer so iframes/tabs sync to the correct current time.
                // CRITICAL (Fix 191): Only the tab the user actually Interacted with (the initiator) 
                // should save its timer. Passive tabs will follow via handleStorageChange logic.
                if (!request.initiatorInstanceId || request.initiatorInstanceId === this.instanceId) {
                    this.saveTimer();
                }
                
                // FIX 168: Restart monitor in iframes too so the pill updates!
                this.stateMonitor();
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
            
            // FIX 190: Anchor thresholds and clear "once" flag on interval change
            // This ensures that switching from "Every" to "Once" doesn't get 
            // silenced by the already-spent minutes.
            const oldType = this.settings?.reminderIntervalType;
            const oldInt = this.settings?.reminderInterval;
            const newType = newSettings.reminderIntervalType;
            const newInt = newSettings.reminderInterval;
            const oldEnabled = this.settings?.reminderIntervalEnabled !== false;
            const newEnabled = newSettings.reminderIntervalEnabled !== false;

            if (oldType !== newType || oldInt !== newInt || oldEnabled !== newEnabled) {
                sessionStorage.removeItem('cure_remind_interval_shown');
                this._lastReminderThreshold = Math.floor(this.activeSeconds / 60);
            }

            // FIX: Arm settings-change guard to block stale reminder broadcasts.
            // The background sends 'dismiss' then sets new baselines, but old 'show:true'
            // broadcasts from the previous config can arrive AFTER the dismiss due to
            // async chrome.tabs.query racing. This guard blocks them for 2 seconds.
            this._settingsChangedAt = Date.now();

            // FIX: Immediately dismiss any active reminder overlay on settings change.
            // This is a synchronous cleanup — don't wait for the background's 'dismiss' broadcast.
            sessionStorage.removeItem('cure_reminder_active');
            this.removeOverlay();
            document.body.style.overflow = '';

            const oldWhitelisted = this.isWhitelisted();
            
            // Apply settings first so isWhitelisted() reflects the new state
            this.settings = newSettings;

            const newWhitelisted = this.isWhitelisted();

            // FIX: Reactive Reminder Re-evaluation
            this.checkReminders(0, false); // Changed to false: wait for next boundary

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

                // FIX: Immediate Overlay Removal
                // If it's no longer blacklisted and we were showing a block overlay, kill it.
                if (newWhitelisted || !newStrictLock) {
                    this.removeOverlay();
                    this.updatePill();
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

        if (this.isIframe) {
            // FIX 137: Relaxed Nesting Check (Removed)
            // We rely purely on "Smart Visibility" (Fix 140) now.
            // If an iframe (nested or not) is actually playing video/audio, 
            // we show the pill. If it's just a wrapper (no media), activeSeconds stays 0 => Hidden.
            
            // FIX 140: Smart Visibility
            // Only show pill if we have actually tracked some time (video started).
            if (this.activeSeconds < 1) return false;
        }
        
        const root = this.shadowRoot;
        if (root && root.getElementById(this.overlayId)) return false;

        const isWhitelisted = this.isWhitelisted();
        const showPillSetting = this.settings.showTimerPill !== false;
        const canShowOnWhitelist = !isWhitelisted || this.settings.showPillOnWhitelist === true;

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
        // FIX: Removed premature `this.isWhitelisted()` check.
        // It caused a race condition where uninitialized settings led to false negatives (locking allowed sites).
        // We now rely solely on the background script's authoritative `getLockState` response.


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

        // 3. FIX 129/171: Check for active reminder state immediately
        // Query background to see if a reminder is active for this hostname
        this.safeSendMessage({
            action: 'getReminderState',
            hostname: window.location.hostname
        }, (response) => {
            if (response) {
                // FIX 186: Always sync threshold state even if inactive.
                // This prevents new tabs from re-triggering a dismissal.
                if (response.value > 0) {
                    this._lastReminderThreshold = response.value;
                    this._lastHeartbeatMinute = response.value;
                }

                if (response.active) {
                    // FIX 171: If reminderStyle is 'toast', show toast instead of overlay
                    if (response.reminderStyle === 'toast') {
                        const site = this.getSiteName();
                        let toastMsg = '';
                        if (response.type === 'browser') {
                            toastMsg = `⌛ Browser Screen Time: ${response.value}m spent`;
                        } else if (response.type === 'launch') {
                            toastMsg = `🚀 Visit Limit: ${response.value} visits`;
                        } else {
                            toastMsg = `⏰ ${site} Activity: ${response.value}m spent`;
                        }
                        this.showToast(toastMsg, 'reminder', {
                            reminderType: response.type,
                            targetHostname: response.hostname || window.location.hostname
                        });
                    } else {
                        sessionStorage.setItem('cure_reminder_active', '1');
                        this.renderReminderOverlay(response.value, response.type, true);
                    }
                }
            }
        });

        // 4. Listen for Broadcasts (Dynamic Locking/Unlocking)
        // FIX: Removed duplicate onMessage listener. 
        // The main CureVault.handleUpdate already handles 'broadcastLockState' 
        // (via forceMediaPause) and 'challengeCompleted'.
        // Keeping duplicate listeners causes memory leaks and race conditions.
    }

    async init() {
        this._toastDebounce = false;
        this._resetToastPending = false;
        if (!this.isContextValid()) return;

        // FIX: "The Haunted Overlay" (Stale State Persistence)
        // Check if the extension instance has changed (Reinstall/Factory Reset)
        // If so, NUCLEAR WIPE any existing session storage to prevent "phantom locks".
        try {
            await new Promise(resolve => {
                this.safeSendMessage({ action: 'getSystemInfo' }, (res) => {
                     const currentSysId = res?.instanceId;
                     if (currentSysId) {
                         const storedSysId = sessionStorage.getItem('cure_system_instance_id');
                         if (storedSysId && storedSysId !== currentSysId) {
                             console.log('[Cure] System Instance changed. Wiping stale storage.');
                             const keys = Object.keys(sessionStorage);
                             keys.forEach(k => {
                                 if (k.startsWith('cure_')) sessionStorage.removeItem(k);
                             });
                         }
                         sessionStorage.setItem('cure_system_instance_id', currentSysId);
                     }
                     resolve();
                });
            });
        } catch (e) { /* Ignore setup errors */ }
        
        // FIX 86: Branch for Iframe logic
        // FIX 86: Branch for Iframe logic
        if (this.isIframe) {
            // FIX 131: Enable Tracking for Iframes
            // We run initIframe() to do the fast initial checks (reminders, locks),
            // but we NO LONGER return. We proceed to full init() so stateMonitor starts tracking usage.
            this.initIframe();
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
     * Re-evaluates reminders against current usage stats.
     * @param {number} deltaSecs Seconds passed since last check
     * @param {boolean} force If true, triggers even if a threshold was already crossed (greedy check)
     */
    checkReminders(deltaSecs = 0, force = false) {
        if (!this.isContextValid()) return;
        const remindersOn = (this.settings || {}).masterReminders !== false;
        if (!remindersOn) return;
        
        const isWhitelisted = this.isWhitelisted();
        const allowWhite = !!this.settings.reminderWhitelist;
        if (isWhitelisted && !allowWhite) return;

        // 1. Site Activity Reminder
        // FIX 184: REMOVED grace period check. 
        // It prevented subsequent intervals (e.g. 2 min) from triggering if 1 min was dismissed late.
        // We rely on 'crossed' logic (which only fires once per interval) and 'heartbeat' guards to prevent spam.

        // Site Activity Reminders are now managed centrally by background.js broadcasts.
        // content.js only acts on 'forceReminderOverlay' / 'forceReminderToast' messages.

        // 2. Global Reminders (Now primarily handled by background broadcasts)
        // We still keep a legacy check here for instant local feedback if tracking is fast,
        // but it will be deduplicated by the background's authority.
        // 2. Global & Launch Reminders (Handled centrally by background evaluation)
        if (!this.isIframe && (force || deltaSecs >= 1)) {
            const launchWindow = (this.settings.reminderTriggers?.launchLimit?.windowSeconds) || 3600;
            this.safeSendMessage({ 
                action: 'trackLaunch', 
                hostname: window.location.hostname, 
                windowSeconds: launchWindow,
                isNewVisit: false
            });
        }
    }

    /**
     * Re-evaluates all blocking triggers (Hard Lock, Pause, Reminders).
     * Returns a promise that resolves when the evaluation (and potential UI change) is complete.
     */
    evaluateAllTriggers() {
        if (!this.isContextValid()) return Promise.resolve();

        // FIX: Concurrency Guard.
        // If an evaluation is already running, queue a follow-up if needed,
        // but don't start a parallel one which causes double-increments.
        if (this._pEvaluation) {
            this._pendingReEval = true;
            return this._pEvaluation;
        }

        // FIX: Null Safety. If background script is crashed or settings didn't load,
        // we cannot evaluate triggers. Silently fail instead of crashing.
        if (!this.settings) {
            console.warn('[Cure] Settings not available for evaluation. Background may be offline.');
            return Promise.resolve();
        }

        const whitelistReminders = !!this.settings.reminderWhitelist;
        const whitelistPause = !!this.settings.pauseWhitelist;

        if (this.isWhitelisted() && !whitelistReminders && !whitelistPause) {
            this.removeOverlay();
            return Promise.resolve();
        }

        // --- ATOMIC VISIT DETECTION ---
        // We detect "New Visit" synchronously at the START of evaluation.
        // FIX: Use sessionStorage instead of in-memory flag.
        // This ensures that Redirects (e.g. unsplash.com -> unsplash.com/nature) do NOT 
        // increment the launch count multiple times for a single "visit".
        const storageKey = `cure_launch_counted_${window.location.hostname}`;
        const isNewVisit = !this.isIframe && !sessionStorage.getItem(storageKey);
        if (isNewVisit) {
            sessionStorage.setItem(storageKey, 'true');
            this._launchCounted = true; // Still keep local for fast check
        }

        this._pEvaluation = new Promise(resolve => {
            const launchWindow = (this.settings.reminderTriggers?.launchLimit?.windowSeconds) || 3600;
            const siteWindow = this.settings.hardLockTriggers?.sessionLimit?.windowSeconds || 0;
            const browserWindow = this.settings.hardLockTriggers?.browserLimit?.windowSeconds || 86400;

            // MEGA FIX: Parallelize ALL critical state checks (including Reset Status)
            const pReset = this.isIframe ? Promise.resolve(null) : new Promise(r => this.safeSendMessage({ action: 'checkResetStatus', hostname: window.location.hostname }, r));
            const pLock = new Promise(r => this.safeSendMessage({ action: 'getLockState', hostname: window.location.hostname }, r));
            const pStats = new Promise(r => this.safeSendMessage({ 
                action: 'trackLaunch', 
                hostname: window.location.hostname,
                windowSeconds: launchWindow,
                siteWindowSeconds: siteWindow,
                browserWindowSeconds: browserWindow,
                isNewVisit: isNewVisit
            }, r));
            const pReminder = new Promise(r => this.safeSendMessage({ action: 'getReminderState', hostname: window.location.hostname }, r));

            Promise.all([pReset, pLock, pStats, pReminder]).then(([resReset, lockResponse, response, reminderRes]) => {
                // 1. Handle Background-Enforced Reset
                if (resReset && resReset.needsReset) {
                    sessionStorage.setItem('cure_needs_reset', 'true');
                    sessionStorage.setItem(`cure_needs_reset_${window.location.hostname}`, 'true');
                    this.stateHardLock('limit', true);
                    return resolve();
                }

                if (!lockResponse || !response) return resolve();

                // 2. Handle Cross-Tab Reminder Sync
                if (reminderRes) {
                    // FIX 186: Always sync threshold state even if inactive.
                    // This prevents new tabs from re-triggering a dismissal.
                    if (reminderRes.value > 0) {
                         this._lastReminderThreshold = reminderRes.value;
                         this._lastHeartbeatMinute = reminderRes.value;
                    }

                    if (reminderRes.active) {
                        sessionStorage.setItem('cure_reminder_active', '1');
                        // FIX: Always use the LIVE GROUND TRUTH when a reminder is active.
                        // This allows the UI to update from "6 visits" to "7 visits" mid-flight.
                        const displayValue = response?.currentLaunches || reminderRes.value;
                        
                        // If we have a newer count than the background, broadcast it to sync other tabs
                        const needsUpdate = (reminderRes.type === 'launch' && response?.currentLaunches > reminderRes.value);
                        
                        if (reminderRes.reminderStyle === 'toast') {
                            const site = this.getSiteName();
                            let toastMsg = '';
                            if (reminderRes.type === 'browser') {
                                toastMsg = `⌛ Browser Screen Time: ${displayValue}m spent`;
                            } else if (reminderRes.type === 'launch') {
                                toastMsg = `🚀 Visit Limit: ${displayValue} visits`;
                            } else {
                                toastMsg = `⏰ ${site} Activity: ${displayValue}m spent`;
                            }
                            this.showToast(toastMsg, 'reminder', {
                                reminderType: reminderRes.type,
                                targetHostname: reminderRes.hostname || window.location.hostname
                            });
                            
                            // FIX 183: Ensure state monitor starts for toasts!
                            // Otherwise the timer stops counting on refreshed tabs.
                            if (!this.isIframe && !this.timerInterval) this.stateMonitor();
                        } else {
                            this.renderReminderOverlay(displayValue, reminderRes.type, true);
                        }
                        return resolve();
                    }
                }

                // 3. Handle Whitelisting & Iframe logic
                if (lockResponse.tabWhitelisted && this.isIframe) {
                    this.removeOverlay();
                    return resolve();
                }

                // 4. Handle Sticky Unlock (Reward) logic
                if (lockResponse.unlocked === true) {
                    const rewardSecondsGranted = this.originalRewardSeconds || 0;
                    const rewardConsumed = rewardSecondsGranted > 0 && this.activeSeconds >= rewardSecondsGranted;
                    
                    if (rewardConsumed) {
                        this.stickyUnlocked = false;
                        this.resetTempUnlockStates();
                        this.safeSendMessage({ action: 'clearLockState', hostname: window.location.hostname });
                    } else {
                        this.stickyUnlocked = true;
                        sessionStorage.setItem(`cure_sticky_unlocked_${window.location.hostname}`, 'true');
                        if (sessionStorage.getItem('cure_success_page_active') === 'true') {
                            this.renderSuccess(this.settings.unlockReward || 5);
                            return resolve();
                        }
                        const root = this.ensureShadow();
                        const hasOverlay = root && root.getElementById(this.overlayId);
                        if (hasOverlay) this.removeOverlay();
                        if (!this.timerInterval) this.stateMonitor();
                        return resolve();
                    }
                } else if (this.isIframe && lockResponse.unlocked) {
                    this.removeOverlay();
                }

                // 5. Check Hard Lock Status
                if (lockResponse.locked) {
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

                // Sync local stats
                this.windowedSiteSeconds = response.siteSeconds || 0;
                if (this.mode === 'up') this.activeSeconds = this.windowedSiteSeconds;
                this.windowedBrowserSeconds = response.browserSeconds || 0;

                // 6. Evaluate All Triggers (Hard Lock)
                const triggerReason = this.checkAnyTrigger();
                if (triggerReason) {
                    sessionStorage.removeItem('cure_reminder_active');
                    this.stateHardLock(triggerReason === true ? null : triggerReason);
                    return resolve();
                }

                const masterRemindersOn = this.settings.masterReminders !== false;
                const rTriggers = this.settings.reminderTriggers || {};
                const currentLaunches = response?.currentLaunches || 0;
                const browserSecs = response?.browserSeconds || 0;

                if (masterRemindersOn) {
                    // Site Activity, Browser, and Launch Reminders are now handled EXCLUSIVELY by background.js.
                    // content.js only acts as a UI layer for broadcasts and syncs evaluation state to prevent flickering.
                }

                // 8. Check Pause Triggers (Still local for immediate feedback)
                const pauseTriggers = this.settings.pauseTriggers || {};
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

                // 9. Standard Frequency Pause
                if (this.settings.masterPause !== false && this.shouldShowBreathingRoom(response)) {
                    this.stateBreathingRoom('always');
                    return resolve();
                }

                if (!this.timerInterval) this.stateMonitor();
                resolve();
            });
        }).finally(() => {
            this._pEvaluation = null;
            if (this._pendingReEval) {
                this._pendingReEval = false;
                this.evaluateAllTriggers();
            }
        });

        return this._pEvaluation;
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
                console.debug('[Cure] Nav check failed', e);
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

                // Match exact or as subdomain
                return currentHostNoWww === cleanSiteNoWww ||
                    currentHostNoWww.endsWith('.' + cleanSiteNoWww);
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
        // FIX: Guard against stale breathing room triggers during settings transition.
        // If the user just changed settings (e.g. disabled breathing room), block re-entry.
        if (this._settingsChangedAt && (Date.now() - this._settingsChangedAt < 2000) && !forced) {
            console.debug('[Cure] Ignoring stale breathing room trigger during settings transition.');
            return;
        }

        let message = "Take a breath.";
        if (reason === 'launch') message = `Pause: You've visited ${this.settings.pauseTriggers?.launchLimit?.value || 5} times so far.`;
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

    /**
     * Fetches the authoritative time from the background script.
     * This is the "Single Source of Truth" ensuring all tabs match.
     */
    checkAuthoritativeTime() {
        if (!this.isContextValid()) return Promise.resolve();
        // Don't fetch if we are in reward mode (local countdown)
        if (this.mode === 'down') return Promise.resolve();

        return new Promise(resolve => {
            this.safeSendMessage({ 
                action: 'getTimerState', 
                hostname: window.location.hostname 
            }, (res) => {
                if (res && res.seconds !== undefined) {
                    // console.log(`[Cure] Auth Check: Remote=${res.seconds} Local=${this.activeSeconds}`);
                    
                    // Only update if greater (monotonic) or significantly different (reset)
                    if (res.seconds > this.activeSeconds) {
                        this.activeSeconds = res.seconds;
                        this.updatePill?.();
                    } else if (this.activeSeconds - res.seconds > 10) {
                        // Drift/Reset correction
                        this.activeSeconds = res.seconds;
                        this.updatePill?.();
                    }
                } else {
                    console.warn('[Cure] Auth Check Failed: Invalid response', res);
                }
                resolve();
            });
        });
    }

    // --- PERSISTENCE ---
    async loadTimer() {
        if (!this.isContextValid()) return;
        
        // FIX: Sync Guard (Time Travel Prevention)
        // Flag that we are fetching so saveTimer() knows to yield.
        this._isFetching = true;

        // FIX 194: Standardize Key
        const host = this.cleanHost(window.location.hostname);
        const key = `cure_timer_${host}`;

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
                this._isFetching = false; // Release lock
                resolve();
            });
        });
    }

    saveTimer() {
        if (!this.isContextValid()) {
            // FIX: Visual Indication of Orphaned State
            // If the extension context is invalidated (updated/reloaded), show reload emoji.
            const pill = this.shadowRoot?.getElementById(this.pillId);
            if (pill) {
                pill.style.border = '2px solid #FF3B30';
                pill.style.background = 'rgba(255, 255, 255, 0.9)';
                pill.innerHTML = `<span style="font-size:18px; cursor:pointer;" onclick="location.reload()">🔄</span>`;
                pill.title = 'Extension updated. Please reload the page.';
            }
            return;
        }

        // FIX 195: Visibility Guard.
        // Hidden tabs MUST NOT write to storage. They have stale time.
        // They only READ from storage via handleStorageChange.
        if (document.hidden) return;

        // FIX: Sync Guard (Time Travel Prevention)
        // If we are currently fetching the latest time from storage, 
        // DO NOT overwrite it with our potentially stale local state.
        if (this._isFetching) {
            // console.debug('[Cure] Save suppressed: Fetch in progress');
            return;
        }
        
        // FIX 192: Unblock iframes, but only if they are the active tracker (e.g. video playing)
        if (this.isIframe && !this.checkIfPlaying()) return;
        
        if (this._resetGuard) return; // FIX 126: Prevent zombie state saving during reset
        
        // FIX 194: Standardize Key
        const host = this.cleanHost(window.location.hostname);
        const key = `cure_timer_${host}`;
        const now = Date.now();

        const data = {
            timestamp: now,
            seconds: this.activeSeconds,
            mode: this.mode,
            sessionBaseSeconds: this.sessionBaseSeconds,
            originalRewardSeconds: this.originalRewardSeconds
        };

        // Monotonic check is handled reactively by other tabs via handleStorageChange (Fix 191)
        // DEPRECATED: Background is now the single source of truth.
        // We no longer write to this key to prevent race conditions.
        // chrome.storage.local.set({ [key]: data });
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

    syncDailyStats(full = false) {
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
            }, (res) => {
                // FIX 192: Adopt Authoritative Session Duration if provided
                // This ensures all tabs/iframes snap to the exact same second.
                if (res && res.sittingSeconds !== undefined) {
                    if (this.mode === 'up' && res.sittingSeconds > this.activeSeconds) {
                        this.activeSeconds = res.sittingSeconds;
                        this.updatePill?.(); 
                    }
                }
            });
            this.lastSyncedDailySeconds = this.dailySeconds;
            this.lastSyncedBrowserSeconds = this.browserSeconds;
        }

        this.lastSaveTime = Date.now(); // Reset sync timer

        if (!full) return Promise.resolve({});

        const triggers = settings.hardLockTriggers || {};
        return new Promise(resolve => {
            // Fetch Windowed Usage (Heavier)
            this.safeSendMessage({
                action: 'getWindowedUsage',
                hostname: host,
                siteWindowSeconds: triggers.sessionLimit?.windowSeconds || 0,
                browserWindowSeconds: triggers.browserLimit?.windowSeconds || 86400
            }, (res) => {
                if (res) {
                    this.windowedSiteSeconds = res.siteSeconds;
                    this.windowedBrowserSeconds = res.browserSeconds;
                    // ... reminder sync ...
                    if (res.reminderValue !== undefined && res.reminderValue >= this._lastReminderThreshold) {
                        this._lastReminderThreshold = res.reminderValue;
                        this._lastHeartbeatMinute = res.reminderValue;
                        const isActiveLocally = sessionStorage.getItem('cure_reminder_active') === '1';
                        // FIX: Respect settings-change guard here too
                        const inSettingsTransition = this._settingsChangedAt && (Date.now() - this._settingsChangedAt < 2000);
                        if (res.reminderActive && !isActiveLocally && !inSettingsTransition) {
                            this.renderReminderOverlay(res.reminderValue, 'time', true);
                        } else if (!res.reminderActive && isActiveLocally) {
                            this.removeOverlay();
                        }
                    }
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
    // FIX 139: Smart Media Check
    processInterventionQueue() {
        if (!this.interventionQueue || this.interventionQueue.length === 0) return;

        // BUGGY BASELINE: The one that caused the "dropped toasts" issue
        this.queueSnapshot = [...this.interventionQueue];
        
        // Handle Toast-style reminders
        this.updateToasts();

        // Handle Overlays (if any)
        const overlayReminders = this.queueSnapshot.filter(r => r.style === 'overlay');
        if (overlayReminders.length > 0) {
            const highest = overlayReminders.sort((a,b) => b.value - a.value)[0];
            this.renderReminderOverlay(highest.value, highest.type, true, 'overlay', highest.hostname);
        }

        // THE BUG: Clearing too early causes simultaneous heartbeats to wipe the queueSnapshot
        this.clearQueue(); 
    }

    clearQueue() {
        this.interventionQueue = [];
        this.queueSnapshot = []; 
    }

    updateToasts() {
        const root = this.ensureShadow();
        if (!root) return;

        const reminders = (this.queueSnapshot || []).filter(r => r.style === 'toast');
        if (reminders.length === 0) return;

        reminders.forEach(r => {
            // Dismissal Guard (5s safety)
            const lastDismissed = this._dismissedToasts ? this._dismissedToasts[r.type] : 0;
            if (lastDismissed && (Date.now() - lastDismissed < 5000)) return;

            let msg = '';
            if (r.type === 'browser') {
                msg = `🖥️ Browser Screen Time: ${r.value}m spent`;
            } else if (r.type === 'launch') {
                msg = `🚀 Visit Limit: ${r.value} visits`;
            } else {
                // Match renderReminderOverlay exactly: ⏰ Site Activity: Xm spent
                const site = this.getSiteName();
                msg = `⏰ ${site} Activity: ${r.value}m spent`;
            }
            
            this.showToast(msg, 'reminder', { 
                rType: r.type, 
                isStacked: true,
                persist: true 
            });
        });
    }

    repositionToasts() {
        const root = this.shadowRoot;
        if (!root) return;

        const toasts = Array.from(root.querySelectorAll('[id^="cure-popout-notification-"]'))
            .filter(t => t.style.opacity !== '0');
        
        // Sort by DOM order/timestamp? Let's just use existing order
        let currentOffset = this.isIframe ? 15 : 35;
        const spacing = this.isIframe ? 8 : 12;

        toasts.forEach((toast, index) => {
            toast.style.bottom = `${currentOffset}px`;
            currentOffset += toast.offsetHeight + spacing;
        });
    }

    checkIfPlaying() {
        const media = document.querySelectorAll('video, audio');
        for (const m of media) {
             // Removed readyState check to be more responsive to "Play" clicks even if buffering
             if (!m.paused && !m.ended) return true;
        }
        return false;
    }

    stateMonitor() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        // FIX 133: Initialize tracking baseline immediately. 
        // Previously relied on delta logic which could stall at 0 if starting focused.
        this.lastTickTime = performance.now();

        const runTick = () => {
            if (document.hidden) {
                this.lastTickTime = performance.now(); // Reset baseline when hidden
                return;
            }

            // FIX 139: Smart Iframe Tracking
            // Only track time if video is ACTUALLY playing.
            if (this.isIframe && !this.checkIfPlaying()) {
                 this.lastTickTime = performance.now(); // Reset baseline to prevent jumps
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
            
            // FIX 93: Polling Logic REMOVED.
            // It conflicts with Pessimistic Locking (which sets the flag immediately).
            // We rely on visibilitychange and init checks instead.

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

            // --- HEARTBEAT SYNC (Usage: 1s, Triggers: 10s) ---
            const timeSinceLastSync = Date.now() - (this.lastSyncTimestamp || 0);
            const isTimeForUsageSync = Date.now() - this.lastSaveTime > TIMERS.SAVE_INTERVAL_MS;
            
            if (deltaSecs >= 1 || timeSinceLastSync > 10000 || isTimeForUsageSync) {
                const needsFullSync = timeSinceLastSync > 10000;
                
                if (needsFullSync) {
                    this.lastSyncTimestamp = Date.now();
                    this.syncDailyStats(true); // Full sync (Windowed Usage, Launch, etc.)
                } else if (isTimeForUsageSync && deltaSecs >= 1) {
                    this.syncDailyStats(false); // Light sync (trackUsage only)
                }
            }

            // --- REACTIVE UI SYNC ---
            this.forceRefreshUI();

            // Special case: If we are currently showing a block overlay but it's now "Safe", remove it instantly
            const root = this.ensureShadow();
            const hasOverlay = root && root.getElementById(this.overlayId);
            const reminderActive = sessionStorage.getItem('cure_reminder_active') === '1';

            if (hasOverlay && !hardLockEffective && !pauseEffective && !reminderActive) {
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
            this.checkReminders(deltaSecs);
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


    stateHardLock(reason = 'limit', forced = false, phase = 'decision') {
        if (!this.isContextValid()) return;
        
        // FIX: Guard against stale lock triggers during settings transition.
        // If the user just changed settings (e.g. disabled strict lock), block re-entry.
        if (this._settingsChangedAt && (Date.now() - this._settingsChangedAt < 2000) && !forced) {
            console.debug('[Cure] Ignoring stale lock trigger during settings transition.');
            return;
        }
        
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

        this.renderOverlay('locked', reason, forced, phase);
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
    showToast(msg, type = 'info', options = {}) {
        const root = this.ensureShadow();
        if (!root) return; 

        // UNIQUE ID: Restored to allow stacking
        const toastId = options.isStacked ? `cure-popout-notification-${options.rType}` : 'cure-popout-notification';
        
        const existing = root.getElementById(toastId);
        if (existing && existing.dataset.type === type) {
            const msgSpan = existing.querySelector('span');
            if (msgSpan) {
                msgSpan.textContent = msg;
                existing.style.opacity = '1';
                existing.style.transform = 'translateX(-50%) scale(1.05)';
                setTimeout(() => { existing.style.transform = 'translateX(-50%) scale(1)'; }, 150);
                return;
            }
        }
        if (existing) existing.remove();

        const popout = document.createElement('div');
        popout.id = toastId;
        popout.dataset.type = type;

        // Inject Keyframes
        if (!root.getElementById('cure-pulse-style-final')) {
            const style = document.createElement('style');
            style.id = 'cure-pulse-style-final';
            style.textContent = `
                @keyframes cure-pulse-nuclear {
                    0% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0.7); transform: translateX(-50%) scale(1); }
                    70% { box-shadow: 0 0 0 15px rgba(255, 59, 48, 0); transform: translateX(-50%) scale(1.02); }
                    100% { box-shadow: 0 0 0 0 rgba(255, 59, 48, 0); transform: translateX(-50%) scale(1); }
                }
                @keyframes cure-pulse-soft {
                    0% { transform: translateX(-50%) scale(1); box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
                    50% { transform: translateX(-50%) scale(1.01); box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
                    100% { transform: translateX(-50%) scale(1); box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
                }
            `;
            root.appendChild(style);
        }

        let bgColor = '#007AFF'; 
        let animation = 'none';

        if (type === 'warning' || type === 'error') {
            bgColor = '#FF3B30';
            animation = 'cure-pulse-nuclear 2s infinite';
        } else if (type === 'reminder') {
            bgColor = '#1D1D1F';
            animation = 'cure-pulse-soft 3s infinite';
        }

        const bottomOffset = this.isIframe ? '15px' : '35px';
        const padding = this.isIframe ? '6px 12px' : '10px 20px';
        const fontSize = this.isIframe ? '11px' : '14px';
        const gap = this.isIframe ? '6px' : '12px';

        popout.style.cssText = `
            position: fixed;
            bottom: ${bottomOffset};
            left: 50%;
            transform: translateX(-50%);
            background: ${bgColor};
            color: white;
            padding: ${padding};
            border-radius: 50px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            font-size: ${fontSize};
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: ${gap};
            opacity: 0; 
            transition: opacity 0.3s ease, transform 0.3s ease, bottom 0.3s ease;
            white-space: nowrap;
            pointer-events: auto;
            animation: ${animation};
        `;

        const msgSpan = document.createElement('span');
        msgSpan.textContent = msg;
        popout.appendChild(msgSpan);

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '✕';
        const closeSize = this.isIframe ? '16px' : '20px';
        const closeFontSize = this.isIframe ? '10px' : '12px';
        closeBtn.style.cssText = `background:rgba(255,255,255,0.2); border:none; width:${closeSize}; height:${closeSize}; border-radius:50%; color:white; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:${closeFontSize}; flex-shrink:0;`;
        
        closeBtn.onclick = () => {
            popout.style.opacity = '0';
            setTimeout(() => { 
                if (popout.parentElement) popout.remove(); 
                this.repositionToasts();
            }, 300);
            
            if (type === 'reminder') {
                const rType = options.rType || 'time';
                const isGlobal = (rType === 'browser');
                this._dismissedToasts[rType] = Date.now();
                sessionStorage.removeItem('cure_reminder_active');

                this.safeSendMessage({
                    action: 'broadcastReminderState',
                    hostname: isGlobal ? 'global' : window.location.hostname,
                    show: false,
                    type: rType,
                    reminderStyle: 'toast',
                    initiatorInstanceId: this.instanceId
                });
            }
        };
        popout.appendChild(closeBtn);

        root.appendChild(popout);
        setTimeout(() => { 
            popout.style.opacity = '1'; 
            this.repositionToasts();
        }, 50);

        if (options.persist !== true) {
            setTimeout(() => {
                if (popout.parentElement) {
                    popout.style.opacity = '0';
                    setTimeout(() => { 
                        if (popout.parentElement) popout.remove(); 
                        this.repositionToasts();
                    }, 300);
                }
            }, options.duration || TIMERS.TOAST_DURATION_MS);
        }
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
        sessionStorage.removeItem('cure_reminder_active');
        
        if (this.shadowRoot) {
            const o = this.shadowRoot.getElementById(this.overlayId);
            if (o) o.remove();

            // FIX 186: Also remove the toast notification if it exists!
            const toast = this.shadowRoot.getElementById('cure-popout-notification');
            if (toast) toast.remove();

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
        
        // Clean up old key if it exists (migration)
        this.safeSendMessage({ action: 'sessionStorageProxy', op: 'remove', key: `cure_snapshot_${window.location.hostname}` });
        
        // Fix 77: Removed redundant flag reset here.
        MediaController.stopEnforcement();
    }

    renderIframeBlocked(root, reason = null, metadata = {}) {
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
            z-index: 2147483647;
            pointer-events: auto;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            padding: 10px; box-sizing: border-box; text-align: center;
            color: #1d1d1f; user-select: none;
        `;
        
        // Reason-based labels
        let label = metadata.title || "Session Limit Reached";
        let subText = metadata.subtitle || (reason === 'reminder' ? 'Time for a break?' : 'Complete challenge in new tab to unlock');
        let emoji = metadata.emoji || (reason === 'reminder' ? '⏰' : '🔒');
        let btnText = metadata.continueText || (reason === 'reminder' ? 'Continue Watching' : 'Unlock →');
        
        if (reason === 'blocked') label = "Site Blocked";
        else if (reason === 'launchLimit' && !metadata.title) label = "Launch Limit Reached";
        else if (reason === 'browserLimit' && !metadata.title) label = "Browser Limit Reached";
        else if (reason === 'pause') label = "Take a Breath";
        
        // Custom Rich UI for Reminder (Big Red Timer)
        let contentHtml = '';
        if (reason === 'reminder' && metadata.timeLabel) {
             contentHtml = `
                 <div style="font-size: min(40px, 8vw); margin-bottom: 4px;">${emoji}</div>
                 <div style="font-size: min(18px, 5vw); font-weight: 700;">${label}</div>
                 <div style="font-size: min(12px, 3.5vw); opacity: 0.8; margin-bottom: 8px; max-width: 80%; line-height: 1.3;">${subText}</div>
                 
                 <div class="cure-pulse-timer" style="font-size: min(32px, 10vw); font-weight: 800; color: #FF3B30; line-height: 1;">
                     ${metadata.timeLabel}
                 </div>
                 <div style="font-size: min(12px, 3.5vw); font-weight: 500; opacity: 0.6; margin-bottom: 12px;">
                     ${metadata.timeUnit || 'minutes spent'}
                 </div>
                 
                 <style>
                    @keyframes cure-pulsate {
                        0% { transform: scale(1); opacity: 1; }
                        50% { transform: scale(1.05); opacity: 0.9; }
                        100% { transform: scale(1); opacity: 1; }
                    }
                    .cure-pulse-timer {
                        animation: cure-pulsate 2s infinite ease-in-out;
                    }
                    @media (min-height: 350px) {
                        #cure-iframe-alts { display: flex !important; }
                    }
                 </style>
                 <!-- Alternatives Placeholder (populated if space allows) -->
                 <div id="cure-iframe-alts" style="display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; justify-content: center; display: none;"></div>
             `;
        } else {
            // Standard Lock/Block UI - Upgraded to match Rich Style
            contentHtml = `
                <div style="font-size: min(40px, 10vw); margin-bottom: 8px;">${emoji}</div>
                <div style="font-size: min(18px, 5vw); font-weight: 700; line-height: 1.2; padding: 0 5px;">${label}</div>
                <div style="font-size: min(12px, 3.5vw); opacity: 0.8; margin-top: 4px; max-width: 80%; line-height: 1.3;">${subText}</div>
                
                <div class="cure-iframe-hide-small" style="font-size: 11px; opacity: 0.6; margin-top: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">
                    ${this.dailySeconds > 0 ? Math.floor(this.dailySeconds / 60) + 'm used today' : ''}
                </div>
                <style>
                    @media (max-height: 150px) {
                        .cure-iframe-hide-small { display: none !important; }
                    }
                </style>
            `;
        }
        
        overlay.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%;">
                ${contentHtml}
                <button id="cure-iframe-unlock-btn" data-reason="${reason}" data-type="${metadata.reminderType || ''}" data-value="${metadata.value || ''}" style="
                    margin-top: 12px; font-size: min(13px, 3.5vw); color: #86868B;
                    font-weight: 600; background: transparent; padding: 10px 20px; border-radius: 12px;
                    box-shadow: none; border: 2px solid #E5E5EA; cursor: pointer;
                    transition: all 0.2s ease;
                ">${btnText}</button>
                <style>
                    #cure-iframe-unlock-btn:hover {
                        background: #f5f5f7 !important;
                        border-color: #d1d1d6 !important;
                        color: #1d1d1f !important;
                    }
                </style>
            </div>
        `;
        
        root.appendChild(overlay);
        
        // Alternatives Logic (Inject if Reminder)
        if (reason === 'reminder' && this.settings.shortcuts) {
            const altsParams = overlay.querySelector('#cure-iframe-alts');
            if (altsParams) {
                // Take first 3 shortcuts
                this.settings.shortcuts.slice(0, 3).forEach(s => {
                     const btn = document.createElement('a');
                     btn.href = s.url;
                     btn.target = "_blank";
                     btn.style.cssText = "display: flex; align-items: center; gap: 4px; padding: 6px 12px; background: white; border-radius: 8px; text-decoration: none; color: #1d1d1f; font-size: 11px; font-weight: 600; box-shadow: 0 2px 5px rgba(0,0,0,0.05);";
                     
                     let iconUrl = this.getFaviconUrl(s.url);
                     let name = s.name;
                     if (!name) { try { name = new URL(s.url).hostname.replace('www.',''); } catch(e){ name = 'Link'; } }
                     
                     btn.innerHTML = `<img src="${iconUrl}" style="width:14px;height:14px;border-radius:3px;"> ${name}`;
                     altsParams.appendChild(btn);
                });
            }
        }
        
        const btn = overlay.querySelector('#cure-iframe-unlock-btn');
        if (btn) {
            btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();

                const btnReason = btn.dataset.reason;

                // FIX 129: For reminders, allow direct dismissal from iframe
                // This broadcasts the dismissal to all tabs (including this iframe)
                if (btnReason === 'reminder') {
                    const rType = btn.dataset.type || 'time';
                    const rValue = btn.dataset.value || '';
                    
                    this.safeSendMessage({
                        action: 'broadcastReminderState',
                        hostname: window.location.hostname,
                        show: false,
                        type: rType,
                        value: rValue
                    });
                    
                    // FIX 167: Also set the dismissal flag for site-specific launch reminders
                    if (rType === 'launch' && rValue) {
                        this.safeSendMessage({ 
                            action: 'sessionStorageProxy', 
                            op: 'set', 
                            key: `cure_global_remind_dismissed_launch_${window.location.hostname}_${rValue}`, 
                            value: true 
                        });
                        
                        // FIX 168: Clear launch history for a "clean slate" after unlocking
                        this.safeSendMessage({ 
                            action: 'clearLaunchHistory', 
                            hostname: window.location.hostname 
                        });
                    }
                    
                    // Optimistically unblock immediately (handler will also catch it)
                    MediaController.stopEnforcement();
                    this.removeOverlay();
                    return;
                }

                const originalText = btn.innerText;
                btn.innerText = "Challenge Active in New Tab...";
                btn.style.opacity = "0.7";
                btn.disabled = true;

                // Open the main page with a challenge flag
                // This ensures we get the full-screen typing challenge in a new tab
                const challengeUrl = window.location.href + (window.location.href.includes('?') ? '&' : '?') + 'cure_challenge=true';
                window.open(challengeUrl, '_blank');

                // Fallback: If no response in 10s (user closed tab or something), reset button
                setTimeout(() => {
                    if (btn.innerText === "Challenge Active in New Tab...") {
                        btn.innerText = originalText;
                        btn.style.opacity = "1";
                        btn.disabled = false;
                    }
                }, 10000);
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
        // Allow rendering even if invalid to show the "reload" state
        // if (!this.isContextValid()) return;
        const root = this.ensureShadow();
        if (!root || root.getElementById(this.pillId)) return;
        const pill = document.createElement('div');
        pill.id = this.pillId;
        pill.innerHTML = `<span style="font-size:14px;">⏳</span> <span id="cure-time-text">0min 00sec</span>`;
        if (this.isIframe) pill.classList.add('cure-iframe-pill');
        root.appendChild(pill);
    }

    updatePill() {
        if (!this.stateInitialized) return;
        
        // FIX: Handle Invalid Context (Extension Update)
        if (!this.isContextValid()) {
            const root = this.ensureShadow();
            if (!root) return;
            this.renderPill();
            const pill = root.getElementById(this.pillId);
            if (pill) {
                pill.style.border = '2px solid #FF3B30';
                pill.innerHTML = `<span style="font-size:18px; cursor:pointer;" onclick="location.reload()">🔄</span>`;
                pill.title = 'Extension updated. Please reload the page.';
            }
            return;
        }

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

    renderOverlay(mode, message = "Take a breath.", forced = false, phase = 'decision') {
        // FIX 108: Ultimate Whitelist Safety
        // FIX 129: Respect "Enable on Allowlist" for Reminders/Pause screens.
        const whitelistReminders = !!this.settings.reminderWhitelist;
        const whitelistPause = !!this.settings.pauseWhitelist;
        const isSafeToRender = (mode === 'breathing' && (whitelistReminders || whitelistPause));

        if (this.isWhitelisted() && !forced && !isSafeToRender) {
            this.removeOverlay();
            return;
        }

        // FIX 100: Iframes should COMPLETELY SKIP pause/breathing/reminder screens.
        // These are mindfulness prompts for when you first visit a site - irrelevant for embedded content.
        // Only hard lock (mode === 'locked') is meaningful for iframes.
        if (this.isIframe) {
             // FIX 131: Generalized Iframe Blocking
             // Any blocking mode (locked, reminder, etc) should use the simplified UI
             if (mode === 'locked' || mode === 'reminder') {
                 // Map reason. If mode is locked, use provided reason or 'limit'.
                 const reason = (mode === 'reminder') ? 'reminder' : 'limit';
                 this.renderIframeBlocked(this.ensureShadow(), reason);
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
            // FIX: Phase Routing.
            // If phase is 'protocol', skip the Decision/Time's Up screen and go straight to protocols.
            // This is used for manual re-locks (Lock Transition) to prevent "No Challenge" bugs.
            if (phase === 'protocol') {
                this.renderHardLock(overlay);
            } else {
                this.renderDecisionScreen(this.settings.hardLockDuration || 30, message, forced);
            }
        } else {
            this.renderBreathing(overlay, message, forced);
        }
    }

    renderReminderOverlay(value, type = 'time', forced = false, styleOverride = null, targetHostname = null) {
        // NUCLEAR SAFEGUARD: If we ever try to show a "0 min" site reminder, self-destruct.
        if (type === 'time' && value <= 0 && !forced) {
            console.log('[Cure] Suppressing 0-min ghost reminder overlay.');
            sessionStorage.removeItem('cure_reminder_active');
            return;
        }

        let emoji = "⏰";
        let title = "Productivity Check";
        let timeLabel = `${value}`;
        let timeUnit = 'minutes spent';
        const site = this.getSiteName();
        let subtitle = `You've been active on ${site} for a while.`;
        let continueText = "Continue Browsing (Unlock Site)";

        if (type === 'browser') {
            emoji = "🖥️";
            title = "Daily Screen Time";
            timeLabel = `${value}`;
            timeUnit = 'minutes total';
            subtitle = `You've reached your daily screen time reminder limit.`;
            continueText = "Continue Browsing (Unlock Site)";
        } else if (type === 'launch') {
            emoji = "🚀";
            title = "Frequent Visit Alert";
            timeLabel = `${value}`;
            const windowText = this.settings.reminderTriggers?.launchLimit?.windowSeconds === 86400 ? 'today' : 'this hour';
            const timesWord = value === 1 ? 'time' : 'times';
            timeUnit = `${timesWord} ${windowText}`;
            subtitle = `Total visits to ${site} this hour`;
            continueText = "Continue Browsing (Unlock Site)";
        } else {
            // Default: 'time' (Site Activity)
            title = "Reminder";
            subtitle = `You've spent ${value} minutes on ${site}.`;
        }

        const rStyle = styleOverride || this.settings.reminderStyle || 'overlay';
        
        if (rStyle === 'overlay' && this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }

        if (this.settings.soundEnabled !== false) {
            try { SoundEngine.playChime('warning'); } catch (e) { }
        }

        sessionStorage.setItem('cure_reminder_active', '1');

        // FIX 128/142: Broadcast reminder to ALL tabs of this hostname
        // Critical: We do this BEFORE the iframe check so the Main Tab gets the message!
        if (!forced) {
            this.safeSendMessage({
                action: 'broadcastReminderState',
                hostname: window.location.hostname,
                show: true,
                value: value,
                type: type
            });
        }

        // FIX 170/171: Respect reminderStyle in ALL contexts (main tab AND iframes)
        // FIX 171: Toast now persists across tabs via g_activeReminders
        if (rStyle === 'toast') {

            // Build toast message based on type
            let toastMsg = '';
            if (type === 'browser') {
                toastMsg = `⌛ Browser Screen Time: ${value}m spent`;
            } else if (type === 'launch') {
                toastMsg = `🚀 Visit Limit: ${value} visits`;
            } else {
                toastMsg = `⏰ ${this.getSiteName()} Activity: ${value}m spent`;
            }
            this.showToast(toastMsg, 'reminder', { reminderType: type, targetHostname: targetHostname || window.location.hostname });
            
            // Broadcast to background so other tabs/iframes can restore this toast
            if (!forced) {
                this.safeSendMessage({
                    action: 'broadcastReminderState',
                    hostname: window.location.hostname,
                    show: true,
                    value: value,
                    type: type,
                    reminderStyle: 'toast'
                });
            }
            return;
        }

        if (this.isIframe) {
            // FIX 166/171: Rich Iframe UI for ALL reminder types including Global ones
            // Pass full metadata so iframe can render a matching UI
            this.renderIframeBlocked(this.ensureShadow(), 'reminder', {
                emoji, title, timeLabel, timeUnit, subtitle, continueText, value, reminderType: type 
            });
            return;
        }

        this.renderOverlay('breathing', subtitle, forced); // FIX: Replace undefined contextText with subtitle

        if (!this.shadowRoot) return;
        const overlay = this.shadowRoot.getElementById(this.overlayId);
        if (!overlay) return;

        // Build shortcuts HTML
        const shortcuts = (this.settings.shortcuts || []).slice(0, 6).map(s => {
            const iconUrl = this.getFaviconUrl(s.url);
            let hostname = '';
            try {
                hostname = new URL(s.url).hostname;
            } catch (e) {
                return '';
            }
            return `<a href="${s.url}" class="cure-shortcut-card">
                <img src="${iconUrl}" class="cure-shortcut-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${hostname}&sz=64'">
                <span class="cure-shortcut-name">${s.name}</span>
            </a>`;
        }).join('');

        const shortcutsSection = shortcuts ? `
            <div class="cure-shortcuts-container" style="margin-top:32px;">
                <div class="cure-shortcuts-label">Productive Alternatives</div>
                <div class="cure-hand-pointer">👇</div>
                <div class="cure-shortcuts-row">${shortcuts}</div>
            </div>
        ` : '';

        overlay.innerHTML = `
            <div class="cure-overlay-container">
                <div class="cure-header" style="margin-bottom:0px;">
                    <div style="font-size:48px; margin-bottom:8px;">${emoji}</div>
                    <h1 class="cure-title-large">${title}</h1>
                    <p class="cure-subtitle" style="margin-bottom:8px;">${subtitle}</p>
                    <p class="cure-anim-pulse" style="font-size:32px; font-weight:700; color:#FF3B30; margin:12px 0;">${timeLabel}</p>
                    <p class="cure-subtitle" style="margin:0;">${timeUnit}</p>
                </div>

                ${shortcutsSection}

                <div style="margin-top: 40px; text-align: center; display: flex; flex-direction: column; gap: 24px;">
                    <p style="color:#6B6B6F; font-size:16px; font-weight: 400; margin: 0 auto;">
                        Are you being productive, or just scrolling?
                    </p>
                    <button id="cure-reminder-continue-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #E5E5EA; color:#86868B; box-shadow:none; margin: 0 auto; width: 100%; max-width: 400px; padding: 16px 24px;">
                        <span class="cure-btn-content">${continueText}</span>
                    </button>
                </div>
            </div>
        `;

        const btn = this.shadowRoot.getElementById('cure-reminder-continue-btn');
        if (btn) {
            btn.onclick = async () => {
                sessionStorage.removeItem('cure_reminder_active');
                sessionStorage.removeItem('cure_launch_counted'); // FIX: Allow re-counting for iterative launch
                

                // FIX 128/156: Broadcast dismissal to ALL tabs (hostname-specific or global)
                this.safeSendMessage({
                    action: 'broadcastReminderState',
                    hostname: window.location.hostname,
                    show: false,
                    type: type,
                    initiatorInstanceId: this.instanceId
                });
                
                // If this is a global reminder (browser/launch), notify background to dismiss it for ALL tabs
                if (type === 'browser' || type === 'launch') {
                    const hostPart = type === 'launch' ? `_${window.location.hostname}_` : '_';
                    this.safeSendMessage({ 
                        action: 'sessionStorageProxy', 
                        op: 'set', 
                        key: `cure_global_remind_dismissed_${type}${hostPart}${value}`, 
                        value: true 
                    });
                    
                }

                this.removeOverlay();
                document.body.style.overflow = '';
                
                // Small delay before monitor restarts to ensure background state is synced/pruned
                setTimeout(() => this.stateMonitor(), 200);
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
                <div class="cure-header" style="margin-bottom: 16px;">
                    <div style="font-size:42px; margin-bottom:10px;">${emoji}</div>
                    <h1 class="cure-title-large">${title}</h1>
                    <p class="cure-subtitle" style="margin-bottom: 8px;">${subtitle}</p>
                    ${this.dailySeconds > 0 ? `
                        <p class="cure-anim-pulse" style="font-size:32px; font-weight:700; color:#FF3B30; margin:12px 0;">${Math.floor(this.dailySeconds / 60)}</p>
                        <p class="cure-subtitle" style="margin:0;">minutes spent today</p>
                    ` : ''}
                </div>

                <div class="cure-shortcuts-container" style="margin-top: 32px; margin-bottom: 40px;">
                    <div class="cure-shortcuts-label">Productive Alternatives</div>
                    <div class="cure-hand-pointer">👇</div>
                    <div class="cure-shortcuts-row">
                        ${shortcuts}
                    </div>
                </div>

                <div style="margin-top: 0px;">
                     <button id="cure-unlock-decision-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #E5E5EA; color:#86868B; box-shadow:none;">
                        <span class="cure-btn-content">Continue Wasting Time (Unlock)</span>
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
                        // FIX: Lock Transition Hook.
                        // We use the 'protocol' phase to jump straight to the challenge.
                        // This establishes authority (snapshot new settings) AND advances UI.
                        await this.stateHardLock('limit', true, 'protocol');
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
            let hostname = '';
            try {
                hostname = new URL(s.url).hostname;
            } catch (e) {
                console.warn("Invalid shortcut URL:", s.url, e);
                return ''; 
            }
            return `<a href="${s.url}" class="cure-shortcut-card">
                <img src="${iconUrl}" class="cure-shortcut-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${hostname}&sz=64'"> 
                <span class="cure-shortcut-name">${s.name}</span>
            </a>`;
        }).join('');

        overlay.innerHTML = `
        <div class="cure-overlay-container" style="padding-bottom: 80px;">
            <div class="cure-logo">🧘‍♂️</div> 
            <h1 class="cure-title-large">Cure Procrastination</h1>
            <p class="cure-subtitle" style="margin-top: 4px; color: #86868B;">${message}</p>
            <p class="cure-quote-medium" style="margin-top: 12px;">"${quote}"</p>
            
            <div class="cure-shortcuts-container" style="margin-top: 32px; margin-bottom: 40px;">
                <div class="cure-shortcuts-label">Productive Alternatives</div>
                <div class="cure-hand-pointer">👇</div>
                <div class="cure-shortcuts-row">${shortcuts}</div>
            </div>

            <div class="cure-action-wrapper" style="margin: 0; flex-direction: column; gap: 24px;">
                <p style="color:#6B6B6F; font-size:16px; font-weight: 400; margin: 0 auto;">
                    Are you being productive, or just scrolling?
                </p>
                <button id="cure-continue-btn" class="cure-btn-unlock counting" style="margin:0 auto;">
                    <div id="cure-progress-fill" class="cure-progress-fill-anim"></div>
                    <span id="cure-btn-text" class="cure-btn-content">Readying...</span>
                </button>
            </div>
        </div >
            `;
    }

    // --- STATE 3: HARD LOCK (ADVANCED) ---
    async renderHardLock(overlay) {
        const root = this.ensureShadow();
        
        // FIX 85: Premature activation bug.
        // We no longer set isTypingChallengeActive here, as we haven't entered a protocol yet.

        // Use authoritative settings (Snapshotted by background if locked)
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

        // If no protocols remain (and we haven't unlocked yet), it means either:
        // 1. All protocols passed (handled above)
        // 2. No protocols are enabled (Permanent Block)
        
        if (!this.tempDelayComplete && !this.tempPasswordComplete) {
            // No methods available to unlock this site today
            this.renderGodMode(overlay);
        } else {
            // If we got here and some are complete, we unlock.
            this.unlockSession(this.settings.unlockReward || 5);
        }
    }

    renderGodMode(overlay) {
        overlay.innerHTML = `
            <div class="cure-overlay-container" style="justify-content: flex-start;">
                <div style="font-size:48px; margin-bottom:12px;">⛔</div>
                <h1 class="cure-title-large">Locked Until Reset</h1>
                <p class="cure-subtitle" style="margin-top:4px; max-width:400px;">
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
            <div class="cure-overlay-container" style="justify-content: flex-start;">
                <div style="font-size:48px; margin-bottom:12px;">⏳</div>
                <h1 class="cure-title-large">Patience is Key</h1>
                <p class="cure-subtitle" style="margin-top:4px; margin-bottom:30px;">You must wait before attempting to unlock.</p>
                
                <!-- Circular Timer -->
                <div style="position:relative; width:160px; height:160px; margin: 0 auto 30px auto;">
                    <svg width="160" height="160" viewBox="0 0 160 160" style="transform: rotate(-90deg);">
                        <circle cx="80" cy="80" r="${radius}" stroke="#E5E5EA" stroke-width="8" fill="none"></circle>
                        <circle id="cure-timer-ring" cx="80" cy="80" r="${radius}" stroke="#1D1D1F" stroke-width="8" fill="none" 
                                stroke-linecap="round" stroke-dasharray="${circumference}" stroke-dashoffset="0"
                                style="transition: stroke-dashoffset 1s linear;"></circle>
                    </svg>
                    <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; flex-direction:column; padding: 0 10px;">
                        <span id="cure-delay-timer" class="cure-anim-pulse" style="font-size:24px; font-weight:700; color:#FF3B30; font-variant-numeric: tabular-nums; text-align: center; line-height: 1.2;">--:--</span>
                    </div>
                </div>
                
                <div style="margin-top: 20px; width: 100%; max-width: 300px; margin-left: auto; margin-right: auto;">
                    <button id="cure-delay-give-up" class="cure-btn-unlock cure-anim-pulse-black" style="background:#1d1d1f; border: none; color:#ffffff; font-size:16px; padding:16px 32px; height:56px; border-radius: 12px; width: 100%; box-shadow: 0 4px 12px rgba(0,0,0,0.1); font-weight:600;">
                        I'd rather be productive
                    </button>
                </div>

                <p style="color:#86868B; font-size:13px; margin-top: 16px;">Use this time to reconsider your choices.</p>
            </div>
        `;

        if (this.delayInterval) clearInterval(this.delayInterval);
        if (!this.shadowRoot) return;
        
        const timerEl = this.shadowRoot.getElementById('cure-delay-timer');
        const ringEl = this.shadowRoot.getElementById('cure-timer-ring');
        const giveUpBtn = this.shadowRoot.getElementById('cure-delay-give-up');

        if (giveUpBtn) {
            giveUpBtn.onclick = () => {
                if (this.delayInterval) clearInterval(this.delayInterval);
                this.renderDecisionScreen(this.settings.hardLockDuration || 30);
            };
        }

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
            <div class="cure-overlay-container" style="justify-content: flex-start;">
                <div style="font-size:48px; margin-bottom:12px;">🔑</div>
                <h1 class="cure-title-large">Password Required</h1>
                <p class="cure-subtitle" style="margin-top:4px;">Enter your secret key to proceed.</p>
                
                <div style="width:100%; max-width:300px; margin-top:30px;">
                    <div class="cure-pass-container">
                        <input type="password" id="cure-pass-input" class="cure-typing-input" placeholder="Enter password..." style="height:56px; text-align:center; font-size:18px; padding-right: 50px;">
                        <button id="cure-pass-toggle" class="cure-pass-toggle" type="button" title="Show/Hide Password" style="color: #1d1d1f; opacity: 0.6;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M12 4.5C7 4.5 2.73 7.61 1 12C2.73 16.39 7 19.5 12 19.5C17 19.5 21.27 16.39 23 12C21.27 7.61 17 4.5 12 4.5ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17ZM12 9C10.34 9 9 10.34 9 12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12C15 10.34 13.66 9 12 9Z" fill="currentColor"/>
                            </svg>
                        </button>
                    </div>
                    <div id="cure-pass-error" style="color:#FF3B30; margin-top:12px; opacity:0; font-size:14px; font-weight:600; text-align:center;">
                        Incorrect Password
                    </div>
                    <button id="cure-pass-submit" class="cure-btn-unlock cure-anim-pulse-black" style="margin-top:16px; width:100%; background:#1d1d1f; border-radius: 12px; font-weight: 600;">
                        I'd rather be productive
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
                // Update Icon
                if (isPass) {
                    // Show "Hide" icon (Slash)
                    toggle.innerHTML = `
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M11.83 9L15 12.17V12C15 10.34 13.66 9 12 9H11.83ZM19.78 22.61L1.39 4.22L2.8 2.81L19.64 19.65L21.2 21.2L19.78 22.61ZM2.04 4.89C0.97 7 0.5 9.25 1 12C2.73 16.39 7 19.5 12 19.5C13.55 19.5 15.03 19.2 16.38 18.66L14.81 17.09C13.97 17.36 13.04 17.5 12 17.5C9.24 17.5 7 15.26 7 12.5C7 11.46 7.37 10.5 8.01 9.74L2.04 4.89ZM7.53 9.8L9.08 11.35C9.03 11.72 9 12.1 9 12.5C9 14.16 10.34 15.5 12 15.5C12.4 15.5 12.78 15.47 13.15 15.42L14.7 16.97C13.94 17.61 12.98 18 12 17.92C12.03 17.92 12.07 17.92 12.1 17.92L7.53 9.8ZM11.84 9.09L14.28 11.53L14.91 12.16L17.76 15.01C19.79 12.44 21.4 9.4 23 12C21.27 7.61 17 4.5 12 4.5C10.15 4.5 8.44 5.08 6.95 6.06L9.2 8.31C9.69 7.42 10.66 6.8 11.84 6.8V9.09Z" fill="currentColor"/>
                        </svg>
                    `;
                } else {
                    // Show "Show" icon (Eye)
                    toggle.innerHTML = `
                         <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 4.5C7 4.5 2.73 7.61 1 12C2.73 16.39 7 19.5 12 19.5C17 19.5 21.27 16.39 23 12C21.27 7.61 17 4.5 12 4.5ZM12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17ZM12 9C10.34 9 9 10.34 9 12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12C15 10.34 13.66 9 12 9Z" fill="currentColor"/>
                        </svg>
                    `;
                }
            };
        }

        let passResolved = false;

        // Validation Function
        const validate = (fromInput = false) => {
            if (passResolved) return; // Already done

            if (input.value === correctPassword) {
                passResolved = true;
                
                // Success Effects
                input.disabled = true;
                input.blur();
                try { SoundEngine.playChime('success'); } catch (e) { }
                if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

                submit.textContent = "I’m giving in. Unlock.";
                submit.classList.remove('cure-anim-pulse-black'); 
                submit.style.background = "transparent";
                submit.style.color = "#86868B";
                submit.style.border = "2px solid #E5E5EA";
                submit.style.fontWeight = "600";
                submit.style.boxShadow = "none";
                
                // Re-bind click to unlock
                submit.onclick = () => {
                    this.tempPasswordComplete = true;
                    this.renderHardLock(overlay);
                };
            } else {
                // Only show error on explicit submission (Enter key), not just typing
                if (!fromInput) {
                     err.style.opacity = '1';
                     input.classList.add('shake');
                     setTimeout(() => input.classList.remove('shake'), 400);
                }
            }
        };

        // Real-time detection
        input.oninput = () => {
            if (input.value === correctPassword) {
                validate(true);
            }
        };

        input.onkeydown = (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                if (input.value === correctPassword) {
                    validate(); 
                    // If they hit enter and it's correct, we can either:
                    // 1. Just transform button (matches "don't automatically open")
                    // 2. Or unlock immediately. 
                    // Given the user's specific request "change the button and when they click it it unlock",
                    // we'll just focus the button so they can hit Enter again or click it.
                    submit.focus();
                } else {
                    validate(); // Shows error shake
                }
            }
        };

        // Initial Button State: "I'd rather be productive" -> Go Back
        submit.onclick = () => {
             if (passResolved) {
                 // Should have been rebound, but just in case
                 this.tempPasswordComplete = true;
                 this.renderHardLock(overlay);
             } else {
                 this.renderDecisionScreen(this.settings.hardLockDuration || 30);
             }
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

        // Settings are already snapshotted by the background script if site is locked.
        const typingSettings = this.settings.unlockProtocols?.typing || {};
        const difficulty = typingSettings.difficulty || this.settings.typingDifficulty || 50;
        const reward = this.settings.unlockReward || 5;

        overlay.innerHTML = `
            <div class="cure-overlay-container" style="padding-top: 60px;">
                <div class="cure-header" style="margin-bottom: 24px;">
                    <div style="font-size:48px; margin-bottom:12px;">🔒</div>
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
                        <button id="cure-give-up-btn" class="cure-btn-unlock cure-anim-pulse-black" style="background:#1d1d1f; border: none; color:#ffffff; width: 100%;">
                            <span class="cure-btn-content">I'd rather be productive</span>
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
    async fetchChallengeText(wordCount) {
        // If wordCount arg is missing, fallback to difficulty setting
        const count = wordCount || this.currentTypingDifficulty || 50;
        return this.getRandomChallenge(count);
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
                const rawVal = input.value;
                const normalizedVal = normalizeTypingText(rawVal);

                // FIX: IME / Dead Key Protection
                // Do NOT rewrite the input value while composing (this breaks apostrophe/dead keys).
                // Only rewrite if we are NOT composing.
                if (!e.isComposing && rawVal !== normalizedVal) {
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
                        // ETERNAL NORMALIZATION: Always compare normalized versions
                        const charTyped = normalizeTypingText(val[i]);
                        const charTarget = normalizeTypingText(text[i]);
                        
                        // Fail-safe: Strict equality OR Loose Apostrophe check
                        const isApostrophe = (c) => /^['\u2019\u00B4\u0060]$/.test(c);
                        const match = (charTyped === charTarget) || (isApostrophe(charTyped) && isApostrophe(charTarget));

                        if (match) {
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
                    // FIX: Manual Guilt-Based Confirmation
                    // Instead of auto-unlocking, we transform the "Give Up" button into a "Vow Break" button.
                    input.disabled = true; 
                    input.blur();
                    try { SoundEngine.playChime('success'); } catch (e) { }
                    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

                    const giveUpBtn = root.getElementById('cure-give-up-btn');
                    if (giveUpBtn) {
                        giveUpBtn.textContent = "I’m giving in. Unlock.";
                        giveUpBtn.classList.remove('cure-anim-pulse-black');
                        giveUpBtn.style.background = "transparent";
                        giveUpBtn.style.color = "#86868B";
                        giveUpBtn.style.border = "2px solid #E5E5EA";
                        giveUpBtn.style.borderColor = "#E5E5EA";
                        giveUpBtn.style.fontWeight = "600";
                        giveUpBtn.style.boxShadow = "none";
                        
                        giveUpBtn.onclick = () => {
                            this.unlockSession(this.settings.unlockReward || 5);
                        };
                    }
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
                }, 500);
            }
        }

        if (!this.shadowRoot) return;
        const overlay = this.shadowRoot.getElementById(this.overlayId);
        if (!overlay) return;

        const shortcuts = (this.settings.shortcuts || []).slice(0, 6).map(s => {
            const iconUrl = this.getFaviconUrl(s.url);
            let hostname = '';
            try {
                hostname = new URL(s.url).hostname;
            } catch (e) {
                console.warn("Invalid shortcut URL:", s.url, e);
                return ''; 
            }
            return `<a href="${s.url}" class="cure-shortcut-card">
                <img src="${iconUrl}" class="cure-shortcut-icon" onerror="this.src='https://www.google.com/s2/favicons?domain=${hostname}&sz=64'"> 
                <span class="cure-shortcut-name">${s.name}</span>
            </a>`;
        }).join('');

        const isAutoClose = window.location.search.includes('cure_challenge=true');
        const subtitle = isAutoClose 
            ? `✨ Success! Returning you to your page in 2s...` 
            : `You have unlocked <b style="color:#1D1D1F;">${mins}min</b>.<br>The clock is ticking backwards now.`;

        overlay.innerHTML = `
            <div class="cure-overlay-container" style="padding-top: 70px;">
                <div class="cure-header">
                    <div style="font-size:48px; margin-bottom:12px;">${isAutoClose ? '✨' : '🔓'}</div>
                    <h1 class="cure-title-large">${isAutoClose ? 'Task Complete' : 'Strict Lock Lifted'}</h1>
                    <p class="cure-subtitle" style="max-width:400px; margin: 4px auto 0 auto;">
                        ${subtitle}
                    </p>
                </div>

                <div class="cure-shortcuts-container" style="margin-top: 32px; margin-bottom: 40px;">
                    <div class="cure-shortcuts-label">Productive Alternatives</div>
                    <div class="cure-hand-pointer">👇</div>
                    <div class="cure-shortcuts-row">${shortcuts}</div>
                </div>

                <div class="cure-action-wrapper">
                    <button id="cure-finished-btn" class="cure-btn-unlock" style="background:transparent; border: 2px solid #E5E5EA; color:#86868B; box-shadow:none;">
                        <span class="cure-btn-content">Continue to Site</span>
                    </button>
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
            
            // FIX: Reliable Auto-Close Trigger
            if (isAutoClose) {
                setTimeout(() => {
                    this.confirmUnlock(mins);
                }, 500);
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
