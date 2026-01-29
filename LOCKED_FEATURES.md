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

### 🔒 Implementation Constraints

- **Z-Index**: Must be `2147483647` (Max Integer).
- **Guard Logic**: Do NOT add `if (isTypingChallengeActive)` guards to the _display_ logic (it causes the toast to vanish on the Decision Screen).
- **Backup**: A verified backup exists at `content.js.STABLE_BACKUP`.

---

## 2. Shadow DOM Injection

**Status**: ✅ STABLE
**File**: `content.js`

### 🔒 Implementation Constraints

- **Isolation**: All overlay UI (Pill, Lock Screen, Toast) exists within a closed Shadow Root (`#cure-root`).
- **Style Injection**: We inject `<style>` tags dynamically into this root.
