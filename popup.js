// Cure Procrastination - Clean Logic + Help

let currentSettings = null;
let isDirty = false;
let backAttemptCount = 0;

document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    renderAll();
    setupListeners();
    setupNewViewListeners();
    setupInputValidation();
});

async function loadSettings() {
    return new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'getSettings' }, response => {
            if (!response || !response.settings) {
                console.error('[Cure] Failed to get response or settings from background');
                currentSettings = null;
                resolve();
                return;
            }
            currentSettings = response.settings;
            if (!currentSettings.shortcuts) currentSettings.shortcuts = [];
            if (!currentSettings.blacklist) currentSettings.blacklist = [];
            
            // Defaults for master switches if undefined (legacy support)
            if (typeof currentSettings.masterHardLock === 'undefined') currentSettings.masterHardLock = true;
            if (typeof currentSettings.masterPause === 'undefined') currentSettings.masterPause = true;
            if (typeof currentSettings.masterReminders === 'undefined') currentSettings.masterReminders = true;

            populateInputs();
            autoFillCurrentSite(); // Trigger auto-fill
            resolve();
        });
    });
}

function autoFillCurrentSite() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || !tabs[0] || !tabs[0].url) return;
        const tab = tabs[0];
        try {
            const urlObj = new URL(tab.url);
            // Whitelist: Domain only (example.com)
            const domain = urlObj.hostname.replace(/^www\./, '');
            const input = document.getElementById('new-site-input');
            if (input) input.value = domain;

            // Shortcut: Title & Origin (or domain if preferred)
            const sName = document.getElementById('new-shortcut-name');
            const sUrl = document.getElementById('new-shortcut-url');

            // Smart Clean Title: Strip TLDs for a cleaner look
            // e.g. "youtube.com" -> "Youtube", "notion.so" -> "Notion"
            let cleanTitle = domain.replace(/\.(com|org|net|io|co|me|ai|so|app|edu|gov|ly|info|biz|tv)$/i, '');
            cleanTitle = cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1);

            // Only fall back to Title if domain is obscure/numeric (basic heuristic)
            if (cleanTitle.length < 3) {
                cleanTitle = tab.title.split(/[:|\-]/)[0].trim();
            }

            if (sName) sName.value = cleanTitle;
            if (sUrl) sUrl.value = domain; // Just domain (e.g., arena.ai) clean and consistent

        } catch (e) {
            console.log('Cannot parse URL for auto-fill');
        }
    });
}

const UNIT_FACTORS = {
    'sec': 1,
    'min': 60,
    'hr': 3600,
    'day': 86400,
    'week': 604800
};

function saveSettings() {
    // FORCE SYNC: Read master switches directly from DOM to ensure state is accurate
    const masterHL = document.getElementById('master-hardlock-enable');
    const masterPause = document.getElementById('master-pause-enable');
    const masterRemind = document.getElementById('master-reminders-enable');

    if (masterHL) currentSettings.masterHardLock = masterHL.checked;
    if (masterPause) currentSettings.masterPause = masterPause.checked;
    if (masterRemind) currentSettings.masterReminders = masterRemind.checked;

    chrome.runtime.sendMessage({ action: 'updateSettings', settings: currentSettings });
    resetDirty();
}

function markDirty() {
    isDirty = true;
    backAttemptCount = 0;
    // Highlight save buttons
    document.querySelectorAll('[id^="save-"]').forEach(btn => {
        if (!btn.id.includes('status')) btn.classList.add('needs-save');
    });
}

function resetDirty() {
    isDirty = false;
    backAttemptCount = 0;
    document.querySelectorAll('[id^="save-"]').forEach(btn => {
        btn.classList.remove('needs-save', 'shake');
    });
}


function showConfirmDialog(title, msg, onSave, onDiscard, saveDisabled = false) {
    const modal = document.getElementById('confirm-modal');
    if (!modal) return;

    modal.querySelector('.confirm-title').textContent = title;
    modal.querySelector('.confirm-message').textContent = msg;
    
    const saveBtn = document.getElementById('confirm-save-btn');
    const discardBtn = document.getElementById('confirm-discard-btn');

    modal.style.display = 'flex';

    // Handle disabled state for the save button
    if (saveDisabled) {
        saveBtn.disabled = true;
        saveBtn.style.opacity = '0.35';
        saveBtn.style.filter = 'grayscale(1)';
        saveBtn.style.cursor = 'not-allowed';
        saveBtn.style.pointerEvents = 'none';
        
        // Update message to clarify why save is disabled
        modal.querySelector('.confirm-title').textContent = "Incomplete Settings";
        modal.querySelector('.confirm-message').textContent = "Your changes cannot be saved because some settings are incomplete. Fix the errors or discard to leave.";
    } else {
        saveBtn.disabled = false;
        saveBtn.style.opacity = '1';
        saveBtn.style.filter = 'none';
        saveBtn.style.cursor = 'pointer';
        saveBtn.style.pointerEvents = 'auto';
    }

    saveBtn.onclick = () => {
        if (saveDisabled) return;
        modal.style.display = 'none';
        onSave();
    };

    discardBtn.onclick = () => {
        modal.style.display = 'none';
        onDiscard();
    };

    // Close on background click
    modal.onclick = (e) => {
        if (e.target === modal) modal.style.display = 'none';
    };
}

// --- VALIDATION HELPERS ---
function isValidDomain(domain) {
    if (!domain) return false;
    // Regex for valid domain format:
    // - Alphanumeric with hyphens
    // - Must have at least one dot (e.g. example.com, localhost matches exception)
    // - No spaces
    // - Not a phone number (redundant check via regex structure but explicit logic holds)
    
    // Allow 'localhost' as special case
    if (domain === 'localhost') return true;

    // Basic domain regex
    // ^(?![0-9]+$) -> Not only numbers
    // [a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9] -> Part
    // \.[a-zA-Z]{2,}$ -> TLD
    const domainRegex = /^(?!:\/\/)([a-zA-Z0-9-_]{1,63}\.)+[a-zA-Z]{2,63}$/;
    
    // Explicitly reject purely numeric strings to catch phone numbers
    if (/^\+?\d+$/.test(domain)) return false;

    return domainRegex.test(domain);
}


function sanitizeDomainInput(input) {
    if (!input) return '';
    let domain = input.trim().toLowerCase();
    
    // Attempt URL parsing to handle protocols, paths, query params
    try {
        // If it lacks a protocol, generic URL parsing might fail or treat it as relative.
        // Prepending http:// ensures 'google.com' parses correctly as hostname.
        if (!domain.includes('://')) {
            domain = 'http://' + domain;
        }
        const urlObj = new URL(domain);
        domain = urlObj.hostname;
    } catch (e) {
        // If parsing fails, fall back to original (validation will catch it)
        return input.trim().toLowerCase();
    }

    // Strip common prefixes
    domain = domain.replace(/^www\./, '');
    return domain;
}

function isValidUrl(url) {
    if (!url) return false;
    try {
        new URL(url);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Validates settings before saving.
 * Returns { valid: boolean, warnings: string[], errors: string[] }
 */
function validateSettings() {
    const errors = [];
    const warnings = [];

    // Get Site Activity Limit values
    const sessionEnabled = document.getElementById('trigger-session-enable').checked;
    const limitSeconds = getConvertedVal('hardlock-input', 'hardlock-unit');
    const windowSeconds = parseInt(document.getElementById('session-reset-window').value) || 0;

    // Get reward values
    const rewardUnitEl = document.getElementById('unlock-reward-unit');
    const rewardUnit = rewardUnitEl ? rewardUnitEl.value : 'min';
    const rewardSeconds = (rewardUnit === 'session' || rewardUnit === 'unlimited')
        ? 0
        : getConvertedVal('unlock-reward-input', 'unlock-reward-unit');

    // Get browser limit values
    const browserEnabled = document.getElementById('trigger-browser-enable').checked;
    const browserLimitSeconds = getConvertedVal('browser-limit-input', 'browser-limit-unit');
    const browserWindowSeconds = parseInt(document.getElementById('browser-limit-window').value) || 86400;

    // VALIDATION RULE 1: Limit cannot equal or exceed window (Deadlock)
    if (sessionEnabled && windowSeconds > 0) {
        if (limitSeconds >= windowSeconds) {
            const limitStr = formatTime(limitSeconds);
            const windowStr = formatWindow(windowSeconds);
            errors.push(`Limit (${limitStr}) cannot be equal to or greater than the window (${windowStr}). This creates a deadlock.`);
        }
    }

    if (browserEnabled && browserWindowSeconds > 0) {
        if (browserLimitSeconds >= browserWindowSeconds) {
            const limitStr = formatTime(browserLimitSeconds);
            const windowStr = formatWindow(browserWindowSeconds);
            errors.push(`Browser limit (${limitStr}) cannot be equal to or greater than the window (${windowStr}).`);
        }
    }

    // VALIDATION RULE 2: Removed (Reward Trap)
    // if (sessionEnabled && rewardSeconds > 0 && windowSeconds > 0) { ... }

    // VALIDATION RULE 3: Minimum limit of 1 minute (prevents instant lock)
    if (sessionEnabled && limitSeconds < 60) {
        errors.push('Limit must be at least 1 minute.');
    }
    if (browserEnabled && browserLimitSeconds < 60) {
        errors.push('Browser limit must be at least 1 minute.');
    }

    // --- MASTER TOGGLE VALIDATION ---
    const hlOn = document.getElementById('master-hardlock-enable')?.checked || document.getElementById('inner-master-hardlock')?.checked;
    const remindersOn = document.getElementById('master-reminders-enable')?.checked || document.getElementById('inner-master-reminders')?.checked;
    const pauseOn = document.getElementById('master-pause-enable')?.checked || document.getElementById('inner-master-pause')?.checked;

    // 1. Strict Lock Activation Method Required
    if (hlOn) {
        const sessionOn = document.getElementById('trigger-session-enable').checked;
        const launchOn = document.getElementById('trigger-launch-enable').checked;
        const browserOn = document.getElementById('trigger-browser-enable').checked;

        if (!sessionOn && !launchOn && !browserOn) {
            errors.push('<strong>Strict Lock Error:</strong> Select at least one Activation Method.');
        }

        // 2. Protocol Required
        const typeOn = document.getElementById('proto-typing-enable').checked;
        const passOn = document.getElementById('proto-password-enable').checked;
        const delayOn = document.getElementById('proto-delay-enable').checked;
        const passiveOn = document.getElementById('proto-passive-enable').checked;
        const noneOn = document.getElementById('proto-godmode-enable').checked;

        if (!typeOn && !passOn && !delayOn && !passiveOn && !noneOn) {
            errors.push('<strong>Strict Lock Error:</strong> Select at least one Unlock Protocol.');
        }
    }

    // 3. Reminders Activation Method Required
    if (remindersOn) {
        const rIntervalOn = document.getElementById('reminder-interval-enable')?.checked;
        const rBrowserOn = document.getElementById('reminder-trigger-browser-enable')?.checked;
        const rLaunchOn = document.getElementById('reminder-trigger-launch-enable')?.checked;

        if (!rIntervalOn && !rBrowserOn && !rLaunchOn) {
            errors.push('<strong>Reminders Error:</strong> Select at least one Trigger Method.');
        }
    }

    // 4. Pause Activation Method Required
    if (pauseOn) {
        const pLaunchOn = document.getElementById('pause-trigger-launch-enable')?.checked;
        const pBrowserOn = document.getElementById('pause-trigger-browser-enable')?.checked;
        const pWhitelistOn = document.getElementById('pause-whitelist-enable')?.checked;
        
        // Per user request: Master toggle should not be "Enabled" if no specific triggers are active.
        if (!pLaunchOn && !pBrowserOn && !pWhitelistOn) {
             errors.push('<strong>Pause Error:</strong> Select at least one Trigger Method.');
        }
    }
    // --- DOCTOR STRANGE HEURISTICS (Toxic Configs) ---

    // RULE 4: The Flicker Trap (Limit > 95% of Window)
    if (sessionEnabled && windowSeconds > 0) {
        if (limitSeconds > windowSeconds * 0.95) {
            warnings.push('<strong>Flicker Warning:</strong> Limit is very close to window size.');
        }
    }





    // RULE 7: Passive Inflation (Output > Input)
    const passiveEnabled = document.getElementById('proto-passive-enable').checked;
    if (passiveEnabled) {
        const threshold = getConvertedVal('passive-work-val', 'passive-work-unit');
        const reward = getConvertedVal('passive-reward-val', 'passive-reward-unit');
        if (reward > threshold) {
            errors.push('<strong>Passive Error:</strong> Reward value cannot exceed work threshold.');
        }
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

function formatTime(seconds) {
    if (seconds >= 86400) return Math.floor(seconds / 86400) + ' day' + (seconds >= 172800 ? 's' : '');
    if (seconds >= 3600) return Math.floor(seconds / 3600) + ' hour' + (seconds >= 7200 ? 's' : '');
    if (seconds >= 60) return Math.floor(seconds / 60) + ' min';
    return seconds + ' sec';
}

function formatWindow(seconds) {
    if (seconds >= 86400) return 'day';
    if (seconds >= 3600) return 'hour';
    if (seconds >= 1800) return '30 min';
    return 'visit';
}

function showValidationWarning(message, isError = false) {
    const banner = document.getElementById('validation-warning');
    const text = document.getElementById('validation-warning-text');
    const title = banner?.querySelector('.validation-warning-title');
    const icon = banner?.querySelector('.validation-warning-icon');

    if (banner && text) {
        text.innerHTML = message;
        banner.style.display = 'block';

        // Explicitly check for error keywords in message OR isError flag
        const isActuallyError = isError || message.includes('Invalid') || message.includes('Cannot') || message.includes('Error');

        if (isActuallyError) {
            banner.className = 'validation-warning is-error';
            if (title) title.textContent = 'Configuration Error';
            if (icon) icon.textContent = '🛑';
        } else {
            banner.className = 'validation-warning is-warning';
            if (title) title.textContent = 'Configuration Warning';
            if (icon) icon.textContent = '⚠️';
        }
    }
}

function hideValidationWarning() {
    const banner = document.getElementById('validation-warning');
    if (banner) banner.style.display = 'none';
}


function getConvertedVal(id, unitId) {
    const input = document.getElementById(id);
    const unit = document.getElementById(unitId);
    if (!input || !unit) return 0;

    let val = parseInt(input.value);
    
    // STRICT VALIDATION
    if (isNaN(val)) val = 0;
    if (val < 0) val = 0; // Prevent negative inputs

    // Auto-correct standard inputs if they are invalid
    if (input.type === 'number' && input.value !== val.toString()) {
        // If user entered "12a" or "-5", simple fix on save
        input.value = val;
    }

    const unitVal = unit.value;
    return val * (UNIT_FACTORS[unitVal] || 60); // Default to min factor if missing
}

function setConvertedVal(id, unitId, totalSecs) {
    const input = document.getElementById(id);
    const selector = document.getElementById(unitId);
    if (!input || !selector) return;

    if (totalSecs >= 86400 && selector.querySelector('option[value="day"]')) {
        input.value = Math.floor(totalSecs / 86400);
        selector.value = 'day';
    } else if (totalSecs >= 3600 && selector.querySelector('option[value="hr"]')) {
        input.value = Math.floor(totalSecs / 3600);
        selector.value = 'hr';
    } else if (totalSecs >= 60 && selector.querySelector('option[value="min"]')) {
        input.value = Math.floor(totalSecs / 60);
        selector.value = 'min';
    } else {
        input.value = totalSecs;
        selector.value = 'sec';
    }
    updateUnitGrammar(id, unitId);
}

function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function setChk(id, checked) {
    const el = document.getElementById(id);
    if (el) el.checked = checked;
}

function updateUnitGrammar(inputId, unitId) {
    const input = document.getElementById(inputId);
    const selector = document.getElementById(unitId);
    if (!input || !selector) return;

    // 1. Handle "Unlimited" visibility (The "Grant 5 Unlimited" Fix)
    // ONLY hide for 'unlimited', keep visible for 'session' (launches), 'min', 'hr'
    if (selector.tagName === 'SELECT' && selector.value === 'unlimited') {
        input.style.display = 'none';
        // Remove left border radius from selector to look clean
        selector.style.borderRadius = '6px';
        selector.style.marginLeft = '0';
    } else {
        input.style.display = 'inline-block';
        selector.style.borderRadius = '0 6px 6px 0';
        selector.style.marginLeft = '-1px';
    }

    const val = parseInt(input.value) || 0;
    const isSingular = val === 1;

    // 2. Handle Pluralization
    const options = (selector.tagName === 'SELECT') ? selector.querySelectorAll('option') : [];

    if (options.length > 0) {
        options.forEach(opt => {
            let base = opt.getAttribute('data-base');
            if (!base) {
                // First-time setup: store the base singular form
                let text = opt.textContent.trim().toLowerCase();

                // Robust singular discovery
                if (text === 'unlimited access' || text === 'unlimited access') {
                    base = 'unlimited access';
                } else if (text === 'launches' || text === 'launch') {
                    base = 'launch';
                } else if (text.endsWith('s') && !text.endsWith('ss')) {
                    base = text.slice(0, -1);
                } else {
                    base = text;
                }

                opt.setAttribute('data-base', base);
            }

            if (isSingular) {
                opt.textContent = base;
            } else {
                if (base === 'launch') opt.textContent = 'launches';
                else if (base === 'unlimited access') opt.textContent = base;
                else opt.textContent = base + 's';
            }
        });
    } else {
        // Labels (e.g. "launch(es)")
        let text = selector.textContent;
        // Fix the specific "launch(es)" issue
        if (inputId === 'launch-limit-input') {
            selector.textContent = isSingular ? 'launch' : 'launches';
            return;
        }
        if (inputId === 'challenge-length-input') {
            selector.textContent = isSingular ? 'word' : 'words';
            return;
        }

        // General fallback
        if (text.endsWith('s')) text = text.slice(0, -1);
        if (!isSingular) text = text + 's';
        selector.textContent = text;
    }
}

function populateInputs() {
    const breathing = currentSettings.breathingRoomDuration || 15; // User Req: 15s default
    const hardlock = currentSettings.hardLockDuration || 30;
    const reminders = (currentSettings.reminderInterval || 15) * 60; // Storage is min
    const difficulty = currentSettings.unlockProtocols?.typing?.difficulty || currentSettings.typingDifficulty || 50;
    const reward = (currentSettings.unlockReward || 5) * 60; // Storage is min
    const rStyle = currentSettings.reminderStyle || 'toast';
    const soundOn = currentSettings.soundEnabled !== false; // Default true
    const sessionTimeout = (currentSettings.sessionTimeoutMins || 30) * 60; // Storage is min

    setConvertedVal('breathing-input', 'breathing-unit', breathing);
    setConvertedVal('hardlock-input', 'hardlock-unit', hardlock * 60); // legacy min
    setConvertedVal('reminder-input', 'reminder-unit', reminders);
    setVal('challenge-length-input', difficulty);
    setConvertedVal('unlock-reward-input', 'unlock-reward-unit', reward);
    setVal('unlock-reward-unit', currentSettings.unlockRewardType || 'min');
    document.getElementById('pill-enable-input').checked = currentSettings.showTimerPill !== false;
    document.getElementById('pill-whitelist-input').checked = !!currentSettings.showPillOnWhitelist;
    document.getElementById('whitelist-shortcuts-input').checked = !!currentSettings.whitelistShortcuts;

    // Master Switches
    const hardLockOn = !!currentSettings.masterHardLock;
    const pauseOn = !!currentSettings.masterPause;
    const remindersOn = !!currentSettings.masterReminders;

    document.getElementById('master-hardlock-enable').checked = hardLockOn;
    document.getElementById('master-pause-enable').checked = pauseOn;
    document.getElementById('master-reminders-enable').checked = remindersOn;

    // Sync Internal (Inner) Switches
    const innerHardlock = document.getElementById('inner-master-hardlock');
    const innerPause = document.getElementById('inner-master-pause');
    const innerReminders = document.getElementById('inner-master-reminders');

    if (innerHardlock) innerHardlock.checked = hardLockOn;
    if (innerPause) innerPause.checked = pauseOn;
    if (innerReminders) innerReminders.checked = remindersOn;

    const triggers = currentSettings.hardLockTriggers || {
        sessionLimit: { enabled: true, value: 30, windowSeconds: 86400 },
        browserLimit: { enabled: false, value: 480, windowSeconds: 86400 },
        launchLimit: { enabled: false, value: 10, windowSeconds: 86400 }
    };

    const pauseTriggers = currentSettings.pauseTriggers || {
        launchLimit: { enabled: false, value: 5, windowSeconds: 3600 },
        browserLimit: { enabled: false, value: 120, windowSeconds: 86400 }
    };

    const reminderTriggers = currentSettings.reminderTriggers || {
        launchLimit: { enabled: false, value: 5, windowSeconds: 3600 },
        browserLimit: { enabled: false, value: 120, windowSeconds: 86400 }
    };

    // Pause View Inputs
    setConvertedVal('breathing-input', 'breathing-unit', breathing);
    const freqEl = document.getElementById('breathing-freq');
    if (freqEl) freqEl.value = currentSettings.breathingFreq || 'always';

    setChk('pause-trigger-launch-enable', pauseTriggers.launchLimit?.enabled);
    setVal('pause-trigger-launch-val', pauseTriggers.launchLimit?.value || 5);

    setChk('pause-trigger-browser-enable', pauseTriggers.browserLimit?.enabled);
    setVal('pause-trigger-browser-val', pauseTriggers.browserLimit?.value || 120);

    setChk('pause-whitelist-enable', !!currentSettings.pauseWhitelist);

    // Reminders View Inputs
    setChk('reminder-interval-enable', !!currentSettings.reminderIntervalEnabled);
    setVal('reminder-interval-type', currentSettings.reminderIntervalType || 'repeating');
    setConvertedVal('reminder-input', 'reminder-unit', reminders);
    setChk('reminder-whitelist-enable', !!currentSettings.reminderWhitelist);

    setVal('reminder-browser-type', currentSettings.reminderBrowserType || 'once');

    // Reminder Triggers
    setChk('reminder-trigger-launch-enable', reminderTriggers.launchLimit?.enabled);
    setVal('reminder-trigger-launch-val', reminderTriggers.launchLimit?.value || 5);
    setVal('reminder-launch-type', reminderTriggers.launchLimit?.type || 'repeating');
    setVal('reminder-trigger-launch-window', reminderTriggers.launchLimit?.windowSeconds || 3600);

    setVal('reminder-browser-type', currentSettings.reminderBrowserType || 'repeating');
    setChk('reminder-trigger-browser-enable', reminderTriggers.browserLimit?.enabled);
    setConvertedVal('reminder-trigger-browser-val', 'reminder-trigger-browser-unit', (reminderTriggers.browserLimit?.value || 120) * 60);

    const styleSelect = document.getElementById('reminder-style-input');
    if (styleSelect) styleSelect.value = rStyle;

    // Strict Lock Inputs
    setChk('trigger-session-enable', triggers.sessionLimit?.enabled);
    setConvertedVal('hardlock-input', 'hardlock-unit', (triggers.sessionLimit?.value || 30) * 60);
    setVal('session-reset-window', triggers.sessionLimit?.windowSeconds || 86400);

    setChk('trigger-launch-enable', triggers.launchLimit?.enabled);
    setVal('launch-limit-input', triggers.launchLimit?.value || 3);
    setVal('launch-limit-window', triggers.launchLimit?.windowSeconds || 3600);

    setChk('trigger-browser-enable', triggers.browserLimit?.enabled);
    setConvertedVal('browser-limit-input', 'browser-limit-unit', (triggers.browserLimit?.value || 480) * 60);
    setVal('browser-limit-window', triggers.browserLimit?.windowSeconds || 86400);

    setVal('browser-limit-window', triggers.browserLimit?.windowSeconds || 86400);
}

function renderAll() {
    renderWhitelist();
    renderShortcuts();
    renderBlocklist();
}

function renderWhitelist(filter = '') {
    const list = document.getElementById('whitelist-container');
    list.innerHTML = '';

    let items = currentSettings.whitelist || [];
    if (filter) {
        items = items.filter(site => site.toLowerCase().includes(filter.toLowerCase()));
    }

    if (!items.length) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:#999;font-size:13px;">${filter ? 'No matches' : 'Allowlist is empty'}</div>`;
        return;
    }
    items.forEach((site) => {
        // Find original index for removal consistency
        const originalIndex = currentSettings.whitelist.indexOf(site);
        const item = document.createElement('div');
        item.className = 'settings-item';
        
        const leftDiv = document.createElement('div');
        leftDiv.className = 'item-text';
        const h3 = document.createElement('h3');
        h3.textContent = site;
        leftDiv.appendChild(h3);

        const btn = document.createElement('button');
        btn.className = 'action-btn danger-btn';
        btn.dataset.type = 'whitelist';
        btn.dataset.index = originalIndex;
        btn.style.fontSize = '11px';
        btn.style.padding = '4px 10px';
        btn.textContent = 'Remove';

        item.appendChild(leftDiv);
        item.appendChild(btn);
        list.appendChild(item);
    });
}

function renderShortcuts(filter = '') {
    const list = document.getElementById('shortcuts-container');
    list.innerHTML = '';

    let items = currentSettings.shortcuts || [];
    const allowlistSection = document.getElementById('shortcut-allowlist-section');
    if (filter) {
        items = items.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || s.url.toLowerCase().includes(filter.toLowerCase()));
        if (allowlistSection) allowlistSection.style.display = 'none';
    } else {
        if (allowlistSection) allowlistSection.style.display = 'block';
    }

    if (!items.length) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:#999;font-size:13px;">${filter ? 'No matches' : 'No shortcuts'}</div>`;
        return;
    }
    items.forEach((s) => {
        const originalIndex = currentSettings.shortcuts.indexOf(s);
        const item = document.createElement('div');
        item.className = 'settings-item';
        
        const leftDiv = document.createElement('div');
        leftDiv.className = 'item-text';
        const h3 = document.createElement('h3');
        h3.textContent = s.name;
        const p = document.createElement('p');
        
        // VISUAL CLEANUP: Strip protocol and www for display consistency
        let displayUrl = s.url;
        try {
            displayUrl = displayUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
            // Optional: Remove trailing slash if it's the only Thing
             if (displayUrl.endsWith('/') && displayUrl.indexOf('/') === displayUrl.length - 1) {
                displayUrl = displayUrl.slice(0, -1);
             }
        } catch (e) {}
        
        p.textContent = displayUrl;
        leftDiv.appendChild(h3);
        leftDiv.appendChild(p);

        const btn = document.createElement('button');
        btn.className = 'action-btn danger-btn';
        btn.dataset.type = 'shortcut';
        btn.dataset.index = originalIndex;
        btn.style.fontSize = '11px';
        btn.style.padding = '4px 10px';
        btn.textContent = 'Remove';

        item.appendChild(leftDiv);
        item.appendChild(btn);
        list.appendChild(item);
    });
}

function renderBlocklist(filter = '') {
    const list = document.getElementById('blocklist-container');
    if (!list) return;
    list.innerHTML = '';

    let items = currentSettings.blacklist || [];
    if (filter) {
        items = items.filter(site => site.toLowerCase().includes(filter.toLowerCase()));
    }

    if (!items.length) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:#999;font-size:13px;">${filter ? 'No matches' : 'Blocklist is empty'}</div>`;
        return;
    }
    items.forEach((site) => {
        const originalIndex = currentSettings.blacklist.indexOf(site);
        const item = document.createElement('div');
        item.className = 'settings-item';
        
        const leftDiv = document.createElement('div');
        leftDiv.className = 'item-text';
        const h3 = document.createElement('h3');
        h3.textContent = site;
        leftDiv.appendChild(h3);

        const btn = document.createElement('button');
        btn.className = 'action-btn danger-btn';
        btn.dataset.type = 'blacklist';
        btn.dataset.index = originalIndex;
        btn.style.fontSize = '11px';
        btn.style.padding = '4px 10px';
        btn.textContent = 'Remove';

        item.appendChild(leftDiv);
        item.appendChild(btn);
        list.appendChild(item);
    });
}

function setupListeners() {
    // --- NAVIGATION ---
    document.querySelectorAll('.nav-trigger').forEach(el => {
        el.addEventListener('click', (e) => {
            // Safety check: don't navigate if clicking a switch/input directly
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'LABEL' || e.target.closest('.switch')) return;

            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            const t = document.getElementById(el.dataset.target);
            if (t) t.classList.add('active');
            updateUIState(); // Ensure the newly opened view respects master switches
        });
    });

    document.querySelectorAll('.nav-back').forEach(el => {
        el.addEventListener('click', () => {
            if (isDirty) {
                // Find visible save button in current view
                const currentView = el.closest('.view');
                const saveBtn = currentView?.querySelector('[id^="save-"]');
                const isSaveDisabled = saveBtn?.disabled === true;

                showConfirmDialog(
                    "Unsaved Changes",
                    "Do you want to save your progress before leaving?",
                    () => {
                        // SAVE & EXIT
                        if (saveBtn) saveBtn.click();
                        else {
                            saveSettings();
                            resetDirty();
                            goHome();
                        }
                    },
                    () => {
                        // DISCARD: Reload saved settings AND re-render all lists
                        loadSettings().then(() => {
                            renderAll(); // CRITICAL: Re-render UI with reverted data
                            resetDirty();
                            goHome();
                        });
                    },
                    isSaveDisabled // Pass disabled state
                );
                return;
            }
            goHome();
        });
    });

    function goHome() {
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('home-view').classList.add('active');
        updateUIState(); // Re-sync
    }

    // --- LIST SEARCH LISTENERS ---
    function toggleAddCard(e) {
        const controls = e.target.closest('.list-controls');
        const addCard = controls?.querySelector('.add-card');
        if (addCard) {
            addCard.style.display = e.target.value.trim().length > 0 ? 'none' : '';
        }
    }

    document.getElementById('whitelist-search')?.addEventListener('input', (e) => {
        renderWhitelist(e.target.value);
        toggleAddCard(e);
    });
    document.getElementById('shortcuts-search')?.addEventListener('input', (e) => {
        renderShortcuts(e.target.value);
        toggleAddCard(e);
    });
    document.getElementById('blocklist-search')?.addEventListener('input', (e) => {
        renderBlocklist(e.target.value);
        toggleAddCard(e);
    });

    // --- MASTER SWITCH LISTENERS (Internal & External) ---
    const masterKeyMap = {
        'master-hardlock-enable': 'masterHardLock',
        'inner-master-hardlock': 'masterHardLock',
        'master-pause-enable': 'masterPause',
        'inner-master-pause': 'masterPause',
        'master-reminders-enable': 'masterReminders',
        'inner-master-reminders': 'masterReminders'
    };
    Object.keys(masterKeyMap).forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', (e) => {
                const settingKey = masterKeyMap[id];
            const isChecked = e.target.checked;
            currentSettings[settingKey] = isChecked;

            // SYNC ALL TOGGLES for this key
            Object.keys(masterKeyMap).forEach(otherId => {
                if (masterKeyMap[otherId] === settingKey) {
                    const el = document.getElementById(otherId);
                    if (el) el.checked = isChecked;
                }
            });

            if (id.startsWith('master-')) {
                // HOME SCREEN VALIDATION
                if (isChecked) {
                    const validation = validateSettings();
                    if (!validation.valid) {
                        // REVERT
                        e.target.checked = false;
                        currentSettings[settingKey] = false;
                        
                        // Sync others back to false
                        Object.keys(masterKeyMap).forEach(otherId => {
                            if (masterKeyMap[otherId] === settingKey) {
                                const el = document.getElementById(otherId);
                                if (el) el.checked = false;
                            }
                        });

                        showValidationWarning(validation.errors[0], true);
                        return;
                    }
                }
                saveSettings();
                showSavedIndicator();
            } else {
                markDirty();
            }
            updateUIState();
        });
        }
    });

    // --- HELP MODAL SYSTEM ---
    const helpModal = document.getElementById('help-modal');
    const helpModalIcon = document.getElementById('help-modal-icon');
    const helpModalTitle = document.getElementById('help-modal-title');
    const helpModalText = document.getElementById('help-modal-text');
    const helpModalClose = document.getElementById('help-modal-close');

    const helpContent = {
        'pause-duration': { title: 'Pause Duration', text: 'A mandatory waiting period before you can access a distracting site. Also includes Frequency settings: "Every page load" shows the pause loop on every navigation, while "The first page load only" shows it only when you first enter the site for that browsing session.', icon: '🧘‍♂️' },
        'pause-launch-trigger': { title: 'Launch Count Trigger', text: 'Automatically triggers the Pause Screen every time you visit a site a certain number of times per hour. Great for caching "habitual checks".', icon: '🚀' },
        'pause-screentime-trigger': { title: 'Screen Time Trigger', text: 'Automatically triggers the Pause Screen every time you spend a certain amount of time browsing today.', icon: '⏱️' },
        'pause-allowlist': { title: 'Enable on Allowlist', text: 'By default, "productive" allowlisted sites skip the pause screen. Turn this on if you want to be paused on those sites too.', icon: '✅' },
        
        'reminder-interval': { title: 'Site Activity Reminder', text: 'Alerts based specifically on how long you have been on the current website. You can set this to repeat every X minutes, or fire just once as a "one-off" alarm.', icon: '⏳' },
        'reminder-style': { title: 'Appearance', text: 'Choose "Overlay" for a full-screen interrupt or "Toast" for a subtle notification at the bottom.', icon: '🎨' },
        'reminder-screentime-trigger': { title: 'Screen Time Reminder', text: 'Get an alert when your total browsing time today hits a certain limit. Now supports repeating alerts if you want to be reminded multiple times.', icon: '🛑' },
        'reminder-launch-trigger': { title: 'Launch Count Reminder', text: 'Get a specific alert every time you visit sites too frequently (e.g. 10 times in an hour).', icon: '🚀' },
        'reminder-allowlist': { title: 'Enable on Allowlist', text: 'By default, allowlisted sites do not trigger reminders. Turn this on to get reminders even on productive sites.', icon: '✅' },

        // Main Menu Keys
        'menu-allowlist': { title: 'Allowlist', text: 'Sites listed here are "productive" and safe. They will never be blocked, and won\'t trigger interventions unless you specifically enable them.', icon: '✅' },
        'menu-blocklist': { title: 'Blocklist', text: 'Sites listed here are considered "distracting" and will be restricted according to your Strict Lock settings.', icon: '⛔' },
        'menu-shortcuts': { title: 'Shortcuts', text: 'Quick links to your favorite productive sites. Adding a site here makes it easy to access alternatives when you are blocked.', icon: '🚀' },
        'menu-strict-lock': { title: 'Strict Lock', text: 'The core blocking engine. Configures how hard the blockage is (e.g. typing challenges, time limits) and when it triggers.', icon: '🔒' },
        'menu-pause': { title: 'Pause', text: 'A "Breathing Room" feature that forces you to pause and think for a few seconds before entering a distracting site.', icon: '🧘‍♂️' },
        'menu-reminders': { title: 'Reminders', text: 'Gentle nudges that help you stay aware of your time spent on sites without blocking you completely.', icon: '🔔' },

        'session-allowance': { title: 'Launch Count Limit', text: 'Set a strict limit on how many times you can visit this site within a time window (e.g. 3 times per hour).', icon: '🚀' },

        'sound-effects': { title: 'Sound Effects', text: 'Play a sound when a timer finishes or a challenge is failed. Helpful for auditory feedback.', icon: '🔊' },
        'timer-pill': { title: 'Timer Pill', text: 'A small floating timer that shows you how much time you have left on a site or how long you\'ve been browsing.', icon: '💊' },
        'pill-allowlist': { title: 'Include Allowlist Sites', text: 'Show the timer pill even on allowed/productive sites, so you can track your time everywhere.', icon: '✅' },
        'data-backup': { title: 'Data Backup', text: 'Export your settings to a file to save them, or import a previously saved file to restore your configuration.', icon: '💾' },
        'shortcuts-allowlist': { title: 'Shortcuts Allowlist', text: 'Add sites here to make them permanently "allowed". These sites will never be blocked, and won\'t trigger the pause screen unless you specifically enable that setting.', icon: '✅' },
        'add-blocklist': { title: 'Add to Blocklist', text: 'Enter a domain (e.g., youtube.com) to block it. You can manage your blocked sites in the list below.', icon: '🚫' },

        'session-limit': { title: 'Site Activity Limit', text: 'Max time allowed for this site. You can choose to reset this timer when you leave the site, or set it as a rolling budget (e.g. 20 minutes per hour).', icon: '🔒' },
        'reward-time': { title: 'Unlock Reward', text: 'The number of minutes granted after successfully completing an unlock protocol.', icon: '🍏' },
        'passive-reward': { title: 'Passive Reward', text: 'Earn bonus reward time just by spending time on your allowlist "productive" sites. This time can be used to unlock your restricted sites later.', icon: '🧠' },
        'browser-screen-time': { title: 'Browser Screen Time', text: 'Total time you can use the browser per day across all sites.', icon: '🌐' },
        'typing': { title: 'Typing Challenge', text: 'Requires you to type a long quote perfectly to unlock the site.', icon: '⌨️' },
        'password': { title: 'Password Protection', text: 'Requires a pre-set password to unlock. Ideal for accountability partners.', icon: '🔑' },
        'delay': { title: 'Time Delay', text: 'Forces you to wait for several minutes after initiating an unlock before access is granted.', icon: '🕒' },
        'none-mode': { title: 'No Unlocking', text: 'The strictest mode. Once locked, there is no way to unlock until the next day.', icon: '⛔' },
        'session-timeout': { title: 'Session Timeout', text: 'If you leave a site for this long, your "Session Timer" will reset back to 0. Great for taking short breaks without being permanently locked.', icon: '🔄' }
    };

    document.querySelectorAll('.help-icon').forEach(icon => {
        icon.addEventListener('click', (e) => {
            e.stopPropagation();
            const key = icon.dataset.help;
            const content = helpContent[key];
            if (content && helpModal) {
                helpModalIcon.textContent = content.icon;
                helpModalTitle.textContent = content.title;
                helpModalText.textContent = content.text;
                helpModal.style.display = 'flex';
            }
        });
    });

    if (helpModalClose) {
        helpModalClose.onclick = () => { helpModal.style.display = 'none'; };
    }
    if (helpModal) {
        helpModal.onclick = (e) => { if (e.target === helpModal) helpModal.style.display = 'none'; };
    }

    // --- UI LOGIC HAS BEEN MOVED TO GLOBAL SCOPE ---
    // See updateUIState() below


    function updateTypingEffectiveness() {
        const words = parseInt(document.getElementById('challenge-length-input').value) || 0;
        const fill = document.getElementById('typing-effectiveness-fill');
        const text = document.getElementById('typing-effectiveness-text');

        if (!fill || !text) return;

        let pct, label, color;
        if (words < 30) {
            pct = Math.min(words / 30 * 33, 33);
            label = '⚠️ Too easy - not an effective barrier';
            color = '#FF3B30';
        } else if (words < 60) {
            pct = 33 + ((words - 30) / 30 * 33);
            label = '🟡 Moderate deterrent';
            color = '#FF9500';
        } else if (words < 80) {
            pct = 66 + ((words - 60) / 20 * 34);
            label = '✅ Good friction';
            color = '#34C759';
        } else {
            pct = 100;
            label = '💪 Strong barrier - highly effective';
            color = '#34C759';
        }

        if (fill) {
            fill.style.width = `${pct}%`;
            fill.style.background = color;
        }
        if (text) {
            text.textContent = label;
            text.style.color = color;
        }
    }

    // --- PASSWORD STRENGTH & MATCH ---
    function setupPasswordLogic() {
        const pOldRow = document.getElementById('password-verify-section');
        const pOldInput = document.getElementById('proto-password-old');
        const pValInput = document.getElementById('proto-password-val');
        const pConfirmInput = document.getElementById('proto-password-confirm');
        const pEntryLabel = document.getElementById('password-entry-label');
        
        const showPassChk = document.getElementById('show-password-chk');
        const matchStatus = document.getElementById('password-match-status');
        const confirmBtn = document.getElementById('generate-password-btn');
        const cancelBtn = document.getElementById('cancel-password-setup-btn');

        if (!pValInput) return;

        // HELPER: Update Confirm button state based on password validity
        const updateConfirmButtonState = () => {
            if (!confirmBtn) return;
            
            const newVal = pValInput.value;
            const confirmVal = pConfirmInput?.value || '';
            const isValid = newVal.length > 0 && newVal === confirmVal;
            
            if (isValid) {
                // VALID: Enable and fill the button
                confirmBtn.disabled = false;
                confirmBtn.style.opacity = '1';
                confirmBtn.style.filter = 'none';
                confirmBtn.style.cursor = 'pointer';
                confirmBtn.style.pointerEvents = 'auto';
            } else {
                // INVALID: Fade and disable the button
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.35';
                confirmBtn.style.filter = 'grayscale(1)';
                confirmBtn.style.cursor = 'not-allowed';
                confirmBtn.style.pointerEvents = 'none';
            }
        };
        
        // Initialize button as faded on setup
        updateConfirmButtonState();

        // 1. Show/Hide toggle
        if (showPassChk) {
            showPassChk.onchange = () => {
                const type = showPassChk.checked ? 'text' : 'password';
                pValInput.type = type;
                if (pConfirmInput) pConfirmInput.type = type;
                if (pOldInput) pOldInput.type = type;
            };
        }

        // 2. Real-time match feedback + button state update
        const checkMatch = () => {
            if (!pConfirmInput.value) {
                matchStatus.textContent = '';
            } else if (pValInput.value === pConfirmInput.value) {
                matchStatus.textContent = '✓ Passwords match';
                matchStatus.style.color = '#34C759';
            } else {
                matchStatus.textContent = '✕ Passwords do not match';
                matchStatus.style.color = '#FF3B30';
            }
            
            // PROGRESSIVE DISCLOSURE: Update button state on every keystroke
            updateConfirmButtonState();
        };
        pValInput.oninput = checkMatch;
        pConfirmInput.oninput = checkMatch;

        // 3. The "Confirm" (Commit to Buffer) button
        if (confirmBtn) {
            confirmBtn.onclick = () => {
                const hasExisting = !!(currentSettings?.unlockProtocols?.password?.value);
                
                // Verification check if updating
                if (hasExisting && pOldRow?.style.display !== 'none') {
                    if (pOldInput.value !== currentSettings.unlockProtocols.password.value) {
                        showValidationWarning('<strong>Security Error:</strong> Current password incorrect.');
                        return;
                    }
                }

                // These checks should never trigger due to progressive disclosure, but keep as safety net
                if (!pValInput.value || pValInput.value !== pConfirmInput.value) {
                    return; // Silently ignore - button shouldn't be clickable anyway
                }

                // Success transition
                const setupState = document.getElementById('password-setup-state');
                const activeState = document.getElementById('password-active-state');
                if (setupState) setupState.style.display = 'none';
                if (activeState) activeState.style.display = 'block';
                if (cancelBtn) cancelBtn.style.display = 'block';

                // We don't save to storage yet, just let the user see "Active" 
                // and then they can click the main "Save Settings" button.
                hideValidationWarning();
                
                // Trigger full UI update to re-check all validation rules
                updateUIState();
            };
        }
    }

    setupPasswordLogic();

    // Logic moved global


    function forceDisable(id, disabled) {
        const el = document.getElementById(id);
        if (el) {
            el.disabled = disabled;
            el.parentElement.style.opacity = disabled ? '0.5' : '1';
        }
    }

    function hide(id) {
        const el = document.getElementById(id);
        if (el) el.classList.add('disabled');
    }

    // Listeners for UI state (non-None toggles)
    ['proto-typing-enable', 'proto-password-enable', 'proto-delay-enable', 'proto-passive-enable'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            markDirty();
            updateUIState();
            // showSavedIndicator removed to avoid redundancy
        });
    });
    document.getElementById('challenge-length-input')?.addEventListener('input', () => {
        updateTypingEffectiveness();
    });

    // --- TRIGGER TOGGLES ---
    const triggerIds = [
        'trigger-session-enable', 'trigger-browser-enable', 'trigger-launch-enable',
        'pause-trigger-launch-enable', 'pause-trigger-browser-enable', 'pause-whitelist-enable',
        'reminder-interval-enable', 'reminder-trigger-browser-enable', 'reminder-trigger-launch-enable'
    ];
    triggerIds.forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            markDirty();
            updateUIState();
        });
    });

    // --- GENERAL TOGGLES ---
    document.getElementById('pill-enable-input')?.addEventListener('change', (e) => {
        markDirty();
        updateUIState();
        // showSavedIndicator removed to avoid redundancy
    });

    // --- REAL-TIME VALIDATION ---

    // Attach live validation to all relevant inputs
    const validationInputs = [
        'hardlock-input', 'hardlock-unit', 'session-reset-window',
        'browser-limit-input', 'browser-limit-unit', 'browser-limit-window',
        'launch-limit-input', 'launch-limit-window',
        'unlock-reward-input', 'unlock-reward-unit',
        'trigger-session-enable', 'trigger-browser-enable', 'trigger-launch-enable',
        'proto-typing-enable', 'proto-password-enable', 'proto-delay-enable', 'proto-passive-enable', 'proto-godmode-enable',
        'passive-reward-val', 'passive-reward-unit', 'passive-work-val', 'passive-work-unit'
    ];

    validationInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => { markDirty(); updateUIState(); });
            el.addEventListener('input', () => { markDirty(); updateUIState(); });
        }
    });

    // --- UNIT GRAMMAR LISTENERS ---
    const unitPairs = [
        ['breathing-input', 'breathing-unit'],
        ['reminder-input', 'reminder-unit'],
        ['reminder-trigger-browser-val', 'reminder-trigger-browser-unit'],
        ['hardlock-input', 'hardlock-unit'],
        ['browser-limit-input', 'browser-limit-unit'],
        ['unlock-reward-input', 'unlock-reward-unit'],
        ['proto-delay-val', 'proto-delay-unit'],
        ['launch-limit-input', 'launch-limit-label'],
        ['challenge-length-input', 'challenge-length-label'],
        ['passive-reward-val', 'passive-reward-unit'],
        ['passive-work-val', 'passive-work-unit']
    ];

    unitPairs.forEach(([inputId, unitId]) => {
        const input = document.getElementById(inputId);
        const unit = document.getElementById(unitId);
        if (input) {
            input.addEventListener('input', () => updateUnitGrammar(inputId, unitId));
        }
        if (unit && unit.tagName === 'SELECT') {
            unit.addEventListener('change', () => updateUnitGrammar(inputId, unitId));
        }
    });

    window.refreshAllGrammar = () => {
        unitPairs.forEach(([inputId, unitId]) => updateUnitGrammar(inputId, unitId));
    };

    // --- NONE MODE CONFIRMATION ---
    const noneToggle = document.getElementById('proto-godmode-enable');
    const noneModal = document.getElementById('none-confirm-modal');
    const noneCancel = document.getElementById('none-cancel-btn');
    const noneConfirm = document.getElementById('none-confirm-btn');

    if (noneToggle && noneModal) {
        noneToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                // Show confirmation modal
                e.target.checked = false; // Revert immediately
                noneModal.style.display = 'flex';
            } else {
                updateUIState();
            }
        });

        noneCancel.onclick = () => {
            noneModal.style.display = 'none';
        };

        noneConfirm.onclick = () => {
            noneToggle.checked = true;
            noneModal.style.display = 'none';
            updateUIState();
        };
    }


    // --- MANUAL SAVE (Adv. Protocols) ---
    const saveProtoBtn = document.getElementById('save-difficulty-btn');
    if (saveProtoBtn) {
        saveProtoBtn.addEventListener('click', () => {
            currentSettings.unlockReward = Math.ceil(getConvertedVal('unlock-reward-input', 'unlock-reward-unit') / 60) || 5;

            currentSettings.hardLockTriggers = {
                sessionLimit: {
                    enabled: document.getElementById('trigger-session-enable').checked,
                    value: Math.floor(getConvertedVal('hardlock-input', 'hardlock-unit') / 60) || 30,
                    windowSeconds: parseInt(document.getElementById('session-reset-window').value) || 0
                },
                browserLimit: {
                    enabled: document.getElementById('trigger-browser-enable').checked,
                    value: Math.floor(getConvertedVal('browser-limit-input', 'browser-limit-unit') / 60) || 480,
                    windowSeconds: parseInt(document.getElementById('browser-limit-window').value) || 86400
                },
                launchLimit: {
                    enabled: document.getElementById('trigger-launch-enable').checked,
                    value: parseInt(document.getElementById('launch-limit-input').value) || 3,
                    windowSeconds: parseInt(document.getElementById('launch-limit-window').value) || 3600
                }
            };

            currentSettings.unlockRewardType = document.getElementById('unlock-reward-unit').value;

            // Maintain legacy field for compatibility
            currentSettings.hardLockDuration = currentSettings.hardLockTriggers.sessionLimit.value;

            // Construct Protocols Object
            currentSettings.unlockProtocols = {
                typing: {
                    enabled: document.getElementById('proto-typing-enable').checked,
                    difficulty: parseInt(document.getElementById('challenge-length-input').value) || 50
                },
                password: {
                    enabled: document.getElementById('proto-password-enable').checked,
                    value: document.getElementById('proto-password-val').value || (currentSettings.unlockProtocols?.password?.value || '')
                },
                delay: {
                    enabled: document.getElementById('proto-delay-enable').checked,
                    duration: Math.ceil(getConvertedVal('proto-delay-val', 'proto-delay-unit') / 60) || 5
                },
                godMode: document.getElementById('proto-godmode-enable').checked
            };

            currentSettings.passiveReward = {
                enabled: document.getElementById('proto-passive-enable').checked,
                reward: getConvertedVal('passive-reward-val', 'passive-reward-unit') || 300,
                threshold: getConvertedVal('passive-work-val', 'passive-work-unit') || 1800
            };

            // SAFEGUARD #6 REMOVED: Respect user choice for protocols.
            // (Previously forced typing enabled here)

            // SAFEGUARD #8: Enforce minimum 1 minute unlock reward
            if (currentSettings.unlockReward < 1) {
                currentSettings.unlockReward = 1;
            }

            // Sync legacy field
            currentSettings.typingDifficulty = currentSettings.unlockProtocols.typing.difficulty;

            // VALIDATION CHECK
            const validation = validateSettings();

            if (!validation.valid) {
                // Block save - show errors
                showValidationWarning(validation.errors[0], true);
                return;
            }

            if (validation.warnings.length > 0) {
                // Show warnings but allow save
                showValidationWarning(validation.warnings[0]);
            }
 else {
                hideValidationWarning();
            }

            saveSettings();
            showSavedIndicator();
            // Immediate navigate back to HOME
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('home-view').classList.add('active');
            updateUIState();
        });
    }

    // --- MANUAL SAVE (General Timers) ---
    const saveTimersBtn = document.getElementById('save-timers-btn');
    if (saveTimersBtn) {
        saveTimersBtn.addEventListener('click', () => {
            // Check validation first
            const v = validateSettings();
            if (!v.valid) {
                showValidationWarning(v.errors[0], true);
                return;
            }

            currentSettings.breathingRoomDuration = getConvertedVal('breathing-input', 'breathing-unit') || 15;
            currentSettings.reminderInterval = Math.ceil(getConvertedVal('reminder-input', 'reminder-unit') / 60) || 15;
            currentSettings.reminderStyle = document.getElementById('reminder-style-input').value;
            currentSettings.soundEnabled = document.getElementById('sound-input').checked;
            currentSettings.showTimerPill = document.getElementById('pill-enable-input').checked;
            currentSettings.showPillOnWhitelist = document.getElementById('pill-whitelist-input').checked;
            currentSettings.whitelistShortcuts = document.getElementById('whitelist-shortcuts-input').checked;
            currentSettings.breathingFreq = document.getElementById('breathing-freq').value;
            saveSettings();
            showSavedIndicator();
            // Immediate navigate back to HOME
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('home-view').classList.add('active');
            updateUIState();
        });
    }

    // --- ADD/REMOVE ITEMS ---
    const addSiteBtn = document.getElementById('add-site-btn');
    if (addSiteBtn) {
        addSiteBtn.addEventListener('click', () => {
            let v = document.getElementById('new-site-input').value.trim().toLowerCase();
            if (!v) return;

            // ROBUST SANITIZATION
            v = sanitizeDomainInput(v);

            // STRICT VALIDATION
            if (!isValidDomain(v)) {
                showCustomAlert("Invalid Domain", "Please enter a valid domain (e.g., example.com). Phone numbers and text are not allowed.");
                return;
            }

            if (v && !currentSettings.whitelist.includes(v)) {
                currentSettings.whitelist.push(v);
                markDirty();
                renderWhitelist();
                document.getElementById('new-site-input').value = '';
            } else if (currentSettings.whitelist.includes(v)) {
                 showCustomAlert("Duplicate Entry", "This site is already on your list.");
            }
        });
    }

    const addBlockBtn = document.getElementById('add-block-btn');
    if (addBlockBtn) {
        addBlockBtn.addEventListener('click', () => {
            let v = document.getElementById('new-block-input').value.trim().toLowerCase();
            if (!v) return;

            // ROBUST SANITIZATION
            v = sanitizeDomainInput(v);

             // STRICT VALIDATION
            if (!isValidDomain(v)) {
                showCustomAlert("Invalid Domain", "Please enter a valid domain (e.g., example.com). Phone numbers and text are not allowed.");
                return;
            }

            if (v && !currentSettings.blacklist.includes(v)) {
                currentSettings.blacklist.push(v);
                markDirty();
                renderBlocklist();
                document.getElementById('new-block-input').value = '';
            } else if (currentSettings.blacklist.includes(v)) {
                showCustomAlert("Duplicate Entry", "This site is already on your list.");
            }
        });
    }

    // Auto-clean shortcut input on blur/input/paste
    const shortcutInput = document.getElementById('new-shortcut-url');
    if (shortcutInput) {
        const cleanup = () => {
             let val = shortcutInput.value.trim();
            if (val) {
                val = val.replace(/^https?:\/\//i, '').replace(/^www\./i, '');
                shortcutInput.value = val;
            }
        };
        shortcutInput.addEventListener('blur', cleanup);
        shortcutInput.addEventListener('input', cleanup);
        shortcutInput.addEventListener('paste', () => setTimeout(cleanup, 10));
    }

    const addShortcutBtn = document.getElementById('add-shortcut-btn');
    if (addShortcutBtn) {
        addShortcutBtn.addEventListener('click', () => {
            if ((currentSettings.shortcuts || []).length >= 6) {
                showCustomAlert("Limit Reached", "Maximum of 6 shortcuts allowed. Please remove one before adding another.");
                return;
            }
            const n = document.getElementById('new-shortcut-name').value.trim();
            let u = document.getElementById('new-shortcut-url').value.trim();
            
            // SMART URL FIX: If missing protocol, assume https://
            if (u && !/^https?:\/\//i.test(u)) {
                u = 'https://' + u;
            }
            
            if (!n) {
                showCustomAlert("Missing Name", "Please enter a name for the shortcut.");
                return;
            }

            if (!isValidUrl(u)) {
                showCustomAlert("Invalid URL", "Please enter a full valid URL (e.g., https://youtube.com).");
                return;
            }

            // DUPLICATE CHECK
            if (currentSettings.shortcuts.some(s => s.url === u)) {
                 showCustomAlert("Duplicate Entry", "This shortcut is already on your list.");
                 return;
            }

            currentSettings.shortcuts.push({ name: n, url: u });
            markDirty();
            renderShortcuts();
            document.getElementById('new-shortcut-name').value = '';
            document.getElementById('new-shortcut-url').value = '';
        });
    }

    // Delete Delegation
    document.body.addEventListener('click', (e) => {
        if (e.target.dataset.type) {
            const idx = parseInt(e.target.dataset.index);
            const type = e.target.dataset.type;
            
            if (type === 'whitelist') {
                currentSettings.whitelist.splice(idx, 1);
                const filter = document.getElementById('whitelist-search')?.value || '';
                markDirty();
                renderWhitelist(filter);
            } else if (type === 'blacklist') {
                currentSettings.blacklist.splice(idx, 1);
                const filter = document.getElementById('blocklist-search')?.value || '';
                markDirty();
                renderBlocklist(filter);
            } else if (type === 'shortcut') {
                currentSettings.shortcuts.splice(idx, 1);
                const filter = document.getElementById('shortcuts-search')?.value || '';
                markDirty();
                renderShortcuts(filter);
            }
        }
    });

    // Make updateUIState global-ish or accessible if needed, but it's bound to listeners.
    // We attach it to DOM now so it runs on init in populate.
    window.triggerProtocolUIUpdate = updateUIState;

    // Handle Password Dual-State (Toggle between view/edit)
    const updateBtn = document.getElementById('toggle-password-setup-btn');
    const cancelBtn = document.getElementById('cancel-password-setup-btn');
    const setupState = document.getElementById('password-setup-state');
    const activeState = document.getElementById('password-active-state');
    
    // Rows to toggle
    const verifySec = document.getElementById('password-verify-section');
    const entryLabel = document.getElementById('password-entry-label');
    const confirmBtn = document.getElementById('generate-password-btn');

    if (updateBtn) {
        updateBtn.onclick = () => {
            const hasExisting = !!(currentSettings?.unlockProtocols?.password?.value);
            if (setupState) setupState.style.display = 'block';
            if (activeState) activeState.style.display = 'none';

            // Configure sub-states
            if (hasExisting) {
                if (verifySec) verifySec.style.display = 'block';
                if (entryLabel) entryLabel.textContent = 'Set New Password';
                if (confirmBtn) confirmBtn.textContent = 'Confirm New Password';
            } else {
                if (verifySec) verifySec.style.display = 'none';
                if (entryLabel) entryLabel.textContent = 'Create Master Password';
                if (confirmBtn) confirmBtn.textContent = 'Confirm Password';
            }
            
            // PROGRESSIVE DISCLOSURE: Fade the Confirm button until passwords match
            if (confirmBtn) {
                confirmBtn.disabled = true;
                confirmBtn.style.opacity = '0.35';
                confirmBtn.style.filter = 'grayscale(1)';
                confirmBtn.style.cursor = 'not-allowed';
                confirmBtn.style.pointerEvents = 'none';
            }

            // Trigger full UI update to fade the "Save Settings" button
            updateUIState();
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            if (setupState) setupState.style.display = 'none';
            if (activeState) activeState.style.display = 'block';
            updateUIState();
        };
    }

    // --- DEVELOPER/TEST BUTTONS ---
    const debugActions = {
        'test-hardlock-btn': 'forceHardLock',
        'test-reminder-btn': 'forceReminder',
        'test-pause-btn': 'forceBreathing'
    };

    Object.keys(debugActions).forEach(id => {
        const btn = document.getElementById(id);
        if (btn) {
            btn.addEventListener('click', () => {
                showSavedIndicator('Triggering...');
                chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                    const tabId = tabs[0]?.id;
                    if (!tabId) return;

                    chrome.runtime.sendMessage({ 
                        action: 'relayDebugTrigger', 
                        type: debugActions[id],
                        tabId: tabId
                    }, (res) => {
                        if (res && res.success) {
                            showSavedIndicator('Triggered ✓');
                        } else if (res && res.error === 'stale') {
                            showSavedIndicator('Refresh Tab!');
                            console.warn('[Cure] Tab needs refresh to receive debug signals.');
                        } else {
                            showSavedIndicator('Error!');
                        }
                    });
                });
            });
        }
    });

    // Force initial UI update now that listeners are set
    updateUIState();
}

function showSavedIndicator(text = 'Saved ✓') {
    const el = document.getElementById('save-status');
    if (el) {
        el.textContent = text;
        el.classList.add('show');
        setTimeout(() => { el.classList.remove('show'); }, 2000);
    }
}


// Override populate to fill new fields
const _pop = populateInputs;
populateInputs = function () {
    _pop(); // Run original basic population

    if (currentSettings.breathingFreq) {
        document.getElementById('breathing-freq').value = currentSettings.breathingFreq;
    }

    // Fill Protocols
    const p = currentSettings.unlockProtocols || { typing: { enabled: true, difficulty: 50 } };

    setChk('proto-typing-enable', p.typing?.enabled);
    setVal('challenge-length-input', p.typing?.difficulty || 50);

    setChk('proto-password-enable', p.password?.enabled);
    const activeState = document.getElementById('password-active-state');
    const setupState = document.getElementById('password-setup-state');
    const cancelBtn = document.getElementById('cancel-password-setup-btn');
    const verifySec = document.getElementById('password-verify-section');
    const entryLabel = document.getElementById('password-entry-label');
    const confirmBtn = document.getElementById('generate-password-btn');

    if (p.password?.value) {
        // STATE: ACTIVE
        if (activeState) activeState.style.display = 'block';
        if (setupState) setupState.style.display = 'none';
        if (cancelBtn) cancelBtn.style.display = 'block';
    } else {
        // STATE: UNSET
        if (activeState) activeState.style.display = 'none';
        if (setupState) setupState.style.display = 'block';
        if (cancelBtn) cancelBtn.style.display = 'none';
        
        // Ensure create-mode texts
        if (verifySec) verifySec.style.display = 'none';
        if (entryLabel) entryLabel.textContent = 'Create Master Password';
        if (confirmBtn) {
            confirmBtn.textContent = 'Confirm Password';
            // PROGRESSIVE DISCLOSURE: Start faded until passwords match
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.35';
            confirmBtn.style.filter = 'grayscale(1)';
            confirmBtn.style.cursor = 'not-allowed';
            confirmBtn.style.pointerEvents = 'none';
        }
    }

    setVal('proto-password-old', '');
    setVal('proto-password-val', '');
    setVal('proto-password-confirm', '');

    setChk('proto-delay-enable', p.delay?.enabled);
    setVal('proto-delay-val', p.delay?.duration || 5);

    // Unlock Reward Population (Manual to preserve Unit Type)
    const rewardType = currentSettings.unlockRewardType || 'min';
    const rewardVal = currentSettings.unlockReward || 5;
    const urInput = document.getElementById('unlock-reward-input');
    const urUnit = document.getElementById('unlock-reward-unit');

    if (urInput && urUnit) {
        urUnit.value = rewardType;
        // Fallback: If for some reason the above failed (blank dropdown), force 'min'
        if (!urUnit.value) urUnit.value = 'min';

        if (rewardType === 'hr') {
            urInput.value = Math.floor(rewardVal / 60) || 1;
        } else {
            urInput.value = rewardVal;
        }
        updateUnitGrammar('unlock-reward-input', 'unlock-reward-unit');
    }

    setChk('proto-godmode-enable', p.godMode);

    // Passive Rewards
    const pr = currentSettings.passiveReward || { enabled: false, reward: 300, threshold: 1800 };
    setChk('proto-passive-enable', pr.enabled);
    setConvertedVal('passive-reward-val', 'passive-reward-unit', pr.reward || 300);
    setConvertedVal('passive-work-val', 'passive-work-unit', pr.threshold || 1800);

    // Trigger UI update AFTER all values are set
    setTimeout(() => {
        if (window.refreshAllGrammar) window.refreshAllGrammar();
        if (window.triggerProtocolUIUpdate) window.triggerProtocolUIUpdate();

    }, 10);
}

function setChk(id, val) { const el = document.getElementById(id); if (el) el.checked = !!val; }
function setVal(id, val) {
    const el = document.getElementById(id);
    if (el) {
        el.value = val;
        // Trigger grammar update if it's a known input
        const unitPairs = [
            ['launch-limit-input', 'launch-limit-label'],
            ['challenge-length-input', 'challenge-length-label']
        ];
        const pair = unitPairs.find(p => p[0] === id);
        if (pair) updateUnitGrammar(pair[0], pair[1]);
    }
}
// --- NEW SAVE LISTENERS ---
function setupNewViewListeners() {
    // SAVE PAUSE SETTINGS
    document.getElementById('save-pause-btn')?.addEventListener('click', () => {
        // Check validation first
        const v = validateSettings();
        if (!v.valid) {
            showValidationWarning(v.errors[0], true);
            return;
        }

        currentSettings.breathingRoomDuration = getConvertedVal('breathing-input', 'breathing-unit');
        currentSettings.breathingFreq = document.getElementById('breathing-freq').value;
        currentSettings.pauseWhitelist = document.getElementById('pause-whitelist-enable').checked;

        currentSettings.pauseTriggers = {
            launchLimit: {
                enabled: document.getElementById('pause-trigger-launch-enable').checked,
                value: parseInt(document.getElementById('pause-trigger-launch-val').value) || 5,
                windowSeconds: 3600 // Fixed to 1 hour for simplicity as per UI
            },
            browserLimit: {
                enabled: document.getElementById('pause-trigger-browser-enable').checked,
                value: parseInt(document.getElementById('pause-trigger-browser-val').value) || 120, // Minutes
                windowSeconds: 86400 // Daily
            }
        };

        saveSettings();
        showSavedIndicator();
        const backBtn = document.querySelector('.nav-back');
        if (backBtn) backBtn.click();
    });

    // Mark dirty when frequency dropdown changes
    document.getElementById('breathing-freq')?.addEventListener('change', () => {
        markDirty();
    });

    // SAVE REMINDERS SETTINGS
    document.getElementById('save-reminders-btn')?.addEventListener('click', () => {
        // Check validation first
        const v = validateSettings();
        if (!v.valid) {
            showValidationWarning(v.errors[0], true);
            return;
        }

        currentSettings.reminderIntervalEnabled = document.getElementById('reminder-interval-enable').checked;
        currentSettings.reminderIntervalType = document.getElementById('reminder-interval-type').value;
        currentSettings.reminderBrowserType = document.getElementById('reminder-browser-type').value;
        currentSettings.reminderInterval = Math.floor(getConvertedVal('reminder-input', 'reminder-unit') / 60) || 15;
        
        // Convert Browser Limit to minutes for background/content logic
        const browserLimitSecs = getConvertedVal('reminder-trigger-browser-val', 'reminder-trigger-browser-unit');
        if (!currentSettings.reminderTriggers) currentSettings.reminderTriggers = {};
        if (!currentSettings.reminderTriggers.browserLimit) currentSettings.reminderTriggers.browserLimit = { enabled: true, value: 120 };
        currentSettings.reminderTriggers.browserLimit.value = Math.floor(browserLimitSecs / 60) || 120;
        currentSettings.reminderTriggers.browserLimit.enabled = document.getElementById('reminder-trigger-browser-enable').checked;

        currentSettings.reminderStyle = document.getElementById('reminder-style-input').value;
        currentSettings.reminderWhitelist = document.getElementById('reminder-whitelist-enable').checked;

        currentSettings.reminderTriggers = {
            launchLimit: {
                enabled: document.getElementById('reminder-trigger-launch-enable').checked,
                value: parseInt(document.getElementById('reminder-trigger-launch-val').value) || 5,
                windowSeconds: parseInt(document.getElementById('reminder-trigger-launch-window').value) || 3600,
                type: document.getElementById('reminder-launch-type').value || 'repeating'
            },
            browserLimit: {
                enabled: document.getElementById('reminder-trigger-browser-enable').checked,
                value: parseInt(document.getElementById('reminder-trigger-browser-val').value) || 120,
                windowSeconds: 86400
            }
        };

        saveSettings();
        showSavedIndicator();
        const backBtn = document.querySelector('.nav-back');
        if (backBtn) backBtn.click();
    });

    // DATA & SECURITY LISTENERS
    // Export
    document.getElementById('export-settings-btn')?.addEventListener('click', () => {
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentSettings, null, 2));
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", "cure_settings_" + new Date().toISOString().slice(0, 10) + ".json");
        document.body.appendChild(downloadAnchorNode); // required for firefox
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    });

    // Import Trigger
    document.getElementById('import-settings-btn')?.addEventListener('click', () => {
        document.getElementById('import-file-input').click();
    });

    // Import Handler
    document.getElementById('import-file-input')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const imported = JSON.parse(e.target.result);
                // Basic validation: check for key properties
                if (imported.whitelist && imported.hardLockTriggers) {
                    currentSettings = imported;
                    saveSettings();
                    alert('Settings imported successfully! Reloading...');
                    window.location.reload();
                } else {
                    alert('Invalid settings file.');
                }
            } catch (err) {
                alert('Error parsing file: ' + err.message);
            }
        };
        reader.readAsText(file);
    });


    // Listeners for new toggles to update UI state
    ['pause-trigger-launch-enable', 'pause-trigger-browser-enable', 'reminder-trigger-launch-enable', 'reminder-trigger-browser-enable', 'reminder-interval-enable'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            markDirty();
            if (window.triggerProtocolUIUpdate) window.triggerProtocolUIUpdate();
            // showSavedIndicator removed to avoid redundancy
        });
    });

    // Additional listeners for Reminders inputs to ensure dirty state
    ['reminder-interval-type', 'reminder-browser-type', 'reminder-input', 'reminder-unit', 'reminder-trigger-browser-val', 'reminder-trigger-browser-unit', 'reminder-trigger-launch-val', 'reminder-trigger-launch-window', 'reminder-style-input', 'reminder-whitelist-enable'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            const eventType = (el.type === 'number' || el.type === 'text') ? 'input' : 'change';
            el.addEventListener(eventType, () => markDirty());
        }
    });

    // CONSISTENT SAVE BUTTONS FOR NEW VIEWS
    ['save-whitelist-btn', 'save-shortcuts-btn', 'save-blocklist-btn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            // Check validation first (Global master toggles might be invalid)
            const v = validateSettings();
            if (!v.valid) {
                showValidationWarning(v.errors[0], true);
                return;
            }

            saveSettings();
            showSavedIndicator();
            // Immediate navigate back to HOME
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('home-view').classList.add('active');
            updateUIState();
        });
    });

    // TEST ZONE BUTTONS
    document.getElementById('test-factory-reset-btn')?.addEventListener('click', () => {
        if (confirm('⚠️ FACTORY RESET: This will wipe ALL settings and data. Are you sure?')) {
            const btn = document.getElementById('test-factory-reset-btn');
            const originalText = btn.innerHTML;
            btn.innerHTML = '⚠️ Resetting...';
            btn.disabled = true;

            chrome.runtime.sendMessage({ action: 'factoryReset' }, (res) => {
                if (res && res.success) {
                    btn.innerHTML = '✅ Reset Complete';
                    setTimeout(() => {
                        chrome.runtime.reload(); 
                    }, 1000);
                }
            });
        }
    });

    document.getElementById('test-unlock-site-btn')?.addEventListener('click', () => {
        // Query active tab to unlock specific site
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTab = tabs[0];
            if (!currentTab || !currentTab.url) {
                alert('No active site detected (Tab/URL unavailable).');
                return;
            }

            let hostname;
            try {
                hostname = new URL(currentTab.url).hostname;
            } catch (e) {
                alert('Invalid URL for unlocking.');
                return;
            }

            // Fix 15: Send tabId for precise targeting + hostname for key removal
            chrome.runtime.sendMessage({ 
                action: 'forceUnlockSite', 
                hostname: hostname,
                tabId: currentTab.id 
            }, (res) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    alert('Unlock Verification Failed: ' + lastError.message);
                    return;
                }

                if (res && res.success) {
                    const btn = document.getElementById('test-unlock-site-btn');
                    const originalText = btn.innerHTML;
                    // Truncate hostname for button UI
                    const shortHost = hostname.length > 20 ? hostname.substring(0, 18) + '...' : hostname;
                    btn.innerHTML = `✅ Unlocked ${shortHost}`;
                    setTimeout(() => {
                        btn.innerHTML = originalText;
                    }, 2000);
                } else {
                    alert('Background failed to process unlock request (No success response).');
                }
            });
        });
    });
}



// --- GLOBAL UI FUNCTIONS ---

function updateUIState() {
    // 1. Master Switch States (Fading & Disabling entire sections)
    // Runs first so that sub-config toggling can refine the enabled/disabled state
    if (currentSettings) {
        applyMasterState('hardlock-config-view', currentSettings.masterHardLock !== false, 'hardlock-disabled-banner');
        applyMasterState('pause-view', currentSettings.masterPause !== false, 'pause-disabled-banner');
        applyMasterState('reminders-view', currentSettings.masterReminders !== false, 'reminders-disabled-banner');

        updateMasterStatusText('hardlock-status-text', currentSettings.masterHardLock !== false, 'strict lock');
        updateMasterStatusText('pause-status-text', currentSettings.masterPause !== false, 'pause');
        updateMasterStatusText('reminders-status-text', currentSettings.masterReminders !== false, 'reminders');
    }

    // 2. Feature Sub-Configs (Triggers & Protocols)
    toggleSub('proto-typing-enable', 'config-typing');
    toggleSub('proto-password-enable', 'config-password');
    toggleSub('proto-delay-enable', 'config-delay');
    toggleSub('proto-godmode-enable', 'config-godmode');
    toggleSub('proto-passive-enable', 'config-passive');
    toggleSub('trigger-session-enable', 'config-trigger-session');
    toggleSub('trigger-browser-enable', 'config-browser-limit');
    toggleSub('trigger-launch-enable', 'config-launch-limit');
    toggleSub('pause-trigger-launch-enable', 'config-pause-trigger-launch');
    toggleSub('pause-trigger-browser-enable', 'config-pause-trigger-browser');
    toggleSub('reminder-trigger-browser-enable', 'config-reminder-trigger-browser');
    toggleSub('reminder-trigger-launch-enable', 'config-reminder-trigger-launch');
    toggleSub('reminder-interval-enable', 'config-reminder-interval');
    toggleSub('pill-enable-input', 'config-pill-whitelist');

    // 3. Specialized Logic (None Mode, Rewards, Typing)
    const noneMode = document.getElementById('proto-godmode-enable')?.checked;
    if (noneMode) {
        forceDisable('proto-typing-enable', true);
        forceDisable('proto-password-enable', true);
        forceDisable('proto-delay-enable', true);
    } else {
        forceDisable('proto-typing-enable', false);
        forceDisable('proto-password-enable', false);
        forceDisable('proto-delay-enable', false);
    }

    const rewardContainer = document.getElementById('reward-time-container');
    if (rewardContainer) {
        rewardContainer.style.display = noneMode ? 'none' : 'block';
    }
    updateTypingEffectiveness();

    // 4. Validation (Visual Polish)
    const v = validateSettings();
    const hlSaveBtn = document.getElementById('save-difficulty-btn');
    const remindSaveBtn = document.getElementById('save-reminders-btn');
    const pauseSaveBtn = document.getElementById('save-pause-btn');

    const isHLMasterOn = document.getElementById('master-hardlock-enable')?.checked;
    const isRemindMasterOn = document.getElementById('inner-master-reminders')?.checked;
    const isPauseMasterOn = document.getElementById('inner-master-pause')?.checked;

    // SILENT PASSWORD CHECK: Disable Save if password is ON but incomplete/editing
    const passOn = document.getElementById('proto-password-enable')?.checked;
    const isPasswordEditing = document.getElementById('password-setup-state')?.style.display !== 'none';
    const hasStoredPassword = !!(currentSettings?.unlockProtocols?.password?.value);
    const hasBufferPassword = !!(document.getElementById('proto-password-val')?.value);
    const hasPassword = hasStoredPassword || hasBufferPassword;
    const passIncomplete = passOn && (isPasswordEditing || !hasPassword);

    // Helper to apply visual state to save buttons based on validation
    const applySaveBtnState = (btn, isValid, errorMsg) => {
        if (!btn) return;
        if (!isValid) {
            btn.disabled = true;
            btn.style.opacity = '0.35';
            btn.style.filter = 'grayscale(1)';
            btn.style.cursor = 'not-allowed';
            btn.style.pointerEvents = 'none';
            if (errorMsg) showValidationWarning(errorMsg, true);
        } else {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.filter = 'none';
            btn.style.cursor = 'pointer';
            btn.style.pointerEvents = 'auto';
            hideValidationWarning();
        }
    };

    // Evaluate Strict Lock Save Button
    const hlError = v.errors.find(e => e.includes('Strict Lock'));
    if (hlSaveBtn && isHLMasterOn) {
        applySaveBtnState(hlSaveBtn, !hlError && !passIncomplete, hlError || (passIncomplete ? "Complete password setup" : null));
    } else if (hlSaveBtn) {
        applySaveBtnState(hlSaveBtn, true);
    }

    // Evaluate Reminders Save Button
    const remindError = v.errors.find(e => e.includes('Reminders'));
    if (remindSaveBtn && isRemindMasterOn) {
        applySaveBtnState(remindSaveBtn, !remindError, remindError);
    } else if (remindSaveBtn) {
        applySaveBtnState(remindSaveBtn, true);
    }

    // Evaluate Pause Save Button
    const pauseError = v.errors.find(e => e.includes('Pause'));
    if (pauseSaveBtn && isPauseMasterOn) {
        applySaveBtnState(pauseSaveBtn, !pauseError, pauseError);
    } else if (pauseSaveBtn) {
        applySaveBtnState(pauseSaveBtn, true);
    }
}

function toggleSub(chkId, divId) {
    const chk = document.getElementById(chkId);
    const div = document.getElementById(divId);
    if (chk && div) {
        const isDisabled = !chk.checked || chk.disabled;
        if (isDisabled) div.classList.add('disabled');
        else div.classList.remove('disabled');

        const children = div.querySelectorAll('input, select, button');
        children.forEach(child => {
            child.disabled = isDisabled;
        });
    }
}

function applyMasterState(containerId, isEnabled, bannerId) {
    const view = document.getElementById(containerId);
    if (!view) return;

    const scrollable = view.querySelector('.scrollable-content');
    const banner = document.getElementById(bannerId);
    const footer = view.querySelector('.fixed-footer');

    if (!isEnabled) {
        if (scrollable) {
            scrollable.style.opacity = '0.35';
            scrollable.style.filter = 'grayscale(1)';
            scrollable.style.pointerEvents = 'none';
        }
        if (banner) {
            banner.classList.add('is-disabled');
        }

        // Disable all interactive elements EXCEPT the master switch itself
        const inputs = view.querySelectorAll('input, select, button');
        inputs.forEach(el => {
            if (el.classList.contains('nav-back') || el.id.startsWith('inner-master-')) return;
            el.disabled = true;
            el.style.opacity = '0.35';
            el.style.pointerEvents = 'none';
        });
    } else {
        if (scrollable) {
            scrollable.style.opacity = '1';
            scrollable.style.filter = 'none';
            scrollable.style.pointerEvents = 'auto'; // Re-enable pointer events
        }
        if (banner) {
            banner.classList.remove('is-disabled');
        }

        // RE-ENABLE logic: Bring everything back to a base state
        // toggleSub will then refine this by disabling specific sub-configs
        const inputs = view.querySelectorAll('input, select, button');
        inputs.forEach(el => {
            el.disabled = false;
            el.style.opacity = '';
            el.style.filter = '';
            el.style.pointerEvents = '';
        });

        // Re-enable footer buttons specifically just in case
        if (footer) {
            const btns = footer.querySelectorAll('button');
            btns.forEach(b => {
                b.disabled = false;
                b.style.opacity = '1';
                b.style.pointerEvents = 'auto';
            });
        }
    }
}

function updateMasterStatusText(id, isEnabled, featureName) {
    const el = document.getElementById(id);
    if (!el) return;

    // Feature names for specialized grammar
    const displayNames = {
        'strict lock': 'Strict Lock is',
        'pause': 'Pause is',
        'reminders': 'Reminders are'
    };
    const prefix = displayNames[featureName] || `${featureName} is`;
    const emoji = isEnabled ? '🔒' : '🔓';

    if (isEnabled) {
        el.innerHTML = `<span style="margin-right:8px">${emoji}</span> ${prefix} Enabled`;
    } else {
        el.innerHTML = `<span style="margin-right:8px">${emoji}</span> ${prefix} Disabled`;
    }
}

function forceDisable(id, disable) {
    const el = document.getElementById(id);
    if (el) {
        el.disabled = disable;
        if (disable) el.checked = false;
    }
}


function showCustomAlert(title, message) {
    const modal = document.getElementById('custom-alert-modal');
    const titleEl = modal.querySelector('.cure-modal-title');
    const msgEl = modal.querySelector('.cure-modal-message');
    const okBtn = document.getElementById('custom-alert-ok-btn');

    if (modal && titleEl && msgEl) {
        titleEl.textContent = title;
        msgEl.textContent = message;
        modal.style.display = 'flex';
        
        okBtn.onclick = () => {
            modal.style.display = 'none';
        };
        
        // Close on background click
        modal.onclick = (e) => {
            if (e.target === modal) modal.style.display = 'none';
        };
    } else {
        // Fallback if modal DOM is missing
        alert(message);
    }
}

function updateTypingEffectiveness() {
    const input = document.getElementById('challenge-length-input');
    if (!input) return; // Guard
    const words = parseInt(input.value) || 0;
    const fill = document.getElementById('typing-effectiveness-fill');
    const text = document.getElementById('typing-effectiveness-text');

    if (!fill || !text) return;

    let pct, label, color;
    if (words < 30) {
        pct = Math.min(words / 30 * 33, 33);
        label = '⚠️ Too easy';
        color = '#FF3B30';
    } else if (words < 60) {
        pct = 33 + ((words - 30) / 30 * 33);
        label = '🟡 Moderate';
        color = '#FF9500';
    } else {
        pct = 66 + ((words - 60) / 20 * 34);
        label = '✅ Effective';
        color = '#34C759';
    }

    fill.style.width = `${pct}%`;
    fill.style.background = color;
    text.textContent = label;
    text.style.color = color;
}

/**
 * Strict Input Validation
 * Prevents negative numbers, enforces min/max limits, and sanitizes input.
 */
function setupInputValidation() {
    // Configuration for all numeric inputs
    const numericInputs = [
        { id: 'hardlock-input', min: 1, max: 1440 },        // Site Activity Limit (default 30 min)
        { id: 'launch-limit-input', min: 1, max: 999 },     // Launch budget
        { id: 'browser-limit-input', min: 1, max: 1440 },   // Browser daily limit
        
        { id: 'unlock-reward-input', min: 1, max: 1440 },   // Reward duration
        { id: 'passive-reward-val', min: 1, max: 1440 },    // Passive earned
        { id: 'passive-work-val', min: 1, max: 1440 },      // Passive work req
        
        { id: 'challenge-length-input', min: 1, max: 200 }, // Typing words
        { id: 'proto-delay-val', min: 0, max: 120 },        // Unlock delay (0 is allowed)
        
        { id: 'breathing-input', min: 1, max: 300 },        // Pause duration (sec)
        { id: 'pause-trigger-launch-val', min: 1, max: 999 }, // Pause launch trigger
        { id: 'pause-trigger-browser-val', min: 1, max: 1440 }, // Pause screen time
        
        { id: 'reminder-input', min: 1, max: 1440 },        // Reminder interval
        { id: 'reminder-trigger-browser-val', min: 1, max: 1440 }, // Reminder screen time
        { id: 'reminder-trigger-launch-val', min: 1, max: 999 }    // Reminder launch trigger
    ];

    numericInputs.forEach(config => {
        const input = document.getElementById(config.id);
        if (!input) return;

        // 1. Prevent invalid characters (-, +, e) during typing
        input.addEventListener('keydown', (e) => {
            // Allow navigation keys (backspace, delete, arrows, tab)
            if (['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key)) return;
            // Block invalid chars
            if (['-', '+', 'e', 'E', '.'].includes(e.key)) {
                e.preventDefault();
            }
        });

        // 2. Sanitize on input (handles paste/drag)
        input.addEventListener('input', () => {
            const raw = input.value;
            // Remove non-digit chars
            if (!/^\d*$/.test(raw)) {
                input.value = raw.replace(/\D/g, '');
            }
        });

        // 3. Strict enforcement on blur (focus out)
        input.addEventListener('blur', () => {
            let val = parseInt(input.value, 10);
            
            // Handle empty or invalid
            if (isNaN(val)) {
                val = config.min; 
            } else {
                // Clamp functionality
                if (val < config.min) val = config.min;
                if (config.max && val > config.max) val = config.max;
            }

            // Update visible value if changed
            if (input.value !== String(val)) {
                input.value = val;
                // Trigger change to ensure settings save
                input.dispatchEvent(new Event('change'));
            }
        });
    });
}
