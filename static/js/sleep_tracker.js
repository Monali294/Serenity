/* =====================================================
   SERENITY SLEEP TRACKER — FRONTEND LOGIC
   Frontend-only. Ready for Flask integration.
   No backend calls are made yet.
===================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------------------------------------------
     THEME TOGGLE
     Self-contained: does not depend on script.js.
     Writes to both localStorage keys used across the app.
  --------------------------------------------------- */
  const themeToggleBtn = document.getElementById('themeToggle');
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      html.setAttribute('data-theme', next);
      localStorage.setItem('serenity-theme', next);
      localStorage.setItem('serenityTheme', next);
    });
  }

  /* ---------------------------------------------------
     ELEMENT REFERENCES
  --------------------------------------------------- */
  const sleepStartInput   = document.getElementById('sleepStart');
  const wakeTimeInput     = document.getElementById('wakeTime');
  const durationDisplay   = document.getElementById('durationDisplay');
  const durationValueEl   = document.getElementById('sleepDuration');
  const qualityGroup      = document.getElementById('sleepQualityGroup');
  const qualityOptions    = Array.from(document.querySelectorAll('.quality-option'));
  const qualityHiddenInput = document.getElementById('sleepQuality');
  const saveBtn           = document.getElementById('saveSleepBtn');
  const resetBtn          = document.getElementById('sleepResetBtn');
  const sleepForm         = document.getElementById('sleepForm');
  const toastContainer    = document.getElementById('toastContainer');

  /* ---------------------------------------------------
     STATE
  --------------------------------------------------- */
  let selectedQuality = null; // human-readable label sent to Flask, e.g. 'Restless'
  let selectedQualityKey = null; // raw key used to look up toast copy, e.g. 'restless'
  let durationMinutes = null;

  /* ---------------------------------------------------
     DURATION CALCULATION
     Handles overnight sleep: if wake time <= sleep time,
     treat wake time as occurring the next calendar day.
  --------------------------------------------------- */
  function timeStringToMinutes(timeStr) {
    if (!timeStr) return null;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours * 60) + minutes;
  }

  function formatDuration(totalMinutes) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    const hourLabel = `${hours} Hour${hours === 1 ? '' : 's'}`;
    if (minutes === 0) return hourLabel;

    const minuteLabel = `${minutes} Minute${minutes === 1 ? '' : 's'}`;
    return `${hourLabel} ${minuteLabel}`;
  }

  function calculateDuration() {
    const sleepStr = sleepStartInput.value;
    const wakeStr = wakeTimeInput.value;

    if (!sleepStr || !wakeStr) {
      durationValueEl.textContent = 'Select both times to calculate';
      durationValueEl.setAttribute('data-duration-minutes', '');
      durationDisplay.classList.remove('has-value');
      durationMinutes = null;
      evaluateSaveButtonState();
      return;
    }

    const sleepMinutes = timeStringToMinutes(sleepStr);
    let wakeMinutes = timeStringToMinutes(wakeStr);

    // Overnight handling: if wake time is earlier than or equal to
    // sleep time, treat wake time as falling on the next day.
    if (wakeMinutes <= sleepMinutes) {
      wakeMinutes += 24 * 60;
    }

    const totalMinutes = wakeMinutes - sleepMinutes;
    durationMinutes = totalMinutes;

    durationValueEl.textContent = formatDuration(totalMinutes);
    durationValueEl.setAttribute('data-duration-minutes', String(totalMinutes));
    durationDisplay.classList.add('has-value');

    evaluateSaveButtonState();
  }

  sleepStartInput.addEventListener('input', calculateDuration);
  wakeTimeInput.addEventListener('input', calculateDuration);
  sleepStartInput.addEventListener('change', calculateDuration);
  wakeTimeInput.addEventListener('change', calculateDuration);

  /* ---------------------------------------------------
     SLEEP QUALITY SELECTOR
     Same interaction pattern as Mood Tracker:
     ripple, single-select, dim non-selected, keyboard nav.
  --------------------------------------------------- */
  function selectQuality(option) {
    qualityOptions.forEach(opt => {
      const isSelected = opt === option;
      opt.classList.toggle('selected', isSelected);
      opt.setAttribute('aria-checked', String(isSelected));
      opt.setAttribute('tabindex', isSelected ? '0' : '-1');
    });

    qualityGroup.classList.add('has-selection');
    const qualityMap = {
    restless: "Restless",
    light: "Light Sleep",
    balanced: "Balanced",
    restorative: "Restorative",
    deep: "Deep Sleep"
};

selectedQuality = qualityMap[option.dataset.quality];
    selectedQualityKey = option.dataset.quality;
    qualityHiddenInput.value = selectedQuality;

    evaluateSaveButtonState();
  }

  function spawnRipple(option, event) {
    const rect = option.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';

    const size = Math.max(rect.width, rect.height);
    ripple.style.width = ripple.style.height = `${size}px`;

    // Support both mouse clicks and keyboard activation (center the ripple)
    const x = event && event.clientX
      ? event.clientX - rect.left - size / 2
      : rect.width / 2 - size / 2;
    const y = event && event.clientY
      ? event.clientY - rect.top - size / 2
      : rect.height / 2 - size / 2;

    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    option.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  }

  qualityOptions.forEach((option, index) => {
    option.addEventListener('click', (event) => {
      spawnRipple(option, event);
      selectQuality(option);
    });

    // Keyboard accessibility: arrow key navigation across the radiogroup
    option.addEventListener('keydown', (event) => {
      const key = event.key;

      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        spawnRipple(option, event);
        selectQuality(option);
        return;
      }

      if (key === 'ArrowRight' || key === 'ArrowDown') {
        event.preventDefault();
        const next = qualityOptions[(index + 1) % qualityOptions.length];
        next.focus();
      }

      if (key === 'ArrowLeft' || key === 'ArrowUp') {
        event.preventDefault();
        const prev = qualityOptions[(index - 1 + qualityOptions.length) % qualityOptions.length];
        prev.focus();
      }
    });
  });

  /* ---------------------------------------------------
     SAVE BUTTON ENABLE / DISABLE LOGIC
     Enabled only when sleep time, wake time, and
     sleep quality are all selected.
  --------------------------------------------------- */
  function evaluateSaveButtonState() {
    const isComplete = Boolean(sleepStartInput.value) &&
                        Boolean(wakeTimeInput.value) &&
                        Boolean(selectedQuality);

    saveBtn.disabled = !isComplete;
  }

  /* ---------------------------------------------------
     TOAST NOTIFICATIONS
     Same shared toast component as Mood Tracker.
  --------------------------------------------------- */
  const qualityToastMessages = {
    restless: { emoji: '😴', text: 'Sleep recorded. Your sleep seems restless. Try winding down earlier tonight.' },
    light: { emoji: '🌙', text: 'Sleep recorded. You got some rest. A relaxing bedtime routine may improve sleep quality.' },
    balanced: { emoji: '😌', text: 'Sleep recorded. Nice! Maintaining a regular sleep schedule can improve consistency.' },
    restorative: { emoji: '🌅', text: 'Great! Your sleep was restorative. Keep following your healthy habits.' },
    deep: { emoji: '🌟', text: 'Excellent! Deep sleep supports mood, focus, and emotional well-being.' }
  };

  /* Shared toast renderer — every toast on this page goes through here. */
  function spawnToast(emoji, text, variant) {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'serenity-toast' + (variant ? ' toast-' + variant : '');
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <span class="toast-emoji" aria-hidden="true">${emoji}</span>
      <span class="toast-text"></span>
    `;
    toast.querySelector('.toast-text').textContent = text; // textContent avoids HTML injection

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hide');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4500);
  }

  function showToast(quality) {
    const config = qualityToastMessages[quality];
    if (!config) return;
    spawnToast(config.emoji, config.text, 'success');
  }

  function showErrorToast(message) {
    spawnToast('⚠️', message || 'Unable to save sleep data. Please try again.', 'error');
  }

  /* ---------------------------------------------------
     VALIDATION
     Defensive checks run on submit, in addition to the
     saveBtn disabled-state gating during normal use.
  --------------------------------------------------- */
  function validateSleepForm() {
    if (!sleepStartInput.value) {
      showErrorToast('Please select what time you went to sleep.');
      sleepStartInput.focus();
      return false;
    }

    if (!wakeTimeInput.value) {
      showErrorToast('Please select what time you woke up.');
      wakeTimeInput.focus();
      return false;
    }

    if (!selectedQuality || !selectedQualityKey) {
      showErrorToast('Please choose how your sleep felt.');
      qualityOptions[0]?.focus();
      return false;
    }

    if (!durationMinutes || durationMinutes <= 0) {
      showErrorToast('Those times don\u2019t add up to a valid sleep duration. Please check them.');
      return false;
    }

    if (durationMinutes > 20 * 60) {
      showErrorToast('That\u2019s over 20 hours of sleep \u2014 please double-check your times.');
      return false;
    }

    return true;
  }

  /* ---------------------------------------------------
     FORM SUBMIT — SAVE SLEEP
  --------------------------------------------------- */
  sleepForm.addEventListener('submit', (event) => {
    event.preventDefault();

    if (saveBtn.disabled) return;
    if (!validateSleepForm()) return;

    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    if (!csrfMeta || !csrfMeta.content) {
      showErrorToast('Your session may have expired. Please refresh the page and try again.');
      return;
    }

    saveBtn.classList.add('loading');
    saveBtn.disabled = true;

    const formData = new URLSearchParams();
    formData.append('sleepStart', sleepStartInput.value);
    formData.append('wakeTime', wakeTimeInput.value);
    formData.append('sleepDurationMinutes', durationMinutes);
    formData.append('sleepQuality', selectedQuality);

    fetch('/save_sleep', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': csrfMeta.content
      },
      body: formData
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('Server responded with status ' + response.status);
        }
        return response.json();
      })
      .then((data) => {
        saveBtn.classList.remove('loading');
        saveBtn.disabled = false;

        if (data.status === 'success') {
          // Rich, quality-specific message via the Serenity toast component
          showToast(selectedQualityKey);
        } else {
          showErrorToast(data.message || 'Unable to save sleep data. Please try again.');
        }
      })
      .catch((error) => {
        console.error(error);
        saveBtn.classList.remove('loading');
        saveBtn.disabled = false;
        showErrorToast('Unable to reach the server. Please check your connection and try again.');
      });
  });

  /* ---------------------------------------------------
     RESET
  --------------------------------------------------- */
  resetBtn.addEventListener('click', () => {
    sleepForm.reset();

    qualityOptions.forEach(opt => {
      opt.classList.remove('selected');
      opt.setAttribute('aria-checked', 'false');
      opt.setAttribute('tabindex', '-1');
    });
    qualityOptions[0].setAttribute('tabindex', '0');
    qualityGroup.classList.remove('has-selection');

    selectedQuality = null;
    selectedQualityKey = null;
    qualityHiddenInput.value = '';
    durationMinutes = null;

    durationValueEl.textContent = 'Select both times to calculate';
    durationValueEl.setAttribute('data-duration-minutes', '');
    durationDisplay.classList.remove('has-value');

    evaluateSaveButtonState();
  });

  /* ---------------------------------------------------
     INITIAL STATE
  --------------------------------------------------- */
  evaluateSaveButtonState();

});