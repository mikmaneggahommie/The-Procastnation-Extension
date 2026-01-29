# 🎓 Senior AI-Developer Workflow (Actionable Guide)

If you want to stop the frustration, you need to use these **Actionable Prompts** to control the AI from the very first second.

---

### 1. The Modular Rule (Stop the 3,000-line Mess)

**When to use**: Before the AI starts writing a big game or app.
**The Prompt**:

> _"I want to build a [Project Name]. **DO NOT** write everything in one file. Split the code into small, logical modules (e.g., UI, Game Logic, Physics). Create a folder structure first and show it to me."_

- **The Result**: Instead of one broken `app.js`, you get 5 tiny files that are easy for the AI to fix without breaking each other.

### 2. The Architecture-First Rule (The Blueprint)

**When to use**: At the very start of any project.
**The Prompt**:

> _"Before you write any code, create a **PLAN.md**. List every feature we need and explain how the different files will talk to each other. I want to approve the logic before you write the first line."_

- **The Result**: You fix "logical bugs" (like how the car moves) in words before they become expensive "code bugs."

### 3. The Automated Verification (The Self-Check)

**When to use**: When a feature is complex (like a physics engine or a login system).
**The Prompt**:

> _"I want this feature to be bulletproof. Write a small **test script** that I can run to verify that [Feature X] works as intended. The script should output 'PASS' or 'FAIL'."_

- **The Result**: You don't have to manually play the game for 10 minutes to see if it's broken. You just run the script.

### 4. The Strict Boundary (Protective Glass)

**When to use**: When you have a piece of code (like the Toast UI) that is "Perfect."
**The Prompt**:

> _"I am moving the Toast UI code into a folder called `/locked`. You are allowed to read these files to understand the project, but you are **FORBIDDEN** from editing anything in that folder. If you need to make changes, ask me first."_

- **The Result**: The AI will never "accidentally" refactor or delete your favorite features while trying to fix something else.

---

### 👑 The "God-Mode" Opening (The First Thing You Say)

Copy and paste this exact prompt to start any new project perfectly:

> _"I want to build **[Project Name]**. Before we write any code: 1. Initialize Git and set up a 'Golden State' Safety Net (AI_HANDOVER.md with 3-fix rule, and MILESTONES.md). 2. Create a **PLAN.md** with a **Modular File Structure** (tiny files, not one big one). 3. Once I approve the plan, start a new branch for the first task and do not touch 'main' until I say 'Perfect'."_

---

**Summary**: A senior dev spends 50% of their time **organizing** and only 50% **coding**. Use these prompts to make the AI organize the work for you! 🚀🛡️🦾
