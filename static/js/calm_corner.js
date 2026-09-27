/* ==========================================================
   Calm Corner — Serenity
   Self-contained: no backend, no external audio files, no
   external icon libraries. Everything here is generated
   client-side so nothing can 404 after deployment.
   ========================================================== */

(function () {
  'use strict';

  /* ---------------- Toasts ---------------- */
  function showToast(message, type) {
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var toast = document.createElement('div');
    toast.className = 'toast' + (type === 'success' ? ' toast-success' : type === 'error' ? ' toast-error' : '');
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(function () {
      toast.classList.add('toast-out');
      setTimeout(function () { toast.remove(); }, 220);
    }, 3200);
  }

  /* ---------------- Theme toggle ---------------- */
  var themeToggle = document.getElementById('themeToggle');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('serenity-theme', theme);
      localStorage.setItem('serenityTheme', theme);
    } catch (e) { /* storage unavailable — theme still applies for this session */ }
  }
  if (themeToggle) {
    themeToggle.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      applyTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------------- Voice guidance toggle ---------------- */
  var voiceToggle = document.getElementById('voiceToggle');
  var speechSupported = 'speechSynthesis' in window;
  var voiceEnabled = true;
  try {
    var storedVoice = localStorage.getItem('serenity-calm-voice');
    voiceEnabled = storedVoice === null ? true : storedVoice === 'true';
  } catch (e) { /* default stays true */ }

  function setVoiceEnabled(val) {
    voiceEnabled = val;
    if (voiceToggle) voiceToggle.setAttribute('aria-pressed', String(val));
    try { localStorage.setItem('serenity-calm-voice', String(val)); } catch (e) {}
  }
  if (voiceToggle) {
    if (!speechSupported) {
      voiceToggle.disabled = true;
      voiceToggle.title = 'Voice guidance is not supported in this browser';
      setVoiceEnabled(false);
    } else {
      setVoiceEnabled(voiceEnabled);
      voiceToggle.addEventListener('click', function () {
        setVoiceEnabled(!voiceEnabled);
      });
    }
  }

  function speak(text) {
    if (!speechSupported || !voiceEnabled) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(text);
      utter.rate = 0.95;
      utter.pitch = 1;
      utter.volume = 0.9;
      window.speechSynthesis.speak(utter);
    } catch (e) { /* speech failure should never break the page */ }
  }

  /* ==========================================================
     Shared Web Audio engine — used by both the sound cards
     and the meditation timer's background sound.
     ========================================================== */
  var AudioEngineCtor = window.AudioContext || window.webkitAudioContext;
  var audioCtx = null;
  var audioSupported = !!AudioEngineCtor;

  function getCtx() {
    if (!audioCtx && audioSupported) {
      audioCtx = new AudioEngineCtor();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }

  function makeNoiseBuffer(ctx, seconds, colorize) {
    var bufferSize = Math.floor(ctx.sampleRate * seconds);
    var buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    var lastOut = 0;
    for (var i = 0; i < bufferSize; i++) {
      var white = Math.random() * 2 - 1;
      if (colorize === 'brown') {
        lastOut = (lastOut + 0.02 * white) / 1.02;
        data[i] = lastOut * 3.2;
      } else if (colorize === 'pink') {
        lastOut = 0.98 * lastOut + 0.02 * white;
        data[i] = lastOut * 2.2;
      } else {
        data[i] = white;
      }
    }
    return buffer;
  }

  // Registry of currently-active sound instances, keyed by sound id.
  var activeSounds = {};

  function stopSound(id) {
    var inst = activeSounds[id];
    if (!inst) return;
    try {
      if (inst.source) { inst.source.stop(); inst.source.disconnect(); }
      if (inst.lfoNode) { inst.lfoNode.stop(); inst.lfoNode.disconnect(); }
      if (inst.filter) inst.filter.disconnect();
      if (inst.gainNode) inst.gainNode.disconnect();
    } catch (e) { /* nodes may already be stopped */ }
    if (inst.chirpTimer) clearTimeout(inst.chirpTimer);
    delete activeSounds[id];
  }

  function stopAllSounds() {
    Object.keys(activeSounds).forEach(stopSound);
    syncSoundCardUI();
  }

  function scheduleForestChirp(ctx, destinationGain, id) {
    var inst = activeSounds[id];
    if (!inst) return;
    var delay = 2500 + Math.random() * 6000;
    inst.chirpTimer = setTimeout(function () {
      if (!activeSounds[id]) return;
      try {
        var osc = ctx.createOscillator();
        var chirpGain = ctx.createGain();
        var startFreq = 1800 + Math.random() * 1400;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(startFreq, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(startFreq * 1.4, ctx.currentTime + 0.12);
        chirpGain.gain.setValueAtTime(0.0001, ctx.currentTime);
        chirpGain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
        chirpGain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
        osc.connect(chirpGain).connect(destinationGain);
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch (e) {}
      scheduleForestChirp(ctx, destinationGain, id);
    }, delay);
  }

  function startSound(id, volumePercent) {
    var ctx = getCtx();
    if (!ctx) {
      showToast('This browser does not support the Web Audio API needed for sounds.', 'error');
      return;
    }
    stopAllSounds();

    var master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(1, volumePercent / 100));
    master.connect(ctx.destination);

    var inst = { gainNode: master };

    if (id === 'rain') {
      var buf = makeNoiseBuffer(ctx, 3, 'white');
      var src = ctx.createBufferSource();
      src.buffer = buf; src.loop = true;
      var lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1100; lp.Q.value = 0.5;
      var hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 220;
      src.connect(hp).connect(lp).connect(master);
      src.start();
      inst.source = src; inst.filter = lp;

    } else if (id === 'ocean') {
      var obuf = makeNoiseBuffer(ctx, 4, 'brown');
      var osrc = ctx.createBufferSource();
      osrc.buffer = obuf; osrc.loop = true;
      var olp = ctx.createBiquadFilter();
      olp.type = 'lowpass'; olp.frequency.value = 700;
      var swellGain = ctx.createGain();
      swellGain.gain.value = 0.7;
      var lfo = ctx.createOscillator();
      lfo.type = 'sine'; lfo.frequency.value = 0.11;
      var lfoDepth = ctx.createGain();
      lfoDepth.gain.value = 0.3;
      lfo.connect(lfoDepth).connect(swellGain.gain);
      lfo.start();
      osrc.connect(olp).connect(swellGain).connect(master);
      osrc.start();
      inst.source = osrc; inst.filter = olp; inst.lfoNode = lfo;

    } else if (id === 'forest') {
      var fbuf = makeNoiseBuffer(ctx, 3, 'pink');
      var fsrc = ctx.createBufferSource();
      fsrc.buffer = fbuf; fsrc.loop = true;
      var flp = ctx.createBiquadFilter();
      flp.type = 'lowpass'; flp.frequency.value = 900;
      var fbedGain = ctx.createGain();
      fbedGain.gain.value = 0.35;
      fsrc.connect(flp).connect(fbedGain).connect(master);
      fsrc.start();
      inst.source = fsrc; inst.filter = flp;
      activeSounds[id] = inst;
      scheduleForestChirp(ctx, master, id);
      return finishStart();

    } else if (id === 'white') {
      var wbuf = makeNoiseBuffer(ctx, 2, 'white');
      var wsrc = ctx.createBufferSource();
      wsrc.buffer = wbuf; wsrc.loop = true;
      wsrc.connect(master);
      wsrc.start();
      inst.source = wsrc;
    } else {
      return;
    }

    activeSounds[id] = inst;
    finishStart();

    function finishStart() {
      syncSoundCardUI();
    }
  }

  function setSoundVolume(id, volumePercent) {
    var inst = activeSounds[id];
    if (inst && inst.gainNode) {
      inst.gainNode.gain.value = Math.max(0, Math.min(1, volumePercent / 100));
    }
  }

  function syncSoundCardUI() {
    document.querySelectorAll('.sound-card').forEach(function (card) {
      var id = card.getAttribute('data-sound');
      card.classList.toggle('is-playing', !!activeSounds[id]);
    });
  }

  /* ---- Wire up sound cards ---- */
  document.querySelectorAll('.sound-play-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var id = btn.getAttribute('data-sound');
      if (activeSounds[id]) {
        stopSound(id);
        syncSoundCardUI();
      } else {
        var slider = document.querySelector('.sound-volume[data-sound="' + id + '"]');
        startSound(id, slider ? Number(slider.value) : 60);
      }
    });
  });
  document.querySelectorAll('.sound-volume').forEach(function (slider) {
    slider.addEventListener('input', function () {
      setSoundVolume(slider.getAttribute('data-sound'), Number(slider.value));
    });
  });

  /* ==========================================================
     Breathing sessions
     ========================================================== */
  var TECHNIQUES = {
    box: {
      label: 'Box breathing',
      phases: [
        { name: 'Breathe in', duration: 4, scale: 1.35 },
        { name: 'Hold', duration: 4, scale: 1.35 },
        { name: 'Breathe out', duration: 4, scale: 0.82 },
        { name: 'Hold', duration: 4, scale: 0.82 }
      ]
    },
    '478': {
      label: '4-7-8 breathing',
      phases: [
        { name: 'Breathe in', duration: 4, scale: 1.35 },
        { name: 'Hold', duration: 7, scale: 1.35 },
        { name: 'Breathe out', duration: 8, scale: 0.82 }
      ]
    }
  };

  var overlay = document.getElementById('breathingOverlay');
  var orb = document.getElementById('breathingOrb');
  var phaseCaption = document.getElementById('phaseCaption');
  var phaseProgressFill = document.getElementById('phaseProgressFill');
  var cycleCounterEl = document.getElementById('cycleCounter');
  var overlayTechniqueName = document.getElementById('overlayTechniqueName');

  var breathingSession = null; // { technique, phaseIndex, cycle, timeoutId }

  function stepBreathing() {
    if (!breathingSession) return;
    var technique = TECHNIQUES[breathingSession.technique];
    var phase = technique.phases[breathingSession.phaseIndex];

    phaseCaption.textContent = phase.name;
    orb.style.transitionDuration = phase.duration + 's';
    orb.style.transform = 'scale(' + phase.scale + ')';
    speak(phase.name);

    // restart progress bar animation
    phaseProgressFill.style.transition = 'none';
    phaseProgressFill.style.width = '0%';
    // force reflow so the next transition actually runs
    void phaseProgressFill.offsetWidth;
    phaseProgressFill.style.transition = 'width ' + phase.duration + 's linear';
    phaseProgressFill.style.width = '100%';

    breathingSession.timeoutId = setTimeout(function () {
      if (!breathingSession) return;
      breathingSession.phaseIndex++;
      if (breathingSession.phaseIndex >= technique.phases.length) {
        breathingSession.phaseIndex = 0;
        breathingSession.cycle++;
        cycleCounterEl.textContent = 'Cycle ' + breathingSession.cycle;
      }
      stepBreathing();
    }, phase.duration * 1000);
  }

  function openBreathing(techniqueKey) {
    var technique = TECHNIQUES[techniqueKey];
    if (!technique) return;
    breathingSession = { technique: techniqueKey, phaseIndex: 0, cycle: 0, timeoutId: null };
    overlayTechniqueName.textContent = technique.label;
    cycleCounterEl.textContent = 'Cycle 0';
    orb.style.transitionDuration = '2s';
    orb.style.transform = 'scale(0.85)';
    phaseCaption.textContent = 'Get ready\u2026';
    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    speak('Starting ' + technique.label + '. Get ready.');
    setTimeout(function () {
      if (breathingSession) stepBreathing();
    }, 1600);
  }

  function closeBreathing() {
    if (breathingSession && breathingSession.timeoutId) clearTimeout(breathingSession.timeoutId);
    breathingSession = null;
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (speechSupported) window.speechSynthesis.cancel();
  }

  document.querySelectorAll('.start-breathing-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      openBreathing(btn.getAttribute('data-technique'));
    });
  });
  var closeBreathingBtn = document.getElementById('closeBreathingBtn');
  var stopBreathingBtn = document.getElementById('stopBreathingBtn');
  if (closeBreathingBtn) closeBreathingBtn.addEventListener('click', closeBreathing);
  if (stopBreathingBtn) stopBreathingBtn.addEventListener('click', closeBreathing);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeBreathing();
  });

  /* ==========================================================
     Meditation timer
     ========================================================== */
  var durationChips = document.querySelectorAll('.chip[data-minutes]');
  var customMinutesInput = document.getElementById('customMinutes');
  var timerSoundSelect = document.getElementById('timerSoundSelect');
  var timerClock = document.getElementById('timerClock');
  var timerStatus = document.getElementById('timerStatus');
  var timerRing = document.getElementById('timerRingProgress');
  var timerSetup = document.getElementById('timerSetup');
  var startBtn = document.getElementById('timerStartBtn');
  var pauseBtn = document.getElementById('timerPauseBtn');
  var resumeBtn = document.getElementById('timerResumeBtn');
  var resetBtn = document.getElementById('timerResetBtn');

  var RING_CIRCUMFERENCE = 2 * Math.PI * 100; // r=100

  var timerState = {
    totalSeconds: 5 * 60,
    remainingSeconds: 5 * 60,
    intervalId: null,
    running: false,
    soundId: 'none'
  };

  function formatClock(seconds) {
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function updateRing() {
    var fraction = timerState.totalSeconds > 0 ? timerState.remainingSeconds / timerState.totalSeconds : 0;
    var offset = RING_CIRCUMFERENCE * (1 - fraction);
    timerRing.style.strokeDasharray = String(RING_CIRCUMFERENCE);
    timerRing.style.strokeDashoffset = String(offset);
  }

  function renderTimer() {
    timerClock.textContent = formatClock(timerState.remainingSeconds);
    updateRing();
  }

  durationChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      durationChips.forEach(function (c) { c.classList.remove('chip-active'); });
      chip.classList.add('chip-active');
      if (customMinutesInput) customMinutesInput.value = '';
      var minutes = Number(chip.getAttribute('data-minutes'));
      timerState.totalSeconds = minutes * 60;
      timerState.remainingSeconds = minutes * 60;
      renderTimer();
    });
  });

  if (customMinutesInput) {
    customMinutesInput.addEventListener('input', function () {
      var val = Math.max(1, Math.min(120, Number(customMinutesInput.value) || 0));
      if (!customMinutesInput.value) return;
      durationChips.forEach(function (c) { c.classList.remove('chip-active'); });
      timerState.totalSeconds = val * 60;
      timerState.remainingSeconds = val * 60;
      renderTimer();
    });
  }

  function playChime() {
    var ctx = getCtx();
    if (!ctx) return;
    [523.25, 659.25, 783.99].forEach(function (freq, i) {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      var startAt = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, startAt);
      g.gain.exponentialRampToValueAtTime(0.2, startAt + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, startAt + 2.2);
      osc.connect(g).connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 2.3);
    });
  }

  function startTimer() {
    if (timerState.remainingSeconds <= 0) return;
    timerState.running = true;
    timerState.soundId = timerSoundSelect ? timerSoundSelect.value : 'none';

    startBtn.hidden = true;
    pauseBtn.hidden = false;
    resumeBtn.hidden = true;
    resetBtn.hidden = false;
    timerSetup.querySelectorAll('button, input, select').forEach(function (el) { el.disabled = true; });

    timerStatus.textContent = 'Settle in and breathe';
    speak('Meditation started for ' + Math.round(timerState.totalSeconds / 60) + ' minutes.');

    if (timerState.soundId && timerState.soundId !== 'none') {
      startSound(timerState.soundId, 45);
      var linkedSlider = document.querySelector('.sound-volume[data-sound="' + timerState.soundId + '"]');
      if (linkedSlider) linkedSlider.value = 45;
    }

    timerState.intervalId = setInterval(function () {
      timerState.remainingSeconds--;
      renderTimer();
      if (timerState.remainingSeconds <= 0) {
        finishTimer();
      }
    }, 1000);
  }

  function pauseTimer() {
    timerState.running = false;
    clearInterval(timerState.intervalId);
    pauseBtn.hidden = true;
    resumeBtn.hidden = false;
    timerStatus.textContent = 'Paused';
  }

  function resumeTimer() {
    timerState.running = true;
    pauseBtn.hidden = false;
    resumeBtn.hidden = true;
    timerStatus.textContent = 'Settle in and breathe';
    timerState.intervalId = setInterval(function () {
      timerState.remainingSeconds--;
      renderTimer();
      if (timerState.remainingSeconds <= 0) finishTimer();
    }, 1000);
  }

  function finishTimer() {
    clearInterval(timerState.intervalId);
    timerState.running = false;
    timerState.remainingSeconds = 0;
    renderTimer();
    timerStatus.textContent = 'Session complete';
    if (timerState.soundId && timerState.soundId !== 'none') stopSound(timerState.soundId);
    syncSoundCardUI();
    playChime();
    speak('Your meditation session is complete.');
    showToast('Meditation session complete.', 'success');
    pauseBtn.hidden = true;
    resumeBtn.hidden = true;
    startBtn.hidden = true;
    resetBtn.hidden = false;
  }

  function resetTimer() {
    clearInterval(timerState.intervalId);
    timerState.running = false;
    var activeChip = document.querySelector('.chip.chip-active[data-minutes]');
    var minutes = activeChip ? Number(activeChip.getAttribute('data-minutes')) : 5;
    if (customMinutesInput && customMinutesInput.value) minutes = Number(customMinutesInput.value);
    timerState.totalSeconds = minutes * 60;
    timerState.remainingSeconds = minutes * 60;
    renderTimer();
    timerStatus.textContent = 'Ready when you are';
    startBtn.hidden = false;
    pauseBtn.hidden = true;
    resumeBtn.hidden = true;
    resetBtn.hidden = true;
    timerSetup.querySelectorAll('button, input, select').forEach(function (el) { el.disabled = false; });
    if (timerState.soundId && timerState.soundId !== 'none') stopSound(timerState.soundId);
    syncSoundCardUI();
  }

  if (startBtn) startBtn.addEventListener('click', startTimer);
  if (pauseBtn) pauseBtn.addEventListener('click', pauseTimer);
  if (resumeBtn) resumeBtn.addEventListener('click', resumeTimer);
  if (resetBtn) resetBtn.addEventListener('click', resetTimer);

  renderTimer();

  /* ==========================================================
     Gratitude journal (localStorage — no DB table yet)
     ========================================================== */
  var GRATITUDE_KEY = 'serenity-gratitude-entries';
  var PROMPTS = [
    'What made you smile today?',
    'Who is someone you appreciate right now, and why?',
    'What is a small comfort you sometimes take for granted?',
    'What is something your body did for you today?',
    'What is a place that makes you feel at ease?',
    'What is a challenge you got through that you are proud of?',
    'What is something beautiful you noticed recently?',
    'Who helped you this week, even in a small way?',
    'What is a memory that still makes you feel warm inside?',
    'What is something about today you would not want to forget?',
    'What is a skill or ability you are thankful to have?',
    'What is something simple that brought you comfort today?'
  ];

  var gratitudePromptEl = document.getElementById('gratitudePrompt');
  var newPromptBtn = document.getElementById('newPromptBtn');
  var readPromptBtn = document.getElementById('readPromptBtn');
  var gratitudeText = document.getElementById('gratitudeText');
  var charCount = document.getElementById('charCount');
  var saveGratitudeBtn = document.getElementById('saveGratitudeBtn');
  var gratitudeList = document.getElementById('gratitudeList');
  var gratitudeEmpty = document.getElementById('gratitudeEmpty');

  var lastPromptIndex = -1;
  function showRandomPrompt() {
    var idx;
    do { idx = Math.floor(Math.random() * PROMPTS.length); } while (idx === lastPromptIndex && PROMPTS.length > 1);
    lastPromptIndex = idx;
    gratitudePromptEl.textContent = PROMPTS[idx];
  }
  if (newPromptBtn) newPromptBtn.addEventListener('click', showRandomPrompt);
  if (readPromptBtn) readPromptBtn.addEventListener('click', function () {
    if (!speechSupported) { showToast('Voice is not supported in this browser.', 'error'); return; }
    var wasEnabled = voiceEnabled;
    voiceEnabled = true;
    speak(gratitudePromptEl.textContent);
    voiceEnabled = wasEnabled;
  });
  showRandomPrompt();

  if (gratitudeText && charCount) {
    gratitudeText.addEventListener('input', function () {
      charCount.textContent = gratitudeText.value.length + ' / 600';
    });
  }

  function loadEntries() {
    try {
      var raw = localStorage.getItem(GRATITUDE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveEntries(entries) {
    try {
      localStorage.setItem(GRATITUDE_KEY, JSON.stringify(entries));
      return true;
    } catch (e) {
      showToast('Could not save — your browser storage may be full or disabled.', 'error');
      return false;
    }
  }

  function formatDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderEntries() {
    var entries = loadEntries();
    gratitudeList.innerHTML = '';
    gratitudeEmpty.classList.toggle('hidden', entries.length > 0);
    entries
      .slice()
      .reverse()
      .forEach(function (entry) {
        var card = document.createElement('div');
        card.className = 'gratitude-entry';
        card.innerHTML =
          '<div class="gratitude-entry-head">' +
            '<span class="gratitude-entry-date"></span>' +
            '<button class="gratitude-entry-delete" type="button">Delete</button>' +
          '</div>' +
          '<p class="gratitude-entry-text"></p>';
        card.querySelector('.gratitude-entry-date').textContent = formatDate(entry.date);
        card.querySelector('.gratitude-entry-text').textContent = entry.text;

        var deleteBtn = card.querySelector('.gratitude-entry-delete');
        var confirming = false;
        var revertTimer = null;
        deleteBtn.addEventListener('click', function () {
          if (!confirming) {
            confirming = true;
            deleteBtn.textContent = 'Confirm?';
            deleteBtn.classList.add('confirming');
            revertTimer = setTimeout(function () {
              confirming = false;
              deleteBtn.textContent = 'Delete';
              deleteBtn.classList.remove('confirming');
            }, 3000);
          } else {
            clearTimeout(revertTimer);
            var current = loadEntries();
            var idx = current.findIndex(function (e) { return e.id === entry.id; });
            if (idx !== -1) current.splice(idx, 1);
            if (saveEntries(current)) {
              renderEntries();
              showToast('Entry deleted.', 'success');
            }
          }
        });

        gratitudeList.appendChild(card);
      });
  }

  if (saveGratitudeBtn) {
    saveGratitudeBtn.addEventListener('click', function () {
      var text = gratitudeText.value.trim();
      if (!text) {
        showToast('Write something before saving.', 'error');
        return;
      }
      var entries = loadEntries();
      entries.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 8), date: new Date().toISOString(), text: text });
      if (saveEntries(entries)) {
        gratitudeText.value = '';
        if (charCount) charCount.textContent = '0 / 600';
        renderEntries();
        showToast('Gratitude entry saved.', 'success');
      }
    });
  }

  renderEntries();

  /* ---------------- Cleanup ---------------- */
  window.addEventListener('beforeunload', function () {
    stopAllSounds();
    if (breathingSession && breathingSession.timeoutId) clearTimeout(breathingSession.timeoutId);
  });

})();