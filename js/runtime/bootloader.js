/**
 * bootloader.js
 * ------------------------------------------------------------------
 * A brief full-screen boot animation shown while the Kernel boots,
 * styled after the XP/Vista startup sequence (logo + progress
 * indicator on a dark screen), so the underlying module construction
 * and async asset/VFS loading happens behind a deliberate "the OS is
 * starting up" moment instead of the desktop just abruptly appearing.
 *
 * ARCHITECTURE: Bootloader owns its OWN full-screen overlay element
 * and is the only thing allowed to create/remove it — same DOM-
 * ownership discipline as every other UI module in this OS (compare
 * to WindowManager owning window chrome, DesktopEngine owning the
 * desktop surface). It does not touch window/desktop/taskbar DOM.
 *
 * LIFECYCLE:
 *   1. Bootloader is constructed and shows its overlay IMMEDIATELY
 *      (synchronously, before Kernel.boot() even runs) — main.js
 *      creates it first, before `new Kernel()`.
 *   2. It listens for "kernel:ready" to know the module graph is
 *      fully constructed.
 *   3. It ALSO waits for a minimum display time (so the boot screen
 *      never flashes by too fast to read, even on a fast machine —
 *      real OS boot screens have a similar deliberate minimum) and
 *      for AssetManager/VFS's "asset:ready"/"vfs:ready" if they
 *      haven't already fired, so the desktop doesn't appear before
 *      icons have real data to render from.
 *   4. Once all three conditions are met, it fades out and removes
 *      its own overlay.
 * ------------------------------------------------------------------ */

class Bootloader {
  constructor(eventBus, options = {}) {
    this.bus = eventBus;
    this.minDisplayMs = options.minDisplayMs ?? 1100;

    this._kernelReady = false;
    this._assetsReady = false;
    this._vfsReady = false;
    this._minTimeElapsed = false;
    this._dismissed = false;

    this._buildOverlay();
    this._bindEvents();

    setTimeout(() => {
      this._minTimeElapsed = true;
      this._maybeDismiss();
    }, this.minDisplayMs);
  }

  _buildOverlay() {
    const overlay = document.createElement("div");
    overlay.id = "prism-bootloader";
    overlay.className = "prism-bootloader";
    overlay.innerHTML = `
      <div class="prism-bootloader-center">
        <div class="prism-bootloader-logo-row">
          <div class="prism-bootloader-flag">
            <svg class="prism-bootloader-flag-svg" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <g transform="rotate(-18 11 11)">
                <rect x="2" y="2" width="8" height="8" fill="#f25022" />
                <rect x="12" y="2" width="8" height="8" fill="#7fba00" />
                <rect x="2" y="12" width="8" height="8" fill="#00a4ef" />
                <rect x="12" y="12" width="8" height="8" fill="#ffb900" />
              </g>
            </svg>
          </div>
          <div class="prism-bootloader-wordmark">
            <div class="prism-bootloader-brand">Microsoft<sup>&reg;</sup></div>
            <div class="prism-bootloader-product">Windows<span class="prism-bootloader-xp-text">xp</span></div>
            <div class="prism-bootloader-edition">Professional</div>
          </div>
        </div>
        <div class="prism-bootloader-bar">
          <div class="prism-bootloader-bar-segment"></div>
          <div class="prism-bootloader-bar-segment"></div>
          <div class="prism-bootloader-bar-segment"></div>
        </div>
      </div>
      <div class="prism-bootloader-corner-bl">
        <div>Copyright &copy; 1985-2001</div>
        <div>Microsoft Corporation</div>
      </div>
      <div class="prism-bootloader-corner-br">Microsoft<sup>&reg;</sup></div>
      <div class="prism-bootloader-status"></div>
    `;
    document.body.appendChild(overlay);
    this.overlayEl = overlay;
    this.statusEl = overlay.querySelector(".prism-bootloader-status");

    // Suggestion #11: customizable logo. If a real image is
    // registered/dropped in at the "icon.bootlogo" key, swap it in
    // place of the built-in CSS/SVG flag — resolved through the
    // standard asset:get/asset:resolved pattern, never a raw path.
    // The built-in flag is the fallback shown until/unless that
    // happens, so the boot screen never looks broken either way.
    const flagContainer = overlay.querySelector(".prism-bootloader-flag");
    const requestId = `bootloader-logo-${Math.random().toString(36).slice(2)}`;
    const handler = (payload) => {
      if (payload.requestId !== requestId) return;
      this.bus.off("asset:resolved", handler);
      if (payload.found) {
        flagContainer.innerHTML = `<img src="${payload.path}" class="prism-bootloader-flag-img" alt="" />`;
      }
    };
    this.bus.on("asset:resolved", handler);
    this.bus.emit("asset:get", { key: "icon.bootlogo", requestId });
  }

  _bindEvents() {
    this.bus.on("kernel:ready", () => {
      this._kernelReady = true;
      this._maybeDismiss();
    });
    this.bus.on("asset:ready", () => {
      this._assetsReady = true;
      this.setStatus("Loading assets...");
      this._maybeDismiss();
    });
    this.bus.on("asset:loadFailed", () => {
      // Don't let a failed (e.g. 404) asset registry load hang the
      // boot screen forever — treat "failed" the same as "ready" for
      // the purpose of dismissing the bootloader, since AssetManager
      // itself already degrades gracefully to placeholders.
      this._assetsReady = true;
      this._maybeDismiss();
    });
    this.bus.on("vfs:ready", () => {
      this._vfsReady = true;
      this.setStatus("Mounting file system...");
      this._maybeDismiss();
    });
    this.bus.on("vfs:loadFailed", () => {
      this._vfsReady = true;
      this._maybeDismiss();
    });
    this.bus.on("kernel:bootStep", ({ name }) => {
      this.setStatus(`Initializing ${name}...`);
    });
  }

  setStatus(text) {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  _maybeDismiss() {
    if (this._dismissed) return;
    if (this._kernelReady && this._assetsReady && this._vfsReady && this._minTimeElapsed) {
      this.dismiss();
    }
  }

  /**
   * Fade out and remove the boot overlay. Safe to call more than
   * once — only the first call has any effect.
   */
  dismiss() {
    if (this._dismissed) return;
    this._dismissed = true;

    this.setStatus("Welcome");
    this.overlayEl.classList.add("prism-bootloader-fadeout");

    const remove = () => {
      if (this.overlayEl.isConnected) this.overlayEl.remove();
      this.bus.emit("bootloader:dismissed", {});
    };

    // Match the fadeout transition duration defined in styles.css.
    // A safety-net timeout (same pattern as animations.js) ensures
    // the overlay is removed even if transitionend never fires.
    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      remove();
    };
    this.overlayEl.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, 500);
  }
}

window.Bootloader = Bootloader;
