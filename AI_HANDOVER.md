# 🛑 READ THIS FIRST (For Future AI Agents)

**Project Status:** GOLDEN STATE (Stable)
**Current Commit:** `54e123e` ("Golden State: Fixed red pill toast, instant locking, and iframe visibility")
**GitHub Repo:** https://github.com/mikmaneggahommie/The-Procastnation-Extension

## ⚠️ THE GOLDEN RULE

This user has experienced significant frustration with "fixing one thing and breaking another."
**DO NOT** make experimental changes without first securing the current state.

## 🛠 THE PROTOCOL (Mandatory)

This project uses a strict Git Safety Net. You must follow this workflow:

1.  **Before Starting Work**: Run `git status` to ensure the clean state.
2.  **After "It works!"**: When the user confirms a feature is working, run:
    ```bash
    git add .
    git commit -m "Feature X Working"
    git push origin main
    ```
3.  **If You Break It**:
    - **Do not** try to patch the bug blindly for 10 turns.
    - **IMMEDIATELY** offer to revert:
      ```bash
      git reset --hard HEAD
      ```
    - This restores the last "Golden State" instantly.

## 🧩 Key Architectural Notes

- **Red Pill Toast**: Must have `z-index: 2147483647` and `!important` visibility. Do not "clean up" these styles.
- **Iframe Logic**: The extension runs on both main frames and iframes. `isIframe` checks are critical but were recently tuned to allow toasts. Be careful re-introducing blockers.
- **Instant Locking**: The "Test Zone" buttons in popup only target the _active tab_. Do not change this to global broadcasting without understanding the "Iframe Storm" bug.

## 🚀 How to Pick Up Where We Left Off

1.  Read `task.md` (if available) to see the last checklist.
2.  Ask the user: _"I see the AI_HANDOVER file. Shall I create a new branch for our next task to keep the main code safe?"_
