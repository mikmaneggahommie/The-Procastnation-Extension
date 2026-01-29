# 🛑 EMERGENCY PROTOCOL (For Future AI Agents)

**Project Status:** GOLDEN STATE (Stable)
**Current Stable State:** See [MILESTONES.md](file:///Users/mac2015/Desktop/The%20Procastnation%20Extension/MILESTONES.md)
**GitHub:** https://github.com/mikmaneggahommie/The-Procastnation-Extension

## 🚀 THE HANDOVER RULE

1.  **Read [MILESTONES.md](file:///Users/mac2015/Desktop/The%20Procastnation%20Extension/MILESTONES.md)** first. It tracks which commits are "Perfect."
2.  **Maintain the Log**: Whenever you finish a task and the user is happy, update `MILESTONES.md` with the date, feature, and new commit hash.

## 🆘 THE EMERGENCY RULE (Strict Enforcement)

If you make a change and it fails OR if the user says "it's broken":

1.  **Stop everything.** Do not try to "patch" the bug more than ONCE.
2.  **IMMEDIATELY** run `git reset --hard HEAD` to restore the last stable state.

## 🚨 ANTI-CHEAT & UI CONSTRAINTS

- **Anti-Cheat**: Blocks `paste`, `drop`, `contextmenu`. Logic in `content.js`.
- **Toast UI**: Pill design, `8px 16px` padding, fixed at `35px` bottom. DO NOT CHANGE without explicit approval.
- **Strict Lock**: If a user is in a challenge, they MUST stay. Re-locking must be instant.

## 🗣️ MAGIC PHRASES

- **"Take me back" / "Undo"** → `git reset --hard HEAD`
- **"Check the Milestones"** → Look at `MILESTONES.md`.
- **"Lock it in"** → `git add . && git commit -m "..." && git push origin main`
