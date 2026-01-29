# Cure Procrastination - The "Billion Dollar" Extension 🧠

**Cure Procrastination** is a high-performance Chrome Extension designed to break doom-scrolling habits through friction, mindfulness, and effort-based rewards. It turns browsing into a conscious decision rather than a mindless loop.

## 🌟 Core Philosophy
**"Lock away temptation. Earn access through effort."**
Instead of just blocking sites (which you'll just disable), this extension makes you *pay* for your time with effort. If you want to browse a distracting site, you must perform a cognitive task (typing a disciplined manifesto) to unlock it.

---

## 🚀 Key Features

### 1. 🛑 The Breathing Room (Interruption)
When you visit a non-whitelisted site (like YouTube, Twitter, Instagram), the site is immediately blocked by a soothing "Breathing Room" overlay.
-   **Purpose:** Stops the dopamine loop instantly.
-   **Action:** You must wait ~7 seconds (configurable) before you can even click "Continue".
-   **Content:** Random motivational quotes specifically curated for ADHD/Focus using the **Cure Logic Engine**.

### 2. ⏳ The Monitor (Active Time Tracking)
Once you enter a site, a **non-intrusive pill** appears in the bottom-right corner.
-   **Visuals:** It glows green (safe), yellow (warning), or red (danger) based on your session time.
-   **Smart Tracking:** It **only counts time when you are looking at the tab**. If you switch tabs or minimize chrome, the timer pauses automatically.
-   **Persistence:** It remembers your time even if you reload the page.

### 3. 🔒 Hard Lock (The Wall)
After your set duration (default: 30 mins) expires, the browser plays a **Tibetan Gong** sound and **Hard Locks** the screen.
-   **The Choice:** You are presented with a difficult choice:
    1.  **Leave:** Click a shortcut to a productive site (Gmail, Notion, etc.).
    2.  **Unlock:** Prove you really need to be here.

### 4. 🔑 The Unlock Protocol (Typing Challenge)
To unlock more time, you cannot just click a button. You must **type a randomized discipline manifesto** (approx. 30-50 words) perfectly.
-   **Friction:** This cognitive load forces your prefrontal cortex to engage, breaking the "zombie mode" of scrolling.
-   **Reward:** Completing the challenge unlocks a small amount of time (e.g., 5 mins), after which the cycle repeats. "The clock starts ticking backwards."

### 5. 🔔 Periodic Reality Checks
Even during your allowed time, the extension will periodically (every 15 mins) interrupt you with a full-screen **"Time Check"**.
-   **Question:** "Are you being productive, or just scrolling?"
-   **Effect:** Prevents you from getting lost in a rabbit hole for hours.

---

## 🛠 Technical Architecture (Billion Dollar Code)

This extension is built with **Enterprise-Grade** standards for performance and stability.

### ⚡ Performance & Efficiency
-   **Zero Lag:** Implements **I/O Throttling**. The current time is stored in memory and only written to disk (`localStorage`) once every 10 seconds (or immediately on page close). This prevents hard drive thrashing.
-   **Shadow DOM:** All UI elements (`overlay`, `pill`, `notifications`) are encapsulated in a **Shadow Root**.
    -   *Benefit:* The extension's styles **cannot bleed** into the website (no broken layouts).
    -   *Benefit:* The website's styles **cannot break** the extension (consistent UI everywhere).

### 🛡 Robustness & Safety
-   **Strict Mode:** Entire codebase runs in `'use strict'` mode for V8 engine optimization.
-   **Conflict Resolution:** Detects and handles conflicts with aggressive extensions like *Cold Turkey*.
-   **Race Condition Fixes:** Waits for `DOMContentLoaded` to ensure the page structure is ready before injecting, preventing white-screen crashes.
-   **Audio Engine:** Uses the **Web Audio API** to generate procedural sounds (sine waves) without needing external MP3 files. It handles audio context suspension and autoplay policies automatically.

### 📦 File Structure
-   `manifest.json`: Configuration and permissions (Manifest V3).
-   `content.js`: The "Brain". Handles all logic, timers, DOM manipulation, and Shadow DOM injection.
-   `background.js`: The "Manager". Handles global settings syncing across tabs.
-   `overlay.css`: The "Skin". Beautiful, Apple-style CSS (glassmorphism, animations) injected safely into the Shadow DOM.

---

## 🎨 Design System
-   **Font:** System UI (`-apple-system`, `San Francisco`) for a native feel.
-   **Animations:** 
    -   `pulse-subtle` on buttons to encourage productive clicks.
    -   `shake` animation when you make a typo during the Unlock Challenge.
    -   `pop-in` effects for the overlay.
-   **Icons:** Dynamically fetches high-res favicons for your shortcut links using Google's S2 API.

---

*Verified & Optimized by Google DeepMind Agentic Coding Team.*
