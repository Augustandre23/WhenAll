'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── In-memory store ─────────────────────────────────────────────────────────
const events = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function uniqueCode() {
  let code;
  do { code = generateCode(); } while (events.has(code));
  return code;
}

// ─── Slot generation ─────────────────────────────────────────────────────────
function generateSlots(windowStart, windowEnd, durationMins) {
  const slots = [];
  const durationMs = durationMins * 60000;
  let current = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  while (current + durationMs <= end) {
    slots.push(new Date(current).toISOString());
    current += durationMs;
  }
  return slots;
}

// ─── Algorithm: find best slot ───────────────────────────────────────────────
function computeResult(event) {
  const roundKey = `round_${event.round}`;
  const avail = event.availabilities[roundKey] || {};
  const participants = event.participants;

  let best = null;
  for (const slotStart of event.slots) {
    const available = participants.filter(p =>
      (avail[p.id] || []).includes(slotStart)
    );
    if (!best || available.length > best.count ||
        (available.length === best.count && slotStart < best.start)) {
      best = {
        start: slotStart,
        count: available.length,
        available: available.map(p => p.nickname),
        total: participants.length
      };
    }
  }

  if (!best || best.count === 0) return null;
  return { ...best, type: best.count === best.total ? 'perfect' : 'best' };
}

// ─── Safe event for client ───────────────────────────────────────────────────
function toClient(event) {
  const roundKey = `round_${event.round}`;
  const submitted = event.availabilities[roundKey] || {};
  return {
    code: event.code,
    title: event.title,
    windowStart: event.windowStart,
    windowEnd: event.windowEnd,
    slotDuration: event.slotDuration,
    slots: event.slots,
    status: event.status,
    round: event.round,
    participants: event.participants,
    submittedIds: Object.keys(submitted),
    result: event.result,
    votes: event.votes
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// Create event
app.post('/api/events', (req, res) => {
  const { title, nickname, windowStart, windowEnd, slotDuration } = req.body;

  if (!title?.trim() || !nickname?.trim() || !windowStart || !windowEnd) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  if (new Date(windowEnd) <= new Date(windowStart)) {
    return res.status(400).json({ error: 'End time must be after start time' });
  }

  const duration = Math.max(15, parseInt(slotDuration) || 60);
  const slots = generateSlots(windowStart, windowEnd, duration);

  if (slots.length === 0) {
    return res.status(400).json({ error: 'Time window too short for selected duration' });
  }

  const userId = uuidv4();
  const code = uniqueCode();

  const event = {
    code,
    title: title.trim(),
    windowStart,
    windowEnd,
    slotDuration: duration,
    slots,
    status: 'collecting',
    round: 1,
    participants: [{ id: userId, nickname: nickname.trim() }],
    availabilities: { round_1: {} },
    result: null,
    votes: {}
  };

  events.set(code, event);
  res.json({ userId, event: toClient(event) });
});

// Get event
app.get('/api/events/:code', (req, res) => {
  const event = events.get(req.params.code.toUpperCase());
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(toClient(event));
});

// Join event
app.post('/api/events/:code/join', (req, res) => {
  const event = events.get(req.params.code.toUpperCase());
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const nickname = req.body.nickname?.trim();
  if (!nickname) return res.status(400).json({ error: 'Nickname required' });

  // Return existing participant if nickname matches
  const existing = event.participants.find(
    p => p.nickname.toLowerCase() === nickname.toLowerCase()
  );
  if (existing) {
    return res.json({ userId: existing.id, event: toClient(event) });
  }

  const userId = uuidv4();
  event.participants.push({ id: userId, nickname });
  io.to(event.code).emit('update', toClient(event));
  res.json({ userId, event: toClient(event) });
});

// Submit availability
app.post('/api/events/:code/availability', (req, res) => {
  const event = events.get(req.params.code.toUpperCase());
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.status !== 'collecting') {
    return res.status(400).json({ error: 'Availability collection is closed' });
  }

  const { userId, slots } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  // Only keep valid event slots
  const validSlots = (slots || []).filter(s => event.slots.includes(s));

  const roundKey = `round_${event.round}`;
  event.availabilities[roundKey][userId] = validSlots;

  // Check if all participants have submitted
  if (Object.keys(event.availabilities[roundKey]).length >= event.participants.length) {
    event.result = computeResult(event);
    event.status = 'deciding';
    event.votes = {};
  }

  io.to(event.code).emit('update', toClient(event));
  res.json(toClient(event));
});

// Vote on result
app.post('/api/events/:code/vote', (req, res) => {
  const event = events.get(req.params.code.toUpperCase());
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (event.status !== 'deciding') {
    return res.status(400).json({ error: 'Not in voting phase' });
  }

  const { userId, accept } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  event.votes[userId] = !!accept;

  const allVoted = event.participants.every(p => event.votes[p.id] !== undefined);
  if (allVoted) {
    const allAccepted = event.participants.every(p => event.votes[p.id] === true);
    if (allAccepted) {
      event.status = 'accepted';
    } else {
      // Start new round
      event.round += 1;
      event.status = 'collecting';
      event.result = null;
      event.votes = {};
      event.availabilities[`round_${event.round}`] = {};
    }
  }

  io.to(event.code).emit('update', toClient(event));
  res.json(toClient(event));
});

// Serve SPA for all other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Socket.io ───────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('join', (code) => {
    socket.join(code);
    const room = io.sockets.adapter.rooms.get(code);
    io.to(code).emit('viewers', room ? room.size : 1);
  });

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room === socket.id) continue;
      const roomObj = io.sockets.adapter.rooms.get(room);
      const count = roomObj ? roomObj.size - 1 : 0;
      io.to(room).emit('viewers', Math.max(0, count));
    }
  });
});

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`WhenAll running → http://localhost:${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=3001 node server.js`);
    process.exit(1);
  } else {
    throw err;
  }
});
