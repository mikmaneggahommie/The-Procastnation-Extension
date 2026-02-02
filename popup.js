// Cure Procrastination - Clean Logic + Help

let currentSettings = null;

document.addEventListener('DOMContentLoaded', async () => {
    await loadSettings();
    renderAll();
    setupListeners();
    setupNewViewListeners(); // New listeners for Pause/Reminders
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
            if (sUrl) sUrl.value = urlObj.origin; // https://example.com

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

    // VALIDATION RULE 1: Limit cannot equal or exceed window (Deadlock / Impossible)
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

    // --- STRICT LOCK ENFORCEMENT ---
    const hlOn = document.getElementById('master-hardlock-enable').checked;
    if (hlOn) {
        // 1. Activation Method Required
        const sessionOn = document.getElementById('trigger-session-enable').checked;
        const launchOn = document.getElementById('trigger-launch-enable').checked;
        const browserOn = document.getElementById('trigger-browser-enable').checked;

        if (!sessionOn && !launchOn && !browserOn) {
            errors.push('<strong>Strict Lock Error:</strong> Select at least one Activation Method (e.g. Site Activity Limit).');
        }

        // 2. Protocol Required
        const typeOn = document.getElementById('proto-typing-enable').checked;
        const passOn = document.getElementById('proto-password-enable').checked;
        const delayOn = document.getElementById('proto-delay-enable').checked;
        const passiveOn = document.getElementById('proto-passive-enable').checked;
        const noneOn = document.getElementById('proto-godmode-enable').checked;

        if (!typeOn && !passOn && !delayOn && !passiveOn && !noneOn) {
            errors.push('<strong>Strict Lock Error:</strong> Select at least one Unlock Protocol (e.g. Typing or None).');
        }

        // 3. Password Integrity Check (State-Aware)
        if (passOn) {
            const hasStored = !!(currentSettings?.unlockProtocols?.password?.value);
            const isEditing = document.getElementById('password-setup-state')?.style.display !== 'none';
            const newVal = document.getElementById('proto-password-val')?.value;
            const confirmVal = document.getElementById('proto-password-confirm')?.value;

            if (isEditing) {
                if (!newVal) errors.push('<strong>Password Error:</strong> New password cannot be empty.');
                if (newVal !== confirmVal) errors.push('<strong>Password Error:</strong> New passwords do not match.');
            } else if (!hasStored) {
                errors.push('<strong>Password Error:</strong> No password set. Please click "Update Password" to create one.');
            }
        }
    }

    // --- DOCTOR STRANGE HEURISTICS (Toxic Configs) ---

    // RULE 4: The Flicker Trap (Limit > 95% of Window)
    if (sessionEnabled && windowSeconds > 0) {
        if (limitSeconds > windowSeconds * 0.95) {
            warnings.push('<strong>Flicker Warning:</strong> Limit is very close to window size. You may get locked/unlocked constantly.');
        }
    }





    // RULE 7: Passive Inflation (Output > Input)
    const passiveEnabled = document.getElementById('proto-passive-enable').checked;
    if (passiveEnabled) {
        const earnSeconds = getConvertedVal('passive-reward-val', 'passive-reward-unit');
        const workSeconds = getConvertedVal('passive-work-val', 'passive-work-unit');
        if (earnSeconds > workSeconds) {
            errors.push('<strong>Passive Inflation:</strong> You cannot earn more time than you work. This breaks the laws of physics (and productivity).');
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

    const val = parseInt(input.value) || 0;
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
    setConvertedVal('reminder-input', 'reminder-unit', reminders);
    setChk('reminder-whitelist-enable', !!currentSettings.reminderWhitelist);

    // Reminder Triggers
    setChk('reminder-trigger-launch-enable', reminderTriggers.launchLimit?.enabled);
    setVal('reminder-trigger-launch-val', reminderTriggers.launchLimit?.value || 5);

    setChk('reminder-trigger-browser-enable', reminderTriggers.browserLimit?.enabled);
    setVal('reminder-trigger-browser-val', reminderTriggers.browserLimit?.value || 120);

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
    if (!items.length) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:#999;font-size:13px;">${filter ? 'No matches' : 'Allowlist is empty'}</div>`;
        return;
    }
        return;
    }
    items.forEach((site) => {
        // Find original index for removal consistency
        const originalIndex = currentSettings.whitelist.indexOf(site);
        const item = document.createElement('div');
        item.className = 'settings-item';
        item.innerHTML = `
      <div class="item-text"><h3>${site}</h3></div>
      <button class="action-btn danger-btn" data-type="whitelist" data-index="${originalIndex}" style="font-size:11px; padding:4px 10px;">Remove</button>
    `;
        list.appendChild(item);
    });
}

function renderShortcuts(filter = '') {
    const list = document.getElementById('shortcuts-container');
    list.innerHTML = '';

    let items = currentSettings.shortcuts || [];
    if (filter) {
        items = items.filter(s => s.name.toLowerCase().includes(filter.toLowerCase()) || s.url.toLowerCase().includes(filter.toLowerCase()));
    }

    if (!items.length) {
        list.innerHTML = `<div style="padding:16px;text-align:center;color:#999;font-size:13px;">${filter ? 'No matches' : 'No shortcuts'}</div>`;
        return;
    }
    items.forEach((s) => {
        const originalIndex = currentSettings.shortcuts.indexOf(s);
        const item = document.createElement('div');
        item.className = 'settings-item';
        item.innerHTML = `
      <div class="item-text">
        <h3>${s.name}</h3>
        <p>${s.url}</p>
      </div>
      <button class="action-btn danger-btn" data-type="shortcut" data-index="${originalIndex}" style="font-size:11px; padding:4px 10px;">Remove</button>
    `;
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
        item.innerHTML = `
      <div class="item-text"><h3>${site}</h3></div>
      <button class="action-btn danger-btn" data-type="blacklist" data-index="${originalIndex}" style="font-size:11px; padding:4px 10px;">Remove</button>
    `;
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
            document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
            document.getElementById('home-view').classList.add('active');
            updateUIState(); // Re-sync
        });
    });

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

            saveSettings();
            updateUIState();
            
            // Only show indicator for home-screen master toggles
            if (id.startsWith('master-')) {
                showSavedIndicator();
            }
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
        'pause-duration': { title: 'Pause Duration', text: 'A mandatory waiting period before you can access a distracting site. This helps break impulsive scrolling habits.', icon: '🧘‍♂️' },
        'remind-every': { title: 'Reminder Frequency', text: 'How often the extension will show you a "productive check-in" reminding you of your time spent.', icon: '⏳' },
        'session-limit': { title: 'Site Activity Limit', text: 'Max time allowed for this site. You can choose to reset this timer when you leave the site, or set it as a rolling budget (e.g. 20 minutes per hour).', icon: '🔒' },
        'reward-time': { title: 'Unlock Reward', text: 'The number of minutes granted after successfully completing an unlock protocol.', icon: '🍏' },
        'passive-reward': { title: 'Passive Reward', text: 'Earn bonus reward time just by spending time on your allowlist "productive" sites. This time can be used to unlock your restricted sites later.', icon: '🧠' },
        'browser-screen-time': { title: 'Browser Screen Time', text: 'Total time you can use the browser per day across all sites.', icon: '🌐' },
        'session-allowance': { title: 'Launch Count', text: 'This budget limits how many times you can enter a blocked site within a rolling window (e.g. 3 launches per hour). A session ends as soon as you stop using the site for 2 minutes.', icon: '🚀' },
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
                helpModal.style.display = 'block';
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

        // 1. Show/Hide toggle
        if (showPassChk) {
            showPassChk.onchange = () => {
                const type = showPassChk.checked ? 'text' : 'password';
                pValInput.type = type;
                if (pConfirmInput) pConfirmInput.type = type;
                if (pOldInput) pOldInput.type = type;
            };
        }

        // 2. Real-time match feedback
        const checkMatch = () => {
            if (!pConfirmInput.value) {
                matchStatus.textContent = '';
                return;
            }
            if (pValInput.value === pConfirmInput.value) {
                matchStatus.textContent = '✓ Passwords match';
                matchStatus.style.color = '#34C759';
            } else {
                matchStatus.textContent = '✕ Passwords do not match';
                matchStatus.style.color = '#FF3B30';
            }
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

                if (!pValInput.value) {
                    showValidationWarning('<strong>Validation Error:</strong> Please enter a new password.');
                    return;
                }
                if (pValInput.value !== pConfirmInput.value) {
                    showValidationWarning('<strong>Validation Error:</strong> New passwords do not match.');
                    return;
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
            updateUIState();
            // showSavedIndicator removed to avoid redundancy
        });
    });
    document.getElementById('challenge-length-input')?.addEventListener('input', () => {
        updateTypingEffectiveness();
    });

    // --- TRIGGER TOGGLES ---
    ['trigger-session-enable', 'trigger-browser-enable', 'trigger-launch-enable'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            updateUIState();
            // showSavedIndicator removed to avoid redundancy
        });
    });

    // --- GENERAL TOGGLES ---
    document.getElementById('pill-enable-input')?.addEventListener('change', (e) => {
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
            el.addEventListener('change', updateUIState);
            el.addEventListener('input', updateUIState);
        }
    });

    // --- UNIT GRAMMAR LISTENERS ---
    const unitPairs = [
        ['breathing-input', 'breathing-unit'],
        ['reminder-input', 'reminder-unit'],
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
                noneModal.style.display = 'block';
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
                showValidationWarning('<strong>Cannot save:</strong><br>' + validation.errors.join('<br>'));
                return;
            }

            if (validation.warnings.length > 0) {
                // Show warnings but allow save
                showValidationWarning(validation.warnings.join('<br>'));
            } else {
                hideValidationWarning();
            }

            saveSettings();
            showSavedIndicator();
            // Immediate navigate back for responsive feel
            const backBtn = document.querySelector('.nav-back');
            if (backBtn) backBtn.click();
        });
    }

    // --- MANUAL SAVE (General Timers) ---
    const saveTimersBtn = document.getElementById('save-timers-btn');
    if (saveTimersBtn) {
        saveTimersBtn.addEventListener('click', () => {
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
            document.querySelector('.nav-back').click();
        });
    }

    // --- ADD/REMOVE ITEMS ---
    const addSiteBtn = document.getElementById('add-site-btn');
    if (addSiteBtn) {
        addSiteBtn.addEventListener('click', () => {
            let v = document.getElementById('new-site-input').value.trim().toLowerCase();
            if (!v) return;

            // Basic Sanitization: Strip protocol and path
            try {
                if (v.includes('://')) v = v.split('://')[1];
                v = v.split('/')[0];
                v = v.replace(/^www\./, '');
            } catch (e) { }

            if (v && !currentSettings.whitelist.includes(v)) {
                currentSettings.whitelist.push(v);
                saveSettings();
                renderWhitelist();
                document.getElementById('new-site-input').value = '';
            }
        });
    }

    const addShortcutBtn = document.getElementById('add-shortcut-btn');
    if (addShortcutBtn) {
        addShortcutBtn.addEventListener('click', () => {
            if ((currentSettings.shortcuts || []).length >= 6) {
                alert("You can't do that. The max is 6 shortcut apps");
                return;
            }
            const n = document.getElementById('new-shortcut-name').value.trim();
            const u = document.getElementById('new-shortcut-url').value.trim();
            if (n && u) {
                currentSettings.shortcuts.push({ name: n, url: u });
                saveSettings();
                renderShortcuts();
                document.getElementById('new-shortcut-name').value = '';
                document.getElementById('new-shortcut-url').value = '';
            }
        });
    }

    // Delete Delegation
    document.body.addEventListener('click', (e) => {
        if (e.target.dataset.type) {
            const idx = parseInt(e.target.dataset.index);
            if (e.target.dataset.type === 'whitelist') currentSettings.whitelist.splice(idx, 1);
            if (e.target.dataset.type === 'blacklist') currentSettings.blacklist.splice(idx, 1);
            if (e.target.dataset.type === 'shortcut') currentSettings.shortcuts.splice(idx, 1);
            saveSettings();
            renderAll();
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
        };
    }

    if (cancelBtn) {
        cancelBtn.onclick = () => {
            if (setupState) setupState.style.display = 'none';
            if (activeState) activeState.style.display = 'block';
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
        if (confirmBtn) confirmBtn.textContent = 'Confirm Password';
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

    // SAVE REMINDERS SETTINGS
    document.getElementById('save-reminders-btn')?.addEventListener('click', () => {
        currentSettings.reminderInterval = Math.floor(getConvertedVal('reminder-input', 'reminder-unit') / 60) || 15;
        currentSettings.reminderStyle = document.getElementById('reminder-style-input').value;
        currentSettings.reminderWhitelist = document.getElementById('reminder-whitelist-enable').checked;

        currentSettings.reminderTriggers = {
            launchLimit: {
                enabled: document.getElementById('reminder-trigger-launch-enable').checked,
                value: parseInt(document.getElementById('reminder-trigger-launch-val').value) || 5,
                windowSeconds: 3600
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
    ['pause-trigger-launch-enable', 'pause-trigger-browser-enable', 'reminder-trigger-launch-enable', 'reminder-trigger-browser-enable'].forEach(id => {
        document.getElementById(id)?.addEventListener('change', (e) => {
            if (window.triggerProtocolUIUpdate) window.triggerProtocolUIUpdate();
            // showSavedIndicator removed to avoid redundancy
        });
    });

    // CONSISTENT SAVE BUTTONS FOR NEW VIEWS
    ['save-whitelist-btn', 'save-shortcuts-btn', 'save-blocklist-btn'].forEach(id => {
        document.getElementById(id)?.addEventListener('click', () => {
            saveSettings();
            showSavedIndicator();
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

    // 4. Validation (Final Override for Strict Lock)
    const v = validateSettings();
    const hlSaveBtn = document.getElementById('save-difficulty-btn');
    const hlView = document.getElementById('hardlock-config-view');
    const hlScrollable = hlView?.querySelector('.scrollable-content');
    const isHLMasterOn = document.getElementById('master-hardlock-enable')?.checked;

    if (hlSaveBtn && isHLMasterOn) {
        if (v.errors.length > 0) {
            hlSaveBtn.disabled = true;
            hlSaveBtn.style.opacity = '0.35';
            hlSaveBtn.style.filter = 'grayscale(1)';
            hlSaveBtn.style.cursor = 'not-allowed';
            hlSaveBtn.style.pointerEvents = 'none';
            
            showValidationWarning(v.errors[0]);

            if (hlScrollable) {
                hlScrollable.style.opacity = '0.6';
                hlScrollable.style.filter = 'grayscale(0.5)';
            }
        } else {
            hlSaveBtn.disabled = false;
            hlSaveBtn.style.opacity = '1';
            hlSaveBtn.style.filter = 'none';
            hlSaveBtn.style.cursor = 'pointer';
            hlSaveBtn.style.pointerEvents = 'auto';

            if (hlScrollable) {
                hlScrollable.style.opacity = '1';
                hlScrollable.style.filter = 'none';
            }
            hideValidationWarning();
        }
    } else {
        // Master is OFF or no btn: Ensure no warning hangs around
        // Note: applyMasterState already handled the fading/disabling when OFF
        hideValidationWarning();
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
