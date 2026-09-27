/* =========================================================
   SERENITY — dashboard.js
   Modular, self-contained. Guards every DOM call.
   Relies on theme toggle already handled by script.js.
   ========================================================= */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     0. THEME TOGGLE
        Self-contained: does not depend on script.js.
        Writes to both localStorage keys used across the app
        ('serenity-theme' on landing/register JS variants,
        'serenityTheme' used by register.js) so the choice
        stays in sync no matter which page it was set from.
  ═══════════════════════════════════════════════ */
  (function initThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    const html   = document.documentElement;
    if (!toggle) return;

    function applyTheme(theme) {
      html.setAttribute('data-theme', theme);
      localStorage.setItem('serenity-theme', theme);
      localStorage.setItem('serenityTheme', theme);
    }

    toggle.addEventListener('click', function () {
      const current = html.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  })();


  /* ═══════════════════════════════════════════════
     1. DYNAMIC GREETING
  ═══════════════════════════════════════════════ */
  (function initGreeting() {
    const date  = document.getElementById('dateLabel');
    if (date) {
      const now  = new Date();
      const opts = { weekday: 'long', month: 'long', day: 'numeric' };
      date.textContent = now.toLocaleDateString('en-IN', opts);
    }
  })();


  /* ═══════════════════════════════════════════════
   2. MOOD CHECK-IN
═══════════════════════════════════════════════ */
(function initMood() {

    const grid = document.getElementById("moodGrid");
    const resetBtn = document.getElementById("moodResetBtn");

    if (!grid) return;

    const btns = Array.from(grid.querySelectorAll(".sr-mood-btn"));

    // Check if Flask has already marked today's mood
    let selected = grid.querySelector(".sr-mood-btn.selected");

    if (selected) {

        btns.forEach(btn => {

            if (btn !== selected) {
                btn.classList.add("dimmed");
                btn.setAttribute("aria-pressed", "false");
            }

        });

        selected.setAttribute("aria-pressed", "true");

        if (resetBtn)
            resetBtn.classList.remove("d-none");
    }

    function selectMood(btn) {

        if (selected) {

            showToast(
                "Mood Already Saved 😊",
                "You have already checked in today.",
                "fa-circle-info"
            );

            return;
        }

        const mood = btn.dataset.label;

        fetch("/save_mood", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "X-CSRFToken": document.querySelector('meta[name="csrf-token"]').content
            },
            body: "mood=" + encodeURIComponent(mood)
        })

        .then(response => response.json())

        .then(data => {

            if (data.status === "success") {

                selected = btn;

                btn.classList.add("selected");
                btn.classList.add("rippling");

                btn.addEventListener(
                    "animationend",
                    () => btn.classList.remove("rippling"),
                    { once: true }
                );

                btn.setAttribute("aria-pressed", "true");

                btns.forEach(b => {

                    if (b !== btn) {

                        b.classList.add("dimmed");
                        b.setAttribute("aria-pressed", "false");

                    }

                });

                if (resetBtn)
                    resetBtn.classList.remove("d-none");

                showToast(
                    "Mood Saved 🌿",
                    data.message,
                    "fa-heart"
                );

            }

            else {

                showToast(
                    "Error",
                    "Unable to save mood.",
                    "fa-circle-exclamation"
                );

            }

        })

        .catch(error => {

            console.error(error);

            showToast(
                "Server Error",
                "Could not connect to server.",
                "fa-circle-exclamation"
            );

        });

    }

    function resetMood() {

        selected = null;

        btns.forEach(btn => {

            btn.classList.remove("selected");
            btn.classList.remove("dimmed");

            btn.setAttribute("aria-pressed", "false");

        });

        if (resetBtn)
            resetBtn.classList.add("d-none");

    }

    grid.addEventListener("click", function(e) {

        const btn = e.target.closest(".sr-mood-btn");

        if (btn)
            selectMood(btn);

    });

    grid.addEventListener("keydown", function(e) {

        const btn = e.target.closest(".sr-mood-btn");

        if (btn && (e.key === "Enter" || e.key === " ")) {

            e.preventDefault();
            selectMood(btn);

        }

    });

    if (resetBtn)
        resetBtn.addEventListener("click", resetMood);

})();


  /* ═══════════════════════════════════════════════
     3. WELLNESS SCORE ANIMATION
  ═══════════════════════════════════════════════ */
  (function initWellnessScore() {
    const arc      = document.getElementById('scoreArc');
    const numEl    = document.getElementById('scoreNum');
    if (!arc || !numEl) return;

    /* Inject SVG gradient definition */
    const ns   = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const lg   = document.createElementNS(ns, 'linearGradient');
    lg.setAttribute('id', 'scoreGrad');
    lg.setAttribute('x1', '0%'); lg.setAttribute('y1', '0%');
    lg.setAttribute('x2', '100%'); lg.setAttribute('y2', '0%');
    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#8C7AD6');
    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#C566A6');
    lg.appendChild(stop1);
    lg.appendChild(stop2);
    defs.appendChild(lg);
    arc.closest('svg').prepend(defs);

    const TARGET     = parseInt(numEl.textContent, 10) || 0;
    const CIRCUMF    = 326.73;
    const DURATION   = 1600; // ms
    let start        = null;

    function animFrame(ts) {
      if (!start) start = ts;
      const progress  = Math.min((ts - start) / DURATION, 1);
      const eased     = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current   = Math.round(TARGET * eased);
      const offset    = CIRCUMF - (CIRCUMF * current / 100);

      arc.style.strokeDashoffset = offset;
      numEl.textContent           = current;

      if (progress < 1) requestAnimationFrame(animFrame);
    }

    /* Trigger when card enters viewport */
    const card = arc.closest('.sr-score-card');
    if (!card) { requestAnimationFrame(animFrame); return; }

    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        requestAnimationFrame(animFrame);
        observer.disconnect();
      }
    }, { threshold: 0.4 });
    observer.observe(card);
  })();


  /* ═══════════════════════════════════════════════
     4. DAILY MOTIVATION QUOTES
  ═══════════════════════════════════════════════ */
  (function initMotivation() {
    const el = document.getElementById('motivationQuote');
    if (!el) return;

    const quotes = [
      'Small consistent steps create lasting change.',
      'You don\'t have to be perfect to be worthy of care.',
      'Rest is not weakness. It is wisdom.',
      'Healing is not linear, and that is perfectly okay.',
      'Every morning you choose yourself again. That counts.',
      'Being kind to yourself is the first act of courage.',
      'Your progress is real, even when you can\'t see it yet.',
      'The gentlest pace is still forward.',
    ];

    /* Pick quote based on day-of-year for daily consistency */
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
    el.textContent  = quotes[dayOfYear % quotes.length];
  })();


  /* ═══════════════════════════════════════════════
     5. TOAST HELPER (reusable across the dashboard)
  ═══════════════════════════════════════════════ */
  function showToast(title, message, iconClass = 'fa-check') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'sr-toast';
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <div class="sr-toast-icon"><i class="fa-solid ${iconClass}"></i></div>
      <div class="sr-toast-body">
        <p class="sr-toast-title">${title}</p>
        <p class="sr-toast-msg">${message}</p>
      </div>`;

    container.appendChild(toast);

    /* Auto-dismiss after 4 s */
    setTimeout(() => {
      toast.classList.add('toast-out');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, 4000);
  }

  /* Expose for potential use in other scripts */
  window.serenityToast = showToast;


  /* ═══════════════════════════════════════════════
     6. SCROLL REVEAL
        Self-contained: does not depend on script.js.
        Fades/slides .reveal elements in as they enter view.
  ═══════════════════════════════════════════════ */
  (function initReveal() {
    const revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;

    if (!('IntersectionObserver' in window)) {
      /* No IntersectionObserver support: just show everything */
      revealEls.forEach(el => el.classList.add('visible'));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });

    revealEls.forEach(el => observer.observe(el));
  })();


  /* ═══════════════════════════════════════════════
     7. QUICK ACCESS — click ripple feedback
  ═══════════════════════════════════════════════ */
  (function initQuickAccess() {
    document.querySelectorAll('.sr-quick-card').forEach(card => {
      card.addEventListener('click', function () {
        /* Pulse the card briefly */
        this.style.transition = 'transform 0.12s ease, box-shadow 0.12s ease';
        this.style.transform  = 'scale(0.97) translateY(-6px)';
        setTimeout(() => {
          this.style.transform  = '';
          this.style.transition = '';
        }, 140);
      });
    });
  })();

})();