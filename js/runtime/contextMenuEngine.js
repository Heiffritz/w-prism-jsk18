/**
 * contextMenuEngine.js
 * ------------------------------------------------------------------
 * Generic right-click context menu system.
 *
 * Any module (DesktopEngine, TaskbarEngine, future apps) can request
 * a context menu by emitting "contextmenu:open" with a list of menu
 * items and a screen position. This engine is the ONLY module that
 * creates/destroys the actual context-menu DOM element — callers
 * never build their own popup markup.
 *
 * Menu item shape:
 *   { label: string, action: string, disabled?: boolean, separator?: false }
 *   { separator: true }  // a visual divider, no label/action needed
 *
 * When an item is clicked, this engine emits "contextmenu:action"
 * with { action, context } where `context` is whatever arbitrary
 * payload the original opener attached (e.g. which icon was
 * right-clicked). The opener listens for that action event — it
 * does NOT get a direct callback reference, keeping everything
 * on the bus.
 * ------------------------------------------------------------------
 */

class ContextMenuEngine {
  constructor(eventBus) {
    this.bus = eventBus;
    this.menuEl = null;
    this._currentContext = null;

    this._bindEvents();
    this._bindGlobalDismiss();
  }

  _bindEvents() {
    this.bus.on("contextmenu:open", (payload) => this.open(payload));
    this.bus.on("contextmenu:close", () => this.close());
  }

  /**
   * Clicking anywhere outside the menu, or pressing Escape, or
   * scrolling, dismisses it — standard OS context-menu behavior.
   */
  _bindGlobalDismiss() {
    document.addEventListener("mousedown", (e) => {
      if (this.menuEl && !this.menuEl.contains(e.target)) {
        this.close();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.close();
    });
    document.addEventListener(
      "scroll",
      () => this.close(),
      { capture: true }
    );
    // A second right-click anywhere else should close the current
    // menu rather than stacking multiple menus — DesktopEngine etc.
    // call open() again on their own contextmenu handler, and open()
    // itself always closes any prior menu first (see below).
  }

  /**
   * @param {Object} payload
   * @param {Array}  payload.items - menu item definitions (see header)
   * @param {number} payload.x
   * @param {number} payload.y
   * @param {*}      [payload.context] - opaque data passed back on action
   */
  open({ items, x, y, context } = {}) {
    this.close(); // only one context menu on screen at a time

    if (!Array.isArray(items) || items.length === 0) return;

    this._currentContext = context ?? null;

    const menu = document.createElement("div");
    menu.className = "prism-context-menu";
    menu.style.position = "fixed";
    menu.style.zIndex = "999998"; // above windows, below nothing else
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    items.forEach((item) => {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "prism-context-menu-separator";
        menu.appendChild(sep);
        return;
      }

      const entry = document.createElement("div");
      entry.className = "prism-context-menu-item";
      entry.textContent = item.label;

      if (item.disabled) {
        entry.classList.add("disabled");
      } else {
        entry.addEventListener("click", () => {
          this.bus.emit("contextmenu:action", {
            action: item.action,
            context: this._currentContext
          });
          this.close();
        });
      }

      menu.appendChild(entry);
    });

    document.body.appendChild(menu);
    this.menuEl = menu;

    // Keep the menu fully on-screen — flip up/left if it would
    // overflow the viewport on either axis.
    this._clampToViewport(menu, x, y);

    this.bus.emit("contextmenu:opened", { x, y, itemCount: items.length });
  }

  _clampToViewport(menu, x, y) {
    const rect = menu.getBoundingClientRect();
    let newX = x;
    let newY = y;

    if (rect.right > window.innerWidth) {
      newX = Math.max(0, window.innerWidth - rect.width - 4);
    }
    if (rect.bottom > window.innerHeight) {
      newY = Math.max(0, window.innerHeight - rect.height - 4);
    }

    menu.style.left = `${newX}px`;
    menu.style.top = `${newY}px`;
  }

  close() {
    if (this.menuEl) {
      this.menuEl.remove();
      this.menuEl = null;
      this._currentContext = null;
      this.bus.emit("contextmenu:closed", {});
    }
  }
}

window.ContextMenuEngine = ContextMenuEngine;
