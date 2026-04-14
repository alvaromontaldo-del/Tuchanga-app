import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || '*';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

function parseBearer(req) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7).trim();
}

function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

async function ensureUser(userId, displayName = 'Usuario') {
  await pool.query(
    `INSERT INTO users (id, email, display_name) VALUES ($1::uuid, NULL, $2)
     ON CONFLICT (id) DO NOTHING`,
    [userId, displayName],
  );
}

async function userInConversation(conversationId, userId) {
  const { rows } = await pool.query(
    `SELECT 1 FROM conversations
     WHERE id = $1::uuid AND (cliente_id = $2::uuid OR trabajador_id = $2::uuid)`,
    [conversationId, userId],
  );
  return rows.length > 0;
}

const app = express();
app.use(
  cors({
    origin: FRONTEND_ORIGIN === '*' ? true : FRONTEND_ORIGIN.split(',').map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json());

/** GET /api/conversations */
app.get('/api/conversations', async (req, res) => {
  const userId = parseBearer(req);
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.cliente_id,
         c.trabajador_id,
         c.created_at,
         CASE WHEN c.cliente_id = $1::uuid THEN c.trabajador_id ELSE c.cliente_id END AS other_user_id,
         CASE WHEN c.cliente_id = $1::uuid THEN uw.display_name ELSE uc.display_name END AS other_display_name,
         (SELECT text FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message,
         (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_at
       FROM conversations c
       JOIN users uc ON uc.id = c.cliente_id
       JOIN users uw ON uw.id = c.trabajador_id
       WHERE c.cliente_id = $1::uuid OR c.trabajador_id = $1::uuid
       ORDER BY COALESCE(
         (SELECT created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1),
         c.created_at
       ) DESC`,
      [userId],
    );
    res.json({
      conversations: rows.map((r) => ({
        id: r.id,
        otherUserId: r.other_user_id,
        otherDisplayName: r.other_display_name,
        primaryTrade: '',
        lastMessage: r.last_message,
        updatedAt: r.last_message_at || r.created_at,
        myRole: r.cliente_id === userId ? 'cliente' : 'trabajador',
      })),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** GET /api/messages/:conversationId */
app.get('/api/messages/:conversationId', async (req, res) => {
  const userId = parseBearer(req);
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { conversationId } = req.params;
  if (!isUuid(conversationId)) {
    return res.status(400).json({ error: 'Invalid conversation' });
  }
  try {
    const ok = await userInConversation(conversationId, userId);
    if (!ok) return res.status(403).json({ error: 'Forbidden' });

    const { rows } = await pool.query(
      `SELECT id, conversation_id, sender_id, text, status, created_at
       FROM messages WHERE conversation_id = $1::uuid ORDER BY created_at ASC`,
      [conversationId],
    );
    res.json({ messages: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

/** POST /api/conversations/find-or-create */
app.post('/api/conversations/find-or-create', async (req, res) => {
  const userId = parseBearer(req);
  if (!userId || !isUuid(userId)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { workerUserId, workerDisplayName, primaryTrade } = req.body || {};
  if (!workerUserId || !isUuid(workerUserId)) {
    return res.status(400).json({ error: 'workerUserId inválido' });
  }
  if (userId === workerUserId) {
    return res.status(400).json({ error: 'No podés chatear con vos mismo' });
  }
  try {
    await ensureUser(userId);
    const { rows: wrows } = await pool.query(`SELECT id FROM users WHERE id = $1::uuid`, [
      workerUserId,
    ]);
    if (wrows.length === 0) {
      return res.status(404).json({ error: 'Trabajador no encontrado en el servidor' });
    }

    const { rows: found } = await pool.query(
      `SELECT id FROM conversations WHERE cliente_id = $1::uuid AND trabajador_id = $2::uuid`,
      [userId, workerUserId],
    );
    let convId;
    if (found.length > 0) {
      convId = found[0].id;
    } else {
      const ins = await pool.query(
        `INSERT INTO conversations (cliente_id, trabajador_id) VALUES ($1::uuid, $2::uuid) RETURNING id`,
        [userId, workerUserId],
      );
      convId = ins.rows[0].id;
    }

    res.json({
      conversationId: convId,
      workerDisplayName: workerDisplayName || 'Profesional',
      primaryTrade: primaryTrade || '',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: FRONTEND_ORIGIN === '*' ? '*' : FRONTEND_ORIGIN.split(',').map((s) => s.trim()),
    methods: ['GET', 'POST'],
  },
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token || !isUuid(String(token))) {
    return next(new Error('unauthorized'));
  }
  socket.userId = String(token);
  next();
});

io.on('connection', (socket) => {
  socket.on('join_conversation', async (payload, cb) => {
    const conversationId = payload?.conversationId;
    if (!conversationId || !isUuid(conversationId)) {
      cb?.({ ok: false, error: 'invalid' });
      return;
    }
    try {
      const ok = await userInConversation(conversationId, socket.userId);
      if (!ok) {
        cb?.({ ok: false, error: 'forbidden' });
        return;
      }
      socket.join(`conv:${conversationId}`);
      cb?.({ ok: true });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'server' });
    }
  });

  socket.on('leave_conversation', (payload) => {
    const conversationId = payload?.conversationId;
    if (conversationId) socket.leave(`conv:${conversationId}`);
  });

  socket.on('send_message', async (payload, cb) => {
    const { conversationId, text, clientMessageId } = payload || {};
    if (!conversationId || !isUuid(conversationId) || !text || typeof text !== 'string') {
      cb?.({ ok: false, error: 'invalid' });
      return;
    }
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed) {
      cb?.({ ok: false, error: 'empty' });
      return;
    }
    try {
      const ok = await userInConversation(conversationId, socket.userId);
      if (!ok) {
        cb?.({ ok: false, error: 'forbidden' });
        return;
      }
      const ins = await pool.query(
        `INSERT INTO messages (conversation_id, sender_id, text, status)
         VALUES ($1::uuid, $2::uuid, $3, 'sent')
         RETURNING id, conversation_id, sender_id, text, status, created_at`,
        [conversationId, socket.userId, trimmed],
      );
      const row = ins.rows[0];
      const message = {
        id: row.id,
        conversation_id: row.conversation_id,
        sender_id: row.sender_id,
        text: row.text,
        status: row.status,
        created_at: row.created_at,
        clientMessageId: clientMessageId || null,
      };
      io.to(`conv:${conversationId}`).emit('message:new', message);
      cb?.({ ok: true, message });
    } catch (e) {
      console.error(e);
      cb?.({ ok: false, error: 'server' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Tu Changa API + Socket.io en http://localhost:${PORT}`);
});
