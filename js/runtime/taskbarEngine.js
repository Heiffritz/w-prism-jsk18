/**
 * taskbarEngine.js
 * ------------------------------------------------------------------
 * Renders the bottom taskbar surface: Start button + one button per
 * RUNNING PROCESS (not per app — multiple instances of a non-single-
 * instance app would each get their own taskbar button, though every
 * current app in this project is single-instance).
 *
 * Responsibilities:
 *   - build the #taskbar element, fixed to the bottom of the screen
 *   - render/remove a taskbar button as processes spawn/die
 *   - clicking a running window's button:
 *       - if that window is currently focused -> minimize it
 *       - otherwise -> focus/restore it
 *     (matches real Windows taskbar toggle behavior)
 *   - reflect focus state visually (pressed/active look)
 *   - host the Start button, which emits "startmenu:toggle"
 *   - host a simple live clock (no real OS dependency, just Date())
 *
 * TaskbarEngine does NOT call WindowManager or ProcessManager
 * directly. It tracks window<->process linkage purely from events
 * it already receives (process:spawned, window:created, etc) so it
 * can map a taskbar button to the right windowId when clicked.
 * ------------------------------------------------------------------
 */

class TaskbarEngine {
  constructor(eventBus) {
    this.bus = eventBus;

    this.taskbarEl = null;
    this.buttonsLayerEl = null;
    this.startButtonEl = null;
    this.clockEl = null;

    // Map<pid, { buttonEl, windowId, title, focused }>
    this._entries = new Map();

    this._buildTaskbar();
    this._bindEvents();
    this._startClock();
  }

  /** ---------------------------------------------------------------
   * Construction
   * ------------------------------------------------------------- */

  _buildTaskbar() {
    const bar = document.createElement("div");
    bar.id = "taskbar";
    bar.className = "prism-taskbar";

    const startBtn = document.createElement("button");
    startBtn.id = "start-button";
    startBtn.className = "prism-start-button";
    // A real tilted, four-color Windows flag — built as inline SVG
    // (no external image asset exists or is needed) so it stays
    // crisp at any size and needs no AssetManager round trip.
    startBtn.innerHTML = `
      <svg class="prism-start-flag" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <g transform="rotate(-18 11 11)">
          <rect x="2" y="2" width="8" height="8" fill="#f25022" />
          <rect x="12" y="2" width="8" height="8" fill="#7fba00" />
          <rect x="2" y="12" width="8" height="8" fill="#00a4ef" />
          <rect x="12" y="12" width="8" height="8" fill="#ffb900" />
        </g>
      </svg>
      <span class="prism-start-label">start</span>
    `;
    startBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.bus.emit("startmenu:toggle", {});
    });

    const buttonsLayer = document.createElement("div");
    buttonsLayer.className = "prism-taskbar-buttons";

    const clock = document.createElement("div");
    clock.className = "prism-taskbar-clock";

    bar.appendChild(startBtn);
    bar.appendChild(buttonsLayer);
    bar.appendChild(clock);
    document.body.appendChild(bar);

    this.taskbarEl = bar;
    this.startButtonEl = startBtn;
    this.buttonsLayerEl = buttonsLayer;
    this.clockEl = clock;
  }

  _startClock() {
    const tick = () => {
      const now = new Date();
      const hh = String(now.getHours() % 12 || 12);
      const mm = String(now.getMinutes()).padStart(2, "0");
      const ampm = now.getHours() >= 12 ? "PM" : "AM";
      this.clockEl.textContent = `${hh}:${mm} ${ampm}`;
    };
    tick();
    this._clockInterval = setInterval(tick, 1000 * 15); // good enough for a minute-resolution clock
  }

  /** ---------------------------------------------------------------
   * Events
   * ------------------------------------------------------------- */

  _bindEvents() {
    // A process was spawned -> reserve a taskbar entry. We don't yet
    // know its windowId (WindowManager creates that asynchronously
    // right after), so we create the button now and patch in the
    // windowId once window:created arrives for this pid.
    this.bus.on("process:spawned", (record) => {
      this._addEntry(record);
    });

    this.bus.on("window:created", ({ pid, windowId, title }) => {
      const entry = this._entries.get(pid);
      if (entry) {
        entry.windowId = windowId;
        if (title) this._setButtonLabel(entry, title);
      }
    });

    this.bus.on("window:focused", ({ pid }) => {
      this._setFocused(pid);
    });

    this.bus.on("window:minimized", ({ pid }) => {
      const entry = this._entries.get(pid);
      if (entry) {
        entry.focused = false;
        entry.buttonEl.classList.remove("active");
        entry.buttonEl.classList.add("minimized");
      }
    });

    this.bus.on("window:restored", ({ pid }) => {
      const entry = this._entries.get(pid);
      if (entry) entry.buttonEl.classList.remove("minimized");
    });

    this.bus.on("process:killed", ({ pid }) => {
      this._removeEntry(pid);
    });

    // Populate any processes that were already running before
    // TaskbarEngine booted (defensive — boot order should normally
    // prevent this, but it's cheap insurance).
    this.bus.emit("process:requestList", {});
    this.bus.on("process:list", ({ processes }) => {
      processes.forEach((record) => {
        if (!this._entries.has(record.pid)) this._addEntry(record);
      });
    });

    // Right-click a taskbar button -> context menu (Restore/Minimize/
    // Close). Bound ONCE here (not per-button) to avoid leaking a new
    // listener every time a process spawns.
    this.bus.on("contextmenu:action", ({ action, context }) => {
      if (!context || context.source !== "taskbarButton") return;
      if (!this._entries.has(context.pid)) return; // entry may have been removed already

      if (action === "taskbar:restore") {
        this.bus.emit("window:restore", { windowId: context.windowId });
        this.bus.emit("window:focus", { windowId: context.windowId });
      }
      if (action === "taskbar:minimize") {
        this.bus.emit("window:minimize", { windowId: context.windowId });
      }
      if (action === "taskbar:maximize") {
        this.bus.emit("window:maximize", { windowId: context.windowId });
        this.bus.emit("window:focus", { windowId: context.windowId });
      }
      if (action === "taskbar:close") {
        this.bus.emit("window:close", { windowId: context.windowId });
      }
    });
  }

  /** ---------------------------------------------------------------
   * Entry management
   * ------------------------------------------------------------- */

  _addEntry(record) {
    if (this._entries.has(record.pid)) return;

    const btn = document.createElement("button");
    btn.className = "prism-taskbar-app-button";
    btn.dataset.pid = String(record.pid);
    btn.textContent = record.title || record.appId;

    btn.addEventListener("click", () => {
      const entry = this._entries.get(record.pid);
      if (!entry || !entry.windowId) return;

      if (entry.focused) {
        this.bus.emit("window:minimize", { windowId: entry.windowId });
      } else {
        this.bus.emit("window:restore", { windowId: entry.windowId });
        this.bus.emit("window:focus", { windowId: entry.windowId });
      }
    });

    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const entry = this._entries.get(record.pid);
      if (!entry || !entry.windowId) return;
      this.bus.emit("contextmenu:open", {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "Restore", action: "taskbar:restore" },
          { label: "Minimize", action: "taskbar:minimize" },
          { label: "Maximize", action: "taskbar:maximize" },
          { separator: true },
          { label: "Close", action: "taskbar:close" }
        ],
        context: { source: "taskbarButton", pid: record.pid, windowId: entry.windowId }
      });
    });

    this.buttonsLayerEl.appendChild(btn);

    this._entries.set(record.pid, {
      buttonEl: btn,
      windowId: record.windowId || null,
      title: record.title,
      focused: false
    });
  }

  _removeEntry(pid) {
    const entry = this._entries.get(pid);
    if (!entry) return;
    entry.buttonEl.remove();
    this._entries.delete(pid);
  }

  _setButtonLabel(entry, title) {
    entry.title = title;
    entry.buttonEl.textContent = title;
  }

  /**
   * Only one taskbar button can show as "focused" at a time. Since
   * window:focused fires with the pid of the newly-focused window,
   * we clear .active from every other entry first.
   */
  _setFocused(pid) {
    this._entries.forEach((entry, entryPid) => {
      const isFocused = entryPid === pid;
      entry.focused = isFocused;
      entry.buttonEl.classList.toggle("active", isFocused);
      entry.buttonEl.classList.remove("minimized");
    });
  }
}

window.TaskbarEngine = TaskbarEngine;
