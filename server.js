// server.js
const express = require('express');
const fs = require('fs');
const cors = require('cors');
const path = require('path');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5001;

/** =========================
 *  Persistent Disk 경로 (Render 퍼시스턴트 디스크)
 *  ========================= */
const DATA_DIR = '/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

// ✅ Render는 /data 디렉토리 자체는 이미 존재하므로 mkdirSync('/data') 하면 권한 오류.
// 하위 디렉토리만 생성
for (const dir of [SESSIONS_DIR, BACKUPS_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    console.error('[mkdir failed]', dir, e);
  }
}

/** =========================
 *  보안/관리자 설정
 *  ========================= */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'iope@00';
const ADMIN_KEY = process.env.ADMIN_KEY || 'hwaseon-admin-key';

/** =========================
 *  미들웨어
 *  ========================= */
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://IOPE-url.onrender.com', 'https://IOPE-url.com']
    : ['http://localhost:5001'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'hwaseon-secret-key',
  resave: false,
  saveUninitialized: true,
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 24 * 60 * 60,
    reapInterval: 60 * 60,
    retries: 0
  }),
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

/** =========================
 *  정적 파일 & 세션 디버그
 *  ========================= */
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, _res, next) => {
  console.log('[SESSION]', {
    id: req.sessionID,
    user: req.session.user || null,
    path: req.path,
    method: req.method
  });
  next();
});

/** =========================
 *  유틸 함수
 *  ========================= */
function readJSONSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[READ FAIL] ${file}:`, e);
    return fallback;
  }
}

function writeJSONAtomic(file, data) {
  const temp = file + '.tmp';
  const bak = file + '.bak';
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, bak);
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    JSON.parse(fs.readFileSync(temp, 'utf8'));
    fs.renameSync(temp, file);
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    return true;
  } catch (e) {
    console.error(`[WRITE FAIL] ${file}:`, e);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (fs.existsSync(bak)) fs.renameSync(bak, file);
    return false;
  }
}

const saveUsers = (users) => writeJSONAtomic(USERS_FILE, users);
const loadUsers = () => readJSONSafe(USERS_FILE, { users: [] });
const saveDB = (db) => writeJSONAtomic(DB_FILE, db);
const loadDB = () => readJSONSafe(DB_FILE, {});

const genId = () => Date.now().toString();
const generateShortCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 6 }, () => chars.charAt(Math.floor(Math.random() * chars.length))).join('');
};

function getClientIp(req) {
  let ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.connection.remoteAddress || '';
  if (typeof ip === 'string' && ip.includes(',')) ip = ip.split(',')[0].trim();
  if (typeof ip === 'string' && ip.includes('::ffff:')) ip = ip.substring(7);
  return ip || '';
}

/** =========================
 *  권한 관련 함수
 *  ========================= */
function hasAdminSession(req) {
  return !!(req.session?.user?.isAdmin);
}
function hasValidAdminKey(req) {
  const key = req.body?.adminKey || req.query?.adminKey || req.headers['x-admin-key'];
  return key === ADMIN_KEY;
}
function ensureAdmin(req, res) {
  if (hasAdminSession(req) || hasValidAdminKey(req)) return true;
  res.status(403).json({ success: false, message: '관리자 권한이 필요합니다.' });
  return false;
}

/** =========================
 *  데이터 마이그레이션
 *  ========================= */
(function migrateUsersIfNeeded() {
  const data = loadUsers();
  let changed = false;
  data.users = (data.users || []).map(u => {
    if (!u.id) { u.id = genId(); changed = true; }
    if (typeof u.isAdmin !== 'boolean') { u.isAdmin = false; changed = true; }
    return u;
  });
  if (changed) {
    console.log('[MIGRATE] users.json 보정됨');
    saveUsers(data);
  }
})();

/** =========================
 *  라우트
 *  ========================= */
const BASE_URL = process.env.NODE_ENV === 'production'
  ? (process.env.DOMAIN || 'https://IOPE-url.com')
  : `http://localhost:${PORT}`;

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'url.html')));
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

/** 로그인/로그아웃 */
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: '입력 필요' });

  const users = loadUsers().users || [];
  const user = users.find(u => u.username === username);
  if (!user) return res.status(401).json({ success: false, message: '아이디/비번 불일치' });

  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: '아이디/비번 불일치' });

  req.session.user = { id: user.id, username: user.username, isAdmin: !!user.isAdmin };
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, message: '세션 오류' });
    res.json({ success: true, user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false, message: '로그아웃 오류' });
    res.json({ success: true });
  });
});

/** URL 생성 */
app.post('/shorten', (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL 누락' });

  const db = loadDB();
  let code;
  do { code = generateShortCode(); } while (db[code]);

  db[code] = {
    longUrl: url,
    shortUrl: `${BASE_URL}/${code}`,
    totalVisits: 0,
    todayVisits: 0,
    createdAt: new Date().toISOString(),
    ip: getClientIp(req),
    userId: req.session.user?.id || null
  };

  saveDB(db);
  res.json({ shortUrl: db[code].shortUrl, shortCode: code });
});

/** 리다이렉트 */
app.get('/:shortCode', (req, res, next) => {
  const code = req.params.shortCode;
  if (['login', 'dashboard'].includes(code)) return next();

  const db = loadDB();
  const row = db[code];
  if (!row) return res.status(404).send('잘못된 단축URL');

  row.totalVisits++;
  row.todayVisits++;
  saveDB(db);

  const target = row.longUrl.startsWith('http') ? row.longUrl : `https://${row.longUrl}`;
  res.redirect(302, target);
});

/** 크론: 일일 방문 초기화 */
cron.schedule('0 0 * * *', () => {
  const db = loadDB();
  for (const code in db) {
    db[code].todayVisits = 0;
  }
  saveDB(db);
  console.log('🕛 방문자 수 초기화 완료');
}, { timezone: 'Asia/Seoul' });

/** 서버 시작 */
app.listen(PORT, () => console.log(`✅ 서버 실행: http://localhost:${PORT}`));
