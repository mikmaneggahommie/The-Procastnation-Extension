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

### 📖 GitHub Jargon Decoded

| Term                  | What it means to You                                                                                                                      |
| :-------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **`main`**            | Your "Real" code. It should always be 100% working.                                                                                       |
| **`Branch`**          | A temporary "Test Room." The AI makes a copy of your code here to experiment. If they break it, your `main` code is still safe.           |
| **`refine-toast-ui`** | An example of a branch name. The AI chooses these automatically based on your request (e.g., `fix-reminders`).                            |
| **`Tag`**             | A "Golden Bookmark." I created one called `v-stable-toast-fix`. This is a permanent marker that stays even if you delete everything else. |
| **`Commit`**          | A "Save Point." Each time the AI saves, it adds a new commit to the history.                                                              |

---

### ❓ Why this works:

1.  **Safety Room**: The AI works in a "Branch" (a copy), so your main code stays safe until you say "Perfect."
2.  **Permanent Memory**: `MILESTONES.md` tells the AI exactly which version of the code was perfect, so they can't "forget" it.
3.  **Surgical Repair**: You can fix one specific bug without losing all your other progress.

**You are now the Manager. Everything is backed up and safe on GitHub!** 🚀🛡️
