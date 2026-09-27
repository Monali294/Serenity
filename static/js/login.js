/* =========================================================
   SERENITY — script.js ADDITIONS (login page)
   APPEND this entire block to the bottom of script.js.
   The existing DOMContentLoaded listener handles:
     - theme toggle  (id="themeToggle")
     - particles     (id="particles")
     - smooth scroll
     - scroll reveal (.reveal)
   This block adds login-page-specific behaviour only.
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {

  /* Guard — only run when the login form is present */
  const loginForm = document.getElementById('loginForm');
  if (!loginForm) return;

  /* ── Cache DOM refs ── */
  const loginBtn       = document.getElementById('loginBtn');
  const loginEmail     = document.getElementById('loginEmail');
  const loginPassword  = document.getElementById('loginPassword');
  const togglePassword = document.getElementById('togglePassword');
  const eyeIcon        = document.getElementById('eyeIcon');
  const authAlert      = document.getElementById('authAlert');

  /* ================================================================
     SHOW / HIDE PASSWORD TOGGLE
     ================================================================ */
  if (togglePassword && loginPassword && eyeIcon) {
    togglePassword.addEventListener('click', () => {
      const isHidden = loginPassword.type === 'password';

      loginPassword.type = isHidden ? 'text' : 'password';

      /* Swap eye icon with a subtle scale pop */
      eyeIcon.style.transform = 'scale(0.7)';
      setTimeout(() => {
        eyeIcon.className = isHidden ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
        eyeIcon.style.transform = 'scale(1)';
      }, 120);

      togglePassword.setAttribute(
        'aria-label',
        isHidden ? 'Hide password' : 'Show password'
      );
    });
  }

  /* ================================================================
     ALERT HELPER
     Injects a Bootstrap-style dismissible alert into #authAlert.
     ================================================================ */
  function showAuthAlert(message, type = 'danger') {
    if (!authAlert) return;

    const iconMap = {
      danger:  'fa-circle-exclamation',
      success: 'fa-circle-check',
      warning: 'fa-triangle-exclamation',
      info:    'fa-circle-info',
    };
    const icon = iconMap[type] || 'fa-circle-info';

    authAlert.innerHTML = `
      <div class="alert alert-serenity alert-${type} alert-dismissible fade show mb-3" role="alert">
        <i class="fa-solid ${icon} me-2" aria-hidden="true"></i>${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>`;
  }

  /* ================================================================
     FIELD VALIDATION HELPERS
     ================================================================ */
  function markInvalid(input) {
    input.classList.add('is-invalid');
    input.classList.remove('is-valid');
  }
  function markValid(input) {
    input.classList.add('is-valid');
    input.classList.remove('is-invalid');
  }
  function clearMark(input) {
    input.classList.remove('is-invalid', 'is-valid');
  }

  /* Live clearing: remove error state as user types */
  [loginEmail, loginPassword].forEach(input => {
    if (!input) return;
    input.addEventListener('input', () => {
      clearMark(input);
      if (authAlert) authAlert.innerHTML = '';
    });
  });

  /* ================================================================
     CLIENT-SIDE VALIDATION
     Returns true if form passes; false + shows errors if not.
     Flask still validates server-side — this is UX-only.
     ================================================================ */
  function validateLoginForm() {
    let valid = true;
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!loginEmail.value.trim() || !emailRx.test(loginEmail.value.trim())) {
      markInvalid(loginEmail);
      valid = false;
    } else {
      markValid(loginEmail);
    }

    if (!loginPassword.value.trim()) {
      markInvalid(loginPassword);
      valid = false;
    } else {
      markValid(loginPassword);
    }

    if (!valid) {
      showAuthAlert('Please enter a valid email and password.', 'warning');
      /* Focus first invalid field */
      const firstInvalid = loginForm.querySelector('.is-invalid');
      if (firstInvalid) firstInvalid.focus();
    }

    return valid;
  }

  /* ================================================================
     FORM SUBMIT — loading state + validation gate
     ================================================================ */
  loginForm.addEventListener('submit', (e) => {
    if (!validateLoginForm()) {
      e.preventDefault(); /* Block submission; Flask never sees invalid data */
      return;
    }

    /* Activate loading state — form submits naturally to Flask */
    if (loginBtn) {
      loginBtn.classList.add('is-loading');
      loginBtn.disabled = true;

      /*
       * Safety timeout: re-enable button after 12 s in case Flask
       * returns an error and doesn't redirect (no page reload on error
       * in some setups with fetch-based forms).
       */
      setTimeout(() => {
        loginBtn.classList.remove('is-loading');
        loginBtn.disabled = false;
      }, 12000);
    }
  });

  /* ================================================================
     ACCESSIBILITY — clear validation marks on focus
     Prevents stale red/green outlines from previous session.
     ================================================================ */
  [loginEmail, loginPassword].forEach(input => {
    if (!input) return;
    input.addEventListener('focus', () => {
      /* Remove valid state on re-focus so the glow doesn't distract */
      input.classList.remove('is-valid');
    });
  });

});
document.addEventListener("DOMContentLoaded", function () {

    const themeToggle = document.getElementById("themeToggle");

    if (!themeToggle) return;

    // Load saved theme
    const savedTheme = localStorage.getItem("serenity-theme");

    if (savedTheme) {
        document.documentElement.setAttribute("data-theme", savedTheme);
    } else {
        document.documentElement.setAttribute("data-theme", "light");
    }

    // Toggle theme
    themeToggle.addEventListener("click", function () {

        const currentTheme =
            document.documentElement.getAttribute("data-theme");

        const newTheme =
            currentTheme === "dark" ? "light" : "dark";

        document.documentElement.setAttribute("data-theme", newTheme);

        localStorage.setItem("serenity-theme", newTheme);
    });

});