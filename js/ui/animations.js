/**
 * animations.js
 * ------------------------------------------------------------------
 * Small, reusable CSS-transition helper functions for window
 * open/close/minimize/restore.
 *
 * ARCHITECTURE NOTE: WindowManager remains the ONLY module allowed
 * to create/destroy/move window DOM (see windowManager.js's header).
 * This file does not violate that — it owns no DOM itself and never
 * creates or removes elements. It only exposes small functions that
 * TAKE an element WindowManager already owns and apply a transition
 * to it, with a completion callback. WindowManager calls into these
 * functions at the right moments in createWindow()/closeWindow()/
 * minimizeWindow()/restoreWindow() — animations.js never reaches
 * into WindowManager's registry, never listens to the event bus, and
 * has no state of its own beyond the constants below.
 *
 * All animations are plain CSS transitions toggled via inline style
 * properties (no external animation library), kept short (150-220ms)
 * to feel like genuine XP/Vista chrome rather than a modern web app's
 * exaggerated motion design.
 * ------------------------------------------------------------------ */

const PrismAnimations = {
  DURATIONS: {
    open: 160,
    close: 140,
    minimize: 180,
    restore: 180
  },

  /**
   * Window open: scale up slightly + fade in from the window's
   * final resting position. Call this immediately after the window
   * element has been mounted into the DOM with its final position/
   * size already set, BEFORE the browser has painted it (i.e. set
   * the "from" state synchronously, then flip to the "to" state on
   * the next animation frame so the transition actually animates).
   * @param {HTMLElement} el
   * @param {Function} [onComplete]
   */
  animateOpen(el, onComplete) {
    el.style.transition = "none";
    el.style.opacity = "0";
    el.style.transform = "scale(0.94)";

    // Force the "from" state to actually paint before switching to
    // the "to" state — otherwise the browser may coalesce both style
    // writes into a single frame and skip the animation entirely.
    requestAnimationFrame(() => {
      el.style.transition = `opacity ${this.DURATIONS.open}ms ease-out, transform ${this.DURATIONS.open}ms ease-out`;
      el.style.opacity = "1";
      el.style.transform = "scale(1)";
    });

    this._onTransitionEnd(el, this.DURATIONS.open, () => {
      el.style.transition = "";
      el.style.transform = "";
      if (onComplete) onComplete();
    });
  },

  /**
   * Window close: fade out + scale down slightly. The caller
   * (WindowManager.closeWindow) is expected to actually remove the
   * element from the DOM inside onComplete — this function only
   * handles the visual transition, never the removal itself, keeping
   * DOM ownership entirely with WindowManager.
   * @param {HTMLElement} el
   * @param {Function} onComplete
   */
  animateClose(el, onComplete) {
    el.style.transition = `opacity ${this.DURATIONS.close}ms ease-in, transform ${this.DURATIONS.close}ms ease-in`;
    el.style.opacity = "0";
    el.style.transform = "scale(0.94)";

    this._onTransitionEnd(el, this.DURATIONS.close, onComplete);
  },

  /**
   * Window minimize: shrink toward the bottom of the screen (toward
   * where the taskbar lives), fading out. WindowManager is expected
   * to set `el.style.display = "none"` inside onComplete, same
   * ownership split as animateClose.
   * @param {HTMLElement} el
   * @param {Function} onComplete
   */
  animateMinimize(el, onComplete) {
    el.style.transition = `opacity ${this.DURATIONS.minimize}ms ease-in, transform ${this.DURATIONS.minimize}ms ease-in`;
    el.style.transformOrigin = "center bottom";
    el.style.opacity = "0";
    el.style.transform = "scale(0.6) translateY(40px)";

    this._onTransitionEnd(el, this.DURATIONS.minimize, onComplete);
  },

  /**
   * Window restore: reverse of minimize — grow back from the
   * minimized state to full size/opacity. WindowManager is expected
   * to set `el.style.display = "block"` BEFORE calling this (so the
   * element is actually visible/paintable for the transition to
   * apply to), same as animateOpen's pattern.
   * @param {HTMLElement} el
   * @param {Function} [onComplete]
   */
  animateRestore(el, onComplete) {
    el.style.transition = "none";
    el.style.transformOrigin = "center bottom";
    el.style.opacity = "0";
    el.style.transform = "scale(0.6) translateY(40px)";

    requestAnimationFrame(() => {
      el.style.transition = `opacity ${this.DURATIONS.restore}ms ease-out, transform ${this.DURATIONS.restore}ms ease-out`;
      el.style.opacity = "1";
      el.style.transform = "scale(1) translateY(0)";
    });

    this._onTransitionEnd(el, this.DURATIONS.restore, () => {
      el.style.transition = "";
      el.style.transform = "";
      el.style.transformOrigin = "";
      if (onComplete) onComplete();
    });
  },

  /**
   * Fires onComplete once, either on the element's own
   * "transitionend" event or after a safety-net timeout slightly
   * longer than the expected duration — whichever comes first. The
   * timeout fallback exists because transitionend can fail to fire
   * in edge cases (e.g. the element is removed from the DOM mid-
   * transition, or a property never actually changed value), and a
   * window lifecycle callback that never fires would leave the OS
   * in a stuck visual state.
   * @param {HTMLElement} el
   * @param {number} expectedDurationMs
   * @param {Function} onComplete
   */
  _onTransitionEnd(el, expectedDurationMs, onComplete) {
    if (!onComplete) return;

    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      el.removeEventListener("transitionend", onTransitionEnd);
      clearTimeout(safetyTimer);
      onComplete();
    };

    const onTransitionEnd = (e) => {
      if (e.target !== el) return; // ignore bubbled transitionend from children
      finish();
    };

    el.addEventListener("transitionend", onTransitionEnd);
    const safetyTimer = setTimeout(finish, expectedDurationMs + 100);
  }
};

window.PrismAnimations = PrismAnimations;
