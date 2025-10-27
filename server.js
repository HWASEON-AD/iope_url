// server.js
const express = require('express');
const fs = require('fs');
const fsp = fs.promises;
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
 *  Persistent Disk 경로
 *  ========================= */
const DATA_DIR = '/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const BACKUPS_DIR = path.join(DATA_DIR, 'backups');

/** =========================
 *  보안/관리자 설정 (환경변수 지원)
 *  ========================= */
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'iope@00';
const ADMIN_KEY = process.env.ADMIN_KEY || 'hwaseon-admin-key';

/** =========================
 *  디렉토리 준비
 *  ========================= */
for (const dir of [DATA_DIR, SESSIONS_DIR, BACKUPS_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** =========================
 *  CORS/파서/세션
 *  ========================= */
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://iope-url.onrender.com', 'https://iope-url.com']
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
  store: new FileStore({
    path: SESSIONS_DIR,
    ttl: 24 * 60 * 60,
    reapInterval: 60 * 60,
    retries: 0
  }),
  cookie: {
    httpOnly: true,
    secure: false, // Render가 HTTPS면 true 고려
    maxAge: 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  }
}));

/** 정적 파일 */
app.use(express.static(path.join(__dirname, 'public')));

/** 세션 디버그 */
app.use((req, _res, next) => {
  console.log('[DEBUG][Session]', {
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
    console.error(`[READ JSON FAIL] ${file}:`, e);
    return fallback;
  }
}

function writeJSONAtomic(file, data) {
  const temp = file + '.tmp';
  const bak = file + '.bak';
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, bak);
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    // sanity check
    JSON.parse(fs.readFileSync(temp, 'utf8'));
    fs.renameSync(temp, file);
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
    return true;
  } catch (e) {
    console.error(`[WRITE JSON FAIL] ${file}:`, e);
    if (fs.existsSync(temp)) fs.unlinkSync(temp);
    if (fs.existsSync(bak)) fs.renameSync(bak, file);
    return false;
  }
}

const saveUsers = (users) => writeJSONAtomic(USERS_FILE, users);
const loadUsers = () => readJSONSafe(USERS_FILE, { users: [] });

const saveDB = (db) => writeJSONAtomic(DB_FILE, db);
const loadDB = () => readJSONSafe(DB_FILE, {});

/** ID 생성 */
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

/** 권한 헬퍼 */
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
 *  부트 타임 데이터 마이그레이션
 *  - id 없는 사용자에 id 부여
 *  ========================= */
(function migrateUsersIfNeeded() {
  const data = loadUsers();
  let changed = false;
  data.users = (data.users || []).map(u => {
    if (!u.id) {
      u.id = genId();
      changed = true;
    }
    if (typeof u.isAdmin !== 'boolean') {
      u.isAdmin = false;
      changed = true;
    }
    return u;
  });
  if (changed) {
    console.log('[MIGRATE] users.json: 누락된 id/isAdmin 보정');
    saveUsers(data);
  }
})();

/** =========================
 *  페이지 라우트
 *  ========================= */
app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});
app.get('/signup', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'signup.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'url.html')));
app.get('/multiple', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'multiple.html')));
app.get('/multiple.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'multiple.html')));
app.get('/dashboard', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/dashboard.html', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});
app.get('/admin', (req, res) => {
  if (hasAdminSession(req)) res.sendFile(path.join(__dirname, 'public', 'admin.html'));
  else res.redirect('/login');
});

/** =========================
 *  인증 / 사용자
 *  ========================= */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ success: false, message: '비밀번호 불일치' });
  const adminUser = { id: 'admin', username: '아이오페', email: 'gt.min@hawseon.com', isAdmin: true };
  req.session.user = adminUser;
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, message: '세션 저장 오류' });
    res.json({ success: true, user: adminUser });
  });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: '입력 필요' });

  const usersData = loadUsers();
  const user = (usersData.users || []).find(u => u.username === username);
  if (!user) return res.status(401).json({ success: false, message: '아이디/비번 불일치' });

  const ok = await bcrypt.compare(password, user.passwordHash || '');
  if (!ok) return res.status(401).json({ success: false, message: '아이디/비번 불일치' });

  req.session.user = { id: user.id, username: user.username, email: user.email, isAdmin: !!user.isAdmin };
  req.session.save(err => {
    if (err) return res.status(500).json({ success: false, message: '세션 저장 오류' });
    res.json({ success: true, user: req.session.user, redirectTo: user.isAdmin ? '/admin' : '/dashboard' });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ success: false, message: '로그아웃 오류' });
    res.json({ success: true, message: '로그아웃 완료' });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session.user) res.json({ success: true, user: req.session.user, isAuthenticated: true });
  else res.status(401).json({ success: false, message: '로그인 필요', isAuthenticated: false });
});

/** 관리자 사용자 목록 */
app.get('/api/admin/users', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  res.json({ success: true, users: loadUsers().users });
});

/** 사용자 생성 (관리자) */
app.post('/api/admin/users', async (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { username, password, email } = req.body || {};
  if (!username || !password) return res.status(400).json({ success: false, message: '아이디/비밀번호 필요' });

  const userData = loadUsers();
  if ((userData.users || []).some(u => u.username === username)) {
    return res.status(400).json({ success: false, message: '중복 아이디' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const newUser = {
    id: genId(),
    username,
    passwordHash,
    email: email || undefined,
    isAdmin: false,
    createdAt: new Date().toISOString()
  };
  userData.users.push(newUser);
  saveUsers(userData);

  const userResponse = { ...newUser };
  delete userResponse.passwordHash;
  res.json({ success: true, user: userResponse });
});

/** 공통 삭제 로직 */
function deleteUserById(userId, sessionUser) {
  const data = loadUsers();
  const users = data.users || [];
  const idx = users.findIndex(u => u.id === userId);

  if (idx === -1) return { ok: false, code: 404, msg: '사용자를 찾을 수 없습니다.' };
  const target = users[idx];

  // 관리자 삭제 방지
  if (target.isAdmin) return { ok: false, code: 400, msg: '관리자 계정은 삭제할 수 없습니다.' };
  // 자기 자신 삭제 방지 (원하면 막기)
  if (sessionUser && sessionUser.id === target.id) {
    return { ok: false, code: 403, msg: '자기 자신의 계정은 삭제할 수 없습니다.' };
  }

  users.splice(idx, 1);
  saveUsers({ users });
  return { ok: true };
}

/** 관리자 삭제 (세션/키 모두 허용) */
app.delete('/api/admin/users/:userId', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { userId } = req.params;
  const result = deleteUserById(userId, req.session.user);
  if (!result.ok) return res.status(result.code).json({ success: false, message: result.msg });
  res.json({ success: true });
});

/** ✅ 호환 라우트: 예전 프론트 호출 지원
 *  - /api/users/:userId + adminKey 지원
 */
app.delete('/api/users/:userId', (req, res) => {
  if (!ensureAdmin(req, res)) return; // 세션 관리자이거나 adminKey 유효해야 함
  const { userId } = req.params;
  const result = deleteUserById(userId, req.session.user);
  if (!result.ok) return res.status(result.code).json({ success: false, message: result.msg });
  res.json({ success: true });
});

/** =========================
 *  URL 단축/조회/삭제
 *  ========================= */
const BASE_URL = process.env.NODE_ENV === 'production'
  ? (process.env.DOMAIN || 'https://iope-url.com')
  : `http://localhost:${PORT}`;

app.get('/urls', (req, res) => {
  const db = loadDB();
  const isAdmin = !!req.session.user?.isAdmin;
  const userId = req.session.user?.id || null;

  const urls = Object.keys(db)
    .filter(code => isAdmin || db[code].userId === userId)
    .map(code => ({ ...db[code], shortCode: code }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  res.json(urls);
});

app.post('/shorten', (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: 'URL 누락' });

  const db = loadDB();
  let code;
  do { code = generateShortCode(); } while (db[code]);

  db[code] = {
    longUrl: url,
    shortUrl: `${BASE_URL}/${code}`,
    todayVisits: 0,
    totalVisits: 0,
    createdAt: new Date().toISOString(),
    lastReset: new Date().toISOString(),
    ip: getClientIp(req),
    logs: [],
    userId: req.session.user ? req.session.user.id : null,
    username: req.session.user ? req.session.user.username : '비회원',
    memo: ''
  };
  saveDB(db);

  res.json({ shortUrl: db[code].shortUrl, shortCode: code });
});

app.delete('/urls/:shortCode', (req, res) => {
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });

  const userId = req.session.user ? req.session.user.id : null;
  const isAdmin = !!req.session.user?.isAdmin;
  if (!isAdmin && db[code].userId !== userId) return res.status(403).json({ error: '권한 없음' });

  delete db[code];
  saveDB(db);
  res.json({ message: '삭제 완료' });
});

app.put('/urls/:shortCode', (req, res) => {
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });
  db[code].memo = req.body?.memo || '';
  saveDB(db);
  res.json({ message: '수정 완료' });
});

/** 상세 */
app.get('/urls/:shortCode/details', (req, res) => {
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });
  const d = db[code];
  res.json({
    shortCode: code,
    createdAt: d.createdAt,
    ip: d.ip,
    todayVisits: d.todayVisits || 0,
    totalVisits: d.totalVisits || 0,
    dailyLimit: 5000,
    logs: d.logs || []
  });
});

/** 방문 추적 */
app.post('/track/:shortCode', (req, res) => {
  const db = loadDB();
  const code = req.params.shortCode;
  if (!db[code]) return res.status(404).json({ error: '없음' });
  db[code].todayVisits = (db[code].todayVisits || 0) + 1;
  db[code].totalVisits = (db[code].totalVisits || 0) + 1;
  saveDB(db);
  res.json({ success: true, todayVisits: db[code].todayVisits, totalVisits: db[code].totalVisits });
});

/** 리다이렉트 */
app.get('/:shortCode', (req, res, next) => {
  const code = req.params.shortCode;
  if (['dashboard', 'multiple', 'login', 'signup', 'admin'].includes(code) || code.includes('.')) return next();

  const db = loadDB();
  const row = db[code];
  if (!row) return res.status(404).send('잘못된 단축URL');

  const ua = req.headers['user-agent'] || '';
  const isBot = [/bot/i, /spider/i, /crawl/i, /monitor/i, /render/i, /health/i].some(re => re.test(ua));
  if (!isBot) {
    row.todayVisits = (row.todayVisits || 0) + 1;
    row.totalVisits = (row.totalVisits || 0) + 1;
    row.logs ||= [];
    row.logs.unshift({ ip: getClientIp(req), time: new Date().toISOString() });
    if (row.logs.length > 100) row.logs = row.logs.slice(0, 100);
    saveDB(db);
  }

  const target = row.longUrl.startsWith('http') ? row.longUrl : `https://${row.longUrl}`;
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'Surrogate-Control': 'no-store'
  });
  res.redirect(302, target);
});

/** =========================
 *  전체 삭제
 *  ========================= */
app.delete('/delete-all', (req, res) => {
  const db = loadDB();
  const userId = req.session.user?.id || null;
  const isAdmin = !!req.session.user?.isAdmin;

  if (!userId) return res.status(401).json({ success: false, error: '로그인이 필요합니다' });
  if (isAdmin) {
    saveDB({});
    return res.json({ success: true, message: '모든 URL이 삭제되었습니다.' });
  }
  const filtered = {};
  for (const [code, data] of Object.entries(db)) {
    if (data.userId !== userId) filtered[code] = data;
  }
  saveDB(filtered);
  res.json({ success: true, message: '내 URL이 모두 삭제되었습니다.' });
});

/** =========================
 *  백업/복원
 *  ========================= */
app.get('/api/backup', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const backup = { timestamp: new Date().toISOString(), urls: loadDB(), users: loadUsers() };
  res.setHeader('Content-Disposition', `attachment; filename=backup-${new Date().toISOString().slice(0,10)}.json`);
  res.json(backup);
});

app.post('/api/restore', (req, res) => {
  if (!ensureAdmin(req, res)) return;
  const { urls, users } = req.body || {};
  if (!urls || !users) return res.status(400).json({ success: false, message: '유효하지 않은 백업 데이터' });
  saveDB(urls);
  saveUsers(users);
  res.json({ success: true });
});

/** =========================
 *  크론: 방문 초기화 & 자동 백업
 *  ========================= */
cron.schedule('0 0 * * *', () => {
  const db = loadDB();
  for (const code in db) {
    db[code].todayVisits = 0;
    db[code].lastReset = new Date().toISOString();
  }
  saveDB(db);
  console.log('🕛 방문자 초기화 완료');
}, { timezone: 'Asia/Seoul' });

cron.schedule('0 0 * * *', () => {
  const backup = { timestamp: new Date().toISOString(), urls: loadDB(), users: loadUsers() };
  const file = path.join(BACKUPS_DIR, `backup-${new Date().toISOString().slice(0,10)}.json`);
  fs.writeFileSync(file, JSON.stringify(backup, null, 2));
  console.log('✅ 자동 백업 완료:', file);
}, { timezone: 'Asia/Seoul' });

/** =========================
 *  서버 시작
 *  ========================= */
app.listen(PORT, () => {
  console.log(`서버 실행: http://localhost:${PORT}`);
});
