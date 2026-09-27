/* =====================================================
   SERENITY HABIT TRACKER — FRONTEND LOGIC
   Self-contained: theme toggle included, no dependency
   on script.js. Ready for Flask integration at the three
   marked endpoints (/save_habits, /toggle_habit, /delete_habit).

   Persistence model: habit selection and today's completion
   state are NOT stored in localStorage. They come from the
   server on page load (via Jinja) and are written back to
   the server on every change, so refreshing the page never
   loses or resets anything — the page just reflects whatever
   the server currently has.

   -----------------------------------------------------
   FLASK ENDPOINT CONTRACTS (adjust URLs/shapes as needed
   to match your actual routes and DB schema)
   -----------------------------------------------------
   POST /save_habits
     body (JSON): { habits: [ { id, name, icon, is_custom }, ... ] }
       - id is the preset's id (e.g. "water") for catalog picks,
         or null for a custom habit the user typed.
     response (JSON): { status: "success", habits: [
         { id, name, icon, streak: 0, completed_today: false }, ...
     ] }
       - `id` in the response must be the newly created
         user_habit's real database id (used for future
         toggle/delete calls). `habits` should be returned in
         the same order they were submitted.

   POST /toggle_habit
     body (url-encoded): habit_id=<id>
       - Server should toggle *today's* completion for that
         habit and recompute its streak server-side (client
         does not send a completed/not-completed flag, to
         avoid trusting client state).
     response (JSON): { status: "success", completed: true|false, streak: <int> }

   POST /delete_habit
     body (url-encoded): habit_id=<id>
     response (JSON): { status: "success" }
   ----------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------------------------------------------------
     THEME TOGGLE
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
  const progressCard        = document.getElementById('progressCard');
  const progressRingFill    = document.getElementById('progressRingFill');
  const progressRingLabel   = document.getElementById('progressRingLabel');
  const progressTitle       = document.getElementById('progressTitle');
  const progressSubtitle    = document.getElementById('progressSubtitle');

  const habitListSection    = document.getElementById('habitListSection');
  const habitGrid           = document.getElementById('habitGrid');
  const emptyHabitsMsg      = document.getElementById('emptyHabitsMsg');
  const manageHabitsBtn     = document.getElementById('manageHabitsBtn');

  const habitPicker         = document.getElementById('habitPicker');
  const pickerTitle         = document.getElementById('pickerTitle');
  const presetGrid          = document.getElementById('presetGrid');
  const customHabitInput    = document.getElementById('customHabitInput');
  const addCustomChipBtn    = document.getElementById('addCustomChipBtn');
  const cancelPickerBtn     = document.getElementById('cancelPickerBtn');
  const savePickerBtn       = document.getElementById('savePickerBtn');

  const modalOverlay        = document.getElementById('habitModalOverlay');
  const modalCancelBtn      = document.getElementById('habitModalCancel');
  const modalConfirmBtn     = document.getElementById('habitModalConfirm');

  const toastContainer      = document.getElementById('toastContainer');

  const RING_CIRCUMFERENCE  = 226.19; // 2π × 36, matches the SVG radius

  /* Inject the ring's gradient def once (same pattern as the dashboard score ring) */
  (function injectRingGradient() {
    if (!progressRingFill) return;
    const svg = progressRingFill.closest('svg');
    if (!svg || svg.querySelector('#habitRingGrad')) return;

    const ns = 'http://www.w3.org/2000/svg';
    const defs = document.createElementNS(ns, 'defs');
    const grad = document.createElementNS(ns, 'linearGradient');
    grad.setAttribute('id', 'habitRingGrad');
    grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
    grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '0%');
    const stop1 = document.createElementNS(ns, 'stop');
    stop1.setAttribute('offset', '0%');
    stop1.setAttribute('stop-color', '#8b5cf6');
    const stop2 = document.createElementNS(ns, 'stop');
    stop2.setAttribute('offset', '100%');
    stop2.setAttribute('stop-color', '#ec4899');
    grad.appendChild(stop1);
    grad.appendChild(stop2);
    defs.appendChild(grad);
    svg.prepend(defs);
  })();

  /* ---------------------------------------------------
     CSRF HELPER
  --------------------------------------------------- */
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  }

  /* ---------------------------------------------------
     TOAST NOTIFICATIONS (same pattern as Sleep Tracker)
  --------------------------------------------------- */
  function spawnToast(emoji, text, variant) {
    if (!toastContainer) return;

    const toast = document.createElement('div');
    toast.className = 'serenity-toast' + (variant ? ' toast-' + variant : '');
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <span class="toast-emoji" aria-hidden="true">${emoji}</span>
      <span class="toast-text"></span>
    `;
    toast.querySelector('.toast-text').textContent = text;

    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('hide');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }

  function showSuccessToast(message, emoji) {
    spawnToast(emoji || '🌿', message, 'success');
  }

  function showErrorToast(message) {
    spawnToast('⚠️', message || 'Something went wrong. Please try again.', 'error');
  }

  /* ---------------------------------------------------
     PROGRESS RING
     Recomputed from the DOM (source of truth is whatever
     is actually rendered in #habitGrid at the time).
  --------------------------------------------------- */
  function updateProgress() {
    const cards = Array.from(habitGrid.querySelectorAll('.habit-card'));
    const total = cards.length;
    const done = cards.filter((c) => c.classList.contains('completed')).length;

    if (total === 0) {
      progressCard.classList.add('d-none');
      return;
    }

    progressCard.classList.remove('d-none');

    const ratio = done / total;
    const offset = RING_CIRCUMFERENCE - RING_CIRCUMFERENCE * ratio;
    progressRingFill.style.strokeDashoffset = String(offset);
    progressRingLabel.textContent = `${done}/${total}`;

    if (done === 0) {
      progressTitle.textContent = "Let's get started";
      progressSubtitle.textContent = 'Complete your habits to see today\u2019s progress.';
    } else if (done === total) {
      progressTitle.textContent = 'All done for today! 🎉';
      progressSubtitle.textContent = 'Every habit checked off — nice work.';
    } else {
      progressTitle.textContent = `${done} of ${total} completed`;
      progressSubtitle.textContent = 'Keep going, you\u2019re doing great.';
    }
  }

  /* ---------------------------------------------------
     EMPTY STATE
     Toggles between "daily tracker" and "onboarding" views
     depending on whether any habits are currently rendered.
  --------------------------------------------------- */
  function checkEmptyState() {
    const hasHabits = habitGrid.children.length > 0;

    emptyHabitsMsg.classList.toggle('d-none', hasHabits);

    if (!hasHabits) {
      // Back to a first-time-user view: expand the picker as onboarding.
      progressCard.classList.add('d-none');
      habitPicker.classList.remove('picker-collapsed');
      pickerTitle.textContent = 'Choose Your Habits';
      savePickerBtn.querySelector('.btn-text').textContent = 'Start Tracking';
      cancelPickerBtn.classList.add('d-none');
    }
  }

  /* ---------------------------------------------------
     BUILD A HABIT CARD (mirrors the Jinja-rendered markup,
     used when a new habit is added without a page reload)
  --------------------------------------------------- */
  function buildHabitCard(habit) {
    const card = document.createElement('article');
    card.className = 'habit-card glass-card reveal visible' + (habit.completed_today ? ' completed' : '');
    card.dataset.habitId = habit.id;

    const week = Array.isArray(habit.week) && habit.week.length === 7
      ? habit.week
      : [false, false, false, false, false, false, Boolean(habit.completed_today)];

    const dotsHtml = week
      .map((done, i) => `<span class="week-dot${done ? ' dot-done' : ''}${i === 6 ? ' dot-today' : ''}"></span>`)
      .join('');

    card.innerHTML = `
      <button type="button" class="habit-check" aria-label="Mark ${escapeHtml(habit.name)} as done today" aria-pressed="${habit.completed_today ? 'true' : 'false'}">
        <i class="fa-solid fa-check"></i>
      </button>
      <div class="habit-body">
        <div class="habit-top-row">
          <span class="habit-name">
            <span class="habit-emoji" aria-hidden="true">${habit.icon || '🎯'}</span>
            <span class="habit-label"></span>
          </span>
          <button type="button" class="habit-delete-btn" aria-label="Delete ${escapeHtml(habit.name)}">
            <i class="fa-regular fa-trash-can"></i>
          </button>
        </div>
        <div class="habit-meta-row">
          <span class="habit-streak"><i class="fa-solid fa-fire" aria-hidden="true"></i> ${habit.streak || 0} day streak</span>
          <span class="habit-week-dots" aria-hidden="true">${dotsHtml}</span>
        </div>
      </div>
    `;
    card.querySelector('.habit-label').textContent = habit.name; // safe text insertion

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /* ---------------------------------------------------
     TOGGLE HABIT COMPLETION (event delegation)
  --------------------------------------------------- */
  habitGrid.addEventListener('click', (event) => {
    const checkBtn = event.target.closest('.habit-check');
    const deleteBtn = event.target.closest('.habit-delete-btn');
    const card = event.target.closest('.habit-card');
    if (!card) return;

    if (checkBtn) {
      toggleHabit(card);
    } else if (deleteBtn) {
      openDeleteModal(card);
    }
  });

  function toggleHabit(card) {
    const habitId = card.dataset.habitId;
    const wasCompleted = card.classList.contains('completed');
    const checkBtn = card.querySelector('.habit-check');

    // Optimistic UI update
    card.classList.toggle('completed', !wasCompleted);
    checkBtn.setAttribute('aria-pressed', String(!wasCompleted));
    updateProgress();

    fetch('/toggle_habit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': getCsrfToken()
      },
      body: new URLSearchParams({ habit_id: habitId })
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        if (data.status !== 'success') {
          throw new Error(data.message || 'Unable to update habit.');
        }

        // Reconcile with server truth (streak, and completion state if it differs)
        const nowCompleted = Boolean(data.completed);
        card.classList.toggle('completed', nowCompleted);
        checkBtn.setAttribute('aria-pressed', String(nowCompleted));

        if (typeof data.streak === 'number') {
          const streakEl = card.querySelector('.habit-streak');
          if (streakEl) {
            streakEl.innerHTML = '';
            const icon = document.createElement('i');
            icon.className = 'fa-solid fa-fire';
            icon.setAttribute('aria-hidden', 'true');
            streakEl.appendChild(icon);
            streakEl.append(` ${data.streak} day streak`);
          }
        }

        updateProgress();

        if (nowCompleted && !wasCompleted) {
          showSuccessToast('Nice work — habit marked complete!', '✅');
        }
      })
      .catch((error) => {
        console.error(error);
        // Revert the optimistic update
        card.classList.toggle('completed', wasCompleted);
        checkBtn.setAttribute('aria-pressed', String(wasCompleted));
        updateProgress();
        showErrorToast('Couldn\u2019t save that. Please try again.');
      });
  }

  /* ---------------------------------------------------
     DELETE HABIT (confirmation modal, same pattern as
     the Journal detail page's delete flow)
  --------------------------------------------------- */
  let pendingDeleteCard = null;
  let lastFocusedElement = null;

  function openDeleteModal(card) {
    pendingDeleteCard = card;
    lastFocusedElement = document.activeElement;

    modalOverlay.hidden = false;
    modalOverlay.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => modalOverlay.classList.add('modal-visible'));
    modalConfirmBtn.focus();
    document.addEventListener('keydown', onModalKeydown);
  }

  function closeDeleteModal() {
    modalOverlay.classList.remove('modal-visible');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.removeEventListener('keydown', onModalKeydown);

    setTimeout(() => { modalOverlay.hidden = true; }, 200);

    pendingDeleteCard = null;
    if (lastFocusedElement) lastFocusedElement.focus();
  }

  function onModalKeydown(event) {
    if (event.key === 'Escape') closeDeleteModal();
  }

  modalCancelBtn.addEventListener('click', closeDeleteModal);
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeDeleteModal();
  });

  modalConfirmBtn.addEventListener('click', () => {
    if (!pendingDeleteCard) return;
    const card = pendingDeleteCard;
    const habitId = card.dataset.habitId;

    modalConfirmBtn.disabled = true;

    fetch('/delete_habit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': getCsrfToken()
      },
      body: new URLSearchParams({ habit_id: habitId })
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        modalConfirmBtn.disabled = false;
        closeDeleteModal();

        if (data.status !== 'success') {
          showErrorToast(data.message || 'Unable to delete habit.');
          return;
        }

        card.classList.add('leaving');
        card.addEventListener('animationend', removeCard, { once: true });
        setTimeout(removeCard, 320); // fallback in case no animation runs

        function removeCard() {
          if (!card.isConnected) return;
          card.remove();
          updateProgress();
          checkEmptyState();
        }

        showSuccessToast('Habit removed.', '🗑️');
      })
      .catch((error) => {
        console.error(error);
        modalConfirmBtn.disabled = false;
        closeDeleteModal();
        showErrorToast('Couldn\u2019t delete that habit. Please try again.');
      });
  });

  /* ---------------------------------------------------
     HABIT PICKER — selection state
     Keyed by a unique string so presets and custom
     entries never collide: "preset:<id>" or "custom:<name>"
  --------------------------------------------------- */
  const selection = new Map();

  function selectionKeyForPreset(id) { return 'preset:' + id; }
  function selectionKeyForCustom(name) { return 'custom:' + name.trim().toLowerCase(); }

  function updateSaveButtonState() {
    savePickerBtn.disabled = selection.size === 0;
  }

  function isNameAlreadyTaken(name) {
    const lower = name.trim().toLowerCase();

    // Already-followed habits (rendered cards)
    const existing = Array.from(habitGrid.querySelectorAll('.habit-label'))
      .some((el) => el.textContent.trim().toLowerCase() === lower);
    if (existing) return true;

    // Already selected in the picker (preset or custom)
    for (const entry of selection.values()) {
      if (entry.name.trim().toLowerCase() === lower) return true;
    }
    return false;
  }

  /* Preset chip selection (event delegation) */
  presetGrid.addEventListener('click', (event) => {
    const chip = event.target.closest('.preset-chip');
    if (!chip) return;

    const key = selectionKeyForPreset(chip.dataset.presetId);
    const isSelected = chip.classList.toggle('selected');
    chip.setAttribute('aria-pressed', String(isSelected));

    if (isSelected) {
      selection.set(key, {
        id: chip.dataset.presetId,
        name: chip.dataset.name,
        icon: chip.dataset.icon,
        is_custom: false
      });
    } else {
      selection.delete(key);
    }

    updateSaveButtonState();
  });

  /* Custom habit chip creation */
  function addCustomHabitChip() {
    const rawName = customHabitInput.value.trim();

    if (!rawName) {
      showErrorToast('Type a habit name first.');
      customHabitInput.focus();
      return;
    }

    if (rawName.length > 40) {
      showErrorToast('Habit names should be under 40 characters.');
      return;
    }

    if (isNameAlreadyTaken(rawName)) {
      showErrorToast('You\u2019re already tracking (or have selected) that habit.');
      customHabitInput.focus();
      return;
    }

    const key = selectionKeyForCustom(rawName);
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'preset-chip custom-chip selected';
    chip.setAttribute('aria-pressed', 'true');
    chip.innerHTML = `
      <span class="chip-icon" aria-hidden="true">🎯</span>
      <span class="chip-name"></span>
      <button type="button" class="chip-remove" aria-label="Remove ${escapeHtml(rawName)}">
        <i class="fa-solid fa-xmark"></i>
      </button>
    `;
    chip.querySelector('.chip-name').textContent = rawName;

    presetGrid.appendChild(chip);
    selection.set(key, { id: null, name: rawName, icon: '🎯', is_custom: true });
    updateSaveButtonState();

    customHabitInput.value = '';
    customHabitInput.focus();
  }

  addCustomChipBtn.addEventListener('click', addCustomHabitChip);
  customHabitInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustomHabitChip();
    }
  });

  /* Removing a custom chip (event delegation, since chips are added dynamically) */
  presetGrid.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.chip-remove');
    if (!removeBtn) return;
    event.stopPropagation();

    const chip = removeBtn.closest('.custom-chip');
    if (!chip) return;

    const name = chip.querySelector('.chip-name').textContent;
    selection.delete(selectionKeyForCustom(name));
    chip.remove();
    updateSaveButtonState();
  });

  /* ---------------------------------------------------
     OPEN / CLOSE THE PICKER PANEL
  --------------------------------------------------- */
  function resetPickerSelection() {
    selection.clear();
    presetGrid.querySelectorAll('.preset-chip.selected:not(.custom-chip)').forEach((chip) => {
      chip.classList.remove('selected');
      chip.setAttribute('aria-pressed', 'false');
    });
    presetGrid.querySelectorAll('.custom-chip').forEach((chip) => chip.remove());
    customHabitInput.value = '';
    updateSaveButtonState();
  }

  manageHabitsBtn.addEventListener('click', () => {
    habitPicker.classList.remove('picker-collapsed');
    habitPicker.scrollIntoView({ behavior: 'smooth', block: 'start' });
    customHabitInput.focus({ preventScroll: true });
  });

  cancelPickerBtn.addEventListener('click', () => {
    resetPickerSelection();
    habitPicker.classList.add('picker-collapsed');
  });

  /* ---------------------------------------------------
     SAVE SELECTED HABITS
  --------------------------------------------------- */
  savePickerBtn.addEventListener('click', () => {
    if (selection.size === 0) return;

    const payload = Array.from(selection.values());

    savePickerBtn.classList.add('loading');
    savePickerBtn.disabled = true;

    fetch('/save_habits', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: JSON.stringify({ habits: payload })
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        savePickerBtn.classList.remove('loading');
        savePickerBtn.disabled = false;

        if (data.status !== 'success' || !Array.isArray(data.habits)) {
          showErrorToast(data.message || 'Unable to save your habits. Please try again.');
          return;
        }

        // Render each newly created habit (server-assigned ids, streak, etc.)
        data.habits.forEach((habit) => {
          habitGrid.appendChild(buildHabitCard(habit));
        });

        // Transition from onboarding to the normal daily-tracker view
        habitListSection.classList.remove('d-none');
        progressCard.classList.remove('d-none');
        habitPicker.classList.add('picker-collapsed');
        pickerTitle.textContent = 'Add More Habits';
        savePickerBtn.querySelector('.btn-text').textContent = 'Add Selected Habits';
        cancelPickerBtn.classList.remove('d-none');

        resetPickerSelection();
        updateProgress();
        checkEmptyState();

        showSuccessToast(
          data.habits.length === 1 ? 'Habit added — good luck!' : `${data.habits.length} habits added — good luck!`,
          '🌱'
        );
      })
      .catch((error) => {
        console.error(error);
        savePickerBtn.classList.remove('loading');
        savePickerBtn.disabled = false;
        showErrorToast('Couldn\u2019t reach the server. Please check your connection and try again.');
      });
  });

  /* ---------------------------------------------------
     INITIAL STATE
  --------------------------------------------------- */
  updateProgress();
  checkEmptyState();
});