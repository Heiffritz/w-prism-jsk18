/**
 * themeManager.js
 * ------------------------------------------------------------------
 * Applies and switches the OS's visual theme.
 *
 * HOW THEMING WORKS IN THIS PROJECT: every themeable color/gradient
 * is defined as a CSS custom property (e.g. --titlebar-grad-start)
 * on a THEME object below. ThemeManager's only job is writing those
 * custom properties onto <html> as inline style properties via
 * el.style.setProperty(). Every other stylesheet rule in styles.css
 * reads from these variables (var(--titlebar-grad-start)) instead of
 * hardcoding a color — so switching themes is just re-running
 * applyTheme() with a different THEME object, no class-juggling and
 * no duplicated CSS rule sets per theme.
 *
 * THEMES:
 *   - "luna"  -> Windows XP Luna (blue/green), this OS's DEFAULT theme,
 *                built as close to pixel-accurate as plain CSS allows
 *   - "aero"  -> Windows Vista Aero Glass — defined as a placeholder
 *                token set for now (silver/blue, frosted-glass-style
 *                alpha values) so the THEME switching mechanism is
 *                real and complete, even though Aero's full glass-blur
 *                visual treatment is intentionally not the focus of
 *                this build (Luna was explicitly chosen as the
 *                pixel-accurate target). Switching to it will look
 *                like a believable cooler/silver re-skin, not a
 *                broken empty theme.
 *
 * ThemeManager listens for "theme:set" so any module (the Settings
 * app) can change the theme purely by emitting an event, consistent
 * with every other manager in this OS.
 *
 * WALLPAPER: independent of theme. Each theme defines a DEFAULT
 * desktop background (--desktop-bg, an abstract gradient, since this
 * project ships no real photo assets for the BASE theme look) but
 * the Settings app can override it via "wallpaper:set" with one of
 * the PRISM_WALLPAPERS presets below. Two kinds of preset exist:
 *   - type: "gradient" -> a literal CSS value, applied directly
 *   - type: "image"    -> an AssetManager KEY (never a raw path),
 *                          resolved via the standard asset:get/
 *                          asset:resolved request-response pair,
 *                          then written as a CSS url(...) value.
 *                          The actual .png files are expected to be
 *                          dropped into assets/wallpapers/ by whoever
 *                          deploys this project — see data/assets.json
 *                          for the registered keys/paths. If a file
 *                          is missing, the image simply 404s inside
 *                          a CSS background-image (same graceful
 *                          degradation AssetManager already has for
 *                          icons elsewhere in this OS).
 * Switching theme does NOT reset a manually chosen wallpaper; only
 * resets to the new theme's default if the person picks "Theme
 * Default" explicitly.
 * ------------------------------------------------------------------ */

const PRISM_WALLPAPERS = {
  "theme-default": { type: "gradient", value: null }, // null = defer to the active theme's own --desktop-bg

  // Gradient presets (suggestion #5) — no real image files needed.
  "bliss-hills": { type: "gradient", value: "linear-gradient(to bottom, #3a8de0 0%, #6fb0ec 38%, #bcdff5 55%, #5a9c3a 56%, #4a8c2a 75%, #3a7a1a 100%)" },
  "sunset": { type: "gradient", value: "linear-gradient(to bottom, #2a1a4a 0%, #6a2a6a 35%, #d4682a 65%, #f4a23a 100%)" },
  "midnight": { type: "gradient", value: "radial-gradient(circle at 50% 30%, #1a2a4a 0%, #0a1020 70%, #000008 100%)" },
  "forest": { type: "gradient", value: "linear-gradient(to bottom, #1a3a1a 0%, #2a5a2a 50%, #1a4a1a 100%)" },

  // Image-based presets (suggestion #14) — each value is an
  // AssetManager key, registered in data/assets.json, pointing at
  // assets/wallpapers/<name>.png. Real .png files are a deployment-
  // time content task, same as app icons (Phase 8) and gallery
  // photos/certificate PDFs (Phase 6) — the resolution pipeline is
  // fully real and tested regardless of whether the file exists yet.
  "bliss": { type: "image", value: "wallpaper.bliss" },
  "woe": { type: "image", value: "wallpaper.woe" },
  "anguish": { type: "image", value: "wallpaper.anguish" },
  "error": { type: "image", value: "wallpaper.error" },
  "wonder": { type: "image", value: "wallpaper.wonder" },
  "absurd": { type: "image", value: "wallpaper.absurd" },
  "relief": { type: "image", value: "wallpaper.relief" },
  "window": { type: "image", value: "wallpaper.window" },
  "hope": { type: "image", value: "wallpaper.hope" },
  "prism": { type: "image", value: "wallpaper.prism" }
};

const PRISM_THEMES = {
  luna: {
    // Titlebar (active window) — the iconic Luna blue gradient band
    "--titlebar-active-grad-start": "#3d94f2",
    "--titlebar-active-grad-mid": "#2674e8",
    "--titlebar-active-grad-end": "#0c5dd6",
    "--titlebar-active-text": "#ffffff",
    "--titlebar-active-border": "#1a4fae",

    // Titlebar (inactive window) — desaturated blue-gray
    "--titlebar-inactive-grad-start": "#9db3e0",
    "--titlebar-inactive-grad-end": "#7a8bb8",
    "--titlebar-inactive-text": "#dde4f4",
    "--titlebar-inactive-border": "#7a8bb8",

    // Window chrome
    "--window-border-radius": "5px",
    "--window-content-bg": "#ece9d8",
    "--window-shadow": "3px 3px 12px rgba(0, 0, 0, 0.45)",

    // Window control buttons (minimize/close)
    "--winbtn-grad-start": "#4f9eea",
    "--winbtn-grad-end": "#2a6fd0",
    "--winbtn-close-grad-start": "#f08a78",
    "--winbtn-close-grad-end": "#d63a28",
    "--winbtn-border": "#1a4fae",

    // Desktop
    "--desktop-bg": "radial-gradient(circle at 30% 15%, #5fa8e0 0%, #2a6cb8 35%, #1c4a8c 70%, #0a2a5c 100%)",
    "--desktop-icon-label-shadow": "0 1px 2px rgba(0,0,0,0.9)",

    // Taskbar
    "--taskbar-grad-start": "#2a6df0",
    "--taskbar-grad-end": "#0a3fc0",
    "--taskbar-border-top": "#6fa8ff",
    "--taskbar-btn-bg": "#3a7df5",
    "--taskbar-btn-active-bg": "#0a2a6c",
    "--taskbar-btn-border": "#0a246a",

    // Start button — the green Luna pill
    "--startbtn-grad-start": "#7ed957",
    "--startbtn-grad-mid": "#3fae3f",
    "--startbtn-grad-end": "#1d7a1d",
    "--startbtn-border": "#1a5c1a",
    "--startbtn-text": "#ffffff",

    // Start menu
    "--startmenu-header-grad-start": "#3d94f2",
    "--startmenu-header-grad-end": "#0c5dd6",
    "--startmenu-side-bg": "#ffffff",
    "--startmenu-hover-bg": "#3a6ea5",
    "--startmenu-hover-text": "#ffffff",

    // Context menu
    "--ctxmenu-bg": "#ece9d8",
    "--ctxmenu-border": "#0a246a",
    "--ctxmenu-hover-bg": "#3a6ea5",
    "--ctxmenu-hover-text": "#ffffff",

    // Surface fonts (Luna's signature is Tahoma, not Segoe UI)
    "--ui-font": "Tahoma, Verdana, Arial, sans-serif"
  },

  aero: {
    "--titlebar-active-grad-start": "rgba(160, 200, 245, 0.85)",
    "--titlebar-active-grad-mid": "rgba(120, 170, 230, 0.75)",
    "--titlebar-active-grad-end": "rgba(70, 120, 190, 0.85)",
    "--titlebar-active-text": "#0a2240",
    "--titlebar-active-border": "rgba(255, 255, 255, 0.6)",

    "--titlebar-inactive-grad-start": "rgba(210, 220, 235, 0.7)",
    "--titlebar-inactive-grad-end": "rgba(180, 195, 215, 0.7)",
    "--titlebar-inactive-text": "#5a6b80",
    "--titlebar-inactive-border": "rgba(255, 255, 255, 0.4)",

    "--window-border-radius": "10px",
    "--window-content-bg": "#f5f7fa",
    "--window-shadow": "0 8px 24px rgba(0, 20, 60, 0.5)",

    "--winbtn-grad-start": "#8fc3f5",
    "--winbtn-grad-end": "#3a7fc4",
    "--winbtn-close-grad-start": "#f59a8f",
    "--winbtn-close-grad-end": "#d4453a",
    "--winbtn-border": "rgba(255, 255, 255, 0.5)",

    "--desktop-bg": "radial-gradient(circle at 30% 15%, #cfe6fb 0%, #9ec3e8 40%, #5a8fc8 75%, #2a5a96 100%)",
    "--desktop-icon-label-shadow": "0 1px 3px rgba(0,0,0,0.8)",

    "--taskbar-grad-start": "rgba(140, 180, 225, 0.75)",
    "--taskbar-grad-end": "rgba(80, 130, 190, 0.85)",
    "--taskbar-border-top": "rgba(255, 255, 255, 0.5)",
    "--taskbar-btn-bg": "rgba(160, 195, 235, 0.6)",
    "--taskbar-btn-active-bg": "rgba(40, 70, 120, 0.6)",
    "--taskbar-btn-border": "rgba(255, 255, 255, 0.4)",

    "--startbtn-grad-start": "#bfe0fa",
    "--startbtn-grad-mid": "#6fb0e8",
    "--startbtn-grad-end": "#2a6cb8",
    "--startbtn-border": "rgba(255, 255, 255, 0.6)",
    "--startbtn-text": "#0a2240",

    "--startmenu-header-grad-start": "rgba(160, 200, 245, 0.9)",
    "--startmenu-header-grad-end": "rgba(70, 120, 190, 0.9)",
    "--startmenu-side-bg": "rgba(255, 255, 255, 0.92)",
    "--startmenu-hover-bg": "#5a9fd4",
    "--startmenu-hover-text": "#ffffff",

    "--ctxmenu-bg": "rgba(245, 248, 252, 0.95)",
    "--ctxmenu-border": "rgba(120, 150, 190, 0.6)",
    "--ctxmenu-hover-bg": "#5a9fd4",
    "--ctxmenu-hover-text": "#ffffff",

    "--ui-font": "'Segoe UI', Tahoma, Arial, sans-serif"
  }
};

class ThemeManager {
  constructor(eventBus) {
    this.bus = eventBus;
    this.currentTheme = "luna"; // XP Luna is this OS's default theme
    this.currentWallpaper = "theme-default";

    this._bindEvents();
    this.applyTheme(this.currentTheme);
  }

  _bindEvents() {
    this.bus.on("theme:set", ({ theme } = {}) => {
      this.applyTheme(theme);
    });
    this.bus.on("theme:get", ({ requestId } = {}) => {
      this.bus.emit("theme:current", { requestId, theme: this.currentTheme });
    });
    this.bus.on("wallpaper:set", ({ wallpaper } = {}) => {
      this.applyWallpaper(wallpaper);
    });
    this.bus.on("wallpaper:get", ({ requestId } = {}) => {
      this.bus.emit("wallpaper:current", { requestId, wallpaper: this.currentWallpaper });
    });
  }

  /**
   * Apply a named theme by writing its token set as CSS custom
   * properties on <html>. Falls back to "luna" (and warns) if an
   * unknown theme name is requested, so a typo can never leave the
   * OS with no theme variables defined at all.
   * @param {string} themeName
   */
  applyTheme(themeName) {
    const theme = PRISM_THEMES[themeName];
    if (!theme) {
      console.warn(`[ThemeManager] Unknown theme "${themeName}", falling back to "luna".`);
      this.applyTheme("luna");
      return;
    }

    const root = document.documentElement;
    Object.keys(theme).forEach((cssVar) => {
      root.style.setProperty(cssVar, theme[cssVar]);
    });

    root.dataset.prismTheme = themeName;
    this.currentTheme = themeName;

    // Re-apply the current wallpaper choice on top of the new theme.
    // If the person picked "theme-default", this naturally now means
    // THIS theme's default, not the previous theme's — applyWallpaper
    // already handles that by deferring to --desktop-bg.
    this.applyWallpaper(this.currentWallpaper);

    this.bus.emit("theme:applied", { theme: themeName });
  }

  getCurrentTheme() {
    return this.currentTheme;
  }

  getAvailableThemes() {
    return Object.keys(PRISM_THEMES);
  }

  /**
   * Apply a named wallpaper preset by overriding --desktop-bg
   * directly on <html>. "theme-default" (or any unknown name) clears
   * the override entirely, letting the active theme's own
   * --desktop-bg value (set by applyTheme above) show through.
   * @param {string} wallpaperName
   */
  /**
   * Apply a named wallpaper preset. Gradient presets write their CSS
   * value directly; image presets resolve their AssetManager key via
   * the standard asset:get/asset:resolved request-response pair
   * (same pattern every other module uses to avoid a direct
   * AssetManager reference) and write a CSS url(...) value once
   * resolved. "theme-default" (or any unrecognized name) clears the
   * override entirely, letting the active theme's own --desktop-bg
   * value show through.
   * @param {string} wallpaperName
   */
  applyWallpaper(wallpaperName) {
    const root = document.documentElement;
    const preset = PRISM_WALLPAPERS[wallpaperName];

    if (!wallpaperName || !preset || preset.value === null) {
      root.style.removeProperty("--desktop-bg-override");
      this.currentWallpaper = "theme-default";
      this.bus.emit("wallpaper:applied", { wallpaper: this.currentWallpaper });
      return;
    }

    if (preset.type === "gradient") {
      root.style.setProperty("--desktop-bg-override", preset.value);
      this.currentWallpaper = wallpaperName;
      this.bus.emit("wallpaper:applied", { wallpaper: this.currentWallpaper });
      return;
    }

    if (preset.type === "image") {
      const requestId = `themeManager-wallpaper-${wallpaperName}-${Math.random().toString(36).slice(2)}`;
      const unsub = this.bus.on("asset:resolved", (payload) => {
        if (payload.requestId !== requestId) return;
        unsub();

        // Probe the real file before committing to it as the desktop
        // background — CSS has no load-failure event for
        // background-image, so without this, a missing/misnamed file
        // would silently leave the desktop showing nothing useful
        // with no indication why (the exact bug reported: wallpapers
        // dropped into assets/wallpapers/ "don't work").
        const probe = new Image();
        probe.onload = () => {
          // CSS url() needs the path wrapped in quotes to safely
          // handle any spaces/special characters in a filename.
          root.style.setProperty("--desktop-bg-override", `url("${payload.path}") center center / cover no-repeat`);
          this.currentWallpaper = wallpaperName;
          this.bus.emit("wallpaper:applied", { wallpaper: this.currentWallpaper });
        };
        probe.onerror = () => {
          console.warn(
            `[ThemeManager] Wallpaper "${wallpaperName}" is registered but the file could not be loaded from "${payload.path}". ` +
            `Check the file exists at that exact path/name (case-sensitive, must match the extension in data/assets.json) and that the page is being served over http(s):// rather than opened via file://.`
          );
          this.bus.emit("wallpaper:loadFailed", { wallpaper: wallpaperName, path: payload.path });
        };
        probe.src = payload.path;
      });
      this.bus.emit("asset:get", { key: preset.value, requestId });
      return;
    }

    console.warn(`[ThemeManager] Wallpaper preset "${wallpaperName}" has an unrecognized type "${preset.type}".`);
  }

  getCurrentWallpaper() {
    return this.currentWallpaper;
  }

  getAvailableWallpapers() {
    return Object.keys(PRISM_WALLPAPERS);
  }
}

window.ThemeManager = ThemeManager;
