# 🛑 PROJECT PROTOCOL (For Future AI Agents)

**Project Status:** GOLDEN STATE (Stable)
**Safe Points:** See [MILESTONES.md](file:///Users/mac2015/Desktop/The%20Procastnation%20Extension/MILESTONES.md)

## 🚀 THE HANDOVER RULE (MANDATORY)

1.  **Read the Docs**: Read `MILESTONES.md`, `LOCKED_FEATURES.md`, and `AI_HANDOVER.md` immediately upon starting.
2.  **Branch First**: Every new task/fix MUST start in a new feature branch (`git checkout -b task-name`). Never work directly on `main`.

### 3. Simplified "Per Visit" Logic (Page Load Based)

Based on technical refinement, we've removed the redundant "Session Offset" (Stay away for X mins) setting.

- **Pure Reset**: Closing and reopening a tab now triggers a fresh visit/reminder clock instantly.
- **Stability**: A 2-minute internal grace period prevents accidental resets during simple page refreshes.
- **Clean UI**: No more confusing "Stay away" settings in the configuration.

## 🆘 THE BUG RULE (3-Strike System)

If you make a change and it fails OR if the user says "it's broken":

1.  **Iterate**: You have **3 attempts** to fix the bug.
2.  **STOP and Revert**: If it is still broken after 3 tries, you MUST run `git reset --hard HEAD` and ask for clarification. Do not keep digging a hole.

## 💾 TRIGGER PHRASES (Automation)

The user will use these simple phrases. You must execute the full protocol for them:

- **"Do the github thing"** or **"Lock it in"** or **"Perfect"**:
  1. Update `MILESTONES.md` with current feature + hash.
  2. Commit all changes.
  3. Merge feature branch into `main`.
  4. Push to origin.

- **"Take me back"** or **"Undo"**:
  1. Run `git reset --hard HEAD`.

- **"Repair [Feature Name]"**:
  1. Look at `MILESTONES.md` for the stable hash.
  2. Restore ONLY that section of code using `git show`.

## 🚨 ANTI-CHEAT & UI CONSTRAINTS

- **Anti-Cheat**: Blocks `paste`, `drop`, `contextmenu` on challenge inputs.
- **Toast UI**: Pill design, `8px 16px` padding, fixed at `35px` bottom. `z-index: 2147483647`.
- **Strict Lock**: If a user is in a challenge, they MUST stay. Re-locking must be instant.
