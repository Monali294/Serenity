/* =====================================================
   SERENITY INSIGHTS — FRONTEND LOGIC
   Self-contained: theme toggle included, no dependency
   on script.js.

   -----------------------------------------------------
   FLASK ENDPOINT CONTRACT
   -----------------------------------------------------
   GET /insights/data?period=<daily|weekly|monthly>&refresh=<0|1>
     `refresh=1` forces the server to recompute stats and
     regenerate the AI narrative rather than serving a cached
     version (see the "Refresh insights" button).

     response (JSON), same shape as the `insights_data` object
     rendered into the page on first load:
     {
       period, range_label,
       score: { value, delta, delta_label },
       factors: { mood, sleep, habits },           // 0-100 each
       trend: { labels: [...], mood_series: [...], sleep_series: [...] },
       mood_distribution: { labels: [...5 moods...], values: [...] },
       sleep_pattern: { labels: [...dates...], hours: [...] },
       habit_consistency: { percent, completed, total },
       ai_narrative: "<text>" | null,
       correlations: [ { type: "positive"|"negative", text } ],
       show_support_banner: true|false,
       support_message: "<text>" | null
     }
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
  const periodTabs        = document.getElementById('periodTabs');
  const refreshBtn        = document.getElementById('refreshBtn');
  const downloadBtn       = document.getElementById('downloadBtn');
  const captureRoot       = document.getElementById('insightsCaptureRoot');
  const loadingOverlay    = document.getElementById('loadingOverlay');

  const scoreValueEl      = document.getElementById('scoreValue');
  const scoreDeltaEl      = document.getElementById('scoreDelta');
  const rangeLabelEl      = document.getElementById('rangeLabel');
  const factorMoodEl      = document.getElementById('factorMood');
  const factorSleepEl     = document.getElementById('factorSleep');
  const factorHabitsEl    = document.getElementById('factorHabits');

  const aiNarrativeContent = document.getElementById('aiNarrativeContent');
  const correlationsCard   = document.getElementById('correlationsCard');
  const correlationList    = document.getElementById('correlationList');

  const supportBanner      = document.getElementById('supportBanner');
  const supportDismissBtn  = document.getElementById('supportDismissBtn');
  const supportCloseBtn    = document.getElementById('supportCloseBtn');

  const toastContainer     = document.getElementById('toastContainer');

  let currentPeriod = 'weekly';
  let isLoading = false;

  /* ---------------------------------------------------
     TOAST NOTIFICATIONS (shared pattern)
  --------------------------------------------------- */
  function spawnToast(emoji, text, variant) {
    if (!toastContainer) return;
    const toast = document.createElement('div');
    toast.className = 'serenity-toast' + (variant ? ' toast-' + variant : '');
    toast.setAttribute('role', 'status');
    toast.innerHTML = `<span class="toast-emoji" aria-hidden="true">${emoji}</span><span class="toast-text"></span>`;
    toast.querySelector('.toast-text').textContent = text;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('hide');
      toast.addEventListener('animationend', () => toast.remove());
    }, 4000);
  }
  function showSuccessToast(msg, emoji) { spawnToast(emoji || '🌿', msg, 'success'); }
  function showErrorToast(msg) { spawnToast('⚠️', msg || 'Something went wrong. Please try again.', 'error'); }

  /* ---------------------------------------------------
     CHART.JS SETUP
     Charts are created once, then updated in place on
     every period switch — smoother than destroy/recreate.
  --------------------------------------------------- */
  const purple = '#8b5cf6';
  const pink = '#ec4899';
  const amber = '#f59e0b';

  function textColor() {
    return getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#6b5b7a';
  }
  function gridColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
  }

  const baseFont = { family: "'Inter', sans-serif", size: 12 };

  const trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: { labels: [], datasets: [
      { label: 'Mood', data: [], borderColor: purple, backgroundColor: 'rgba(139,92,246,0.12)', tension: 0.35, fill: true, pointRadius: 3 },
      { label: 'Sleep (hrs)', data: [], borderColor: pink, backgroundColor: 'rgba(236,72,153,0.10)', tension: 0.35, fill: true, pointRadius: 3, yAxisID: 'y1' }
    ]},
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: textColor(), font: baseFont } } },
      scales: {
        x: { ticks: { color: textColor(), font: baseFont }, grid: { color: gridColor() } },
        y: { min: 0, max: 100, ticks: { color: textColor(), font: baseFont }, grid: { color: gridColor() }, title: { display: true, text: 'Mood', color: textColor() } },
        y1: { min: 0, max: 12, position: 'right', ticks: { color: textColor(), font: baseFont }, grid: { display: false }, title: { display: true, text: 'Sleep (hrs)', color: textColor() } }
      }
    }
  });

  const moodChart = new Chart(document.getElementById('moodChart'), {
    type: 'doughnut',
    data: { labels: [], datasets: [{ data: [], backgroundColor: [purple, '#a78bfa', '#c4b5fd', amber, '#ef4444'] }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: textColor(), font: baseFont, boxWidth: 10, padding: 10 } } }
    }
  });

  const sleepChart = new Chart(document.getElementById('sleepChart'), {
    type: 'bar',
    data: { labels: [], datasets: [{ label: 'Hours slept', data: [], backgroundColor: pink, borderRadius: 6, maxBarThickness: 28 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor(), font: baseFont }, grid: { display: false } },
        y: { min: 0, max: 12, ticks: { color: textColor(), font: baseFont }, grid: { color: gridColor() } }
      }
    }
  });

  const habitChart = new Chart(document.getElementById('habitChart'), {
    type: 'bar',
    data: { labels: ['Completed', 'Remaining'], datasets: [{ data: [0, 0], backgroundColor: [purple, gridColor()], borderRadius: 6 }] },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textColor(), font: baseFont }, grid: { color: gridColor() } },
        y: { ticks: { color: textColor(), font: baseFont }, grid: { display: false } }
      }
    }
  });

  function updateCharts(data) {
    trendChart.data.labels = data.trend.labels;
    trendChart.data.datasets[0].data = data.trend.mood_series;
    trendChart.data.datasets[1].data = data.trend.sleep_series;
    trendChart.update();

    moodChart.data.labels = data.mood_distribution.labels;
    moodChart.data.datasets[0].data = data.mood_distribution.values;
    moodChart.update();

    sleepChart.data.labels = data.sleep_pattern.labels;
    sleepChart.data.datasets[0].data = data.sleep_pattern.hours;
    sleepChart.update();

    const done = data.habit_consistency.completed || 0;
    const total = data.habit_consistency.total || 0;
    habitChart.data.datasets[0].data = [done, Math.max(total - done, 0)];
    habitChart.update();
  }

  /* ---------------------------------------------------
     RENDER NON-CHART CONTENT
  --------------------------------------------------- */
  function renderScore(data) {
    scoreValueEl.textContent = data.score.value;
    rangeLabelEl.textContent = data.range_label;
    scoreDeltaEl.textContent = data.score.delta_label;
    scoreDeltaEl.className = 'score-badge-delta ' + (
      data.score.delta > 0 ? 'positive' : data.score.delta < 0 ? 'negative' : 'neutral'
    );
    factorMoodEl.textContent = data.factors.mood;
    factorSleepEl.textContent = data.factors.sleep;
    factorHabitsEl.textContent = data.factors.habits;
  }

  function renderNarrative(data) {
    if (data.ai_narrative) {
      aiNarrativeContent.innerHTML = '<p class="ai-narrative-text"></p>';
      aiNarrativeContent.querySelector('.ai-narrative-text').textContent = data.ai_narrative;
    } else {
      aiNarrativeContent.innerHTML = '<p class="ai-narrative-text"></p>';
      aiNarrativeContent.querySelector('.ai-narrative-text').textContent =
        'Keep checking in over the next few days — once there\u2019s enough data for this period, a personalized summary will appear here.';
    }
  }

  function renderCorrelations(data) {
    const list = data.correlations || [];
    if (!list.length) {
      correlationsCard.hidden = true;
      return;
    }
    correlationsCard.hidden = false;
    correlationList.innerHTML = '';
    list.forEach((c) => {
      const item = document.createElement('div');
      item.className = 'correlation-item';
      const isPositive = c.type === 'positive';
      item.innerHTML = `
        <span class="correlation-icon ${isPositive ? 'positive' : 'negative'}">
          <i class="fa-solid ${isPositive ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down'}"></i>
        </span>
        <span class="correlation-text"></span>
      `;
      item.querySelector('.correlation-text').textContent = c.text;
      correlationList.appendChild(item);
    });
  }

  /* ---------------------------------------------------
     SUPPORT BANNER
     Server decides *whether* the condition is met; a
     dismissal here only snoozes it for the rest of today,
     so a persisting issue will surface again on a later visit.
  --------------------------------------------------- */
  function todayKey() {
    return 'serenity-support-dismissed-' + new Date().toISOString().slice(0, 10);
  }

  function renderSupportBanner(data) {
    const dismissedToday = localStorage.getItem(todayKey()) === 'true';
    if (data.show_support_banner && !dismissedToday) {
      if (data.support_message) {
        supportBanner.querySelector('.support-banner-body p').textContent = data.support_message;
      }
      supportBanner.hidden = false;
    } else {
      supportBanner.hidden = true;
    }
  }

  function dismissSupportBanner() {
    localStorage.setItem(todayKey(), 'true');
    supportBanner.hidden = true;
  }

  supportDismissBtn.addEventListener('click', dismissSupportBanner);
  supportCloseBtn.addEventListener('click', dismissSupportBanner);

  /* ---------------------------------------------------
     APPLY A FULL DATA PAYLOAD TO THE PAGE
  --------------------------------------------------- */
  function applyInsightsData(data) {
    renderScore(data);
    updateCharts(data);
    renderNarrative(data);
    renderCorrelations(data);
    renderSupportBanner(data);
  }

  /* ---------------------------------------------------
     PERIOD TABS
  --------------------------------------------------- */
  function setActiveTab(period) {
    periodTabs.querySelectorAll('.period-tab').forEach((tab) => {
      const active = tab.dataset.period === period;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
  }

  function fetchInsights(period, opts) {
    opts = opts || {};
    if (isLoading) return;
    isLoading = true;

    if (opts.showFullLoading) {
      captureRoot.style.display = 'none';
      loadingOverlay.hidden = false;
    }
    if (opts.spinRefresh) refreshBtn.classList.add('spinning');

    const query = new URLSearchParams({ period, refresh: opts.forceRefresh ? '1' : '0' });

    fetch(`/insights/data?${query.toString()}`, {
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        if (data.status && data.status !== 'success') {
          throw new Error(data.message || 'Unable to load insights.');
        }
        currentPeriod = period;
        setActiveTab(period);
        applyInsightsData(data);
      })
      .catch((error) => {
        console.error(error);
        showErrorToast('Couldn\u2019t load insights for that period. Please try again.');
      })
      .finally(() => {
        isLoading = false;
        loadingOverlay.hidden = true;
        captureRoot.style.display = '';
        refreshBtn.classList.remove('spinning');
      });
  }

  periodTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.period-tab');
    if (!tab || tab.classList.contains('active')) return;
    fetchInsights(tab.dataset.period, { showFullLoading: true });
  });

  refreshBtn.addEventListener('click', () => {
    fetchInsights(currentPeriod, { spinRefresh: true, forceRefresh: true });
  });

  /* ---------------------------------------------------
     CSRF HELPER
  --------------------------------------------------- */
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  }

  /* ---------------------------------------------------
     PDF EXPORT
  --------------------------------------------------- */
  downloadBtn.addEventListener('click', () => {
    if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
      showErrorToast('PDF export isn\u2019t available right now. Please try again shortly.');
      return;
    }

    downloadBtn.disabled = true;
    const originalHtml = downloadBtn.innerHTML;
    downloadBtn.innerHTML = '<i class="fa-solid fa-circle-notch spin-icon"></i> <span>Preparing…</span>';

    document.body.classList.add('pdf-export-mode');

    html2canvas(captureRoot, {
      backgroundColor: document.documentElement.getAttribute('data-theme') === 'dark' ? '#1a1625' : '#f9f6ff',
      scale: 2,
      useCORS: true
    }).then((canvas) => {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'pt', 'a4');
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = pageWidth - 40;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 20;
      const imgData = canvas.toDataURL('image/png');

      pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
      heightLeft -= (pageHeight - 40);

      while (heightLeft > 0) {
        position = heightLeft - imgHeight + 20;
        pdf.addPage();
        pdf.addImage(imgData, 'PNG', 20, position, imgWidth, imgHeight);
        heightLeft -= (pageHeight - 40);
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      pdf.save(`serenity-insights-${currentPeriod}-${dateStr}.pdf`);

      showSuccessToast('Your report has downloaded.', '📄');
    }).catch((error) => {
      console.error(error);
      showErrorToast('Couldn\u2019t generate the PDF. Please try again.');
    }).finally(() => {
      document.body.classList.remove('pdf-export-mode');
      downloadBtn.disabled = false;
      downloadBtn.innerHTML = originalHtml;
    });
  });

  /* ---------------------------------------------------
     INITIAL RENDER — use the data Flask already rendered
     into the page, so there's no flash of empty charts.
  --------------------------------------------------- */
  const initialDataEl = document.getElementById('initialInsightsData');
  let initialData = null;
  try {
    initialData = JSON.parse(initialDataEl.textContent);
  } catch (error) {
    console.error('Could not parse initial insights data', error);
  }

  if (initialData) {
    currentPeriod = initialData.period || 'weekly';
    setActiveTab(currentPeriod);
    applyInsightsData(initialData);
  }
});