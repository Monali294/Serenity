/* =========================================================================
   Serenity — Landing Page Behavior (v2 redesign)
   Independent of the project's global script.js.
   Handles: theme toggle (persisted), navbar scroll state, mobile nav,
   scroll-reveal animations, and the breathing orb label.
   ========================================================================= */

document.addEventListener('DOMContentLoaded', function () {

  /* ---------- 1. Theme toggle (light/dark only, saved to localStorage) ---------- */
  var root = document.documentElement;
  var themeToggle = document.getElementById('themeToggle');
  var THEME_KEY = 'serenity-theme';

  function applyTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }

  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------- 2. Navbar becomes solid once the page is scrolled ---------- */
  var nav = document.getElementById('serenityNav');

  function updateNavState() {
    if (!nav) return;
    if (window.scrollY > 12) {
      nav.classList.add('scrolled');
    } else {
      nav.classList.remove('scrolled');
    }
  }

  updateNavState();
  window.addEventListener('scroll', updateNavState, { passive: true });

  /* ---------- 3. Mobile nav panel ---------- */
  var navToggleBtn = document.getElementById('navToggleBtn');
  var mobilePanel = document.getElementById('mobileNavPanel');

  if (navToggleBtn && mobilePanel) {
    navToggleBtn.addEventListener('click', function () {
      var isOpen = mobilePanel.classList.toggle('open');
      navToggleBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    });

    /* Close the mobile panel once a link is tapped */
    mobilePanel.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobilePanel.classList.remove('open');
        navToggleBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ---------- 4. Scroll-reveal: fade/slide elements in as they enter view ---------- */
  var revealEls = document.querySelectorAll('.reveal');

  if ('IntersectionObserver' in window && revealEls.length) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    revealEls.forEach(function (el) { revealObserver.observe(el); });
  } else {
    /* Fallback: if IntersectionObserver isn't supported, just show everything */
    revealEls.forEach(function (el) { el.classList.add('visible'); });
  }

  /* ---------- 5. Breathing orb label: "Breathe In" / "Breathe Out" ---------- */
  var breathLabel = document.getElementById('breathLabel');

  if (breathLabel) {
    var breathingIn = true;
    setInterval(function () {
      breathingIn = !breathingIn;
      breathLabel.textContent = breathingIn ? 'Breathe In' : 'Breathe Out';
    }, 4000); /* matches the 8s orb animation: 4s in, 4s out */
  }

  /* ---------- 6. Footer year, kept in sync automatically ---------- */
  var yearEl = document.getElementById('footerYear');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

});