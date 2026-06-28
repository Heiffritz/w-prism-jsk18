/**
 * skills.app.js
 * ------------------------------------------------------------------
 * The "Skills" portfolio app — a categorized list of skills/tools.
 * Same registration/factory/window pattern as every other app (see
 * about.app.js for the full architecture note).
 *
 * NOTE: this app was not in the original ⚠️ phase list's explicit
 * Phase 5 build list alongside about/projects/contact, but it WAS
 * named in the target project structure (js/apps/skills.app.js) and
 * the desktop icon roster — so it's included here to keep the app
 * system phase complete and avoid leaving a dangling reference.
 * ------------------------------------------------------------------
 */

(function registerSkillsApp() {
  const APP_ID = "skills";

  const SKILL_CATEGORIES = [
    {
      category: "Languages",
      items: ["JavaScript", "HTML5", "CSS3", "TypeScript", "Python"]
    },
    {
      category: "Tools & Platforms",
      items: ["Git", "VS Code", "Node.js", "Claude AI", "ChatGPT", "Blockbench", "Canva", "GitHub", "Vercel", "Krita"]
    },
    {
      category: "Concepts",
      items: ["Event-driven architecture", "Component design", "Responsive UI", "API integration", "Game Design", "Concept Art", "Pixel Art", "3D Model"]
    }
  ];

  // See about.app.js for why registration must wait for
  // "kernel:ready" rather than firing immediately at script-load time.
  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Skills",
      icon: "icon.skills",
      singleInstance: true,
      factory: skillsAppFactory
    });
  });

  function skillsAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      renderSkills(payload.contentEl);
    });

    ctx.emit("window:create", {
      title: "Skills",
      icon: "icon.skills",
      width: 420,
      height: 380
    });
  }

  function renderSkills(contentEl) {
    const sectionsHtml = SKILL_CATEGORIES.map((section) => {
      const chipsHtml = section.items
        .map((item) => `<span class="app-skills-chip">${escapeHtml(item)}</span>`)
        .join("");
      return `
        <div class="app-skills-section">
          <div class="app-skills-section-title">${escapeHtml(section.category)}</div>
          <div class="app-skills-chips">${chipsHtml}</div>
        </div>
      `;
    }).join("");

    contentEl.innerHTML = `
      <div class="app-skills">
        ${sectionsHtml}
      </div>
    `;
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
