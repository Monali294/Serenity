/* =====================================================
   SERENITY AI COMPANION — FRONTEND LOGIC
   Self-contained: theme toggle included, no dependency
   on script.js. Backend-agnostic — works the same whether
   /send_message is served by  Groq, or anything
   else, as long as the JSON contract below is met.

   -----------------------------------------------------
   FLASK ENDPOINT CONTRACTS (adjust URLs/shapes as needed
   to match your actual routes and DB schema)
   -----------------------------------------------------
   POST /send_message
     body (JSON): { conversation_id: <id>|null, message: "<text>" }
       - conversation_id is null for a brand-new, unsaved chat;
         the server should create a companion_conversations row
         (with a short auto-generated title) on first message.
     response (JSON): {
       status: "success",
       reply: "<assistant reply text>",
       conversation_id: <id>,      // always returned, new or existing
       title: "<conversation title>"  // only needs to be present
                                       // when a new conversation was
                                       // just created
     }

   GET /get_conversation_messages?conversation_id=<id>
     response (JSON): {
       status: "success",
       title: "<conversation title>",
       messages: [ { role: "user"|"assistant", content: "<text>" }, ... ]
     }

   POST /delete_conversation
     body (url-encoded): conversation_id=<id>
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
  const sidebar             = document.getElementById('companionSidebar');
  const sidebarBackdrop     = document.getElementById('sidebarBackdrop');
  const sidebarToggleBtn    = document.getElementById('sidebarToggleBtn');
  const newChatBtn          = document.getElementById('newChatBtn');
  const conversationList    = document.getElementById('conversationList');

  const chatTitle           = document.getElementById('chatTitle');
  const chatScroll          = document.getElementById('chatScroll');
  const chatInner           = document.getElementById('chatInner');

  const chatInput           = document.getElementById('chatInput');
  const micBtn              = document.getElementById('micBtn');
  const sendBtn             = document.getElementById('sendBtn');
  const voiceLiveIndicator  = document.getElementById('voiceLiveIndicator');
  const voiceLiveText       = document.getElementById('voiceLiveText');

  const voiceModeSwitch     = document.getElementById('voiceModeSwitch');

  const modalOverlay        = document.getElementById('companionModalOverlay');
  const modalCancelBtn      = document.getElementById('companionModalCancel');
  const modalConfirmBtn     = document.getElementById('companionModalConfirm');

  const toastContainer      = document.getElementById('toastContainer');

  let currentConversationId = (() => {
    const active = conversationList.querySelector('.convo-item.active');
    return active ? active.dataset.conversationId : null;
  })();

  /* ---------------------------------------------------
     CSRF HELPER
  --------------------------------------------------- */
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? meta.content : '';
  }

  /* ---------------------------------------------------
     TOAST NOTIFICATIONS (same pattern as Sleep/Habit Tracker)
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

  function showSuccessToast(message, emoji) { spawnToast(emoji || '🌿', message, 'success'); }
  function showErrorToast(message) { spawnToast('⚠️', message || 'Something went wrong. Please try again.', 'error'); }

  /* ---------------------------------------------------
     TEXT FORMATTING
     Minimal, safe markdown-ish rendering: escape first,
     then allow **bold** and `code` only.
  --------------------------------------------------- */
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function formatMessageContent(raw) {
    let html = escapeHtml(raw);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
  }

  function stripMarkdownForSpeech(raw) {
    return raw.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
  }

  function truncateTitle(text) {
    const clean = text.trim().replace(/\s+/g, ' ');
    return clean.length > 42 ? clean.slice(0, 42).trim() + '…' : clean;
  }

  /* ---------------------------------------------------
     FEATURE DETECTION — voice input/output
     Both degrade gracefully rather than breaking anything.
  --------------------------------------------------- */
  const ttsSupported = 'speechSynthesis' in window;
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const sttSupported = Boolean(SpeechRecognitionCtor) && window.isSecureContext !== false;

  if (!ttsSupported) {
    voiceModeSwitch.disabled = true;
    voiceModeSwitch.title = 'Voice replies aren\u2019t supported in this browser.';
  }

  if (!sttSupported) {
    micBtn.disabled = true;
    micBtn.title = window.isSecureContext === false
      ? 'Voice input requires a secure (HTTPS) connection.'
      : 'Voice input isn\u2019t supported in this browser. Try Chrome or Edge.';
  }

  /* ---------------------------------------------------
     VOICE MODE (auto-speak replies) — a UI preference
     only, safe to keep in localStorage.
  --------------------------------------------------- */
  const VOICE_MODE_KEY = 'serenity-voice-mode';
  let voiceModeEnabled = ttsSupported && localStorage.getItem(VOICE_MODE_KEY) === 'true';

  function applyVoiceModeUI() {
    voiceModeSwitch.classList.toggle('on', voiceModeEnabled);
    voiceModeSwitch.setAttribute('aria-checked', String(voiceModeEnabled));
  }
  applyVoiceModeUI();

  voiceModeSwitch.addEventListener('click', () => {
    if (!ttsSupported) {
      showErrorToast('Voice replies aren\u2019t supported in this browser.');
      return;
    }
    voiceModeEnabled = !voiceModeEnabled;
    localStorage.setItem(VOICE_MODE_KEY, String(voiceModeEnabled));
    applyVoiceModeUI();
    if (!voiceModeEnabled) window.speechSynthesis.cancel();
  });

  /* ---------------------------------------------------
     TEXT-TO-SPEECH (per-message + voice mode)
  --------------------------------------------------- */
  let currentSpeakingBtn = null;

  function setSpeakingState(btn, speaking) {
    btn.classList.toggle('speaking', speaking);
    const icon = btn.querySelector('i');
    if (icon) icon.className = speaking ? 'fa-solid fa-stop' : 'fa-solid fa-volume-high';
  }

  function toggleSpeak(text, btn) {
    if (!ttsSupported) {
      showErrorToast('Voice replies aren\u2019t supported in this browser.');
      return;
    }

    if (currentSpeakingBtn === btn) {
      window.speechSynthesis.cancel();
      setSpeakingState(btn, false);
      currentSpeakingBtn = null;
      return;
    }

    window.speechSynthesis.cancel();
    if (currentSpeakingBtn) setSpeakingState(currentSpeakingBtn, false);

    const utterance = new SpeechSynthesisUtterance(stripMarkdownForSpeech(text));
    utterance.rate = 1;
    utterance.onend = () => {
      setSpeakingState(btn, false);
      if (currentSpeakingBtn === btn) currentSpeakingBtn = null;
    };
    utterance.onerror = () => {
      setSpeakingState(btn, false);
      if (currentSpeakingBtn === btn) currentSpeakingBtn = null;
    };

    currentSpeakingBtn = btn;
    setSpeakingState(btn, true);
    window.speechSynthesis.speak(utterance);
  }

  /* ---------------------------------------------------
     SPEECH-TO-TEXT (voice input)
  --------------------------------------------------- */
  let recognition = null;
  let isRecording = false;

  if (sttSupported) {
    recognition = new SpeechRecognitionCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      chatInput.value = transcript;
      autosizeTextarea();
      sendBtn.disabled = !transcript.trim();
    };

    recognition.onerror = (event) => {
      isRecording = false;
      micBtn.classList.remove('recording');
      voiceLiveIndicator.hidden = true;

      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        showErrorToast('Microphone access was denied. Please allow it in your browser settings.');
      } else if (event.error === 'network') {
        showErrorToast('Voice input needs an internet connection.');
      } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
        showErrorToast('Voice input ran into a problem. Please try again.');
      }
    };

    recognition.onend = () => {
      isRecording = false;
      micBtn.classList.remove('recording');
      voiceLiveIndicator.hidden = true;

      const transcript = chatInput.value.trim();
      if (transcript) {
        chatInput.value = '';
        autosizeTextarea();
        sendBtn.disabled = true;
        sendMessage(transcript);
      }
    };

    micBtn.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
        return;
      }

      try {
        recognition.start();
        isRecording = true;
        micBtn.classList.add('recording');
        voiceLiveIndicator.hidden = false;
        voiceLiveText.textContent = 'Listening…';
      } catch (error) {
        console.error(error);
        showErrorToast('Couldn\u2019t start voice input. Please try again.');
      }
    });
  }

  /* ---------------------------------------------------
     TEXTAREA — autosize + enable/disable send
  --------------------------------------------------- */
  function autosizeTextarea() {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px';
  }

  chatInput.addEventListener('input', () => {
    autosizeTextarea();
    sendBtn.disabled = !chatInput.value.trim();
  });

  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (chatInput.value.trim()) handleSendClick();
    }
  });

  function handleSendClick() {
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    autosizeTextarea();
    sendBtn.disabled = true;
    sendMessage(text);
  }

  sendBtn.addEventListener('click', handleSendClick);

  /* ---------------------------------------------------
     MESSAGE RENDERING
  --------------------------------------------------- */
  function scrollToBottom() {
    requestAnimationFrame(() => { chatScroll.scrollTop = chatScroll.scrollHeight; });
  }

  function hideWelcome() {
    const welcome = document.getElementById('chatWelcome');
    if (welcome) welcome.remove();
  }

  function buildWelcomeBlock() {
    const div = document.createElement('div');
    div.className = 'chat-welcome';
    div.id = 'chatWelcome';
    div.innerHTML = `
      <div class="welcome-orb" aria-hidden="true">🌿</div>
      <h2>Hi, I'm here for you.</h2>
      <p>Talk or type — whatever's on your mind. This is a calm, judgment-free space just for you.</p>
      <div class="welcome-suggestions">
        <button type="button" class="suggestion-chip">I'm feeling a bit anxious today</button>
        <button type="button" class="suggestion-chip">Help me plan a calming evening</button>
        <button type="button" class="suggestion-chip">I just want to vent for a minute</button>
      </div>
    `;
    return div;
  }

  function buildMessageRow(role, rawText) {
    const row = document.createElement('div');
    row.className = 'msg-row msg-' + role;
    row.dataset.role = role;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.innerHTML = role === 'assistant' ? '✨' : '<i class="fa-solid fa-user"></i>';

    const wrap = document.createElement('div');
    wrap.className = 'msg-bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.dataset.raw = rawText;
    const textSpan = document.createElement('span');
    textSpan.className = 'msg-text';
    textSpan.innerHTML = formatMessageContent(rawText);
    bubble.appendChild(textSpan);

    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = '<button type="button" class="msg-action-btn msg-copy-btn" aria-label="Copy message"><i class="fa-regular fa-copy"></i></button>'
      + (role === 'assistant' ? '<button type="button" class="msg-action-btn msg-speak-btn" aria-label="Read this message aloud"><i class="fa-solid fa-volume-high"></i></button>' : '');

    wrap.appendChild(bubble);
    wrap.appendChild(actions);

    row.appendChild(avatar);
    row.appendChild(wrap);

    return row;
  }

  function buildThinkingRow() {
    const row = document.createElement('div');
    row.className = 'msg-row msg-assistant msg-thinking';
    row.innerHTML = `
      <div class="msg-avatar" aria-hidden="true">✨</div>
      <div class="msg-bubble-wrap">
        <div class="msg-bubble">
          <span class="thinking-dot"></span><span class="thinking-dot"></span><span class="thinking-dot"></span>
        </div>
      </div>
    `;
    return row;
  }

  /* Delegated handlers for message actions + welcome suggestion chips */
  chatInner.addEventListener('click', (event) => {
    const chip = event.target.closest('.suggestion-chip');
    if (chip) {
      sendMessage(chip.textContent.trim());
      return;
    }

    const copyBtn = event.target.closest('.msg-copy-btn');
    if (copyBtn) {
      const bubble = copyBtn.closest('.msg-bubble-wrap').querySelector('.msg-bubble');
      copyToClipboard(bubble.dataset.raw || bubble.textContent);
      return;
    }

    const speakBtn = event.target.closest('.msg-speak-btn');
    if (speakBtn) {
      const bubble = speakBtn.closest('.msg-bubble-wrap').querySelector('.msg-bubble');
      toggleSpeak(bubble.dataset.raw || bubble.textContent, speakBtn);
    }
  });

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => showSuccessToast('Copied to clipboard.', '📋'))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showSuccessToast('Copied to clipboard.', '📋');
    } catch (error) {
      showErrorToast('Couldn\u2019t copy automatically — please select and copy manually.');
    }
    document.body.removeChild(ta);
  }

  /* ---------------------------------------------------
     SEND A MESSAGE
  --------------------------------------------------- */
  function sendMessage(text) {
    if (!text || !text.trim()) return;

    hideWelcome();

    const userRow = buildMessageRow('user', text);
    chatInner.appendChild(userRow);

    const thinkingRow = buildThinkingRow();
    chatInner.appendChild(thinkingRow);
    scrollToBottom();

    fetch('/send_message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRFToken': getCsrfToken()
      },
      body: JSON.stringify({ conversation_id: currentConversationId, message: text })
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        if (thinkingRow.isConnected) thinkingRow.remove();

        if (data.status !== 'success') {
          throw new Error(data.message || 'Unable to get a response.');
        }

        const isNewConversation = !currentConversationId;
        if (data.conversation_id) currentConversationId = data.conversation_id;

        if (isNewConversation && currentConversationId) {
          const title = data.title || truncateTitle(text);
          addConversationToSidebar(currentConversationId, title, true);
          chatTitle.textContent = title;
        }

        const replyRow = buildMessageRow('assistant', data.reply || '');
        chatInner.appendChild(replyRow);
        scrollToBottom();

        if (voiceModeEnabled && ttsSupported && data.reply) {
          const speakBtn = replyRow.querySelector('.msg-speak-btn');
          if (speakBtn) toggleSpeak(data.reply, speakBtn);
        }
      })
      .catch((error) => {
        console.error(error);
        if (thinkingRow.isConnected) thinkingRow.remove();

        const errorRow = buildMessageRow('assistant', "I'm having trouble responding right now. Please try again in a moment.");
        chatInner.appendChild(errorRow);
        scrollToBottom();

        showErrorToast('Couldn\u2019t reach the AI Companion. Please try again.');
      });
  }

  /* ---------------------------------------------------
     SIDEBAR — conversation list
  --------------------------------------------------- */
  function setActiveConversationItem(id) {
    conversationList.querySelectorAll('.convo-item').forEach((item) => {
      item.classList.toggle('active', String(item.dataset.conversationId) === String(id));
    });
  }

  function addConversationToSidebar(id, title, makeActive) {
    const emptyMsg = document.getElementById('sidebarEmptyMsg');
    if (emptyMsg) emptyMsg.remove();

    if (makeActive) setActiveConversationItem(null); // clear any existing active state first

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'convo-item' + (makeActive ? ' active' : '');
    item.dataset.conversationId = id;
    item.innerHTML = '<i class="fa-regular fa-message convo-icon" aria-hidden="true"></i>'
      + '<span class="convo-text"></span>'
      + '<span class="convo-delete-btn" role="button" tabindex="0" aria-label="Delete conversation"><i class="fa-regular fa-trash-can"></i></span>';
    item.querySelector('.convo-text').textContent = title;

    conversationList.prepend(item);
  }

  function loadConversation(id) {
    if (String(id) === String(currentConversationId)) {
      closeMobileSidebar();
      return;
    }

    fetch(`/get_conversation_messages?conversation_id=${encodeURIComponent(id)}`, {
      headers: { 'X-CSRFToken': getCsrfToken() }
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        if (data.status !== 'success') throw new Error(data.message || 'Unable to load that conversation.');

        currentConversationId = id;
        chatTitle.textContent = data.title || 'AI Companion';
        chatInner.innerHTML = '';

        (data.messages || []).forEach((msg) => {
          chatInner.appendChild(buildMessageRow(msg.role, msg.content));
        });

        setActiveConversationItem(id);
        closeMobileSidebar();
        scrollToBottom();
      })
      .catch((error) => {
        console.error(error);
        showErrorToast('Couldn\u2019t load that conversation. Please try again.');
      });
  }

  function startNewChat() {
    currentConversationId = null;
    chatTitle.textContent = 'AI Companion';
    chatInner.innerHTML = '';
    chatInner.appendChild(buildWelcomeBlock());
    setActiveConversationItem(null);
    closeMobileSidebar();
    chatInput.focus();
  }

  newChatBtn.addEventListener('click', startNewChat);

  conversationList.addEventListener('click', (event) => {
    const deleteTarget = event.target.closest('.convo-delete-btn');
    const item = event.target.closest('.convo-item');
    if (!item) return;

    if (deleteTarget) {
      event.stopPropagation();
      openDeleteModal(item);
      return;
    }

    loadConversation(item.dataset.conversationId);
  });

  conversationList.addEventListener('keydown', (event) => {
    const deleteTarget = event.target.closest('.convo-delete-btn');
    if (deleteTarget && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openDeleteModal(deleteTarget.closest('.convo-item'));
    }
  });

  /* ---------------------------------------------------
     DELETE CONVERSATION MODAL
  --------------------------------------------------- */
  let pendingDeleteItem = null;
  let lastFocusedElement = null;

  function openDeleteModal(item) {
    pendingDeleteItem = item;
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
    pendingDeleteItem = null;
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
    if (!pendingDeleteItem) return;
    const item = pendingDeleteItem;
    const id = item.dataset.conversationId;

    modalConfirmBtn.disabled = true;

    fetch('/delete_conversation', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': getCsrfToken()
      },
      body: new URLSearchParams({ conversation_id: id })
    })
      .then((response) => {
        if (!response.ok) throw new Error('Server responded with status ' + response.status);
        return response.json();
      })
      .then((data) => {
        modalConfirmBtn.disabled = false;
        closeDeleteModal();

        if (data.status !== 'success') {
          showErrorToast(data.message || 'Unable to delete that conversation.');
          return;
        }

        const wasActive = String(id) === String(currentConversationId);
        item.remove();

        if (conversationList.querySelectorAll('.convo-item').length === 0) {
          const emptyMsg = document.createElement('p');
          emptyMsg.className = 'sidebar-empty';
          emptyMsg.id = 'sidebarEmptyMsg';
          emptyMsg.textContent = 'No conversations yet — start one below.';
          conversationList.appendChild(emptyMsg);
        }

        if (wasActive) startNewChat();

        showSuccessToast('Conversation deleted.', '🗑️');
      })
      .catch((error) => {
        console.error(error);
        modalConfirmBtn.disabled = false;
        closeDeleteModal();
        showErrorToast('Couldn\u2019t delete that conversation. Please try again.');
      });
  });

  /* ---------------------------------------------------
     MOBILE SIDEBAR
  --------------------------------------------------- */
  function openMobileSidebar() {
    sidebar.classList.add('sidebar-open');
    sidebarBackdrop.classList.add('visible');
  }

  function closeMobileSidebar() {
    sidebar.classList.remove('sidebar-open');
    sidebarBackdrop.classList.remove('visible');
  }

  sidebarToggleBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('sidebar-open')) closeMobileSidebar();
    else openMobileSidebar();
  });

  sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  /* ---------------------------------------------------
     INITIAL STATE
  --------------------------------------------------- */

  // Re-format any Jinja-rendered messages already on the page,
  // and store their raw text for copy/speak to use.
  chatInner.querySelectorAll('.msg-bubble').forEach((bubble) => {
    const textSpan = bubble.querySelector('.msg-text');
    if (!textSpan) return;
    const raw = textSpan.textContent;
    bubble.dataset.raw = raw;
    textSpan.innerHTML = formatMessageContent(raw);
  });

  autosizeTextarea();
  scrollToBottom();
});