# 🛑 READ THIS FIRST (For Future AI Agents)

**Project Status:** GOLDEN STATE (Stable)
**Current Branch:** `main`
**GitHub Repo:** https://github.com/mikmaneggahommie/The-Procastnation-Extension

## ⚠️ THE GOLDEN RULE

This user has experienced significant frustration with "fixing one thing and breaking another."
**DO NOT** make experimental changes without first securing the current state. Work in **Feature Branches** (`git checkout -b task-name`).

## 🚨 ANTI-CHEAT SYSTEM (Mandatory)

The "Typing Challenge" is protected by a multi-layer anti-cheat system in `content.js`:

- **Blocks**: `onpaste`, `ondrop`, and `oncontextmenu` are all explicitly blocked on the challenge input.
- **Attributes**: The input has `spellcheck="false"`, `autocomplete="off"`, and `autocorrect="off"`.
- **Constraint**: The user **MUST** finish the challenge to unlock. Even if they whitelist the site mid-challenge, the overlay persists until the typing is done.

## 💊 THE RED PILL (Toast UI)

The notification system uses a custom "Toast" (The Red Pill) logic in `content.js`:

- **Design**: Balanced Pill capsule with `8px 16px` padding and `13px` semi-bold font.
- **Position**: Fixed at `35px` from the bottom to avoid UI collisions.
- **Z-Index**: `2147483647` (Max) inside a Shadow DOM to stay on top of YouTube etc.
- **SPAs (YouTube)**: Messaging is handled via `sessionStorage` and `debugTrigger` to survive navigation and reload lag.

## 🗣️ User Intent Mapping (The "Magic Phrases")

- **"Lock it in" / "Save this"** → `git add . && git commit -m "..." && git push origin main`
- **"Undo it" / "Go back"** → `git reset --hard` or `git checkout main`
- **"Perfect"** → Merge the current branch into `main`.

## 🚀 Working Features Log (The Time Machine)

- [x] **Anti-Cheat System**: (Jan 29, 2026) Blocks all forms of pasting/dragging.
- [x] **Refined Toast UI**: Balanced Pill design with professional capitalization.
- [x] **Timer Preservation**: Timer no longer resets to 0 when disabling Strict Lock.
- [x] **Overlay Z-Index Fix**: Lock screen stays on top of all sites.

## 🚀 How to Pick Up Where We Left Off

1.  Read `LOCKED_FEATURES.md` for the core logic rules.
2.  Check `content.js` for the `showToast` and `blockCheat` implementations.
3.  Ask the user for the next priority.
