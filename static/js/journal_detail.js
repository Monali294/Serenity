/* ============================================================
   journal_detail.js
   Page-specific interactions for journal_detail.html.

   Fully self-contained — does not depend on script.js.

   Responsibilities:
   0. Theme toggle (light/dark), synced with the shared localStorage
      keys used across the rest of the app
   1. Staggered fade-in / slide-up reveal for .jd-reveal sections
   2. Accessible custom delete-confirmation modal that submits
      the existing #jdDeleteForm to its unchanged Flask route
   ============================================================ */

document.addEventListener('DOMContentLoaded', function () {

  /* --------------------------------------------------------
     0. Theme toggle
     -------------------------------------------------------- */
  var themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var html = document.documentElement;
      var next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('serenity-theme', next);
      localStorage.setItem('serenityTheme', next);
    });
  }

  /* --------------------------------------------------------
     1. Staggered reveal animation
     -------------------------------------------------------- */
  var revealEls = document.querySelectorAll('.jd-reveal');

  revealEls.forEach(function (el, index) {
    window.setTimeout(function () {
      el.classList.add('jd-revealed');
    }, index * 110);
  });

  /* --------------------------------------------------------
     2. Delete confirmation modal
     -------------------------------------------------------- */
  var deleteForm    = document.getElementById('jdDeleteForm');
  var deleteTrigger = document.getElementById('jdDeleteTrigger');
  var modalOverlay  = document.getElementById('jdModalOverlay');
  var modalCancel   = document.getElementById('jdModalCancel');
  var modalConfirm  = document.getElementById('jdModalConfirm');

  if (!deleteForm || !deleteTrigger || !modalOverlay || !modalCancel || !modalConfirm) {
    return; // Fail safely if markup is missing.
  }

  var lastFocusedElement = null;

  function getFocusableModalElements() {
    return modalOverlay.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
  }

  function openModal() {
    lastFocusedElement = document.activeElement;

    modalOverlay.hidden = false;
    modalOverlay.setAttribute('aria-hidden', 'false');

    window.requestAnimationFrame(function () {
      modalOverlay.classList.add('jd-modal-visible');
    });

    modalConfirm.focus();
    document.addEventListener('keydown', onKeydown);
  }

  function closeModal() {
    modalOverlay.classList.remove('jd-modal-visible');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onKeydown);

    window.setTimeout(function () {
      modalOverlay.hidden = true;
    }, 200);

    if (lastFocusedElement) {
      lastFocusedElement.focus();
    } else {
      deleteTrigger.focus();
    }
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      closeModal();
      return;
    }

    if (e.key === 'Tab') {
      var focusable = getFocusableModalElements();
      if (focusable.length === 0) return;

      var first = focusable[0];
      var last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  deleteTrigger.addEventListener('click', openModal);
  modalCancel.addEventListener('click', closeModal);

  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) {
      closeModal();
    }
  });

  modalConfirm.addEventListener('click', function () {
    // Submits the ORIGINAL form as-is — same action, method,
    // and csrf_token input. Nothing altered here.
    deleteForm.submit();
  });

});