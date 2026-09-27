/**
 * register.js – Serenity Mental Wellness App
 * All register-page behaviour lives here.
 * No global variables are exposed; everything is wrapped in an IIFE.
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════
     1. FLOATING PARTICLES
  ═══════════════════════════════════════════════ */

  (function initParticles() {
    const canvas = document.getElementById('register-particles');
    if (!canvas) return;

    const ctx    = canvas.getContext('2d');
    let   W, H, particles;

    /* Palette-aware colours */
    const LIGHT_COLOURS = ['rgba(124,92,191,', 'rgba(192,107,184,', 'rgba(200,160,230,'];
    const DARK_COLOURS  = ['rgba(160,123,224,', 'rgba(214,143,212,', 'rgba(100,70,180,' ];

    function getColours() {
      return document.documentElement.getAttribute('data-theme') === 'dark'
        ? DARK_COLOURS : LIGHT_COLOURS;
    }

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function mkParticle() {
      const colours = getColours();
      return {
        x     : Math.random() * W,
        y     : Math.random() * H,
        r     : Math.random() * 3.5 + 1,
        dx    : (Math.random() - 0.5) * 0.4,
        dy    : (Math.random() - 0.5) * 0.4,
        alpha : Math.random() * 0.45 + 0.1,
        colour: colours[Math.floor(Math.random() * colours.length)],
      };
    }

    function buildParticles() {
      const count = Math.min(Math.floor((W * H) / 14000), 90);
      particles = Array.from({ length: count }, mkParticle);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = p.colour + p.alpha + ')';
        ctx.fill();

        p.x += p.dx;
        p.y += p.dy;

        /* Wrap edges */
        if (p.x < -p.r)  p.x = W + p.r;
        if (p.x > W + p.r) p.x = -p.r;
        if (p.y < -p.r)  p.y = H + p.r;
        if (p.y > H + p.r) p.y = -p.r;
      });

      requestAnimationFrame(draw);
    }

    resize();
    buildParticles();
    draw();

    window.addEventListener('resize', () => { resize(); buildParticles(); });
  })();


  /* ═══════════════════════════════════════════════
     2. DARK / LIGHT MODE TOGGLE
  ═══════════════════════════════════════════════ */

  (function initTheme() {
    const toggle    = document.getElementById('themeToggle');
    const icon      = document.getElementById('themeIcon');
    const html      = document.documentElement;
    const STORE_KEY = 'serenityTheme';

    function applyTheme(theme) {
      html.setAttribute('data-theme', theme);
      icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
      localStorage.setItem(STORE_KEY, theme);
    }

    /* Persist theme across pages */
    const saved = localStorage.getItem(STORE_KEY)
      || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(saved);

    toggle.addEventListener('click', () => {
      applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });
  })();


  /* ═══════════════════════════════════════════════
     3. SHOW / HIDE PASSWORD TOGGLES
  ═══════════════════════════════════════════════ */

  function initEye(btnId, inputId) {
    const btn   = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    if (!btn || !input) return;

    btn.addEventListener('click', () => {
        console.log(btnId + " clicked");
      const isHidden = input.type === 'password';
      input.type     = isHidden ? 'text' : 'password';
      btn.innerHTML  = isHidden
        ? '<i class="fa-regular fa-eye-slash"></i>'
        : '<i class="fa-regular fa-eye"></i>';
      btn.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
    });
  }

  initEye('eyePassword', 'passwordInput');
  initEye('eyeConfirm',  'confirmPasswordInput');


  /* ═══════════════════════════════════════════════
     4. VALIDATION HELPERS
  ═══════════════════════════════════════════════ */

  /**
   * Show feedback beneath a field.
   * @param {string} id      – id of the .sr-feedback element
   * @param {string} msg     – message text (empty string clears)
   * @param {'valid'|'invalid'|''} state
   */
  function setFeedback(id, msg, state) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg;
    el.className   = 'sr-feedback' + (state ? (' ' + state) : '');
  }

  function setInputState(input, state) {
    input.classList.remove('is-valid', 'is-invalid');
    if (state) input.classList.add('is-' + state);
  }

  /** Basic email regex (RFC-5322 subset) */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;


  /* ═══════════════════════════════════════════════
     5. INDIVIDUAL FIELD VALIDATORS
     Each returns true if the field is valid.
  ═══════════════════════════════════════════════ */

  function validateName() {
    const input = document.getElementById('nameInput');
    const val   = input.value.trim();

    if (!val) {
      setInputState(input, 'invalid');
      setFeedback('nameFeedback', 'Full name is required.', 'invalid');
      return false;
    }
    if (val.length < 3) {
      setInputState(input, 'invalid');
      setFeedback('nameFeedback', 'Name must be at least 3 characters.', 'invalid');
      return false;
    }
    setInputState(input, 'valid');
    setFeedback('nameFeedback', '✓ Looks good!', 'valid');
    return true;
  }

  function validateEmail() {
    const input = document.getElementById('emailInput');
    const val   = input.value.trim();

    if (!val) {
      setInputState(input, 'invalid');
      setFeedback('emailFeedback', 'Email address is required.', 'invalid');
      return false;
    }
    if (!EMAIL_RE.test(val)) {
      setInputState(input, 'invalid');
      setFeedback('emailFeedback', 'Please enter a valid email address.', 'invalid');
      return false;
    }
    setInputState(input, 'valid');
    setFeedback('emailFeedback', '✓ Email looks valid!', 'valid');
    return true;
  }

  /* ── Password strength scoring ── */

  const PW_RULES = [
    { id: 'hint-length',  label: '8+ characters',     test: v => v.length >= 8             },
    { id: 'hint-upper',   label: 'Uppercase letter',   test: v => /[A-Z]/.test(v)           },
    { id: 'hint-lower',   label: 'Lowercase letter',   test: v => /[a-z]/.test(v)           },
    { id: 'hint-digit',   label: 'Number',             test: v => /[0-9]/.test(v)           },
    { id: 'hint-special', label: 'Special character',  test: v => /[^A-Za-z0-9]/.test(v)   },
  ];

  const STRENGTH_META = [
    { label: '',          colour: '' },
    { label: 'Weak',      colour: '#e05580' },
    { label: 'Fair',      colour: '#f0a500' },
    { label: 'Good',      colour: '#5cb8c4' },
    { label: 'Strong',    colour: '#5cb85c' },
  ];

  function updateStrengthMeter(val) {
    const bar       = document.getElementById('strengthBar');
    const labelEl   = document.getElementById('strengthLabel');
    let   score     = 0;

    PW_RULES.forEach(rule => {
      const met  = rule.test(val);
      const hint = document.getElementById(rule.id);
      if (!hint) return;

      score += met ? 1 : 0;
      hint.className = met ? 'met' : 'unmet';
      const icon = hint.querySelector('i');
      if (icon) icon.className = met ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark';
    });

    /* Score is 0-5; cap bar levels at 4 */
    const level = Math.min(score, 4);
    bar.className = 'strength-bar-fill strength-' + level;

    const meta = STRENGTH_META[level];
    labelEl.textContent = val.length ? ('Strength: ' + meta.label) : 'Password strength';
    labelEl.style.color = meta.colour || 'var(--sr-muted)';
  }

  function validatePassword() {
    const input = document.getElementById('passwordInput');
    const val   = input.value;

    updateStrengthMeter(val);

    if (!val) {
      setInputState(input, 'invalid');
      setFeedback('passwordFeedback', 'Password is required.', 'invalid');
      return false;
    }

    const failed = PW_RULES.filter(r => !r.test(val));
    if (failed.length) {
      setInputState(input, 'invalid');
      setFeedback('passwordFeedback', 'Password doesn\'t meet all requirements yet.', 'invalid');
      return false;
    }

    setInputState(input, 'valid');
    setFeedback('passwordFeedback', '✓ Strong password!', 'valid');
    return true;
  }

  function validateConfirm() {
    const pw      = document.getElementById('passwordInput').value;
    const input   = document.getElementById('confirmPasswordInput');
    const confirm = input.value;

    if (!confirm) {
      setInputState(input, 'invalid');
      setFeedback('confirmFeedback', 'Please confirm your password.', 'invalid');
      return false;
    }
    if (pw !== confirm) {
      setInputState(input, 'invalid');
      setFeedback('confirmFeedback', 'Passwords do not match.', 'invalid');
      return false;
    }
    setInputState(input, 'valid');
    setFeedback('confirmFeedback', '✓ Passwords match!', 'valid');
    return true;
  }

  function validateTerms() {
    const cb = document.getElementById('termsCheck');
    if (!cb.checked) {
      setFeedback('termsFeedback', 'You must accept the terms to continue.', 'invalid');
      return false;
    }
    setFeedback('termsFeedback', '', '');
    return true;
  }


  /* ═══════════════════════════════════════════════
     6. LIVE VALIDATION LISTENERS
  ═══════════════════════════════════════════════ */

  function onBlur(inputId, fn) {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener('blur', fn);
  }

  function onInput(inputId, fn) {
    const el = document.getElementById(inputId);
    if (el) el.addEventListener('input', fn);
  }

  onBlur('nameInput',            validateName);
  onBlur('emailInput',           validateEmail);
  onBlur('passwordInput',        validatePassword);
  onBlur('confirmPasswordInput', validateConfirm);

  /* Live feedback while typing */
  onInput('nameInput',            validateName);
  onInput('emailInput',           validateEmail);
  onInput('passwordInput',        () => { validatePassword(); validateConfirm(); });
  onInput('confirmPasswordInput', validateConfirm);

  /* Terms checkbox */
  const termsEl = document.getElementById('termsCheck');
  if (termsEl) termsEl.addEventListener('change', validateTerms);


  /* ═══════════════════════════════════════════════
     7. FORM SUBMIT  —  loading + success animations
  ═══════════════════════════════════════════════ */

  const form = document.getElementById('registerForm');
if (form) {
  form.addEventListener('submit', function (e) {

    const valid =
      validateName() &
      validateEmail() &
      validatePassword() &
      validateConfirm() &
      validateTerms();

    if (!valid) {
      e.preventDefault();

      const card = document.querySelector('.register-card');
      if (card) {
        card.style.animation = 'none';
        requestAnimationFrame(() => {
          card.style.animation = 'cardShake .4s ease';
        });
      }
      return;
    }

    // Show loading spinner
    const btn = document.getElementById('registerBtn');
    const btnText = document.getElementById('btnText');
    const spinner = document.getElementById('btnSpinner');

    if (btn && btnText && spinner) {
      btn.disabled = true;
      btnText.style.display = 'none';
      spinner.style.display = 'block';
    }

    // No e.preventDefault() here!
    // Form submits directly to Flask
  });
}


  /* ═══════════════════════════════════════════════
     8. CARD SHAKE KEYFRAME (injected once)
  ═══════════════════════════════════════════════ */

  (function injectShakeKeyframe() {
    if (document.getElementById('sr-shake-style')) return;
    const style = document.createElement('style');
    style.id    = 'sr-shake-style';
    style.textContent = `
      @keyframes cardShake {
        0%,100% { transform: translateX(0);  }
        20%      { transform: translateX(-7px); }
        40%      { transform: translateX(7px);  }
        60%      { transform: translateX(-5px); }
        80%      { transform: translateX(5px);  }
      }
    `;
    document.head.appendChild(style);
  })();


  /* ═══════════════════════════════════════════════
     9. ACCESSIBILITY — trap focus in card on mobile
  ═══════════════════════════════════════════════ */

  (function trapFocus() {
    const card = document.querySelector('.register-card');
    if (!card) return;

    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;

      const focusable = card.querySelectorAll(
        'input, button, a, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  })();

})();
