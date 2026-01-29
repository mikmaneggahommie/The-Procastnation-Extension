# 🛡️ Your Ultimate Safety Guide

This is how you manage any AI working on this project. This system is designed to stop the "Endless Loop of Bugs."

### 📅 The Handover (Start of every New Chat)

**Copy-Paste this:**

> _"Read **AI_HANDOVER.md** and **MILESTONES.md**. Start a new branch for my request and do not modify 'main' until I say 'Perfect'."_

---

### 🚦 When to say what:

| If this happens...                   | Say this to the AI:                            | What the AI will do:                                  |
| :----------------------------------- | :--------------------------------------------- | :---------------------------------------------------- |
| **You love the result**              | "Perfect. Do the github thing."                | Updates Milestones, Merges code, Pushes to GitHub.    |
| **It works but needs a minor tweak** | "Good, but change X."                          | AI stays in the current branch and fixes X.           |
| **It's still broken after 3 tries**  | "Take me back."                                | AI runs `git reset` to the last healthy state.        |
| **An old feature (Toast) broke**     | "Repair the [Feature] from the Milestone log." | AI transplants old healthy code into the new version. |

---

### ❓ Is this enough to stop the "Fix/Break" cycle?

**Yes.** This is the exact workflow professional developers use. The reason it breaks now is that the AI "forgets" how it built the project 100 turns ago.

By using **Branches** and **Milestones**:

1.  **Safety Room**: A new branch is like a "testing room." If the AI breaks things in there, your "Main" code is still safe in the other room.
2.  **Milestones**: If the AI forgets how the Toast works, the `MILESTONES.md` file acts as their memory. It points them to the exact code that worked on Jan 29th.

**You are now the Manager.** Use these commands to keep the AI on track! 🚀🛡️
