/* ===== שרת פרופיל עובדים — Cloudflare Worker + D1 =====
   הנכסים הסטטיים (public/) מוגשים ישירות ע"י Cloudflare. כל מה שתחת /api
   מגיע לכאן. אין כאן שום נתון שמוגש בלי בדיקת הרשאה, חוץ מהטופס של העובד —
   ושם הגישה היא רק דרך הטוקן האישי שלו. */

import { DEFAULT_FORM } from './default-form.js';

const SESSION_HOURS = 12;
const PBKDF2_ITER = 100000; // המקסימום ש-Workers מאפשר
const MAX_BODY = 512 * 1024;
const LOCK_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_USER = 5;
const MAX_FAILS_IP = 20;

/* ===== סכמה ===== */
// נוצרת אוטומטית בבקשה הראשונה — כך שפריסה חדשה לא דורשת הרצת SQL ידנית.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     username TEXT NOT NULL UNIQUE COLLATE NOCASE,
     display_name TEXT NOT NULL,
     role TEXT NOT NULL CHECK (role IN ('admin','viewer')),
     pw_hash TEXT NOT NULL,
     pw_salt TEXT NOT NULL,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL,
     expires_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     key TEXT PRIMARY KEY,
     fails INTEGER NOT NULL,
     first_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS forms (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     intro TEXT NOT NULL DEFAULT '',
     definition TEXT NOT NULL,
     updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS employees (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     role_title TEXT NOT NULL DEFAULT '',
     team TEXT NOT NULL DEFAULT '',
     token TEXT NOT NULL UNIQUE,
     status TEXT NOT NULL DEFAULT 'invited',
     created_at INTEGER NOT NULL,
     opened_at INTEGER,
     submitted_at INTEGER)`,
  `CREATE TABLE IF NOT EXISTS responses (
     employee_id INTEGER PRIMARY KEY,
     answers TEXT NOT NULL,
     updated_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS interviews (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     employee_id INTEGER NOT NULL,
     interview_date TEXT NOT NULL,
     summary TEXT NOT NULL DEFAULT '',
     author TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS interviews_emp ON interviews (employee_id)`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     link_key TEXT NOT NULL UNIQUE,
     pw_hash TEXT NOT NULL,
     pw_salt TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS lessons (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     event_id INTEGER NOT NULL,
     author TEXT NOT NULL,
     author_key TEXT NOT NULL,
     category TEXT NOT NULL,
     kind TEXT NOT NULL,
     body TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS lessons_event ON lessons (event_id, author_key)`,
  `CREATE TABLE IF NOT EXISTS lesson_sessions (
     token_hash TEXT PRIMARY KEY,
     event_id INTEGER NOT NULL,
     author TEXT NOT NULL,
     author_key TEXT NOT NULL,
     expires_at INTEGER NOT NULL)`,
];

let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  // הוספת עמודות למסד שנוצר בגרסה קודמת (CREATE IF NOT EXISTS לא משנה טבלה קיימת)
  const cols = (await db.prepare('PRAGMA table_info(employees)').all()).results.map(c => c.name);
  if (!cols.includes('team')) await db.prepare("ALTER TABLE employees ADD COLUMN team TEXT NOT NULL DEFAULT ''").run();
  const f = await db.prepare('SELECT id FROM forms WHERE id = 1').first();
  if (!f) {
    await db.prepare('INSERT INTO forms (id, title, intro, definition, updated_at) VALUES (1, ?, ?, ?, ?)')
      .bind(DEFAULT_FORM.title, DEFAULT_FORM.intro, JSON.stringify({ sections: DEFAULT_FORM.sections }), Date.now()).run();
  }
  schemaReady = true;
}

/* ===== עזרים ===== */
const enc = new TextEncoder();

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(n = 24) {
  return b64url(crypto.getRandomValues(new Uint8Array(n)));
}
async function sha256(str) {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(str))));
}
async function hashPassword(password, saltB64) {
  const salt = saltB64 ? Uint8Array.from(atob(saltB64.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))
                       : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, key, 256);
  return { hash: b64url(new Uint8Array(bits)), salt: b64url(salt) };
}
function safeEqual(a, b) {
  const x = enc.encode(a), y = enc.encode(b);
  if (x.length !== y.length) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...API_HEADERS, ...extra } });
}
const err = (status, message) => json({ error: message }, status);

async function readJson(req) {
  const len = Number(req.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, 'הבקשה גדולה מדי');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, 'הבקשה גדולה מדי');
  try { return text ? JSON.parse(text) : {}; } catch { throw new HttpError(400, 'JSON לא תקין'); }
}
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function cleanStr(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}

/* ===== סשנים ===== */
function getCookie(req, name) {
  const c = req.headers.get('Cookie') || '';
  for (const part of c.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}
// קידומת __Host- מחייבת Secure ו-Path=/ ומונעת מתת-דומיין לדרוס את העוגייה.
const COOKIE = '__Host-sid';
function sessionCookie(token, maxAge) {
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

async function currentUser(req, db) {
  const token = getCookie(req, COOKIE);
  if (!token) return null;
  const row = await db.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?`).bind(await sha256(token)).first();
  if (!row || row.expires_at < Date.now()) return null;
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

async function checkLock(db, key, max) {
  const r = await db.prepare('SELECT fails, first_at FROM login_attempts WHERE key = ?').bind(key).first();
  return r && Date.now() - r.first_at < LOCK_WINDOW_MS && r.fails >= max;
}
async function recordFail(db, key) {
  const now = Date.now();
  await db.prepare(
    `INSERT INTO login_attempts (key, fails, first_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       fails = CASE WHEN ? - first_at > ? THEN 1 ELSE fails + 1 END,
       first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END`)
    .bind(key, now, now, LOCK_WINDOW_MS, now, LOCK_WINDOW_MS, now).run();
}

/* ===== ולידציה של הגדרת השאלון ===== */
const Q_TYPES = new Set(['short', 'long', 'single', 'multi', 'dropdown', 'yesno', 'scale', 'date', 'number', 'phone', 'email']);
function validateDefinition(def) {
  if (!def || !Array.isArray(def.sections)) throw new HttpError(400, 'הגדרת שאלון לא תקינה');
  const ids = new Set();
  for (const s of def.sections) {
    if (!s.id || !Array.isArray(s.questions)) throw new HttpError(400, 'מקטע לא תקין');
    for (const q of s.questions) {
      if (!q.id || !Q_TYPES.has(q.type)) throw new HttpError(400, 'שאלה לא תקינה');
      if (ids.has(q.id)) throw new HttpError(400, 'מזהה שאלה כפול');
      ids.add(q.id);
    }
  }
}

function isEmptyAnswer(v) {
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
}
function missingRequired(def, answers) {
  const missing = [];
  for (const s of def.sections) for (const q of s.questions) {
    if (!q.required) continue;
    const v = answers[q.id];
    if (isEmptyAnswer(v)) { missing.push(q.label); continue; }
    if (q.type === 'yesno' && (q.items || []).some(it => !v[it.id])) { missing.push(q.label); continue; }
    // בחירת "אחר" בלי טקסט לא נחשבת תשובה
    const usesOther = v === '__other' || (Array.isArray(v) && v.includes('__other'));
    if (usesOther && isEmptyAnswer(cleanStr(answers[q.id + '::other']))) missing.push(q.label);
  }
  return missing;
}

/* ===== ראוטר ===== */
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await handleApi(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return err(e.status, e.message);
      console.error(e);
      return err(500, 'שגיאת שרת');
    }
  },
};

async function handleApi(req, env, url) {
  const db = env.DB;
  await ensureSchema(db);
  const method = req.method;
  const path = url.pathname.replace(/\/+$/, '');

  // הגנת CSRF: בקשה משנה חייבת להגיע מאותו מקור ובפורמט JSON (שמחייב preflight מאתר זר).
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.get('Origin');
    if (origin && origin !== url.origin) return err(403, 'מקור לא מורשה');
    if (!(req.headers.get('Content-Type') || '').includes('application/json')) return err(415, 'נדרש JSON');
  }

  /* --- משובים: קישור משותף לאירוע + סיסמת האירוע --- */
  if (path.startsWith('/api/l/')) return lessonsParticipant(req, db, path, method);

  /* --- טופס העובד: גישה בטוקן בלבד --- */
  let m = path.match(/^\/api\/f\/([A-Za-z0-9_-]{20,64})(\/submit)?$/);
  if (m) return employeeForm(req, db, m[1], !!m[2]);

  /* --- הקמה ראשונה --- */
  if (path === '/api/setup') {
    const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
    if (method === 'GET') return json({ needed: n === 0, configured: !!env.SETUP_CODE });
    if (method !== 'POST') return err(405, 'שיטה לא נתמכת');
    if (n > 0) return err(403, 'המערכת כבר הוקמה');
    if (!env.SETUP_CODE) return err(403, 'לא הוגדר קוד הקמה (SETUP_CODE) בשרת');
    const b = await readJson(req);
    if (!safeEqual(String(b.code || ''), env.SETUP_CODE)) return err(403, 'קוד הקמה שגוי');
    const user = await createUser(db, { ...b, role: 'admin' });
    return startSession(db, user.id, { ok: true });
  }

  if (path === '/api/login' && method === 'POST') {
    const b = await readJson(req);
    const username = cleanStr(b.username, 60);
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    const uKey = 'u:' + username.toLowerCase(), ipKey = 'ip:' + ip;
    if (await checkLock(db, uKey, MAX_FAILS_USER) || await checkLock(db, ipKey, MAX_FAILS_IP))
      return err(429, 'יותר מדי ניסיונות. נסה שוב בעוד רבע שעה');
    const u = await db.prepare('SELECT id, pw_hash, pw_salt FROM users WHERE username = ?').bind(username).first();
    // מחשבים hash גם כשאין משתמש, כדי שזמן התגובה לא יגלה אילו שמות קיימים
    const { hash } = await hashPassword(String(b.password || ''), u ? u.pw_salt : null);
    if (!u || !safeEqual(hash, u.pw_hash)) {
      await recordFail(db, uKey); await recordFail(db, ipKey);
      return err(401, 'שם משתמש או סיסמה שגויים');
    }
    await db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(uKey).run();
    await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run();
    return startSession(db, u.id, { ok: true });
  }

  if (path === '/api/logout' && method === 'POST') {
    const token = getCookie(req, COOKIE);
    if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }

  /* --- מכאן והלאה: רק משתמש מחובר --- */
  const user = await currentUser(req, db);
  if (!user) return err(401, 'נדרשת התחברות');
  const isAdmin = user.role === 'admin';
  const adminOnly = () => { if (!isAdmin) throw new HttpError(403, 'פעולה למנהל בלבד'); };

  if (path === '/api/me') return json({ user });

  const lessonsRes = await lessonsAdmin(req, db, path, method, url, isAdmin, adminOnly);
  if (lessonsRes) return lessonsRes;

  if (path === '/api/data' && method === 'GET') {
    const form = await getForm(db);
    const emps = (await db.prepare('SELECT * FROM employees ORDER BY name').all()).results;
    const resp = (await db.prepare('SELECT * FROM responses').all()).results;
    const byEmp = Object.fromEntries(resp.map(r => [r.employee_id, { answers: JSON.parse(r.answers), updated_at: r.updated_at }]));
    // צופה לא מקבל את הטוקנים — הם בעצם מפתח כניסה לטופס של העובד
    const employees = emps.map(e => ({ ...(isAdmin ? e : { ...e, token: undefined }), response: byEmp[e.id] || null }));
    // סיכומי ראיונות אישיים רגישים — רק למנהלים
    const interviews = isAdmin ? (await db.prepare('SELECT * FROM interviews ORDER BY interview_date DESC, id DESC').all()).results : [];
    return json({ form, employees, interviews });
  }

  if (path === '/api/form' && method === 'PUT') {
    adminOnly();
    const b = await readJson(req);
    validateDefinition(b.definition);
    await db.prepare('UPDATE forms SET title = ?, intro = ?, definition = ?, updated_at = ? WHERE id = 1')
      .bind(cleanStr(b.title, 200) || 'שאלון', cleanStr(b.intro, 4000), JSON.stringify(b.definition), Date.now()).run();
    return json({ ok: true, form: await getForm(db) });
  }

  if (path === '/api/employees' && method === 'POST') {
    adminOnly();
    const b = await readJson(req);
    const list = Array.isArray(b.employees) ? b.employees : [b];
    const created = [];
    for (const e of list.slice(0, 500)) {
      const name = cleanStr(e.name, 120);
      if (!name) continue;
      const row = await db.prepare('INSERT INTO employees (name, role_title, team, token, created_at) VALUES (?, ?, ?, ?, ?) RETURNING *')
        .bind(name, cleanStr(e.role_title, 120), cleanStr(e.team, 120), randomToken(), Date.now()).first();
      created.push(row);
    }
    return json({ ok: true, created });
  }

  m = path.match(/^\/api\/employees\/(\d+)$/);
  if (m) {
    adminOnly();
    const id = Number(m[1]);
    const emp = await db.prepare('SELECT * FROM employees WHERE id = ?').bind(id).first();
    if (!emp) return err(404, 'עובד לא נמצא');
    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM responses WHERE employee_id = ?').bind(id),
        db.prepare('DELETE FROM interviews WHERE employee_id = ?').bind(id),
        db.prepare('DELETE FROM employees WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJson(req);
      const name = b.name !== undefined ? cleanStr(b.name, 120) || emp.name : emp.name;
      const role_title = b.role_title !== undefined ? cleanStr(b.role_title, 120) : emp.role_title;
      const team = b.team !== undefined ? cleanStr(b.team, 120) : emp.team;
      const token = b.regenerate ? randomToken() : emp.token;
      // פתיחה מחדש מחזירה את הטופס לעריכה, בלי למחוק את מה שכבר מולא
      const status = b.reopen ? 'in_progress' : emp.status;
      const submitted_at = b.reopen ? null : emp.submitted_at;
      const row = await db.prepare('UPDATE employees SET name = ?, role_title = ?, team = ?, token = ?, status = ?, submitted_at = ? WHERE id = ? RETURNING *')
        .bind(name, role_title, team, token, status, submitted_at, id).first();
      return json({ ok: true, employee: row });
    }
    return err(405, 'שיטה לא נתמכת');
  }

  if (path === '/api/users') {
    adminOnly();
    if (method === 'GET') {
      const users = (await db.prepare('SELECT id, username, display_name, role, created_at FROM users ORDER BY id').all()).results;
      return json({ users });
    }
    if (method === 'POST') {
      const u = await createUser(db, await readJson(req));
      return json({ ok: true, user: u });
    }
  }

  m = path.match(/^\/api\/users\/(\d+)$/);
  if (m) {
    adminOnly();
    const id = Number(m[1]);
    const target = await db.prepare('SELECT id, role FROM users WHERE id = ?').bind(id).first();
    if (!target) return err(404, 'משתמש לא נמצא');
    const { n: admins } = await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first();
    if (method === 'DELETE') {
      if (id === user.id) return err(400, 'אי אפשר למחוק את המשתמש שלך');
      if (target.role === 'admin' && admins <= 1) return err(400, 'חייב להישאר לפחות מנהל אחד');
      await db.batch([
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
        db.prepare('DELETE FROM users WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJson(req);
      const stmts = [];
      if (b.display_name !== undefined) stmts.push(db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(cleanStr(b.display_name, 80) || 'משתמש', id));
      if (b.role !== undefined) {
        if (!['admin', 'viewer'].includes(b.role)) return err(400, 'הרשאה לא תקינה');
        if (target.role === 'admin' && b.role !== 'admin' && admins <= 1) return err(400, 'חייב להישאר לפחות מנהל אחד');
        stmts.push(db.prepare('UPDATE users SET role = ? WHERE id = ?').bind(b.role, id));
      }
      if (b.password !== undefined) {
        checkPassword(b.password);
        const { hash, salt } = await hashPassword(b.password);
        stmts.push(db.prepare('UPDATE users SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(hash, salt, id));
        // סיסמה חדשה מנתקת את כל החיבורים הקיימים של המשתמש
        stmts.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
      }
      if (stmts.length) await db.batch(stmts);
      return json({ ok: true });
    }
  }

  /* --- ראיונות אישיים (מנהל בלבד) --- */
  if (path === '/api/interviews' && method === 'POST') {
    adminOnly();
    const b = await readJson(req);
    const emp = await db.prepare('SELECT id FROM employees WHERE id = ?').bind(Number(b.employee_id)).first();
    if (!emp) return err(404, 'עובד לא נמצא');
    const iv = interviewFields(b);
    const now = Date.now();
    const row = await db.prepare('INSERT INTO interviews (employee_id, interview_date, summary, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *')
      .bind(emp.id, iv.date, iv.summary, user.display_name, now, now).first();
    return json({ ok: true, interview: row });
  }
  m = path.match(/^\/api\/interviews\/(\d+)$/);
  if (m) {
    adminOnly();
    const id = Number(m[1]);
    if (!(await db.prepare('SELECT id FROM interviews WHERE id = ?').bind(id).first())) return err(404, 'הראיון לא נמצא');
    if (method === 'DELETE') {
      await db.prepare('DELETE FROM interviews WHERE id = ?').bind(id).run();
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const iv = interviewFields(await readJson(req));
      const row = await db.prepare('UPDATE interviews SET interview_date = ?, summary = ?, updated_at = ? WHERE id = ? RETURNING *')
        .bind(iv.date, iv.summary, Date.now(), id).first();
      return json({ ok: true, interview: row });
    }
    return err(405, 'שיטה לא נתמכת');
  }

  if (path === '/api/import' && method === 'POST') {
    adminOnly();
    return importBackup(db, await readJson(req));
  }

  return err(404, 'לא נמצא');
}

function interviewFields(b) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) ? String(b.date) : new Date().toISOString().slice(0, 10);
  const summary = String(b.summary ?? '').trim().slice(0, 50000);
  if (!summary) throw new HttpError(400, 'סיכום הראיון ריק');
  return { date, summary };
}

function checkPassword(p) {
  if (typeof p !== 'string' || p.length < 8) throw new HttpError(400, 'סיסמה חייבת להכיל לפחות 8 תווים');
  if (p.length > 200) throw new HttpError(400, 'סיסמה ארוכה מדי');
}

async function createUser(db, b) {
  const username = cleanStr(b.username, 60);
  if (!/^[A-Za-z0-9._@-]{3,60}$/.test(username)) throw new HttpError(400, 'שם משתמש: 3 תווים לפחות, אותיות לועזיות, ספרות ו-._@-');
  checkPassword(b.password);
  const role = b.role === 'admin' ? 'admin' : 'viewer';
  const exists = await db.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (exists) throw new HttpError(409, 'שם המשתמש תפוס');
  const { hash, salt } = await hashPassword(b.password);
  return db.prepare('INSERT INTO users (username, display_name, role, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, username, display_name, role, created_at')
    .bind(username, cleanStr(b.display_name, 80) || username, role, hash, salt, Date.now()).first();
}

async function startSession(db, userId, body) {
  const token = randomToken(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(await sha256(token), userId, Date.now() + SESSION_HOURS * 3600 * 1000).run();
  return json(body, 200, { 'Set-Cookie': sessionCookie(token, SESSION_HOURS * 3600) });
}

async function getForm(db) {
  const f = await db.prepare('SELECT * FROM forms WHERE id = 1').first();
  return { title: f.title, intro: f.intro, definition: JSON.parse(f.definition), updated_at: f.updated_at };
}

/* ===== טופס העובד ===== */
async function employeeForm(req, db, token, isSubmit) {
  const emp = await db.prepare('SELECT * FROM employees WHERE token = ?').bind(token).first();
  if (!emp) return err(404, 'הקישור אינו בתוקף. פנה למנהל לקבלת קישור חדש');
  const form = await getForm(db);

  if (req.method === 'GET') {
    if (emp.status === 'invited')
      await db.prepare("UPDATE employees SET status = 'opened', opened_at = ? WHERE id = ?").bind(Date.now(), emp.id).run();
    const r = await db.prepare('SELECT answers FROM responses WHERE employee_id = ?').bind(emp.id).first();
    return json({
      name: emp.name,
      submitted: emp.status === 'submitted',
      form: { title: form.title, intro: form.intro, definition: form.definition },
      answers: r ? JSON.parse(r.answers) : {},
    });
  }

  if (emp.status === 'submitted') return err(409, 'השאלון כבר הוגש. לתיקון פנה למנהל');
  const b = await readJson(req);
  const answers = sanitizeAnswers(form.definition, b.answers);

  if (isSubmit && req.method === 'POST') {
    const missing = missingRequired(form.definition, answers);
    if (missing.length) return json({ error: 'חסרות תשובות חובה', missing }, 400);
  } else if (req.method !== 'PUT') {
    return err(405, 'שיטה לא נתמכת');
  }

  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT INTO responses (employee_id, answers, updated_at) VALUES (?, ?, ?)
                ON CONFLICT(employee_id) DO UPDATE SET answers = excluded.answers, updated_at = excluded.updated_at`)
      .bind(emp.id, JSON.stringify(answers), now),
    isSubmit
      ? db.prepare("UPDATE employees SET status = 'submitted', submitted_at = ? WHERE id = ?").bind(now, emp.id)
      : db.prepare("UPDATE employees SET status = 'in_progress' WHERE id = ?").bind(emp.id),
  ]);
  return json({ ok: true, submitted: isSubmit });
}

// שומרים רק תשובות לשאלות שקיימות בשאלון, בטיפוס הנכון — כדי שעובד לא יוכל
// להזריק שדות שרירותיים למסד.
function sanitizeAnswers(def, raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const s of def.sections) for (const q of s.questions) {
    const v = raw[q.id];
    if (isEmptyAnswer(v)) continue;
    const optIds = new Set((q.options || []).map(o => o.id));
    if (q.allowOther) optIds.add('__other');
    switch (q.type) {
      case 'single': case 'dropdown':
        if (optIds.has(v)) out[q.id] = v;
        break;
      case 'multi':
        if (Array.isArray(v)) { const a = [...new Set(v.filter(x => optIds.has(x)))]; if (a.length) out[q.id] = a; }
        break;
      case 'yesno': {
        if (typeof v !== 'object' || Array.isArray(v)) break;
        const items = new Set((q.items || []).map(i => i.id));
        const o = {};
        for (const [k, x] of Object.entries(v)) if (items.has(k) && (x === 'yes' || x === 'no')) o[k] = x;
        if (Object.keys(o).length) out[q.id] = o;
        break;
      }
      case 'scale': {
        const n = Number(v), min = q.scale?.min ?? 1, max = q.scale?.max ?? 5;
        if (Number.isInteger(n) && n >= min && n <= max) out[q.id] = n;
        break;
      }
      case 'number': {
        const n = Number(v);
        if (Number.isFinite(n)) out[q.id] = n;
        break;
      }
      case 'date':
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) out[q.id] = String(v);
        break;
      case 'long':
        out[q.id] = cleanStr(v, 5000);
        break;
      default:
        out[q.id] = cleanStr(v, 300);
    }
    const other = raw[q.id + '::other'];
    if (q.allowOther && !isEmptyAnswer(other)) out[q.id + '::other'] = cleanStr(other, 300);
  }
  return out;
}

/* ===== שחזור מגיבוי ===== */
// מחליף את השאלון, העובדים והתשובות בתוכן הגיבוי. משתמשים לא נכללים בגיבוי.
async function importBackup(db, b) {
  if (!b || b.kind !== 'employee-profiles-backup' || !b.form || !Array.isArray(b.employees))
    throw new HttpError(400, 'קובץ הגיבוי לא מזוהה');
  validateDefinition(b.form.definition);
  const stmts = [
    db.prepare('DELETE FROM responses'),
    db.prepare('DELETE FROM interviews'),
    db.prepare('DELETE FROM employees'),
    db.prepare('UPDATE forms SET title = ?, intro = ?, definition = ?, updated_at = ? WHERE id = 1')
      .bind(cleanStr(b.form.title, 200), cleanStr(b.form.intro, 4000), JSON.stringify(b.form.definition), Date.now()),
  ];
  for (const e of b.employees) {
    const id = Number(e.id);
    if (!Number.isInteger(id)) continue;
    stmts.push(db.prepare('INSERT INTO employees (id, name, role_title, team, token, status, created_at, opened_at, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, cleanStr(e.name, 120), cleanStr(e.role_title, 120), cleanStr(e.team, 120),
            /^[A-Za-z0-9_-]{20,64}$/.test(e.token || '') ? e.token : randomToken(),
            ['invited', 'opened', 'in_progress', 'submitted'].includes(e.status) ? e.status : 'invited',
            Number(e.created_at) || Date.now(), e.opened_at ?? null, e.submitted_at ?? null));
    if (e.response && e.response.answers)
      stmts.push(db.prepare('INSERT INTO responses (employee_id, answers, updated_at) VALUES (?, ?, ?)')
        .bind(id, JSON.stringify(sanitizeAnswers(b.form.definition, e.response.answers)), Number(e.response.updated_at) || Date.now()));
  }
  // גיבויים ישנים לא כוללים ראיונות — אז פשוט לא משוחזר כלום
  const empIds = new Set(b.employees.map(e => Number(e.id)));
  for (const iv of Array.isArray(b.interviews) ? b.interviews : []) {
    if (!empIds.has(Number(iv.employee_id))) continue;
    const f = interviewFields({ date: iv.interview_date, summary: iv.summary });
    stmts.push(db.prepare('INSERT INTO interviews (employee_id, interview_date, summary, author, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(Number(iv.employee_id), f.date, f.summary, cleanStr(iv.author, 80), Number(iv.created_at) || Date.now(), Number(iv.updated_at) || Date.now()));
  }
  await db.batch(stmts);
  return json({ ok: true, employees: b.employees.length });
}

/* ===== משובים: לקחים והערות מאירועים =====
   כל אירוע מקבל קישור קבוע משותף (l#<מפתח>) וסיסמה אחת. המשתתף מזדהה בשם המלא;
   ההערות שלו מזוהות לפי השם המנורמל. העוגייה היא עוגיית-סשן (בלי Max-Age),
   כך שהכניסה נשמרת עד סגירת הדפדפן. */

const LESSON_CATEGORIES = [
  ['c1', 'כללי'], ['c2', 'גביית עדות'], ['c3', 'סריקות'], ['c4', 'זירה'], ['c5', 'מודיעין ועזרים'],
  ['c6', 'ניהול תיק החקירה'], ['c7', 'תיק החקירה הדיגיטלי'], ['c8', 'עבודת הצוות'],
  ['c9', 'ציוד, אמצעים ואמל״ח'], ['c10', 'לוגיסטיקה ומנהלות'],
].map(([id, label]) => ({ id, label }));
const LESSON_KINDS = [
  ['k1', 'לקח לשיפור'], ['k2', 'לקח לשימור'], ['k3', 'רעיונות'], ['k4', 'תובנות כלליות'],
].map(([id, label]) => ({ id, label }));
const CAT_IDS = new Set(LESSON_CATEGORIES.map(c => c.id));
const KIND_IDS = new Set(LESSON_KINDS.map(k => k.id));
const LCOOKIE = '__Host-lsid';
const LESSON_SESSION_DAYS = 30;
const MAX_LESSON = 50000;

const cleanName = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
const nameKey = v => cleanName(v).replace(/["'״׳]/g, '').toLowerCase();

function lessonFields(b) {
  if (!CAT_IDS.has(b.category)) throw new HttpError(400, 'נא לבחור קטגוריה');
  if (!KIND_IDS.has(b.kind)) throw new HttpError(400, 'נא לבחור סוג');
  const body = String(b.body ?? '').trim().slice(0, MAX_LESSON);
  if (!body) throw new HttpError(400, 'אין תוכן לשליחה');
  return { category: b.category, kind: b.kind, body };
}

async function lessonUser(req, db, eventId) {
  const token = getCookie(req, LCOOKIE);
  if (!token) return null;
  const r = await db.prepare('SELECT * FROM lesson_sessions WHERE token_hash = ?').bind(await sha256(token)).first();
  if (!r || r.event_id !== eventId || r.expires_at < Date.now()) return null;
  return { author: r.author, author_key: r.author_key };
}

async function lessonsParticipant(req, db, path, method) {
  const m = path.match(/^\/api\/l\/([A-Za-z0-9_-]{16,64})(\/login|\/logout|\/mine|\/lessons)?(?:\/(\d+))?$/);
  if (!m) return err(404, 'לא נמצא');
  const ev = await db.prepare('SELECT * FROM events WHERE link_key = ?').bind(m[1]).first();
  if (!ev) return err(404, 'הקישור אינו בתוקף. פנה למנהל');
  const sub = m[2] || '', id = m[3] ? Number(m[3]) : null;

  if (sub === '/login' && method === 'POST') {
    const b = await readJson(req);
    const name = cleanName(b.name);
    if (name.length < 2) return err(400, 'נא להקליד שם מלא');
    const ip = req.headers.get('CF-Connecting-IP') || 'local';
    const key = `l:${ev.id}:${ip}`;
    if (await checkLock(db, key, MAX_FAILS_IP)) return err(429, 'יותר מדי ניסיונות. נסה שוב בעוד רבע שעה');
    const { hash } = await hashPassword(String(b.password || ''), ev.pw_salt);
    if (!safeEqual(hash, ev.pw_hash)) { await recordFail(db, key); return err(401, 'סיסמה שגויה'); }
    const token = randomToken(32);
    await db.batch([
      db.prepare('DELETE FROM lesson_sessions WHERE expires_at < ?').bind(Date.now()),
      db.prepare('INSERT INTO lesson_sessions (token_hash, event_id, author, author_key, expires_at) VALUES (?, ?, ?, ?, ?)')
        .bind(await sha256(token), ev.id, name, nameKey(name), Date.now() + LESSON_SESSION_DAYS * 86400000),
    ]);
    return json({ ok: true, me: name }, 200, { 'Set-Cookie': `${LCOOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict` });
  }
  if (sub === '/logout' && method === 'POST') {
    const token = getCookie(req, LCOOKIE);
    if (token) await db.prepare('DELETE FROM lesson_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `${LCOOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  const who = await lessonUser(req, db, ev.id);
  if (sub === '' && method === 'GET')
    return json({ title: ev.title, active: !!ev.active, categories: LESSON_CATEGORIES, kinds: LESSON_KINDS, me: who ? who.author : null });
  if (!who) return err(401, 'נדרשת כניסה');

  if (sub === '/mine' && method === 'GET') {
    const rows = (await db.prepare('SELECT id, category, kind, body, created_at, updated_at FROM lessons WHERE event_id = ? AND author_key = ? ORDER BY created_at DESC')
      .bind(ev.id, who.author_key).all()).results;
    return json({ lessons: rows });
  }
  if (sub === '/lessons' && !id && method === 'POST') {
    if (!ev.active) return err(403, 'האירוע נסגר להקלדה');
    const f = lessonFields(await readJson(req));
    const now = Date.now();
    const row = await db.prepare('INSERT INTO lessons (event_id, author, author_key, category, kind, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id, category, kind, body, created_at, updated_at')
      .bind(ev.id, who.author, who.author_key, f.category, f.kind, f.body, now, now).first();
    return json({ ok: true, lesson: row });
  }
  if (sub === '/lessons' && id && method === 'PATCH') {
    if (!ev.active) return err(403, 'האירוע נסגר לעריכה');
    const f = lessonFields(await readJson(req));
    // עדכון רק של הערה של אותו משתתף באותו אירוע
    const row = await db.prepare('UPDATE lessons SET category = ?, kind = ?, body = ?, updated_at = ? WHERE id = ? AND event_id = ? AND author_key = ? RETURNING id, category, kind, body, created_at, updated_at')
      .bind(f.category, f.kind, f.body, Date.now(), id, ev.id, who.author_key).first();
    if (!row) return err(404, 'ההערה לא נמצאה');
    return json({ ok: true, lesson: row });
  }
  return err(405, 'שיטה לא נתמכת');
}

async function lessonsAdmin(req, db, path, method, url, isAdmin, adminOnly) {
  if (path === '/api/events' && method === 'GET') {
    const rows = (await db.prepare(
      `SELECT e.id, e.title, e.link_key, e.active, e.created_at,
              COUNT(l.id) AS lessons, COUNT(DISTINCT l.author_key) AS authors, MAX(l.created_at) AS last_at
         FROM events e LEFT JOIN lessons l ON l.event_id = e.id
        GROUP BY e.id ORDER BY e.created_at DESC`).all()).results;
    return json({ events: rows.map(r => isAdmin ? r : { ...r, link_key: undefined }), categories: LESSON_CATEGORIES, kinds: LESSON_KINDS });
  }
  if (path === '/api/events' && method === 'POST') {
    adminOnly();
    const b = await readJson(req);
    const title = cleanStr(b.title, 160);
    if (!title) return err(400, 'נא להקליד כותרת לאירוע');
    const password = String(b.password || '');
    if (password.length < 4) return err(400, 'סיסמת האירוע: לפחות 4 תווים');
    const { hash, salt } = await hashPassword(password);
    const row = await db.prepare('INSERT INTO events (title, link_key, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id, title, link_key, active, created_at')
      .bind(title, randomToken(18), hash, salt, Date.now()).first();
    return json({ ok: true, event: row });
  }
  let m = path.match(/^\/api\/events\/(\d+)$/);
  if (m) {
    adminOnly();
    const id = Number(m[1]);
    const ev = await db.prepare('SELECT id FROM events WHERE id = ?').bind(id).first();
    if (!ev) return err(404, 'האירוע לא נמצא');
    if (method === 'DELETE') {
      await db.batch([
        db.prepare('DELETE FROM lessons WHERE event_id = ?').bind(id),
        db.prepare('DELETE FROM lesson_sessions WHERE event_id = ?').bind(id),
        db.prepare('DELETE FROM events WHERE id = ?').bind(id),
      ]);
      return json({ ok: true });
    }
    if (method === 'PATCH') {
      const b = await readJson(req);
      const stmts = [];
      if (b.title !== undefined) {
        const t = cleanStr(b.title, 160);
        if (!t) return err(400, 'נא להקליד כותרת לאירוע');
        stmts.push(db.prepare('UPDATE events SET title = ? WHERE id = ?').bind(t, id));
      }
      if (b.active !== undefined) stmts.push(db.prepare('UPDATE events SET active = ? WHERE id = ?').bind(b.active ? 1 : 0, id));
      if (b.password !== undefined) {
        if (String(b.password).length < 4) return err(400, 'סיסמת האירוע: לפחות 4 תווים');
        const { hash, salt } = await hashPassword(String(b.password));
        stmts.push(db.prepare('UPDATE events SET pw_hash = ?, pw_salt = ? WHERE id = ?').bind(hash, salt, id));
      }
      if (b.regenerate) {
        // קישור חדש מנתק גם את כל מי שמחובר כרגע לאירוע
        stmts.push(db.prepare('UPDATE events SET link_key = ? WHERE id = ?').bind(randomToken(18), id));
        stmts.push(db.prepare('DELETE FROM lesson_sessions WHERE event_id = ?').bind(id));
      }
      if (stmts.length) await db.batch(stmts);
      return json({ ok: true });
    }
    return err(405, 'שיטה לא נתמכת');
  }
  if (path === '/api/lessons' && method === 'GET') {
    const ids = (url.searchParams.get('events') || '').split(',').map(Number).filter(n => Number.isInteger(n) && n > 0).slice(0, 100);
    const where = ids.length ? `WHERE l.event_id IN (${ids.map(() => '?').join(',')})` : '';
    const rows = (await db.prepare(
      `SELECT l.id, l.event_id, e.title AS event_title, l.author, l.category, l.kind, l.body, l.created_at, l.updated_at
         FROM lessons l JOIN events e ON e.id = l.event_id ${where} ORDER BY l.created_at DESC`).bind(...ids).all()).results;
    return json({ lessons: rows, categories: LESSON_CATEGORIES, kinds: LESSON_KINDS });
  }
  m = path.match(/^\/api\/lessons\/(\d+)$/);
  if (m && method === 'DELETE') {
    adminOnly();
    await db.prepare('DELETE FROM lessons WHERE id = ?').bind(Number(m[1])).run();
    return json({ ok: true });
  }
  return null;
}
