// Bullet Auto: Optimized in-browser AI Chatbot using WebLLM (local, private)
// Enhancements: lazy model load, streaming tokens, conversation persistence, clear chat, accessibility & shortcuts.

const BA_CHATBOT = (() => {
  const STORAGE_KEY = 'ba_chat_history_v1';
  const MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
  const FALLBACK_MODEL_ID = 'TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC'; // smaller fallback
  const MODEL_HINT = '(Please be patient and note this is running fully locally in your browser,this is a Beta feature.)';
  const MAX_HISTORY = 15; // keep conversation short to save memory
  const DEFAULT_MAX_TOKENS = 220; // lower token budget for faster responses
  const GEN_TIMEOUT_MS = 15000; // abort streaming update after 15s
  const AUTOSWITCH_TO_AI = false; // do not auto-switch; ask user to toggle 🧠 instead
  let LITE_MODE = true; // start in lite mode to avoid auto heavy model download
  const FAQ = [
    { q: /hours|open|closing|time/i, a: 'We are open Mon–Fri 08:00–17:30 and Sat 08:00–13:00.'},
    { q: /address|where|location/i, a: 'Our address is 7 Strand Road, Bellville, Cape Town.'},
    { q: /contact|phone|number|call|whatsapp/i, a: 'You can WhatsApp or call +27 72 345 3221 and email services@bulletauto.co.za.'},
    { q: /services|offer|do you do/i, a: 'We handle vehicle repairs, scheduled maintenance, 4x4 fitment, and detailing.'},
    { q: /book|booking|appointment/i, a: 'You can book online via the Book Service page or WhatsApp us for urgent slots.'},
    { q: /price|cost|quote|how much/i, a: 'Pricing varies by vehicle and work scope—please request a quote via WhatsApp or booking form.'},
  ];
  const WELCOME = 'Hi! I’m the Bullet Auto AI assistant. Ask about services, booking, pricing ranges, or directions.';

  const SYSTEM_PROMPT = `You are Bullet Auto Service Station's helpful assistant. Answer concisely and professionally about vehicle repairs, scheduled maintenance, 4x4 fitment, and detailing. Business info: Name: Bullet Auto Service Station. Address: 7 Strand Road, Bellville, Cape Town. Hours: Mon–Fri 08:00–17:30, Sat 08:00–13:00. WhatsApp/Phone: +27 72 345 3221 (https://wa.me/27723453221). Email: services@bulletauto.co.za. Guidelines: If a question needs a quote or booking, invite contact or booking. Do not invent exact prices; give typical ranges + disclaimers. Keep answers < 6 sentences when possible.`;

  let engine;
  let initializing = false;
  let cancelledInit = false;
  let streamingMessageDiv = null;
  let modelImported = false;
  let modRef = null;
  let lastInitError = null;
  let generating = false;

  // Load persisted history (excluding system) then prepend system
  function loadHistory() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [{ role: 'system', content: SYSTEM_PROMPT }];
      const parsed = JSON.parse(raw).filter(m => m.role !== 'system');
      return [{ role: 'system', content: SYSTEM_PROMPT }, ...parsed];
    } catch (e) {
      return [{ role: 'system', content: SYSTEM_PROMPT }];
    }
  }
  let history = loadHistory();

  function persistHistory() {
    try {
      const trimmed = history.filter(m => m.role !== 'system').slice(-MAX_HISTORY);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (_) { /* ignore quota errors */ }
  }

  // Styles
  function injectStyles() {
    if (document.getElementById('ba-chatbot-styles')) return;
    const css = `
      .ba-chat-fab { position:fixed; right:18px; bottom:18px; z-index:2147483000; width:56px; height:56px; border-radius:50%; border:none; cursor:pointer; color:#fff; background:#1a237e; box-shadow:0 10px 30px rgba(26,35,126,0.35); display:flex; align-items:center; justify-content:center; transition:transform .2s, box-shadow .2s, background .2s; }
      .ba-chat-fab:hover, .ba-chat-fab:focus-visible { outline:none; transform:translateY(-2px) scale(1.03); box-shadow:0 16px 36px rgba(26,35,126,0.45); background:#3949ab; }
      .ba-chat-fab svg { width:26px; height:26px; }
      .ba-chat-window { position:fixed; right:18px; bottom:84px; width:min(380px,calc(100vw - 24px)); max-height:min(72vh,680px); display:none; flex-direction:column; background:rgba(255,255,255,0.9); backdrop-filter:blur(14px) saturate(160%); -webkit-backdrop-filter:blur(14px) saturate(160%); border:1px solid rgba(26,35,126,0.18); border-radius:18px; box-shadow:0 18px 50px rgba(26,35,126,0.28); overflow:hidden; z-index:2147483000; }
      .ba-chat-header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:linear-gradient(180deg,rgba(224,234,252,0.95),rgba(207,222,243,0.95)); color:#1a237e; font-family:'Orbitron',system-ui,sans-serif; font-weight:700; letter-spacing:.4px; font-size:.95rem; }
      .ba-chat-header-left { display:flex; flex-direction:column; }
      .ba-chat-header-actions { display:flex; align-items:center; gap:6px; }
      .ba-chat-header button { background:transparent; border:none; color:#1a237e; font-size:18px; cursor:pointer; padding:4px 8px; border-radius:8px; line-height:1; }
      .ba-chat-header button:hover, .ba-chat-header button:focus-visible { background:rgba(26,35,126,0.1); outline:none; }
      .ba-chat-messages { padding:12px; display:flex; flex-direction:column; gap:10px; overflow:auto; scrollbar-width:thin; max-height:58vh; }
      .ba-msg { padding:10px 12px; border-radius:12px; line-height:1.45; font-size:0.93rem; white-space:pre-wrap; word-break:break-word; }
      .ba-user { align-self:flex-end; background:#e0eafc; color:#1a237e; border:1px solid rgba(26,35,126,0.15); }
      .ba-bot { align-self:flex-start; background:#ffffff; color:#0b1b34; border:1px solid rgba(26,35,126,0.12); }
      .ba-bot.streaming { animation:pulseBorder 1s infinite alternate; }
      @keyframes pulseBorder { from { box-shadow:0 0 0 rgba(26,35,126,0);} to { box-shadow:0 0 8px rgba(26,35,126,0.25);} }
      .ba-chat-input { display:flex; gap:8px; padding:10px; border-top:1px solid rgba(26,35,126,0.12); background:rgba(255,255,255,0.95); }
      .ba-chat-input input { flex:1; padding:10px 12px; border-radius:10px; border:1px solid rgba(26,35,126,0.25); font-size:.95rem; }
      .ba-chat-input input:focus { outline:2px solid #3949ab33; border-color:#3949ab; }
      .ba-chat-input button { padding:10px 14px; border-radius:10px; border:none; background:#1a237e; color:#fff; cursor:pointer; font-weight:700; display:inline-flex; align-items:center; gap:4px; }
      .ba-chat-input button:hover, .ba-chat-input button:focus-visible { background:#3949ab; outline:none; }
      .ba-status { padding:4px 12px; font-size:11px; color:#1a237e; opacity:0.9; display:flex; justify-content:space-between; align-items:center; gap:8px; }
      .ba-note { font-size:11px; color:#1a237e; opacity:0.7; padding:0 12px 8px; }
      .ba-hidden { display:none !important; }
    `;
    const style = document.createElement('style');
    style.id = 'ba-chatbot-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function createUI() {
    if (document.getElementById('ba-chat-fab')) return;
    injectStyles();
    const fab = document.createElement('button');
    fab.id = 'ba-chat-fab';
    fab.className = 'ba-chat-fab';
    fab.setAttribute('aria-label','Open Bullet Auto AI chat');
    fab.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M2 5a3 3 0 0 1 3-3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9.83l-3.58 3.59A1 1 0 0 1 5 20v-3H5a3 3 0 0 1-3-3V5z"/></svg>';

    const win = document.createElement('div');
    win.className = 'ba-chat-window';
    win.id = 'ba-chat-window';
    win.setAttribute('role','dialog');
    win.setAttribute('aria-label','Bullet Auto AI chat window');
    win.setAttribute('aria-modal','false');
    win.innerHTML = `
      <div class="ba-chat-header">
        <div class="ba-chat-header-left">
          <span>Bullet Auto AI</span>
          <small style="font-weight:400; opacity:0.75; font-size:11px;">Private on-device model ${MODEL_HINT}</small>
        </div>
        <div class="ba-chat-header-actions">
          <button id="ba-clear" title="Clear conversation" aria-label="Clear conversation">🗑</button>
          <button id="ba-lite-toggle" title="Toggle lite mode" aria-label="Toggle lite mode">⚡</button>
            <button id="ba-diagnostics" title="Diagnostics" aria-label="Diagnostics">ℹ️</button>
          <button id="ba-close" title="Close chat" aria-label="Close chat">×</button>
        </div>
      </div>
      <div class="ba-status" id="ba-status"><span>${navigator.gpu ? 'Idle' : 'WebGPU not detected – may not run.'}</span><span id="ba-elapsed"></span></div>
      <div class="ba-chat-messages" id="ba-messages" aria-live="polite" aria-label="Chat messages"></div>
        <div id="ba-diagnostics-panel" class="ba-hidden" style="margin:0 12px 8px; padding:10px 12px; border:1px solid rgba(26,35,126,0.15); border-radius:10px; background:rgba(255,255,255,0.85); font-size:11px; line-height:1.5;">
          <strong style="font-family:'Orbitron',sans-serif; display:block; margin-bottom:6px;">Diagnostics</strong>
          <div id="ba-diag-content">Loading...</div>
          <div style="display:flex; gap:6px; margin-top:8px; flex-wrap:wrap;">
            <button id="ba-diag-refresh" style="background:#1a237e;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Refresh</button>
            <button id="ba-diag-retry" style="background:#3949ab;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Retry Model</button>
            <button id="ba-diag-cancel" style="background:#e53935;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Cancel Load</button>
            <button id="ba-diag-copy" style="background:#25d366;color:#0b1b34;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Copy Report</button>
            <button id="ba-diag-fallback" style="background:#00897b;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Use Fallback Model</button>
            <button id="ba-diag-reset" style="background:#546e7a;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;font-size:11px;">Reset Engine</button>
          </div>
        </div>
      <div class="ba-note">Ask about services, bookings or general car care. Ctrl+Enter to send. Esc to close.</div>
      <div class="ba-chat-input">
        <input id="ba-input" type="text" placeholder="Type your question..." aria-label="Chat message input" autocomplete="off" />
        <button id="ba-send" aria-label="Send message">Send</button>
      </div>`;

    document.body.appendChild(fab);
    document.body.appendChild(win);

    // Restore history UI
    const existing = history.filter(m => m.role !== 'system');
    if (existing.length === 0) {
      addMessage('assistant', WELCOME);
    } else {
      existing.forEach(m => addMessage(m.role === 'assistant' ? 'assistant' : 'user', m.content));
    }

  fab.addEventListener('click', () => toggleWindow(true));
    win.querySelector('#ba-close').addEventListener('click', () => toggleWindow(false));
    win.querySelector('#ba-clear').addEventListener('click', clearConversation);
  win.querySelector('#ba-lite-toggle').addEventListener('click', toggleLiteMode);
    win.querySelector('#ba-diagnostics').addEventListener('click', toggleDiagnostics);
    win.querySelector('#ba-send').addEventListener('click', () => onSend());
    win.querySelector('#ba-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) { e.preventDefault(); onSend(); }
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSend(); }
      if (e.key === 'Escape') { toggleWindow(false); }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleWindow(false); });
  }

  function toggleWindow(show) {
    const win = document.getElementById('ba-chat-window');
    if (!win) return;
    const fab = document.getElementById('ba-chat-fab');
    if (show) {
      win.style.display = 'flex';
      setTimeout(() => document.getElementById('ba-input')?.focus(), 30);
      // Only load engine automatically if not in lite mode
      if (!LITE_MODE) ensureEngine();
    } else {
      win.style.display = 'none';
      fab?.focus();
    }
  }

  function toggleLiteMode() {
    // If WebGPU is not available, stay in lite mode
    if (!navigator.gpu) {
      addMessage('assistant', 'Full AI requires a WebGPU-enabled browser (Chrome/Edge latest, hardware acceleration on). Staying in lite mode.');
      return;
    }
    // If model is currently initializing, allow cancel
    if (initializing) {
      if (!cancelledInit) {
        cancelledInit = true;
        addMessage('assistant', 'Cancelling model load. Remaining in lite mode.');
      }
      return;
    }
    LITE_MODE = !LITE_MODE;
    const btn = document.getElementById('ba-lite-toggle');
    if (btn) btn.textContent = LITE_MODE ? '⚡' : '🧠';
    addMessage('assistant', LITE_MODE ? 'Lite mode enabled: quick FAQ answers, minimal data usage.' : 'Full AI mode: loading model when needed for richer answers.');
    if (!LITE_MODE && !engine) ensureEngine();
  }

  function addMessage(role, content, { streaming = false } = {}) {
    const list = document.getElementById('ba-messages');
    if (!list) return;
    const div = document.createElement('div');
    div.className = `ba-msg ${role === 'user' ? 'ba-user' : 'ba-bot'}${streaming ? ' streaming' : ''}`;
    div.textContent = content;
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
    if (streaming) streamingMessageDiv = div;
    return div;
  }

  function updateStreamingAppend(text) {
    if (!streamingMessageDiv) return;
    streamingMessageDiv.textContent += text;
    const list = document.getElementById('ba-messages');
    list.scrollTop = list.scrollHeight;
  }

  function finalizeStreaming() {
    if (streamingMessageDiv) streamingMessageDiv.classList.remove('streaming');
    streamingMessageDiv = null;
  }

  function gatherDiagnostics() {
    const diag = {};
    diag.webgpu = !!navigator.gpu;
    diag.userAgent = navigator.userAgent;
    diag.platform = navigator.platform;
    diag.memory = navigator.deviceMemory || 'n/a';
    diag.concurrent = generating;
    diag.initializing = initializing;
    diag.cancelledInit = cancelledInit;
    diag.engineReady = !!engine;
    diag.lastInitError = lastInitError ? (lastInitError.message || String(lastInitError)) : 'none';
    diag.liteMode = LITE_MODE;
    diag.historyLength = history.length;
    diag.modelId = engine ? MODEL_ID : '(not loaded)';
    diag.fallbackUsed = engine && lastInitError ? true : false;
    return diag;
  }

  function formatDiagnostics(diag) {
    return [
      `WebGPU: ${diag.webgpu}`,
      `Lite Mode: ${diag.liteMode}`,
      `Engine Ready: ${diag.engineReady}`,
      `Initializing: ${diag.initializing}`,
      `Cancelled Init: ${diag.cancelledInit}`,
      `Generating: ${diag.concurrent}`,
      `Model ID: ${diag.modelId}`,
      `Fallback Used: ${diag.fallbackUsed}`,
      `History Length: ${diag.historyLength}`,
      `Last Init Error: ${diag.lastInitError}`,
      `Device Memory (GB): ${diag.memory}`,
      `Platform: ${diag.platform}`,
      `UA: ${diag.userAgent}`
    ].join('\n');
  }

  function renderDiagnostics() {
    const panel = document.getElementById('ba-diag-content');
    if (!panel) return;
    // Clear stale cancelled flag if engine is ready
    if (engine && cancelledInit && !initializing) cancelledInit = false;
    const diag = gatherDiagnostics();
    panel.textContent = formatDiagnostics(diag);
  }

  function toggleDiagnostics() {
    const panel = document.getElementById('ba-diagnostics-panel');
    if (!panel) return;
    const hidden = panel.classList.contains('ba-hidden');
    if (hidden) {
      panel.classList.remove('ba-hidden');
      renderDiagnostics();
      attachDiagButtons();
    } else {
      panel.classList.add('ba-hidden');
    }
  }

  function attachDiagButtons() {
    const refresh = document.getElementById('ba-diag-refresh');
    const retry = document.getElementById('ba-diag-retry');
    const cancelBtn = document.getElementById('ba-diag-cancel');
    const copyBtn = document.getElementById('ba-diag-copy');
    const fallbackBtn = document.getElementById('ba-diag-fallback');
    const resetBtn = document.getElementById('ba-diag-reset');
    if (refresh) refresh.onclick = () => renderDiagnostics();
    if (retry) retry.onclick = async () => { if (!engine) { await ensureEngine(); renderDiagnostics(); } else { addMessage('assistant','Model already loaded.'); } };
    if (cancelBtn) cancelBtn.onclick = () => { if (initializing && !cancelledInit) { cancelledInit = true; addMessage('assistant','Cancel requested.'); } else { addMessage('assistant','Nothing to cancel.'); } renderDiagnostics(); };
    if (copyBtn) copyBtn.onclick = () => {
      try { const diag = formatDiagnostics(gatherDiagnostics()); navigator.clipboard.writeText(diag); addMessage('assistant','Diagnostics copied to clipboard.'); }
      catch { addMessage('assistant','Unable to copy diagnostics.'); }
    };
    if (fallbackBtn) fallbackBtn.onclick = async () => {
      if (initializing) { addMessage('assistant','Wait for current load to finish or cancel first.'); return; }
      if (engine && lastInitError) { addMessage('assistant','Already using fallback model.'); return; }
      await ensureEngine(true);
      renderDiagnostics();
    };
    if (resetBtn) resetBtn.onclick = async () => {
      if (initializing) { addMessage('assistant','Cannot reset while loading. Cancel first.'); return; }
      try { if (engine?.dispose) engine.dispose(); } catch(_) {}
      engine = null;
      lastInitError = null;
      addMessage('assistant','Engine reset. Use Retry Model or Fallback to load again.');
      renderDiagnostics();
    };
  }

  function liteHeuristicReply(text) {
    const t = text.toLowerCase();
    // Greetings
    if (/^(hi|hello|hey|howzit|good\s*(day|morning|afternoon|evening))\b/.test(t)) {
      return 'Hi! How can I help with your vehicle today? We handle repairs, services, 4x4 fitment and detailing.';
    }
    // Thanks
    if (/thank(s| you)|cheers|appreciate/i.test(text)) {
      return 'You’re welcome! If you need a quote or booking, WhatsApp +27 72 345 3221 or use Book Service.';
    }
    // Directions
    if (/directions|how to (get|go)|map|near/i.test(t)) {
      return 'We’re at 7 Strand Road, Bellville, Cape Town. Landmarks: near Bellville CBD. Message us if you need a pin.';
    }
    // Turnaround / availability
    if (/how long|turnaround|available|today|slot|when can/i.test(t)) {
      return 'Typical same-day for minor work, 1–3 days for bigger jobs. For earliest availability, WhatsApp us and we’ll slot you in.';
    }
    // Pricing generic
    if (/(how much|price|cost|quote)/i.test(t)) {
      return 'Pricing depends on vehicle and work. Share your make/model and symptoms and we’ll quote fast via WhatsApp or booking.';
    }
    // Detailing specifics
    if (/(detail|valet|ceramic|polish|wash)/i.test(t)) {
      return 'We offer washes, micro/mini/full valets, machine polish, ceramic coatings, engine bay & undercarriage cleaning. Book to get a tailored quote.';
    }
    // Aircon, brakes, clutches keywords
  if (/(aircon|a\/?c|brake|clutch|cv|suspension|bearing)/i.test(t)) {
      return 'Yes, we service aircon, brakes, clutches, CVs, suspension and more. Tell us year/make/model and issue—happy to help.';
    }
    // Booking intent
    if (/(book|booking|appointment|schedule)/i.test(t)) {
      return 'You can book online via the Book Service page or WhatsApp +27 72 345 3221 for urgent bookings.';
    }
    return null;
  }

  async function importModelLib() {
    if (modelImported) return modRef;
    // Optional connectivity probe (non-blocking):
    try {
      await fetch('https://esm.run/@mlc-ai/web-llm', { method: 'HEAD' });
    } catch (_) { /* ignore - may be blocked but dynamic import can still succeed */ }
    modRef = await import('https://esm.run/@mlc-ai/web-llm');
    modelImported = true;
    return modRef;
  }

  async function ensureEngine(preferFallback = false) {
    // If currently loading, don't start another
    if (initializing) return engine;
    // If engine already exists
    if (engine) {
      // If user explicitly wants fallback but we appear to be on primary, reset to reload
      if (preferFallback && !lastInitError) {
        try { if (engine?.dispose) engine.dispose(); } catch(_) {}
        engine = null;
      } else {
        return engine;
      }
    }
    // WebGPU preflight
    if (!navigator.gpu) {
      addMessage('assistant', 'Your browser does not support WebGPU. Use Chrome/Edge (latest) with hardware acceleration. Staying in lite mode.');
      LITE_MODE = true;
      const btn = document.getElementById('ba-lite-toggle');
      if (btn) btn.textContent = '⚡';
      return null;
    }
    initializing = true;
    cancelledInit = false;
    // When switching models, clear previous error unless we will mark fallback selection
    lastInitError = null;
    const status = document.getElementById('ba-status');
    if (status) status.firstChild.textContent = 'Loading AI model...';
    const start = performance.now();
    try {
      const mod = await importModelLib();
      if (cancelledInit) throw new Error('User cancelled');
      if (preferFallback) {
        // Load fallback model by request
        engine = await mod.CreateMLCEngine(FALLBACK_MODEL_ID, {
          initProgressCallback: (p) => {
            if (cancelledInit) return;
            if (p && p.text && status) status.firstChild.textContent = '[Fallback] ' + p.text;
          }
        });
        // Mark that fallback was chosen so diagnostics reflect it
        lastInitError = new Error('User selected fallback');
        addMessage('assistant', 'Fallback model loaded by request. Answers may be simpler.');
      } else {
        // Try primary model first, then fallback on failure
        try {
          engine = await mod.CreateMLCEngine(MODEL_ID, {
            initProgressCallback: (p) => {
              if (cancelledInit) return;
              if (p && p.text && status) status.firstChild.textContent = p.text;
            }
          });
        } catch (errPrimary) {
          lastInitError = errPrimary;
          if (status) status.firstChild.textContent = 'Primary model failed. Trying fallback...';
          engine = await mod.CreateMLCEngine(FALLBACK_MODEL_ID, {
            initProgressCallback: (p) => {
              if (cancelledInit) return;
              if (p && p.text && status) status.firstChild.textContent = '[Fallback] ' + p.text;
            }
          });
          addMessage('assistant', 'Using a smaller fallback model due to load issue. Answers may be simpler.');
        }
      }
      if (status) status.firstChild.textContent = 'AI ready';
      const elapsed = ((performance.now() - start)/1000).toFixed(1);
      const el = document.getElementById('ba-elapsed');
      if (el) el.textContent = `(${elapsed}s)`;
      cancelledInit = false;
      return engine;
    } catch (err) {
      console.error('WebLLM init failed', err);
      lastInitError = err;
      if (status) status.firstChild.textContent = cancelledInit ? 'Cancelled' : 'AI failed to load';
      addMessage('assistant', cancelledInit ? 'Model loading was cancelled. Staying in lite mode.' : 'Sorry, full AI could not load (network/browser limits). Staying in lite mode.');
      LITE_MODE = true;
      const btn = document.getElementById('ba-lite-toggle');
      if (btn) btn.textContent = '⚡';
      return null;
    } finally {
      initializing = false;
    }
  }

  async function onSend() {
    const input = document.getElementById('ba-input');
    const status = document.getElementById('ba-status');
    if (!input) return;
    const text = (input.value || '').trim();
    if (!text) return;
    if (generating) {
      addMessage('assistant', 'I’m still answering the previous message. Please wait a moment.');
      return;
    }
    generating = true;
    input.value = '';
    addMessage('user', text);
    history.push({ role: 'user', content: text });
    persistHistory();
    // Defer ensureEngine until after lite FAQ check
    let eng = null;
    if (!LITE_MODE) {
      eng = await ensureEngine();
      if (!eng) return; // engine failure already messaged
    }
    if (status) status.firstChild.textContent = LITE_MODE ? 'Checking...' : 'Thinking...';

  // Start streaming placeholder
  addMessage('assistant', '', { streaming: true });
  const partial = { role: 'assistant', content: '' };
  history.push(partial); // will mutate content as we stream

    try {
      const start = performance.now();
      let accumulated = '';
      // Lite mode fast paths
      if (LITE_MODE) {
        const match = FAQ.find(f => f.q.test(text));
        if (match) {
          addMessage('assistant', match.a);
          history.push({ role: 'assistant', content: match.a });
          persistHistory();
          if (status) status.firstChild.textContent = 'Idle (lite)';
          return;
        }
        const heuristic = liteHeuristicReply(text);
        if (heuristic) {
          addMessage('assistant', heuristic);
          history.push({ role: 'assistant', content: heuristic });
          persistHistory();
          if (status) status.firstChild.textContent = 'Idle (lite)';
          return;
        }
        if (!AUTOSWITCH_TO_AI) {
          addMessage('assistant', 'I can try a richer AI answer. Tap 🧠 (top right) to enable full AI, or ask about hours, address, pricing or bookings.');
          history.push({ role: 'assistant', content: 'Prompted user to enable full AI for non-FAQ question.' });
          persistHistory();
          if (status) status.firstChild.textContent = 'Idle (lite)';
          return;
        }
        // If allowed to autoswitch (kept false), flip to AI
        LITE_MODE = false;
        const tbtn = document.getElementById('ba-lite-toggle');
        if (tbtn) tbtn.textContent = '🧠';
      }
      eng = eng || await ensureEngine();
      if (!eng) return; // if user switched causing engine load failure
      let gotToken = false;
      let ignoreFurther = false;
      const timeout = setTimeout(() => {
        if (!gotToken) {
          ignoreFurther = true;
          finalizeStreaming();
          const msg = 'Taking too long. Please try again later or use ⚡ lite mode for quick info.';
          partial.content = msg;
          persistHistory();
          addMessage('assistant', msg);
          if (status) status.firstChild.textContent = 'Timeout';
        }
      }, GEN_TIMEOUT_MS);
      await eng.chat.completions.create({
        messages: history.slice(- (MAX_HISTORY + 1)),
        temperature: 0.55,
        max_tokens: DEFAULT_MAX_TOKENS,
        stream: true
      }, (evt) => {
        if (ignoreFurther) return;
        if (evt.chunk && evt.chunk.choices && evt.chunk.choices[0]?.delta?.content) {
          const token = evt.chunk.choices[0].delta.content;
          gotToken = true;
          accumulated += token;
          partial.content = accumulated;
          updateStreamingAppend(token);
        }
      });
      clearTimeout(timeout);
      finalizeStreaming();
      // Trim leading whitespace / artifacts
      partial.content = (partial.content || '').trim();
      persistHistory();
      if (status) {
        const ms = performance.now() - start;
        status.firstChild.textContent = 'Ready';
        const el = document.getElementById('ba-elapsed');
        if (el) el.textContent = `${Math.round(ms)}ms`;
      }
    } catch (err) {
      console.error(err);
      finalizeStreaming();
      partial.content = 'Error generating response. Please try again, or toggle ⚡ for quick info.';
      persistHistory();
      updateStreamingAppend(partial.content);
      if (status) status.firstChild.textContent = 'Error';
    }
    generating = false;
  }

  function clearConversation() {
    history = [{ role: 'system', content: SYSTEM_PROMPT }];
    persistHistory();
    const msgs = document.getElementById('ba-messages');
    if (msgs) { msgs.innerHTML = ''; addMessage('assistant', WELCOME); }
  }

  window.addEventListener('DOMContentLoaded', () => { createUI(); });

  return { _debug: { ensureEngine, clearConversation, lastInitError: () => lastInitError } };
})();
