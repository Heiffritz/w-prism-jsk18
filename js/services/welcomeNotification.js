/**
 * welcomeNotification.js
 * ------------------------------------------------------------------
 * Shows the "Welcome to ..." balloon notification on every page
 * load (suggestion #20), reusing NotificationService's generic
 * balloon mechanism.
 *
 * Also re-triggerable manually from Settings' "Show Welcome Message"
 * button. Clicking "About Me" / "My Projects" spawns the
 * corresponding app via process:spawn.
 * ------------------------------------------------------------------ */

(function () {
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
      durationMs: 0
    });
  }

  window.eventBus.on("kernel:ready", () => {
    const bus = window.eventBus;

    bus.on("notification:action", ({ action, id }) => {
      if (id !== NOTIFICATION_ID) return;
      if (action === "welcome:open-about") bus.emit("process:spawn", { appId: "about" });
      if (action === "welcome:open-projects") bus.emit("process:spawn", { appId: "projects" });
    });

    bus.on("welcome:show", () => showWelcomeBalloon(bus));

    showWelcomeBalloon(bus);
  });
})();
