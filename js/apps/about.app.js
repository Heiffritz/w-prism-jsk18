/**
 * about.app.js
 * ------------------------------------------------------------------
 * The "About Me" portfolio app.
 *
 * ARCHITECTURE RULE (same for every app in this OS): an app module
 * does NOT spawn itself. It only calls window.eventBus.emit(
 * "process:registerApp", {...}) to tell ProcessManager it EXISTS and
 * is launchable. Something else — a desktop icon double-click, a
 * Start menu click, or another app — triggers the actual spawn via
 * "process:spawn". This file's job ends at registration; everything
 * after that (factory execution, window creation, rendering) happens
 * through the same event-driven lifecycle every app uses.
 *
 * An app's factory(ctx) receives a small context object — pid,
 * args, emit(), on(), setWindowId() — and uses ONLY that to talk to
 * the rest of the OS. It never reaches into document.* directly
 * except inside the contentEl it's handed back via "window:created".
 * ------------------------------------------------------------------
 */

(function registerAboutApp() {
  const APP_ID = "about";

  // ProcessManager doesn't exist until Kernel.boot() runs (main.js
  // does this inside its own DOMContentLoaded handler), so this app
  // file — loaded as a plain <script> tag, synchronously, possibly
  // before that boot has happened — must wait for "kernel:ready"
  // before it's safe to emit "process:registerApp". Without this,
  // the registration event would be emitted into the bus with no
  // ProcessManager yet listening, and silently lost (EventBus does
  // not queue/replay past events for late subscribers).
  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "About Me",
      icon: "icon.about",
      singleInstance: true,
      factory: aboutAppFactory
    });
  });

  function aboutAppFactory(ctx) {
    // Listen once for the window WindowManager creates for THIS
    // process. Every app filters by ctx.pid because "window:created"
    // is a global event — many windows may be created in the OS's
    // lifetime, and this app only cares about its own.
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      renderAbout(payload.contentEl, ctx);
    });

    ctx.emit("window:create", {
      title: "About Me",
      icon: "icon.about",
      width: 460,
      height: 360
    });
  }

  /**
   * Renders the app's UI into the contentEl WindowManager handed back.
   * This is the ONLY DOM this app ever touches — contentEl and its
   * descendants. Nothing here reaches outside of it.
   */
  function renderAbout(contentEl, ctx) {
    contentEl.innerHTML = `
      <div class="app-about">
        <div class="app-about-header">
          <div class="app-about-avatar">★</div>
          <div>
            <div class="app-about-name">Your Name Here</div>
            <div class="app-about-role">Software Developer &amp; Designer</div>
          </div>
        </div>
        <div class="app-about-body">
          <p>
            Welcome to <strong>Windows Prism JSK</strong> — a portfolio
            built as a simulated operating system, running entirely in
            your browser. Every window, icon, and menu you see is part
            of a small custom OS engine: a kernel, an event bus, a
            process manager, and a window manager, all written in
            plain HTML, CSS, and JavaScript.
          </p>
          <p>
            Use the desktop icons or the Start menu to explore —
            Projects, Skills, and Contact are all real running
            "applications" inside this simulated OS, each with their
            own window you can move, minimize, and close.
          </p>
        </div>
        <div class="app-about-footer">
          <button type="button" class="app-about-btn" data-action="open-projects">
            View Projects
          </button>
          <button type="button" class="app-about-btn" data-action="open-contact">
            Contact Me
          </button>
        </div>
      </div>
    `;

    // Wire up the two shortcut buttons. They spawn OTHER apps purely
    // by emitting "process:spawn" with the target appId — this app
    // has no idea how projects.app.js or contact.app.js work
    // internally, and doesn't need to.
    contentEl.querySelector('[data-action="open-projects"]').addEventListener("click", () => {
      ctx.emit("process:spawn", { appId: "projects" });
    });
    contentEl.querySelector('[data-action="open-contact"]').addEventListener("click", () => {
      ctx.emit("process:spawn", { appId: "contact" });
    });
  }
})();
