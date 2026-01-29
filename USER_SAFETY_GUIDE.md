# 🛡️ Your Ultimate Safety Guide

This is how you manage any AI working on this project. Use these **Magic Phrases** to keep your code safe and stop the "Fix/Break" cycle.

---

### 🏁 1. Starting a New Conversation

**Copy-Paste this as your first message to a new AI:**

> _"Read **AI_HANDOVER.md**, **LOCKED_FEATURES.md**, and **MILESTONES.md**. Follow the Git workflow and milestone logging rules there. Start a new branch for my request and do not modify 'main' until I say 'Perfect it working and stuff do the GitHub thing...'"_

---

### ✅ 2. When they do a Good Job

**When you are happy with the result, say:**

> _"Perfect. It is working, do the GitHub thing. Update **MILESTONES.md**, lock it in, and push it to GitHub. Create a good, relevant commit message that is easily searchable later if you break this feature we just fixed."_

---

### 🛠️ 3. If they break an "Old" feature

**If something that used to work suddenly stops working, say:**

> _"The **[Feature Name]** isn’t working dude. Look at **MILESTONES.md**, find the commit about it, and restore ONLY that part of the code to fix this bug. It used to work perfectly back then."_

---

### 🆘 4. If they "fuck up" everything

**If the AI gets stuck or breaks too many things, say:**

> _"Stop. Take me back. Undo everything immediately and take me back to my last healthy milestone."_

---

### 📖 A Simple "Workday" Story (How it works)

1.  **You**: "Read the docs. Start a new branch. Now, fix the size of the number in the reminder screen."
2.  **AI**: Detects your request. Creates a temporary branch called `fix-reminder-numbers`. Makes the fix.
3.  **You**: You check it. It looks great!
4.  **You**: "Perfect. Do the github thing."
5.  **AI**: It records the "Safe Point" in **MILESTONES.md**, moves the fix into your **main** code, and pushes it to GitHub.
6.  **Next Task**: You ask for the next thing. The AI starts over at Step 1 with a **new** branch.

---

### 📖 GitHub Jargon Decoded

| Term         | What it means to You                                                               |
| :----------- | :--------------------------------------------------------------------------------- |
| **`main`**   | Your "Real" code. It should always be 100% working.                                |
| **`Branch`** | A temporary "Test Room." The AI handles the naming for you (e.g. `fix-reminders`). |
| **`Tag`**    | A "Golden Bookmark." Permanent marker of a stable version.                         |
| **`Commit`** | A "Save Point" in your history.                                                    |

**You are now the Manager. Everything is backed up and safe!** 🚀🛡️
