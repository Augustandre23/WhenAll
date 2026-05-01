(function () {
  'use strict';

  // ─── State ─────────────────────────────────────────────────────────────────
  const state = {
    userId: localStorage.getItem('userId'),
    nickname: localStorage.getItem('nickname'),
    eventCode: localStorage.getItem('eventCode'),
    eventTitle: localStorage.getItem('eventTitle'),
    event: null,
    selectedSlots: new Set(),
    currentDay: null,
    viewers: 0
  };

  function saveEventToStorage(code, title) {
    state.eventCode = code;
    state.eventTitle = title;
    localStorage.setItem('eventCode', code);
    localStorage.setItem('eventTitle', title);
  }

  function clearEventStorage() {
    state.eventCode = null;
    state.eventTitle = null;
    state.event = null;
    localStorage.removeItem('eventCode');
    localStorage.removeItem('eventTitle');
  }

  // ─── Socket ─────────────────────────────────────────────────────────────────
  const socket = io();

  socket.on('update', (event) => {
    if (state.event && event.round > state.event.round) {
      state.selectedSlots.clear();
      state.currentDay = null;
    }
    state.event = event;
    if (state.eventCode && window.location.hash.includes(state.eventCode)) {
      renderEventView();
    }
  });

  socket.on('viewers', (count) => {
    state.viewers = count;
    updateViewerBadge();
  });

  // ─── API ────────────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  }

  // ─── Router ─────────────────────────────────────────────────────────────────
  function navigate(path) {
    window.location.hash = path;
  }

  function getRoute() {
    return window.location.hash.slice(1) || '/';
  }

  function render() {
    const route = getRoute();
    const appEl = document.getElementById('app');

    if (route === '/' || route === '') {
      renderHome(appEl);
    } else if (route === '/create') {
      renderCreate(appEl);
    } else if (route.startsWith('/event/')) {
      const code = route.split('/')[2]?.toUpperCase();
      if (code) {
        state.eventCode = code;
        loadAndRenderEvent(appEl);
      } else {
        renderHome(appEl);
      }
    } else {
      renderHome(appEl);
    }
  }

  async function loadAndRenderEvent(container) {
    try {
      if (!state.event || state.event.code !== state.eventCode) {
        container.innerHTML = '<div class="loading-state">Loading event...</div>';
        const data = await api('GET', `/api/events/${state.eventCode}`);
        state.event = data;
        saveEventToStorage(data.code, data.title);
      }

      socket.emit('join', state.eventCode);

      const isParticipant = state.userId &&
        state.event.participants.some(p => p.id === state.userId);

      if (!isParticipant) {
        renderJoin(container);
      } else {
        renderEventView();
      }
    } catch {
      clearEventStorage();
      container.innerHTML = `
        <div class="error-page">
          <div style="font-size:64px;margin-bottom:16px">🔍</div>
          <h2>Event not found</h2>
          <p>The code <strong>${state.eventCode || '?'}</strong> doesn't match any event.<br>
          The event may have expired — events are stored in memory and reset when the server restarts.</p>
          <button class="btn btn-primary" onclick="navigate('/')">Go Home</button>
        </div>
      `;
    }
  }

  // ─── Views ──────────────────────────────────────────────────────────────────

  function renderHome(container) {
    const hasRecentEvent = state.eventCode && state.eventTitle;

    container.innerHTML = `
      <div class="view-home">
        <div class="hero">
          <div class="logo">
            <span class="logo-icon">📅</span>
            <span class="logo-text">WhenAll</span>
          </div>
          <p class="tagline">Find a time that works for everyone</p>
          <p class="dedication">For Alessia, enjoy!</p>
        </div>

        ${hasRecentEvent ? `
          <div class="resume-card" onclick="navigate('/event/${escHtml(state.eventCode)}')">
            <div class="resume-left">
              <div class="resume-label">Resume event</div>
              <div class="resume-title">${escHtml(state.eventTitle)}</div>
              <div class="resume-code">${escHtml(state.eventCode)}</div>
            </div>
            <span class="resume-arrow">→</span>
          </div>
        ` : ''}

        <div class="card">
          <label class="form-label">Your nickname</label>
          <input type="text" id="nickname-input" class="input"
            placeholder="e.g. Alex, Sam, Jordan..."
            value="${escHtml(state.nickname || '')}"
            maxlength="20"
            autocomplete="nickname"
            autocorrect="off"
            spellcheck="false">
        </div>

        <div class="actions">
          <button class="btn btn-primary btn-large" onclick="handleCreateClick()">
            + Create New Event
          </button>
        </div>

        <div class="divider"><span>or join with a code</span></div>

        <div class="card">
          <label class="form-label">Event code</label>
          <div class="input-row">
            <input type="text" id="code-input" class="input input-code"
              placeholder="ABC123"
              maxlength="6"
              autocomplete="off"
              autocorrect="off"
              spellcheck="false"
              oninput="this.value = this.value.toUpperCase().replace(/[^A-Z0-9]/g,'')">
            <button class="btn btn-primary" onclick="handleJoinClick()">Join</button>
          </div>
        </div>

        <div class="how-it-works">
          <div class="how-title">How it works</div>
          <div class="how-steps">
            <div class="how-step"><span class="how-num">1</span><span>Create an event and share the code</span></div>
            <div class="how-step"><span class="how-num">2</span><span>Everyone picks when they're free</span></div>
            <div class="how-step"><span class="how-num">3</span><span>The app finds the best common slot</span></div>
            <div class="how-step"><span class="how-num">4</span><span>Everyone votes — if all agree, you're done!</span></div>
          </div>
        </div>
      </div>
    `;

    if (!state.nickname) {
      setTimeout(() => document.getElementById('nickname-input')?.focus(), 100);
    }
  }

  window.handleCreateClick = function () {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return showError('Please enter your nickname first');
    state.nickname = nickname;
    localStorage.setItem('nickname', nickname);
    clearEventStorage();
    navigate('/create');
  };

  window.handleJoinClick = function () {
    const nickname = document.getElementById('nickname-input').value.trim();
    const code = document.getElementById('code-input').value.trim().toUpperCase();
    if (!nickname) return showError('Please enter your nickname first');
    if (code.length < 4) return showError('Please enter a valid event code');
    state.nickname = nickname;
    localStorage.setItem('nickname', nickname);
    state.event = null;
    navigate(`/event/${code}`);
  };

  function renderCreate(container) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    const weekLater = new Date(tomorrow);
    weekLater.setDate(weekLater.getDate() + 6);
    weekLater.setHours(18, 0, 0, 0);

    container.innerHTML = `
      <div class="view-create">
        <div class="view-header">
          <button class="btn-back" onclick="navigate('/')">←</button>
          <h2>New Event</h2>
        </div>

        <div class="form-section">
          <label class="form-label">Event name</label>
          <input type="text" id="event-title" class="input"
            placeholder="e.g. Team Lunch, Movie Night, Study Session..."
            maxlength="60"
            autocorrect="off">
        </div>

        <div class="form-section">
          <label class="form-label">Availability window</label>
          <p class="form-hint">Participants will pick from slots within this range.</p>
          <div class="date-row">
            <div>
              <label class="form-label-small">From</label>
              <input type="datetime-local" id="window-start" class="input"
                value="${toLocalInput(tomorrow)}">
            </div>
            <div>
              <label class="form-label-small">To</label>
              <input type="datetime-local" id="window-end" class="input"
                value="${toLocalInput(weekLater)}">
            </div>
          </div>
        </div>

        <div class="form-section">
          <label class="form-label">Event duration</label>
          <select id="slot-duration" class="input select">
            <option value="30">30 minutes</option>
            <option value="60" selected>1 hour</option>
            <option value="90">1 hour 30 min</option>
            <option value="120">2 hours</option>
            <option value="180">3 hours</option>
            <option value="240">Half day (4 hours)</option>
          </select>
        </div>

        <div class="create-submit">
          <button class="btn btn-primary btn-large" onclick="handleCreateEvent()">
            Create Event →
          </button>
        </div>
      </div>
    `;

    setTimeout(() => document.getElementById('event-title')?.focus(), 100);
  }

  window.handleCreateEvent = async function () {
    const title = document.getElementById('event-title').value.trim();
    const windowStart = document.getElementById('window-start').value;
    const windowEnd = document.getElementById('window-end').value;
    const slotDuration = document.getElementById('slot-duration').value;

    if (!title) return showError('Please give your event a name');
    if (!windowStart || !windowEnd) return showError('Please set the time window');
    if (new Date(windowStart) >= new Date(windowEnd)) {
      return showError('End time must be after start time');
    }

    try {
      setLoading(true);
      const data = await api('POST', '/api/events', {
        title,
        nickname: state.nickname,
        windowStart: new Date(windowStart).toISOString(),
        windowEnd: new Date(windowEnd).toISOString(),
        slotDuration: parseInt(slotDuration)
      });

      state.userId = data.userId;
      state.event = data.event;
      state.selectedSlots.clear();
      state.currentDay = null;
      localStorage.setItem('userId', data.userId);
      saveEventToStorage(data.event.code, data.event.title);

      navigate(`/event/${data.event.code}`);
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  function renderJoin(container) {
    const ev = state.event;
    container.innerHTML = `
      <div class="view-join">
        <div class="view-header">
          <button class="btn-back" onclick="navigate('/')">←</button>
          <h2>Join Event</h2>
        </div>

        <div class="event-preview">
          <h3>${escHtml(ev.title)}</h3>
          <p class="event-meta">📅 ${formatDateRange(ev.windowStart, ev.windowEnd)}</p>
          <p class="event-meta">👥 ${ev.participants.length} participant${ev.participants.length !== 1 ? 's' : ''} joined</p>
        </div>

        <div class="form-section">
          <label class="form-label">Your nickname</label>
          <input type="text" id="join-nickname" class="input"
            placeholder="e.g. Alex"
            value="${escHtml(state.nickname || '')}"
            maxlength="20"
            autocorrect="off"
            spellcheck="false">
        </div>

        <div style="padding: 0 16px;">
          <button class="btn btn-primary btn-large" onclick="handleJoinEvent()">
            Join Event →
          </button>
        </div>
      </div>
    `;

    setTimeout(() => {
      const el = document.getElementById('join-nickname');
      if (el && !el.value) el.focus();
    }, 100);
  }

  window.handleJoinEvent = async function () {
    const nickname = document.getElementById('join-nickname').value.trim();
    if (!nickname) return showError('Please enter your nickname');

    try {
      setLoading(true);
      const data = await api('POST', `/api/events/${state.eventCode}/join`, { nickname });
      state.userId = data.userId;
      state.event = data.event;
      state.nickname = nickname;
      localStorage.setItem('userId', data.userId);
      localStorage.setItem('nickname', nickname);
      saveEventToStorage(data.event.code, data.event.title);
      renderEventView();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Main event view dispatcher
  function renderEventView() {
    const container = document.getElementById('app');
    const { event, userId } = state;
    if (!event || !container) return;

    const userSubmitted = event.submittedIds.includes(userId);
    const userVoted = event.votes[userId] !== undefined;

    if (event.status === 'accepted') {
      renderAccepted(container);
    } else if (event.status === 'deciding') {
      if (userVoted) {
        renderWaitingVotes(container);
      } else {
        renderDeciding(container);
      }
    } else {
      if (userSubmitted) {
        renderWaitingSubmissions(container);
      } else {
        renderAvailabilityPicker(container);
      }
    }
  }

  // ─── Shared event topbar ─────────────────────────────────────────────────────

  function eventTopbar(title, extra = '') {
    return `
      <div class="event-topbar">
        <div class="event-topbar-left">
          <span class="event-title-small">${escHtml(title)}</span>
          ${extra}
        </div>
        <button class="btn-menu" onclick="openMenu()" aria-label="Menu">
          <span class="menu-icon">☰</span>
        </button>
      </div>
    `;
  }

  // ─── Share banner ────────────────────────────────────────────────────────────

  function shareBanner() {
    const { event } = state;
    if (!event) return '';
    const viewerText = state.viewers > 1
      ? `<span class="viewer-badge">👁 ${state.viewers} viewing now</span>`
      : '';
    return `
      <div class="share-banner" id="share-banner">
        <div class="share-banner-left">
          <span class="share-banner-code">${event.code}</span>
          <span class="share-banner-label">Invite code</span>
        </div>
        <div class="share-banner-right">
          ${viewerText}
          <button class="btn-share" onclick="shareEvent()">Share</button>
        </div>
      </div>
    `;
  }

  function updateViewerBadge() {
    const badge = document.querySelector('.viewer-badge');
    if (!badge) return;
    if (state.viewers > 1) {
      badge.textContent = `👁 ${state.viewers} viewing now`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  // ─── Availability Picker ─────────────────────────────────────────────────────

  function renderAvailabilityPicker(container) {
    const { event } = state;
    const grouped = groupSlotsByDay(event.slots);
    const days = Object.keys(grouped);

    if (!state.currentDay || !grouped[state.currentDay]) {
      state.currentDay = days[0] || null;
    }

    const currentSlots = state.currentDay ? grouped[state.currentDay] : [];

    container.innerHTML = `
      <div class="view-picker">
        ${eventTopbar(event.title, `<span class="round-badge">Round ${event.round}</span>`)}

        <div class="picker-instruction">
          <p>Tap when you're free — drag to select multiple slots at once</p>
        </div>

        ${shareBanner()}

        <div class="day-tabs-wrapper">
          <div class="day-tabs" id="day-tabs">
            ${days.map(day => `
              <button class="day-tab ${day === state.currentDay ? 'active' : ''}"
                onclick="selectDay('${escHtml(day)}')">
                ${escHtml(day)}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="slots-list" id="slots-list">
          ${renderSlotCells(currentSlots, event.slotDuration)}
        </div>

        <div class="picker-footer">
          <span class="selected-count" id="selected-count">
            ${state.selectedSlots.size} slot${state.selectedSlots.size !== 1 ? 's' : ''} selected
          </span>
          <button class="btn btn-primary" onclick="handleSubmitAvailability()">
            Submit
          </button>
        </div>

        <div class="participants-bar">
          ${event.participants.map(p => `
            <span class="participant-chip ${event.submittedIds.includes(p.id) ? 'submitted' : ''}">
              ${escHtml(p.nickname)}
            </span>
          `).join('')}
          <span class="participants-status">
            ${event.submittedIds.length}/${event.participants.length} ready
          </span>
        </div>
      </div>
    `;

    setupSlotDrag();
  }

  function renderSlotCells(slots, durationMins) {
    if (!slots || slots.length === 0) {
      return '<p class="no-slots">No slots for this day</p>';
    }
    return slots.map(slot => {
      const selected = state.selectedSlots.has(slot);
      return `
        <div class="slot-cell${selected ? ' selected' : ''}"
          data-slot="${slot}"
          onclick="toggleSlot('${slot}')">
          <span class="slot-time">${formatSlotRange(slot, durationMins)}</span>
          <span class="slot-check" style="opacity:${selected ? 1 : 0}">✓</span>
        </div>
      `;
    }).join('');
  }

  window.selectDay = function (day) {
    state.currentDay = day;
    document.querySelectorAll('.day-tab').forEach(tab => {
      tab.classList.toggle('active', tab.textContent.trim() === day);
    });
    const grouped = groupSlotsByDay(state.event.slots);
    const slotsList = document.getElementById('slots-list');
    if (slotsList) {
      slotsList.innerHTML = renderSlotCells(grouped[day] || [], state.event.slotDuration);
      setupSlotDrag();
    }
  };

  window.toggleSlot = function (slot, forced) {
    const isSelected = state.selectedSlots.has(slot);
    const newState = forced !== undefined ? forced : !isSelected;

    if (newState) state.selectedSlots.add(slot);
    else state.selectedSlots.delete(slot);

    const cell = document.querySelector(`[data-slot="${slot}"]`);
    if (cell) {
      cell.classList.toggle('selected', newState);
      const check = cell.querySelector('.slot-check');
      if (check) check.style.opacity = newState ? '1' : '0';
    }

    const counter = document.getElementById('selected-count');
    if (counter) {
      const n = state.selectedSlots.size;
      counter.textContent = `${n} slot${n !== 1 ? 's' : ''} selected`;
    }
  };

  function setupSlotDrag() {
    const slotsList = document.getElementById('slots-list');
    if (!slotsList) return;

    let dragging = false;
    let dragSelect = null;

    slotsList.addEventListener('touchstart', (e) => {
      const cell = e.target.closest('[data-slot]');
      if (!cell) return;
      e.preventDefault();
      dragging = true;
      dragSelect = !state.selectedSlots.has(cell.dataset.slot);
      toggleSlot(cell.dataset.slot, dragSelect);
    }, { passive: false });

    slotsList.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const touch = e.touches[0];
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const cell = el?.closest('[data-slot]');
      if (cell) toggleSlot(cell.dataset.slot, dragSelect);
    }, { passive: false });

    slotsList.addEventListener('touchend', () => {
      dragging = false;
      dragSelect = null;
    });
  }

  window.handleSubmitAvailability = async function () {
    try {
      setLoading(true);
      const data = await api('POST', `/api/events/${state.eventCode}/availability`, {
        userId: state.userId,
        slots: Array.from(state.selectedSlots)
      });
      state.event = data;
      renderEventView();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Waiting for submissions ──────────────────────────────────────────────────

  function renderWaitingSubmissions(container) {
    const { event } = state;
    const submittedCount = event.submittedIds.length;
    const total = event.participants.length;
    const progress = Math.round((submittedCount / total) * 100);

    container.innerHTML = `
      <div class="view-waiting">
        ${eventTopbar(event.title)}
        ${shareBanner()}

        <div class="waiting-content">
          <div class="waiting-icon">⏳</div>
          <h3>Waiting for others...</h3>
          <p class="waiting-sub">You're all set! Others are still picking their slots.</p>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <p class="progress-text">${submittedCount} of ${total} submitted</p>
        </div>

        <div class="participants-card">
          ${event.participants.map(p => `
            <div class="participant-row">
              <span class="participant-name">${escHtml(p.nickname)}</span>
              <span class="participant-status ${event.submittedIds.includes(p.id) ? 'done' : 'pending'}">
                ${event.submittedIds.includes(p.id) ? '✓ Ready' : '⏳ Pending'}
              </span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  // ─── Results & voting ────────────────────────────────────────────────────────

  function renderDeciding(container) {
    const { event } = state;
    const result = event.result;

    if (!result) {
      container.innerHTML = `
        <div class="view-deciding">
          ${eventTopbar(event.title)}
          <div class="no-result">
            <div class="no-result-icon">😔</div>
            <h3>No matching slots</h3>
            <p>No one selected a common time slot.<br>Start a new round with different times.</p>
            <button class="btn btn-primary btn-large" onclick="handleVote(false)">
              Start New Round
            </button>
          </div>
        </div>
      `;
      return;
    }

    const slotEnd = new Date(new Date(result.start).getTime() + event.slotDuration * 60000);
    const isPerfect = result.type === 'perfect';
    const votedCount = Object.keys(event.votes).length;
    const cannotAttend = event.participants.filter(
      p => !result.available.includes(p.nickname)
    ).map(p => p.nickname);

    container.innerHTML = `
      <div class="view-deciding">
        ${eventTopbar(event.title)}

        <div class="result-card ${isPerfect ? 'result-perfect' : 'result-best'}">
          <div class="result-badge">
            ${isPerfect ? '🎉 Perfect Match — Everyone can attend!' : `⭐ Best Available Slot — ${result.count}/${result.total} can attend`}
          </div>
          <div class="result-date">${formatResultDate(result.start)}</div>
          <div class="result-time">${formatTime(result.start)} – ${formatTime(slotEnd.toISOString())}</div>

          <div class="result-availability">
            <div class="avail-count">Available (${result.count}/${result.total})</div>
            <div class="avail-names">
              ${result.available.map(n => `<span class="avail-chip">${escHtml(n)}</span>`).join('')}
            </div>
            ${!isPerfect && cannotAttend.length > 0 ? `
              <div class="cant-make">Can't make it: ${cannotAttend.map(escHtml).join(', ')}</div>
            ` : ''}
          </div>
        </div>

        <div class="vote-section">
          <p class="vote-prompt">Do you accept this time?</p>
          <div class="vote-buttons">
            <button class="btn btn-success btn-vote" onclick="handleVote(true)">
              ✓ Accept
            </button>
            <button class="btn btn-outline btn-vote" onclick="handleVote(false)">
              ↺ Try again
            </button>
          </div>
        </div>

        <div class="votes-status">
          ${votedCount} of ${event.participants.length} have voted
        </div>
      </div>
    `;
  }

  function renderWaitingVotes(container) {
    const { event, userId } = state;
    const myVote = event.votes[userId];
    const votedCount = Object.keys(event.votes).length;
    const progress = Math.round((votedCount / event.participants.length) * 100);

    container.innerHTML = `
      <div class="view-waiting">
        ${eventTopbar(event.title)}

        <div class="waiting-content">
          <div class="waiting-icon">${myVote ? '✅' : '🔄'}</div>
          <h3>${myVote ? 'You accepted!' : 'You requested a retry'}</h3>
          <p class="waiting-sub">Waiting for everyone to vote...</p>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <p class="progress-text">${votedCount} of ${event.participants.length} voted</p>
        </div>

        <div class="participants-card">
          ${event.participants.map(p => {
            const vote = event.votes[p.id];
            const statusClass = vote === true ? 'done' : vote === false ? 'retry' : 'pending';
            const statusText = vote === true ? '✓ Accepted' : vote === false ? '↺ Retry' : '⏳ Pending';
            return `
              <div class="participant-row">
                <span class="participant-name">${escHtml(p.nickname)}</span>
                <span class="participant-status ${statusClass}">${statusText}</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderAccepted(container) {
    const { event } = state;
    const result = event.result;
    const slotEnd = new Date(new Date(result.start).getTime() + event.slotDuration * 60000);

    container.innerHTML = `
      <div class="view-accepted">
        <button class="btn-menu btn-menu-accepted" onclick="openMenu()" aria-label="Menu">
          <span class="menu-icon">☰</span>
        </button>

        <div class="celebration">
          <div class="confetti">🎊</div>
          <h2>It's confirmed!</h2>
          <p>Everyone agreed on a time.</p>
        </div>

        <div class="confirmed-card">
          <div class="confirmed-event">${escHtml(event.title)}</div>
          <div class="confirmed-date">${formatResultDate(result.start)}</div>
          <div class="confirmed-time">${formatTime(result.start)} – ${formatTime(slotEnd.toISOString())}</div>
          <div class="confirmed-divider"></div>
          <div class="confirmed-attendees">
            <strong>Attendees</strong><br>
            ${event.participants.map(p => escHtml(p.nickname)).join(' · ')}
          </div>
        </div>

        <button class="btn btn-outline btn-large" onclick="clearEventStorage(); navigate('/')">
          Create Another Event
        </button>
      </div>
    `;
  }

  window.handleVote = async function (accept) {
    try {
      setLoading(true);
      const data = await api('POST', `/api/events/${state.eventCode}/vote`, {
        userId: state.userId,
        accept
      });
      if (!accept) {
        state.selectedSlots.clear();
        state.currentDay = null;
      }
      state.event = data;
      renderEventView();
    } catch (err) {
      showError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Share ───────────────────────────────────────────────────────────────────

  window.shareEvent = function () {
    const url = `${window.location.origin}/#/event/${state.eventCode}`;
    const title = state.event ? state.event.title : 'WhenAll Event';
    const text = `Join "${title}" on WhenAll — pick your availability!`;

    if (navigator.share) {
      navigator.share({ title, text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url)
        .then(() => showToast('Link copied to clipboard!'))
        .catch(() => showError('Could not copy link'));
    }
  };

  window.copyEventLink = window.shareEvent;

  // ─── Menu (bottom sheet) ─────────────────────────────────────────────────────

  function buildMenu() {
    const ev = state.event;
    const me = state.nickname || '?';

    let stepHtml = '';
    if (ev) {
      const steps = [
        { label: 'Submit availability', done: ev.submittedIds.includes(state.userId) || ev.status !== 'collecting', active: ev.status === 'collecting' && !ev.submittedIds.includes(state.userId) },
        { label: 'Wait for everyone', done: ev.status !== 'collecting', active: ev.status === 'collecting' && ev.submittedIds.includes(state.userId) },
        { label: 'Review best slot', done: ev.status === 'accepted', active: ev.status === 'deciding' },
        { label: 'All accept → Done!', done: ev.status === 'accepted', active: false }
      ];
      stepHtml = `
        <div class="menu-section">
          <div class="menu-section-title">Round ${ev.round} progress</div>
          ${steps.map((s, i) => `
            <div class="menu-step ${s.done ? 'step-done' : s.active ? 'step-active' : 'step-pending'}">
              <span class="step-num">${s.done ? '✓' : i + 1}</span>
              <span class="step-label">${s.label}</span>
            </div>
          `).join('')}
        </div>
      `;
    }

    const viewerLine = state.viewers > 1
      ? `<div class="menu-viewer-count">👁 ${state.viewers} people have this event open right now</div>`
      : '';

    const shareUrl = ev ? `${window.location.origin}/#/event/${ev.code}` : '';

    return `
      <div class="menu-sheet" id="menu-sheet">
        <div class="menu-drag-handle"></div>

        <div class="menu-header">
          <div class="menu-avatar">${escHtml(me.charAt(0).toUpperCase())}</div>
          <div>
            <div class="menu-nickname">${escHtml(me)}</div>
            <div class="menu-nickname-sub">that's you</div>
          </div>
          <button class="menu-close" onclick="closeMenu()">✕</button>
        </div>

        ${ev ? `
          <div class="menu-section">
            <div class="menu-section-title">Share this event</div>
            <div class="menu-event-name">${escHtml(ev.title)}</div>
            ${viewerLine}
            <div class="menu-share-row">
              <div class="menu-code-box">${ev.code}</div>
              <button class="btn btn-primary" onclick="shareEvent(); closeMenu()">
                ${navigator.share ? 'Share link' : 'Copy link'}
              </button>
            </div>
            ${shareUrl ? `<div class="menu-url">${shareUrl}</div>` : ''}
          </div>

          ${stepHtml}
        ` : ''}

        <div class="menu-section">
          <button class="btn btn-secondary btn-large" onclick="navigate('/'); closeMenu()">
            ← Back to Home
          </button>
        </div>
      </div>
    `;
  }

  window.openMenu = function () {
    const overlay = document.getElementById('menu-overlay');
    if (!overlay) return;
    overlay.innerHTML = buildMenu();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';

    // Tap outside to close
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeMenu();
    });

    // Swipe down to close
    const sheet = document.getElementById('menu-sheet');
    if (sheet) {
      let startY = 0;
      sheet.addEventListener('touchstart', (e) => { startY = e.touches[0].clientY; }, { passive: true });
      sheet.addEventListener('touchend', (e) => {
        if (e.changedTouches[0].clientY - startY > 60) closeMenu();
      }, { passive: true });
    }
  };

  window.closeMenu = function () {
    const overlay = document.getElementById('menu-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  };

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function groupSlotsByDay(slots) {
    const groups = {};
    const order = [];
    for (const slot of slots) {
      const key = new Date(slot).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric'
      });
      if (!groups[key]) {
        groups[key] = [];
        order.push(key);
      }
      groups[key].push(slot);
    }
    const ordered = {};
    for (const k of order) ordered[k] = groups[k];
    return ordered;
  }

  function formatTime(iso) {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }

  function formatSlotRange(start, durationMins) {
    const end = new Date(new Date(start).getTime() + durationMins * 60000);
    return `${formatTime(start)} – ${formatTime(end.toISOString())}`;
  }

  function formatResultDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    });
  }

  function formatDateRange(start, end) {
    const opts = { month: 'short', day: 'numeric' };
    const s = new Date(start).toLocaleDateString('en-US', opts);
    const e = new Date(end).toLocaleDateString('en-US', opts);
    return s === e ? s : `${s} – ${e}`;
  }

  function toLocalInput(date) {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function showError(msg) { showToast(msg, true); }

  function showToast(msg, isError = false) {
    let toast = document.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      document.body.appendChild(toast);
    }
    clearTimeout(toast._timeout);
    toast.textContent = msg;
    toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
    void toast.offsetWidth;
    toast.classList.add('visible');
    toast._timeout = setTimeout(() => toast.classList.remove('visible'), 3000);
  }

  function setLoading(on) {
    document.body.classList.toggle('loading', on);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────

  window.navigate = navigate;
  window.clearEventStorage = clearEventStorage;

  // Inject persistent menu overlay
  const overlay = document.createElement('div');
  overlay.id = 'menu-overlay';
  overlay.className = 'menu-overlay';
  document.body.appendChild(overlay);

  window.addEventListener('hashchange', render);
  render();

})();
