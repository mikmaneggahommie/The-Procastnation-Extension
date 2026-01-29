# 🎓 Senior AI-Developer Workflow

If you want to stop the frustration and code like a Senior Engineer, you need to change how you "prepare the ground" before you ask the AI for a single line of code.

Here are the 4 Golden Rules that Senior Devs use to keep AI from breaking things.

---

### 1. The "Modular" Rule (Smaller is Better)

**The Problem**: Your `content.js` is currently 3,000 lines long. This is the #1 reason the AI gets confused and breaks things.
**The Senior Fix**: Split your code into small "modules."

- Instead of one big `content.js`, have `toast-manager.js`, `anti-cheat.js`, and `timer-logic.js`.
- **Reason**: AI is 10X more accurate on 100 lines of code than on 3,000 lines.

### 2. The "Architecture-First" Rule

**The Problem**: Asking for features one-by-one feels like building a house without a blueprint.
**The Senior Fix**: Before you code, tell the AI:

> _"I want to build [Project]. Do not write code yet. Write a **PROPOSAL.md** first. Explain how the data will flow and list every file we will need."_

- **Reason**: You catch logic errors in the "blueprint" before you waste time on "broken bricks."

### 3. The "Automated Verification" Rule

**The Problem**: You have to manually refresh and test every small change.
**The Senior Fix**: Ask the AI to write a "Test Suite" or a "Checker Script" (like your `check_braces.py`).

- **The Prompt**: _"Before we start, write a script that checks if my UI is loaded correctly. We will run this script after every commit."_
- **Reason**: The AI can verify its own work automatically.

### 4. The "Strict Boundary" Rule

**The Problem**: The AI "cleans up" or "refactors" code you didn't want it to touch.
**The Senior Fix**: Create a folder called `core/` and keep your "Perfect" code there.

- Tell the AI: _"Files in the `core/` folder are READ-ONLY. You may look at them, but you are forbidden from editing them."_
- **Reason**: It keeps your "Golden State" code behind a bulletproof glass window.

---

### 💡 PRO-TIP: How to structure your next project:

When you start a new folder, create this structure **first**:

```text
/my-project
  /docs          <-- Architecture, Design, and Milestones
  /src           <-- Your actual code (split into tiny files)
  /tests         <-- Scripts that check if things are broken
  AI_HANDOVER.md <-- The rules for the AI
```

**If you follow this structure, you will eliminate 90% of your frustration.** 🚀🎓🦾
