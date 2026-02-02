# 🔒 LOCKED FEATURES REGISTRY

> **WARNING TO AI AGENTS AND DEVELOPERS:**
> The features listed in this document have been **perfected** after extensive debugging cycles.
> **DO NOT REFACTOR, OPTIMIZE, OR "CLEAN UP" THIS CODE without explicit user instruction.**
> Attempts to "modernize" this logic will likely re-introduce regression bugs.

---

## 1. Progress Reset Notification ("The Red Pill")

**Status**: ✅ STABLE (Verified Jan 29, 2026)
**File**: `content.js`
**Critical Functions**: `checkAndShowResetToast`, `showToast`, `dismissToast`

### 🚫 The "Cycle of Pain" (History)

This feature is highly sensitive to the browser's rendering lifecycle. It has broken repeatedly due to:

1.  **Shadow DOM Isolation**: Moving the CSS/Keyframes to an external file breaks the pulse animation.
    - **RULE**: Keep styles INLINE within `showToast`.
2.  **Race Conditions**: Async checks causes flicker or disappearance.
    - **RULE**: The check must happen at the `renderDecisionScreen` entry point.
3.  **Typing Screen Persistence**: It must disappear _instantly_ when typing starts.
    - **RULE**: `dismissToast()` must be called in `renderTypingLock`.
4.  **Trusted Types (YouTube)**: innerHTML assignments crash the script on strict sites.
    - **RULE**: Use `document.createElement` and `textContent` ONLY. No `innerHTML`.

### 🔒 Implementation Constraints

- **Z-Index**: Must be `2147483647` (Max Integer).
- **Guard Logic**: Do NOT add `if (isTypingChallengeActive)` guards to the _display_ logic (it causes the toast to vanish on the Decision Screen).
- **Backup**: A verified backup exists at `content.js.STABLE_BACKUP`.

### 🔒 Pessimistic Locking (NEW - CRITICAL)

- **The Logic**: We set the reset flag (`cure_needs_reset`) **IMMEDIATELY** when the challenge starts (`challengeStarted` in `background.js`).
- **The Release**: We only clear this flag if the user **EXPLICITLY** succeeds or gives up.
- **Why**: Browsers kill `cleanup()` / `unload` events aggressively. We cannot rely on saving state when the user leaves. We must assume they will leave uncleanly.
- **DO NOT REVERT TO "CLEANUP"-BASED LOGIC.**

---

## 2. Shadow DOM Injection

**Status**: ✅ STABLE
**File**: `content.js`

### 🔒 Implementation Constraints

- **Isolation**: All overlay UI (Pill, Lock Screen, Toast) exists within a closed Shadow Root (`#cure-root`).
- **Style Injection**: We inject `<style>` tags dynamically into this root.

---

## 3. Background Authoritative Lock (Anti-Cheat)

**Status**: ✅ STABLE (Verified Jan 31, 2026)
**File**: `background.js`, `content.js`
**Commit**: `5a9ad61`

### 🔒 Implementation Constraints

1.  **Authoritarian Source**: `background.js` is the ONLY source of truth for settings while a site is locked.
2.  **Immutability**: Once a lock is engaged, the rules for that specific hostname are snapshotted (`JSON.parse(JSON.stringify(settings))`) and cannot be changed until the challenge is cleared.
3.  **Filtered Broadcast**: `updateSettings` selectively sends frozen snapshots to locked tabs and global settings to active ones.
    - **RULE**: Always check the tab's hostname against the snapshot registry before broadcasting.
4.  **No Client-Side Storage**: `content.js` must NOT maintain its own rule overrides; it must trust the background's `getSettings` response.

---

## 4. Unified Modal System

**Status**: ✅ STABLE (Verified Feb 2, 2026)
**Files**: `popup.html`, `styles.css`, `popup.js`

### 🔒 Implementation Constraints

1.  **Centered Display**: Must use `display: flex` on the overlay in `popup.js` to ensure centering via CSS. `display: block` will break the centering.
2.  **Width Consistency**: Max-width is locked at `280px` for a "lesser" compact feel.
3.  **Backdrop**: Uses `backdrop-filter: blur(4px)` for a premium feel.
4.  **Shared Classes**: Uses `.cure-modal-card` and `.cure-modal-overlay`. Do NOT revert to inline styles or unique classes for `none-confirm` or `help-modal`.
