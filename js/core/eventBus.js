/**
 * eventBus.js
 * ------------------------------------------------------------------
 * The OS-wide communication bus.
 *
 * RULE: No module is allowed to call another module's methods directly
 * (e.g. an app calling windowManager.createWindow() directly).
 * Instead, every module EMITS events and LISTENS for events here.
 *
 * This keeps the architecture decoupled: WindowManager doesn't know
 * ProcessManager exists, apps don't know WindowManager exists, etc.
 * They only know "if I emit this event, something will happen."
 *
 * Pattern: simple pub/sub with namespaced event strings, e.g.
 *   "process:spawn", "window:create", "window:close", "vfs:read"
 * ------------------------------------------------------------------
 */

class EventBus {
  constructor() {
    // Map<eventName, Set<listenerFn>>
    this._listeners = new Map();

    // Optional: log every event for debugging the OS ("kernel trace")
    this._traceEnabled = false;
    this._traceLog = [];
    this._maxTraceLog = 500;
  }

  /**
   * Subscribe to an event.
   * @param {string} eventName
   * @param {Function} handler
   * @returns {Function} unsubscribe function
   */
  on(eventName, handler) {
    if (typeof handler !== "function") {
      throw new TypeError(`EventBus.on("${eventName}") requires a function handler`);
    }
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(handler);

    // Return an unsubscribe function for convenience
    return () => this.off(eventName, handler);
  }

  /**
   * Subscribe to an event, but only fire once.
   */
  once(eventName, handler) {
    const wrapped = (...args) => {
      this.off(eventName, wrapped);
      handler(...args);
    };
    return this.on(eventName, wrapped);
  }

  /**
   * Unsubscribe from an event.
   */
  off(eventName, handler) {
    const set = this._listeners.get(eventName);
    if (set) {
      set.delete(handler);
      if (set.size === 0) this._listeners.delete(eventName);
    }
  }

  /**
   * Emit an event to all subscribers.
   * @param {string} eventName
   * @param {*} payload
   */
  emit(eventName, payload) {
    if (this._traceEnabled) this._trace(eventName, payload);

    const set = this._listeners.get(eventName);
    if (!set || set.size === 0) return;

    // Copy to array before iterating — handlers may unsubscribe
    // themselves mid-emit (e.g. via once()), which would otherwise
    // mutate the Set while we're iterating it.
    [...set].forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        // A misbehaving app must never crash the whole OS bus.
        console.error(`[EventBus] handler for "${eventName}" threw:`, err);
        this.emit("system:error", {
          source: "EventBus",
          eventName,
          error: err
        });
      }
    });
  }

  /**
   * Remove every listener for a given event, or every listener
   * in the entire bus if no eventName is given.
   */
  clear(eventName) {
    if (eventName) {
      this._listeners.delete(eventName);
    } else {
      this._listeners.clear();
    }
  }

  /** Debug helpers ---------------------------------------------------- */

  enableTrace() {
    this._traceEnabled = true;
  }

  disableTrace() {
    this._traceEnabled = false;
  }

  _trace(eventName, payload) {
    this._traceLog.push({ t: Date.now(), eventName, payload });
    if (this._traceLog.length > this._maxTraceLog) this._traceLog.shift();
    console.debug(`[EventBus] ${eventName}`, payload);
  }

  getTraceLog() {
    return [...this._traceLog];
  }
}

// The OS has exactly ONE event bus. We attach it to window.EventBus
// (the class) and window.eventBus (the singleton instance) so every
// other script — loaded via plain <script> tags, no bundler — can
// reach it without import/export machinery.
window.EventBus = EventBus;
window.eventBus = new EventBus();
