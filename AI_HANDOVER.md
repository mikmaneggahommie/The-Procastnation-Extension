# 🛑 READ THIS FIRST (For Future AI Agents)

**Project Status:** GOLDEN STATE (Stable)
**Current Commit:** `05274e2` ("Fixed Timer Reset and Re-lock Bypass bugs")
**GitHub Repo:** https://github.com/mikmaneggahommie/The-Procastnation-Extension

## ⚠️ THE GOLDEN RULE

This user has experienced significant frustration with "fixing one thing and breaking another."
**DO NOT** make experimental changes without first securing the current state.

## � STRICT LOCK POLICY (Crucial)

- **Persistent Challenge**: If a user is in the "Typing Challenge", they **MUST** finish it to unlock the site.
- **Even on Whitelist**: If they whitelist the site mid-challenge, the overlay must **STAY** until they finish typing. Do NOT auto-abort the challenge.
- **Input Focus**: The input box must explicitly regain focus after popup interactions (Fixed in `a7d4fd0`).

## �🛠 THE PROTOCOL (Mandatory)

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

## 🗣️ User Intent Mapping (The "Magic Phrases")

The user prefers natural language over technical commands. Interpret these phrases strictly:

- **"Lock it in" / "Save this"** → `git add . && git commit -m "..." && git push`
- **"Undo it" / "Go back"** → `git reset --hard` (or delete branch)
- **"Start a new task"** → `git checkout -b [task-name]`
- **"Reverting"**: If you are in a feature branch and things go wrong, do NOT keep patching it. Offer to `git checkout main` and delete the failed branch.

**Always confirm** which branch you are on before executing destructive revert commands.

## 🚀 Working Features Log (The Time Machine)

Any AI working on this project MUST look at this log before reverting. When a user says a feature is "perfect", add it here with the commit hash.

- [x] **Strict Lock Toggle Fix**: (Commit: `33ef1de`) - Fixed the bypass when toggling Strict Lock ON/OFF while over limits.
- [x] **Timer Preservation**: (Commit: `05274e2`) - Timer no longer resets to 0 when disabling Strict Lock.
- [x] **Overlay Z-Index Fix**: (Commit: `33ef1de`) - Lock screen now has max z-index to stay on top of all sites.

## 🚀 How to Pick Up Where We Left Off

1.  Read `task.md` (if available) to see the last checklist.
2.  Check the **Working Features Log** above to see what is currently considered "Perfect".
3.  Ask the user for the next priority.
