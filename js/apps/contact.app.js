/**
 * contact.app.js
 * ------------------------------------------------------------------
 * The "Contact" portfolio app — contact info plus a simple
 * client-side-only form. Same registration/factory/window pattern
 * as every other app (see about.app.js for the full architecture
 * note).
 *
 * IMPORTANT: this form does NOT actually send anything anywhere.
 * There is no backend in this project (it's a static browser-based
 * OS simulation), so submitting just shows a local confirmation
 * message. Wiring this up to a real email service (e.g. mailto:,
 * or a third-party form endpoint) is a deliberate non-goal of this
 * phase — Phase 5's job is the app system, not real form delivery.
 * ------------------------------------------------------------------
 */

(function registerContactApp() {
  const APP_ID = "contact";

  // See about.app.js for why registration must wait for
  // "kernel:ready" rather than firing immediately at script-load time.
  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Contact Me",
      icon: "icon.contact",
      singleInstance: true,
      factory: contactAppFactory
    });
  });

  function contactAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      renderContact(payload.contentEl);
    });

    ctx.emit("window:create", {
      title: "Contact Me",
      icon: "icon.contact",
      width: 420,
      height: 420
    });
  }

  function renderContact(contentEl) {
    contentEl.innerHTML = `
      <div class="app-contact">
        <div class="app-contact-info">
          <p><strong>Email:</strong> schlokanovsky@gmail.com</p>
          <p><strong>GitHub:</strong> github.com/S-Jouskaa</p>
          <p><strong>LinkedIn:</strong> linkedin.com/in/adhilokaaa</p>
        </div>
        <hr class="app-contact-divider" />
        <form class="app-contact-form" novalidate>
          <label class="app-contact-label" for="contact-name">Name</label>
          <input class="app-contact-input" id="contact-name" name="name" type="text" required />

          <label class="app-contact-label" for="contact-email">Email</label>
          <input class="app-contact-input" id="contact-email" name="email" type="email" required />

          <label class="app-contact-label" for="contact-message">Message</label>
          <textarea class="app-contact-textarea" id="contact-message" name="message" rows="4" required></textarea>

          <button type="submit" class="app-contact-submit">Send Message</button>
          <div class="app-contact-status" aria-live="polite"></div>
        </form>
      </div>
    `;

    const form = contentEl.querySelector(".app-contact-form");
    const statusEl = contentEl.querySelector(".app-contact-status");

    form.addEventListener("submit", (e) => {
      // No backend exists in this project. preventDefault() stops the
      // browser from attempting a real HTTP submission (which would
      // just fail/reload), and we show a local-only confirmation
      // instead — this is explicitly a simulated send, not a real one.
      e.preventDefault();

      const name = form.querySelector("#contact-name").value.trim();
      if (!name) {
        statusEl.textContent = "Please enter your name before sending.";
        statusEl.classList.add("error");
        return;
      }

      statusEl.classList.remove("error");
      statusEl.textContent = `Thanks, ${name}! This is a demo form — no message was actually sent.`;
      form.reset();
    });
  }
})();
