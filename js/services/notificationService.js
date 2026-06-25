/**
 * notificationService.js
 * ------------------------------------------------------------------
 * System-tray-style balloon notifications, anchored near the
 * taskbar's clock — the same visual pattern as Windows XP's
 * "balloon tips" (e.g. "Updates are ready to install", or this
 * project's own welcome message).
 *
 * ARCHITECTURE: NotificationService owns its own DOM layer
 * (#notification-layer) and is the only module allowed to create or
 * remove balloon elements — same ownership discipline as every other
 * UI module in this OS (WindowManager owns windows, DesktopEngine
 * owns desktop icons, ContextMenuEngine owns context menus, this
 * service owns balloons).
 *
 * USAGE (event-driven, like everything else):
 *   bus.emit("notification:show", {
 *     id: "welcome",              // optional; lets a caller avoid
 *                                  // showing the same notification
 *                                  // twice if one with this id is
 *                                  // already visible
 *     icon: "icon.welcome",       // AssetManager key, resolved via
 *                                  // the standard asset:get pattern
 *     title: "Welcome to ...",
 *     body: "A faithful XP-inspired interface...",
 *     links: [
 *       { label: "About Me", action: "open-about" },
 *       { label: "My Projects", action: "open-projects" }
 *     ],
 *     durationMs: 8000             // optional; omit/0 for "stays
 *                                  // until manually dismissed"
 *   });
 *
 * Clicking a link emits "notification:action" with { action, id } —
 * the caller listens for that, same request/action pattern
 * ContextMenuEngine already established. The service itself has no
 * idea what "open-about" means; it just reports the click.
 *
 * Multiple notifications stack vertically above the taskbar rather
 * than overlapping, and each can be dismissed independently.
 * ------------------------------------------------------------------ */

class NotificationService {
  constructor(eventBus) {
    this.bus = eventBus;

    this.layerEl = null;
    // Map<notificationId (string, auto-generated if not provided),
    //     { el, dismissTimer }>
    this._active = new Map();
    this._idCounter = 1;

    this._buildLayer();
    this._bindEvents();
  }

  _buildLayer() {
    const layer = document.createElement("div");
    layer.id = "notification-layer";
    layer.className = "prism-notification-layer";
    document.body.appendChild(layer);
    this.layerEl = layer;
  }

  _bindEvents() {
    this.bus.on("notification:show", (options) => {
      this.show(options || {});
    });
    this.bus.on("notification:dismiss", ({ id } = {}) => {
      this.dismiss(id);
    });
  }

  /**
   * Show a new balloon notification.
   * @param {Object} options
   * @param {string} [options.id] - if provided and a notification
   *        with this id is already visible, this call is a no-op
   *        (returns the existing id instead of stacking a duplicate)
   * @param {string} [options.icon] - AssetManager key
   * @param {string} options.title
   * @param {string} options.body
   * @param {{label:string, action:string}[]} [options.links]
   * @param {number} [options.durationMs] - 0 or omitted = no auto-dismiss
   * @returns {string} the notification's id (generated if not provided)
   */
  show({ id, icon, title, body, links, durationMs } = {}) {
    const notificationId = id || `notif-${this._idCounter++}`;

    if (this._active.has(notificationId)) {
      return notificationId; // already showing — don't stack a duplicate
    }

    const el = document.createElement("div");
    el.className = "prism-notification";
    el.dataset.notificationId = notificationId;

    const linksHtml = (links || [])
      .map((link) => `<a href="#" class="prism-notification-link" data-action="${this._escapeAttr(link.action)}">${this._escapeHtml(link.label)}</a>`)
      .join(" · ");

    el.innerHTML = `
      <div class="prism-notification-header">
        <span class="prism-notification-icon"></span>
        <span class="prism-notification-title">${this._escapeHtml(title || "")}</span>
        <button type="button" class="prism-notification-close" aria-label="Dismiss">×</button>
      </div>
      <div class="prism-notification-body">${this._escapeHtml(body || "")}</div>
      ${linksHtml ? `<div class="prism-notification-links">${linksHtml}</div>` : ""}
    `;

    el.querySelector(".prism-notification-close").addEventListener("click", () => {
      this.dismiss(notificationId);
    });

    el.querySelectorAll(".prism-notification-link").forEach((linkEl) => {
      linkEl.addEventListener("click", (e) => {
        e.preventDefault();
        const action = linkEl.dataset.action;
        this.bus.emit("notification:action", { action, id: notificationId });
        this.dismiss(notificationId);
      });
    });

    this.layerEl.appendChild(el);

    let dismissTimer = null;
    if (durationMs && durationMs > 0) {
      dismissTimer = setTimeout(() => this.dismiss(notificationId), durationMs);
    }

    this._active.set(notificationId, { el, dismissTimer });

    // Resolve the icon through AssetManager via the standard
    // asset:get/asset:resolved pattern — never a raw path. If no
    // icon key was given, or it doesn't resolve to anything real,
    // the iconEl simply stays an empty glyph slot (CSS gives it a
    // generic "i" fallback look — see styles.css).
    if (icon) {
      const iconEl = el.querySelector(".prism-notification-icon");
      const requestId = `notification-icon-${notificationId}-${Math.random().toString(36).slice(2)}`;
      const handler = (payload) => {
        if (payload.requestId !== requestId) return;
        this.bus.off("asset:resolved", handler);
        if (payload.found) {
          iconEl.style.backgroundImage = `url("${payload.path}")`;
          iconEl.classList.add("has-custom-icon");
        }
      };
      this.bus.on("asset:resolved", handler);
      this.bus.emit("asset:get", { key: icon, requestId });
    }

    this.bus.emit("notification:shown", { id: notificationId });
    return notificationId;
  }

  /**
   * Dismiss a notification by id. Safe to call on an id that's
   * already gone (no-op).
   * @param {string} id
   */
  dismiss(id) {
    const entry = this._active.get(id);
    if (!entry) return;

    if (entry.dismissTimer) clearTimeout(entry.dismissTimer);
    entry.el.classList.add("dismissing");

    // Let the dismiss animation play before actually removing the
    // element — same pattern as WindowManager's close animation.
    setTimeout(() => {
      if (entry.el.isConnected) entry.el.remove();
    }, 200);

    this._active.delete(id);
    this.bus.emit("notification:dismissed", { id });
  }

  /** @returns {boolean} whether a notification with this id is currently showing */
  isShowing(id) {
    return this._active.has(id);
  }

  _escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  _escapeAttr(str) {
    return this._escapeHtml(str).replace(/"/g, "&quot;");
  }
}

window.NotificationService = NotificationService;
