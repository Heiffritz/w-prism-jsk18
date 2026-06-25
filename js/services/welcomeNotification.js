/**
 * welcomeNotification.js
 * ------------------------------------------------------------------
 * Shows the one-time "Welcome to ..." balloon notification (suggestion
 * #4), reusing NotificationService's generic balloon mechanism rather
 * than being its own bespoke popup.
 *
 * BEHAVIOR (per the agreed plan):
 *   - Shown AUTOMATICALLY the very first time the OS is ever loaded
 *     in this browser (tracked via a localStorage flag, separate
 *     from session.js's window/theme persistence — this is a
 *     one-time "has this person ever visited" flag, not session
 *     state that should be cleared/restored the same way).
 *   - Can be RE-TRIGGERED manually afterward from the Settings app's
 *     "Show Welcome Message" button (Settings emits
 *     "welcome:show" for this).
 *   - Clicking "About Me" / "My Projects" in the balloon spawns the
 *     corresponding real app, via the same process:spawn path a
 *     desktop icon or Start menu click would use.
 *
 * The custom welcome icon is referenced by an AssetManager key
 * ("icon.welcome"), resolved by NotificationService itself — this
 * file never touches a raw path, same rule as everywhere else.
 * ------------------------------------------------------------------ */

(function () {
  const SEEN_KEY = "prism.welcome.seen";
  const NOTIFICATION_ID = "welcome";

  function showWelcomeBalloon(bus) {
    bus.emit("notification:show", {
      id: NOTIFICATION_ID,
      icon: "icon.welcome",
      title: "Welcome to Windows Prism JSK",
      body: "A faithful XP-inspired interface, custom-built to showcase my work and attention to detail. Get started:",
      links: [
        { label: "About Me", action: "welcome:open-about" },
        { label: "My Projects", action: "welcome:open-projects" }
      ],
      durationMs: 0 // stays until manually dismissed, matching the reference image's balloon
    });
  }

  window.eventBus.on("kernel:ready", () => {
    const bus = window.eventBus;

    // Wire up the balloon's action links once, regardless of how
    // many times it's shown (first-visit or manually re-triggered).
    bus.on("notification:action", ({ action, id }) => {
      if (id !== NOTIFICATION_ID) return;
      if (action === "welcome:open-about") bus.emit("process:spawn", { appId: "about" });
      if (action === "welcome:open-projects") bus.emit("process:spawn", { appId: "projects" });
    });

    // Manual re-trigger, e.g. from Settings' "Show Welcome Message"
    // button — works regardless of whether this is the first visit.
    bus.on("welcome:show", () => showWelcomeBalloon(bus));

    // First-ever-visit auto-show. Wrapped in try/catch since
    // localStorage can throw in some browser privacy modes (e.g.
    // Safari private browsing) — if we can't read the "have they
    // seen this" flag, default to NOT auto-showing rather than
    // risking showing it on every single load for someone whose
    // browser can't persist the flag at all.
    try {
      const alreadySeen = window.localStorage.getItem(SEEN_KEY);
      if (!alreadySeen) {
        showWelcomeBalloon(bus);
        window.localStorage.setItem(SEEN_KEY, "1");
      }
    } catch (err) {
      console.warn("[welcomeNotification] localStorage unavailable, skipping first-visit auto-show:", err);
    }
  });
})();
