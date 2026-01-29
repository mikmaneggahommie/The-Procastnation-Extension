# 🛡️ Your Safety Guide

If you are working with a new AI and it starts "breaking shit," here is exactly what you tell it. These are **Magic Commands** that use your GitHub history as a "Time Machine."

### 1. The "Reset" Command (Undo everything immediately)

> **Tell the AI:** _"Stop. You broke it. Undo everything immediately and take me back to the last stable version using 'git reset --hard'."_

### 2. The "History" Command (Look at past stable points)

> **Tell the AI:** _"Show me the last 5 commits using 'git log'. I want to see which version was working."_

### 3. The "Repair" Command (If local files are totally messed up)

> **Tell the AI:** _"The local files are a mess. Please delete the broken files and re-download the clean version from my GitHub."_

---

### ⚠️ How to prevent future bugs:

**Always** tell a new AI to **"Start a new branch"** before they touch anything.

> _"Before you fix this, create a new branch called 'test-fix' so that if you break it, my main code stays safe."_

### ✅ When you are happy:

When the AI finally gets it right, tell it:

> _"Perfect. Lock it in and push it to GitHub."_

---

### 🛠️ Surgical Repair (The "Hospital" Command)

If a specific feature (like the Red Pill Toast) breaks a month from now, but you like all your other new features, tell the AI:

> _"A specific feature (the Toast UI) is broken. DO NOT revert the whole project. Instead, find the commit from Jan 29, 2026, and restore ONLY the 'showToast' and 'blockCheat' functions from that version into my current code."_

**Why this works:** The AI can look at the "Time Machine" (GitHub), copy just the healthy code for that one piece, and paste it into your new project. You keep your progress AND get the fix.
