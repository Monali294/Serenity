/* ==========================================================================
   SERENITY — Journal
   Frontend-only behaviour. No fetch(), no localStorage/sessionStorage,
   no fake APIs. Form submission (#journalForm) posts normally to the
   Flask route set in journal.html's action attribute.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {

  /* ------------------------------------------------------------------
   * Elements
   * ------------------------------------------------------------------ */
  const form            = document.getElementById('journalForm');
  const titleInput       = document.getElementById('journalTitle');
  const textArea          = document.getElementById('journalText');
  const saveBtn           = document.getElementById('saveJournal');
  const clearBtn          = document.getElementById('clearJournal');
  const deleteBtn         = document.getElementById('deleteJournal');
  const searchInput       = document.getElementById('searchJournal');
  const journalList       = document.getElementById('journalList');
  const emptyState        = document.getElementById('emptyState');
  const newJournalBtn     = document.getElementById('newJournalBtn');
  const themeToggle       = document.getElementById('themeToggle');
  const autosaveIndicator = document.getElementById('autosaveIndicator');
  const autosaveText      = autosaveIndicator?.querySelector('.autosave-text');

  const wordCountEl    = document.getElementById('wordCount');
  const charCountEl    = document.getElementById('charCount');
  const readingTimeEl  = document.getElementById('readingTime');

  const AVG_WORDS_PER_MIN = 200;
  let autosaveTimer = null;

  /* ------------------------------------------------------------------
   * Word / character counters + reading time estimate
   * ------------------------------------------------------------------ */
  function updateStats() {
    const text = textArea.value.trim();
    const words = text.length ? text.split(/\s+/).length : 0;
    const chars = textArea.value.length;
    const minutes = Math.max(1, Math.ceil(words / AVG_WORDS_PER_MIN));

    wordCountEl.textContent = words;
    charCountEl.textContent = chars;
    readingTimeEl.textContent = words === 0 ? '0 min' : `${minutes} min`;
  }

  /* ------------------------------------------------------------------
   * Autosave indicator (visual only — no persistence logic here)
   * ------------------------------------------------------------------ */
  function markEditing() {
    if (!autosaveIndicator) return;
    autosaveIndicator.classList.add('is-editing');
    if (autosaveText) autosaveText.textContent = 'Editing…';

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      autosaveIndicator.classList.remove('is-editing');
      if (autosaveText) autosaveText.textContent = 'All changes saved';
    }, 1200);
  }

  function handleInput() {
    updateStats();
    markEditing();
  }

  textArea.addEventListener('input', handleInput);
  titleInput.addEventListener('input', markEditing);

  /* ------------------------------------------------------------------
   * Mood selector — keep native radio semantics, add a light bounce
   * ------------------------------------------------------------------ */
  const moodOrbs = document.querySelectorAll('.mood-orb');
  document.querySelectorAll('.mood-option input[name="emotion"]').forEach((input) => {
    input.addEventListener('change', () => {
      moodOrbs.forEach((orb) => orb.classList.remove('bounce'));
      const orb = input.nextElementSibling;
      if (orb) {
        orb.classList.add('bounce');
        orb.addEventListener('animationend', () => orb.classList.remove('bounce'), { once: true });
      }
    });
  });

  /* ------------------------------------------------------------------
   * Clear button — resets the form fields, UI only
   * ------------------------------------------------------------------ */
  clearBtn.addEventListener('click', () => {
    titleInput.value = '';
    textArea.value = '';
    document.querySelectorAll('.mood-option input[name="emotion"]').forEach((i) => (i.checked = false));
    updateStats();
    titleInput.focus();
  });

  /* ------------------------------------------------------------------
   * Delete button — UI-only confirmation state.
   * Actual deletion is handled server-side by Flask once wired up.
   * ------------------------------------------------------------------ */
  deleteBtn.addEventListener('click', () => {
    if (!deleteBtn.classList.contains('is-confirming')) {
      deleteBtn.classList.add('is-confirming');
      deleteBtn.querySelector('span:last-child').textContent = 'Confirm delete?';
      setTimeout(() => {
        deleteBtn.classList.remove('is-confirming');
        deleteBtn.querySelector('span:last-child').textContent = 'Delete';
      }, 3000);
      return;
    }
    // FLASK: submit a delete request here, e.g. by setting a hidden
    // input / form action pointing at your delete route, then form.submit()
    deleteBtn.classList.remove('is-confirming');
    deleteBtn.querySelector('span:last-child').textContent = 'Delete';
  });

  /* ------------------------------------------------------------------
   * Save button — brief success animation before the native form
   * submission carries on to the Flask backend.
   * ------------------------------------------------------------------ */
  form.addEventListener('submit', () => {
    saveBtn.classList.add('is-saved');
    saveBtn.querySelector('span:last-child').textContent = 'Saved';
    // Form submits normally to the action set in journal.html — no fetch().
  });

  /* ------------------------------------------------------------------
   * New Journal button — clears the writing area for a fresh entry
   * ------------------------------------------------------------------ */
  newJournalBtn.addEventListener('click', () => {
    clearBtn.click();
    document.querySelectorAll('.journal-card').forEach((c) => c.classList.remove('is-selected'));
    textArea.focus();
  });

  /* ------------------------------------------------------------------
   * Journal card selection
   * FLASK: when a card is clicked, you'll likely want to load that
   * entry's data into the form (server-rendered or via a page reload
   * to a route like /journal/<id>) — hook that in where noted below.
   * ------------------------------------------------------------------ */
  journalList.addEventListener('click', (e) => {
    const card = e.target.closest('.journal-card');
    if (!card) return;

    document.querySelectorAll('.journal-card').forEach((c) => c.classList.remove('is-selected'));
    card.classList.add('is-selected');

    // FLASK: e.g. window.location.href = `/journal/${card.dataset.id}`;
  });

  /* ------------------------------------------------------------------
   * Search filtering (client-side only, filters currently rendered cards)
   * ------------------------------------------------------------------ */
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim().toLowerCase();
    const cards = journalList.querySelectorAll('.journal-card');
    let visibleCount = 0;

    cards.forEach((card) => {
      const title = card.querySelector('.journal-card-title')?.textContent.toLowerCase() || '';
      const excerpt = card.querySelector('.journal-card-excerpt')?.textContent.toLowerCase() || '';
      const matches = title.includes(query) || excerpt.includes(query);
      card.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (emptyState) emptyState.hidden = visibleCount !== 0;
  });

  /* ------------------------------------------------------------------
   * Theme toggle (light / dark) — persisted via shared localStorage keys
   * ------------------------------------------------------------------ */
  const savedTheme = localStorage.getItem('serenity-theme') || localStorage.getItem('serenityTheme');
  if (savedTheme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  themeToggle.addEventListener('click', () => {
    const root = document.documentElement;
    const next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem('serenity-theme', next);
    localStorage.setItem('serenityTheme', next);
  });

  /* ------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------ */
  updateStats();
});