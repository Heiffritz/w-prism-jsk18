/**
 * minigame.app.js
 * ------------------------------------------------------------------
 * "Prism System Recovery" — the OS's built-in minigame.
 *
 * CONCEPT: the player is "recovering" a glitching system by repeating
 * an increasingly long sequence of module activations (Simon-Says
 * style), against a countdown timer, while fake system error popups
 * randomly interrupt play as a distraction. Completing a round
 * increases the score and round length; failing or timing out ends
 * the run.
 *
 * Same registration/factory/window pattern as every other app (see
 * about.app.js for the full architecture note) — this game is a
 * normal OS process like any other, it just happens to render a
 * game instead of a portfolio section.
 *
 * FEATURES (per the build spec):
 *   - score system            -> increments per round survived
 *   - timed puzzle mechanics  -> per-round countdown, fails on timeout
 *   - fake system error events -> random in-window popups during play
 *   - success/failure UI states -> distinct end screens, replay button
 *   - persistent high score   -> localStorage, survives page reloads
 *
 * IMPORTANT ARCHITECTURE NOTE: this game's fake error popups and
 * internal countdown/round state are rendered ENTIRELY inside this
 * app's own contentEl — never as real OS-level windows via
 * "window:create". A "fake system error" that actually opened a
 * real WindowManager window would be indistinguishable from a real
 * one, which would be confusing rather than fun. The simulation
 * stays contained to where the player is already looking.
 * ------------------------------------------------------------------
 */

(function registerMinigameApp() {
  const APP_ID = "minigame";
  const HIGH_SCORE_KEY = "prism.minigame.highscore";

  // Tunable game constants, kept together for easy adjustment.
  const MODULE_COUNT = 4; // number of clickable "system modules" in the grid
  const BASE_SEQUENCE_LENGTH = 3; // round 1 starts with a 3-step sequence
  const BASE_TIME_PER_STEP_MS = 1800; // time budget per sequence step, decreases each round
  const MIN_TIME_PER_STEP_MS = 700;
  const FAKE_ERROR_MIN_DELAY_MS = 4000;
  const FAKE_ERROR_MAX_DELAY_MS = 9000;

  const MODULE_GLYPHS = ["父", "理", "缺", "陥"];
  const MODULE_LABELS = [">MEM.SYS", ">CPU.SYS", ">I-O.SYS", ">NET.SYS"];

  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Prism System Recovery",
      icon: "icon.minigame",
      singleInstance: true,
      factory: minigameAppFactory
    });
  });

  function minigameAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      new MinigameInstance(payload.contentEl, ctx).showStartScreen();
    });

    ctx.emit("window:create", {
      title: "Prism System Recovery",
      icon: "icon.minigame",
      width: 420,
      height: 460,
      resizable: false
    });
  }

  /**
   * Encapsulates all state for ONE running instance of the game.
   * A class instead of closures-in-a-function purely because this
   * app has more moving timer/state than the others — using `this`
   * keeps each timer-handler's intent readable.
   */
  class MinigameInstance {
    constructor(contentEl, ctx) {
      this.contentEl = contentEl;
      this.ctx = ctx;

      this.round = 0;
      this.score = 0;
      this.sequence = [];
      this.playerProgress = 0;
      this.acceptingInput = false;

      this._stepTimer = null;
      this._fakeErrorTimer = null;
      this._destroyed = false;

      // Matrix-rain background animation state (suggestion #8).
      // Tracked separately from _stepTimer/_fakeErrorTimer since it
      // uses requestAnimationFrame, not setTimeout — a different
      // cleanup mechanism that still needs the same discipline: never
      // let a stale animation frame callback run after the window
      // (and its canvas) is gone.
      this._rainAnimationFrame = null;
      this._rainResizeHandler = null;

      // Clean up every pending timer if the window is closed mid-game,
      // so a finished/closed game instance never fires a callback into
      // DOM elements that no longer exist.
      this._unsubClosed = ctx.on("window:closed", (payload) => {
        if (payload.pid !== ctx.pid) return;
        this._destroyed = true;
        this._clearTimers();
        this._stopRain();
      });
    }

    _clearTimers() {
      if (this._stepTimer) clearTimeout(this._stepTimer);
      if (this._fakeErrorTimer) clearTimeout(this._fakeErrorTimer);
      this._stepTimer = null;
      this._fakeErrorTimer = null;
    }

    /** ------------------------------------------------------------
     * Screens
     * ---------------------------------------------------------- */

    showStartScreen() {
      const highScore = this._loadHighScore();
      this.contentEl.innerHTML = `
        <canvas class="app-minigame-rain-canvas"></canvas>
        <div class="app-minigame-crt-overlay"></div>
        <div class="app-minigame">
          <div class="app-minigame-screen app-minigame-start">
            <h2 class="app-minigame-title">&gt;_ PRISM_SYSTEM_RECOVERY.exe</h2>
            <p class="app-minigame-desc">
              CONNECTION TO MAINFRAME ESTABLISHED.<br />
              Memory sectors have desynced from the kernel. Observe
              the activation pattern, then re-input it before the
              trace timer expires. Each cycle the pattern grows
              longer and the trace window grows shorter.
            </p>
            <p class="app-minigame-highscore">BEST_RUN: <strong>${highScore}</strong></p>
            <button type="button" class="app-minigame-btn app-minigame-start-btn">
              [ INITIATE RECOVERY ]
            </button>
          </div>
        </div>
      `;
      this._startRain();
      this.contentEl
        .querySelector(".app-minigame-start-btn")
        .addEventListener("click", () => this.startGame());
    }

    startGame() {
      this.round = 0;
      this.score = 0;
      this._renderGameScreen();
      this._scheduleFakeError();
      this._nextRound();
    }

    _renderGameScreen() {
      const modulesHtml = MODULE_GLYPHS.map((glyph, i) => `
        <button type="button" class="app-minigame-module" data-module-index="${i}">
          <span class="app-minigame-module-glyph">${glyph}</span>
          <span class="app-minigame-module-label">${MODULE_LABELS[i]}</span>
        </button>
      `).join("");

      this.contentEl.innerHTML = `
        <canvas class="app-minigame-rain-canvas"></canvas>
        <div class="app-minigame-crt-overlay"></div>
        <div class="app-minigame">
          <div class="app-minigame-hud">
            <span>CYCLE: <strong class="app-minigame-round">1</strong></span>
            <span>SCORE: <strong class="app-minigame-score">0</strong></span>
            <span>TRACE: <strong class="app-minigame-time">--</strong></span>
          </div>
          <div class="app-minigame-status">&gt; awaiting pattern...</div>
          <div class="app-minigame-grid">${modulesHtml}</div>
          <div class="app-minigame-popup-layer"></div>
        </div>
      `;

      this._startRain();

      this.hudRoundEl = this.contentEl.querySelector(".app-minigame-round");
      this.hudScoreEl = this.contentEl.querySelector(".app-minigame-score");
      this.hudTimeEl = this.contentEl.querySelector(".app-minigame-time");
      this.statusEl = this.contentEl.querySelector(".app-minigame-status");
      this.popupLayerEl = this.contentEl.querySelector(".app-minigame-popup-layer");
      this.moduleEls = [...this.contentEl.querySelectorAll(".app-minigame-module")];

      this.moduleEls.forEach((el) => {
        el.addEventListener("click", () => this._onModuleClick(Number(el.dataset.moduleIndex)));
      });
    }

    showEndScreen(didWin) {
      this._clearTimers();
      const highScore = this._loadHighScore();
      const isNewHighScore = this.score > highScore;
      if (isNewHighScore) this._saveHighScore(this.score);

      const finalHighScore = isNewHighScore ? this.score : highScore;

      this.contentEl.innerHTML = `
        <canvas class="app-minigame-rain-canvas"></canvas>
        <div class="app-minigame-crt-overlay"></div>
        <div class="app-minigame">
          <div class="app-minigame-screen ${didWin ? "app-minigame-win" : "app-minigame-lose"}">
            <h2 class="app-minigame-title">
              ${didWin ? "&gt;_ ACCESS GRANTED" : "&gt;_ CONNECTION TERMINATED"}
            </h2>
            <p class="app-minigame-desc">
              ${didWin
                ? "All sectors resynchronized. Mainframe trust restored."
                : "Trace failed. Session forcibly disconnected by the system."}
            </p>
            <p class="app-minigame-final-score">SCORE: <strong>${this.score}</strong></p>
            <p class="app-minigame-highscore">
              ${isNewHighScore ? "&gt; NEW BEST_RUN RECORDED" : `BEST_RUN: ${finalHighScore}`}
            </p>
            <button type="button" class="app-minigame-btn app-minigame-retry-btn">
              [ RECONNECT ]
            </button>
          </div>
        </div>
      `;
      this._startRain();
      this.contentEl
        .querySelector(".app-minigame-retry-btn")
        .addEventListener("click", () => this.startGame());
    }

    /** ------------------------------------------------------------
     * Round / sequence logic
     * ---------------------------------------------------------- */

    _nextRound() {
      this.round += 1;
      this.playerProgress = 0;
      this.acceptingInput = false;

      const targetLength = BASE_SEQUENCE_LENGTH + (this.round - 1);
      while (this.sequence.length < targetLength) {
        this.sequence.push(Math.floor(Math.random() * MODULE_COUNT));
      }

      this.hudRoundEl.textContent = String(this.round);
      this.hudScoreEl.textContent = String(this.score);
      this.statusEl.textContent = "> reading pattern...";
      this.hudTimeEl.textContent = "--";

      this._playSequence();
    }

    _playSequence() {
      let i = 0;
      const playStep = () => {
        if (this._destroyed) return;
        if (i >= this.sequence.length) {
          this._beginPlayerTurn();
          return;
        }
        const moduleIndex = this.sequence[i];
        this._flashModule(moduleIndex);
        i += 1;
        this._stepTimer = setTimeout(playStep, 550);
      };
      playStep();
    }

    _flashModule(index) {
      const el = this.moduleEls[index];
      el.classList.add("flash");
      setTimeout(() => {
        if (!this._destroyed) el.classList.remove("flash");
      }, 350);
    }

    _beginPlayerTurn() {
      if (this._destroyed) return;
      this.acceptingInput = true;
      this.statusEl.textContent = "> input pattern now_";

      const timePerStep = Math.max(
        MIN_TIME_PER_STEP_MS,
        BASE_TIME_PER_STEP_MS - (this.round - 1) * 100
      );
      const totalTimeMs = timePerStep * this.sequence.length;
      this._startCountdown(totalTimeMs);
    }

    _startCountdown(totalMs) {
      const deadline = Date.now() + totalMs;
      const tick = () => {
        if (this._destroyed || !this.acceptingInput) return;
        const remaining = Math.max(0, deadline - Date.now());
        this.hudTimeEl.textContent = (remaining / 1000).toFixed(1) + "s";

        if (remaining <= 0) {
          this._failRound("> trace timer expired.");
          return;
        }
        this._stepTimer = setTimeout(tick, 100);
      };
      tick();
    }

    _onModuleClick(index) {
      if (!this.acceptingInput || this._destroyed) return;

      const expected = this.sequence[this.playerProgress];
      this._flashModule(index);

      if (index !== expected) {
        this._failRound("> invalid sector accessed.");
        return;
      }

      this.playerProgress += 1;
      if (this.playerProgress >= this.sequence.length) {
        this.acceptingInput = false;
        this.score += this.round * 10;
        this.statusEl.textContent = "> pattern verified. advancing_";
        this._stepTimer = setTimeout(() => this._nextRound(), 900);
      }
    }

    _failRound(reasonText) {
      this.acceptingInput = false;
      this._clearTimers();
      this.statusEl.textContent = reasonText;
      setTimeout(() => {
        if (!this._destroyed) this.showEndScreen(false);
      }, 700);
    }

    /** ------------------------------------------------------------
     * Fake system error popups (pure distraction, contained inside
     * this app's own contentEl — never a real OS window)
     * ---------------------------------------------------------- */

    _scheduleFakeError() {
      const delay =
        FAKE_ERROR_MIN_DELAY_MS +
        Math.random() * (FAKE_ERROR_MAX_DELAY_MS - FAKE_ERROR_MIN_DELAY_MS);
      this._fakeErrorTimer = setTimeout(() => {
        if (this._destroyed) return;
        this._showFakeError();
        this._scheduleFakeError(); // schedule the next one
      }, delay);
    }

    _showFakeError() {
      if (!this.popupLayerEl) return;

      const messages = [
        "NET.SYS reporting packet loss spike.",
        "MEM.SYS checksum mismatch detected.",
        "I-O.SYS thermal nominal — false trigger.",
        "CPU.SYS scheduler thrash detected."
      ];
      const text = messages[Math.floor(Math.random() * messages.length)];

      const popup = document.createElement("div");
      popup.className = "app-minigame-popup";
      popup.innerHTML = `
        <div class="app-minigame-popup-title">&gt;_ SYSTEM_ALERT</div>
        <div class="app-minigame-popup-body">${text}</div>
        <button type="button" class="app-minigame-popup-dismiss">[ ACKNOWLEDGE ]</button>
      `;
      popup.querySelector(".app-minigame-popup-dismiss").addEventListener("click", () => {
        popup.remove();
      });

      this.popupLayerEl.appendChild(popup);

      // Auto-dismiss after a few seconds even if the player ignores
      // it, so popups never permanently stack up and obscure the game.
      setTimeout(() => {
        if (popup.isConnected) popup.remove();
      }, 4000);
    }

    /** ------------------------------------------------------------
     * Matrix-rain background animation (suggestion #8)
     *
     * A canvas sized to fill the window's content area, with columns
     * of falling green characters — the single most recognizable
     * signature of the "Matrix" visual style. Purely decorative,
     * rendered BEHIND the game's real UI (z-index handled in CSS),
     * and contained entirely within this app's own contentEl, same
     * isolation rule as the fake error popups.
     *
     * Every screen transition (_renderGameScreen, showStartScreen,
     * showEndScreen) replaces contentEl.innerHTML wholesale, which
     * destroys the previous <canvas> entirely — so _startRain() is
     * called fresh after each render and must itself guarantee only
     * ONE animation loop is ever running at a time, even if called
     * repeatedly in quick succession.
     * ---------------------------------------------------------- */

    _startRain() {
      // Defensive: if a previous loop is somehow still scheduled
      // (shouldn't happen given _stopRain is called before every
      // fresh render below, but cheap insurance against a future
      // refactor accidentally calling _startRain twice in a row).
      this._stopRain();

      const canvas = this.contentEl.querySelector(".app-minigame-rain-canvas");
      if (!canvas) return; // current screen has no rain canvas (shouldn't happen, but never throw over decoration)

      // Belt-and-suspenders: styles.css uses :has() to give the
      // window's content panel a solid black background whenever it
      // hosts this canvas. :has() has full support across all major
      // browsers, but adding this class directly as well costs
      // nothing and means the black background still applies even in
      // the rare case of an unsupported/older browser.
      this.contentEl.classList.add("has-minigame-rain");

      const ctx2d = canvas.getContext("2d");
      if (!ctx2d) return; // canvas unsupported in this environment — skip decoration, never break the game

      const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ日本語ハッカー父理缺陥".split("");
      const FONT_SIZE = 14;

      let columns = 0;
      let dropY = []; // current fall position (in character-rows) for each column

      const resize = () => {
        const rect = canvas.getBoundingClientRect();
        // Guard against a transient 0x0 size (e.g. the window is
        // mid-animation/minimized when this fires) — a canvas with
        // zero backing size throws on some browsers' getContext calls
        // and serves no visual purpose anyway.
        if (rect.width <= 0 || rect.height <= 0) return;

        canvas.width = rect.width;
        canvas.height = rect.height;
        columns = Math.floor(rect.width / FONT_SIZE);
        dropY = new Array(columns).fill(0).map(() => Math.floor(Math.random() * -20));
      };

      resize();
      this._rainResizeHandler = resize;
      window.addEventListener("resize", this._rainResizeHandler);

      const draw = () => {
        if (this._destroyed) return;

        // Translucent black overlay each frame instead of a hard
        // clear — this is what produces the characteristic fading
        // trail behind each falling character, rather than a blank
        // wipe every frame.
        ctx2d.fillStyle = "rgba(0, 0, 0, 0.08)";
        ctx2d.fillRect(0, 0, canvas.width, canvas.height);

        ctx2d.font = `${FONT_SIZE}px monospace`;

        for (let col = 0; col < columns; col++) {
          const char = CHARSET[Math.floor(Math.random() * CHARSET.length)];
          const x = col * FONT_SIZE;
          const y = dropY[col] * FONT_SIZE;

          // The leading character of each column's trail renders
          // brighter (near-white-green) than the fading trail behind
          // it, matching the source material's signature look.
          ctx2d.fillStyle = "#c8ffcc";
          ctx2d.fillText(char, x, y);

          dropY[col] += 1;
          // Once a column's trail has fallen past the bottom, reset
          // it to a random point above the top (with some randomness
          // in WHEN it resets, so columns don't all loop in sync).
          if (y > canvas.height && Math.random() > 0.975) {
            dropY[col] = Math.floor(Math.random() * -20);
          }
        }

        this._rainAnimationFrame = requestAnimationFrame(draw);
      };

      this._rainAnimationFrame = requestAnimationFrame(draw);
    }

    _stopRain() {
      if (this._rainAnimationFrame) {
        cancelAnimationFrame(this._rainAnimationFrame);
        this._rainAnimationFrame = null;
      }
      if (this._rainResizeHandler) {
        window.removeEventListener("resize", this._rainResizeHandler);
        this._rainResizeHandler = null;
      }
    }

    /** ------------------------------------------------------------
     * Persistent high score (localStorage)
     * ---------------------------------------------------------- */

    _loadHighScore() {
      try {
        const raw = window.localStorage.getItem(HIGH_SCORE_KEY);
        const value = raw ? parseInt(raw, 10) : 0;
        return Number.isFinite(value) ? value : 0;
      } catch (err) {
        // localStorage can throw in some browser privacy modes
        // (e.g. Safari private browsing) — fail gracefully to "no
        // high score" rather than crashing the game.
        console.warn("[minigame] localStorage unavailable, high score will not persist:", err);
        return 0;
      }
    }

    _saveHighScore(score) {
      try {
        window.localStorage.setItem(HIGH_SCORE_KEY, String(score));
      } catch (err) {
        console.warn("[minigame] localStorage unavailable, high score will not persist:", err);
      }
    }
  }
})();
