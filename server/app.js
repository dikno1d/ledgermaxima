const path = require('path');
const express = require('express');
const cors = require('cors');
const { ObjectId } = require('mongodb');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('./db');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── AUTH MIDDLEWARE ───

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }
  next();
}

function mainAdminMiddleware(req, res, next) {
  if (req.user.username !== 'admin') {
    return res.status(403).json({ error: 'Only main admin' });
  }
  next();
}

async function checkPermission(username, permission) {
  if (username === 'admin') return true;
  const db = await getDb();
  const perms = await db.collection('permissions').findOne({ username });
  return perms ? !!perms[permission] : false;
}

function permMiddleware(permission) {
  return async (req, res, next) => {
    if (req.user.role === 'admin') return next();
    const ok = await checkPermission(req.user.username, permission);
    if (!ok) return res.status(403).json({ error: 'Access denied' });
    next();
  };
}

// ─── AUTH ROUTES ───

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  const db = await getDb();
  const user = await db.collection('users').findOne({ username });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const match = await bcrypt.compare(password, user.password);
  if (!match) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign(
    { username: user.username, name: user.name, role: user.role, id: user._id.toString() },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
  res.json({ token, user: { username: user.username, name: user.name, role: user.role } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => res.json(req.user));

// ─── USER ROUTES ───

app.get('/api/users', authMiddleware, adminMiddleware, permMiddleware('canManageUsers'), async (req, res) => {
  const db = await getDb();
  const users = await db.collection('users').find({}, { projection: { password: 0 } }).toArray();
  res.json(users);
});

app.post('/api/users', authMiddleware, adminMiddleware, permMiddleware('canManageUsers'), async (req, res) => {
  const { username, password, name, role } = req.body;
  if (!username || !password || !name) return res.status(400).json({ error: 'Username, password, and name required' });
  const db = await getDb();
  const exists = await db.collection('users').findOne({ username });
  if (exists) return res.status(400).json({ error: 'Username already exists' });
  const userRole = role === 'admin' ? 'admin' : 'user';
  const hashed = await bcrypt.hash(password, 10);
  await db.collection('users').insertOne({ username, password: hashed, name, role: userRole, createdBy: req.user.username, createdAt: new Date().toISOString() });
  await db.collection('permissions').insertOne({ username, canManageMoney: true, canManageIdeas: true, canManageAllocations: false, canManageUsers: false, canManagePermissions: false });
  res.json({ success: true });
});

app.put('/api/users/:username/role', authMiddleware, adminMiddleware, mainAdminMiddleware, async (req, res) => {
  const { username } = req.params;
  const { role } = req.body;
  if (username === 'admin') return res.status(400).json({ error: 'Cannot change main admin role' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  const db = await getDb();
  await db.collection('users').updateOne({ username }, { $set: { role } });
  if (role === 'admin') {
    await db.collection('permissions').updateOne({ username }, { $set: { canManageMoney: true, canManageIdeas: true, canManageAllocations: true, canManageUsers: true } }, { upsert: true });
  }
  res.json({ success: true });
});

app.delete('/api/users/:username', authMiddleware, adminMiddleware, permMiddleware('canManageUsers'), async (req, res) => {
  const { username } = req.params;
  if (username === 'admin') return res.status(400).json({ error: 'Cannot delete main admin' });
  const db = await getDb();
  await db.collection('users').deleteOne({ username });
  await db.collection('permissions').deleteOne({ username });
  res.json({ success: true });
});

// ─── MONEY ROUTES ───

app.post('/api/money', authMiddleware, async (req, res) => {
  const { amount, date, note } = req.body;
  if (!amount || !date) return res.status(400).json({ error: 'Amount and date required' });
  const db = await getDb();
  await db.collection('money').insertOne({ amount: Number(amount), addedBy: req.user.name, date, note: note || '', createdAt: new Date().toISOString() });
  res.json({ success: true });
});

app.get('/api/money', authMiddleware, async (req, res) => {
  const db = await getDb();
  const entries = await db.collection('money').find().sort({ date: -1, createdAt: -1 }).toArray();
  res.json(entries);
});

app.get('/api/money/total', authMiddleware, async (req, res) => {
  const db = await getDb();
  const r = await db.collection('money').aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray();
  res.json({ total: r.length > 0 ? r[0].total : 0 });
});

app.delete('/api/money/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const db = await getDb();
  await db.collection('money').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});

// ─── IDEA ROUTES ───

app.post('/api/ideas', authMiddleware, async (req, res) => {
  const { title, description, proposedBy } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });
  const db = await getDb();
  await db.collection('ideas').insertOne({ title, description: description || '', proposedBy: proposedBy || req.user.name, createdAt: new Date().toISOString() });
  res.json({ success: true });
});

app.get('/api/ideas', authMiddleware, async (req, res) => {
  const db = await getDb();
  const ideas = await db.collection('ideas').find().sort({ createdAt: -1 }).toArray();
  res.json(ideas);
});

app.delete('/api/ideas/:id', authMiddleware, adminMiddleware, permMiddleware('canManageIdeas'), async (req, res) => {
  const db = await getDb();
  await db.collection('ideas').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});

// ─── ALLOCATION ROUTES ───

app.get('/api/allocations', authMiddleware, async (req, res) => {
  const db = await getDb();
  const allocs = await db.collection('allocations').find().sort({ createdAt: -1 }).toArray();
  const totalMoney = await db.collection('money').aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray();
  const total = totalMoney.length > 0 ? totalMoney[0].total : 0;
  const withAmounts = allocs.map(a => ({ ...a, percentage: a.percentage || 0, amount: total * (a.percentage || 0) / 100 }));
  res.json(withAmounts);
});

app.post('/api/allocations', authMiddleware, adminMiddleware, permMiddleware('canManageAllocations'), async (req, res) => {
  const { name, percentage, description } = req.body;
  if (!name || percentage === undefined) return res.status(400).json({ error: 'Name and percentage required' });
  const db = await getDb();
  await db.collection('allocations').insertOne({ name, percentage: Number(percentage), description: description || '', createdBy: req.user.username, createdAt: new Date().toISOString() });
  res.json({ success: true });
});

app.put('/api/allocations/:id', authMiddleware, adminMiddleware, permMiddleware('canManageAllocations'), async (req, res) => {
  const update = {};
  if (req.body.name) update.name = req.body.name;
  if (req.body.percentage !== undefined) update.percentage = Number(req.body.percentage);
  if (req.body.description !== undefined) update.description = req.body.description;
  const db = await getDb();
  await db.collection('allocations').updateOne({ _id: new ObjectId(req.params.id) }, { $set: update });
  res.json({ success: true });
});

app.delete('/api/allocations/:id', authMiddleware, adminMiddleware, permMiddleware('canManageAllocations'), async (req, res) => {
  const db = await getDb();
  await db.collection('allocations').deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ success: true });
});

// ─── PERMISSION ROUTES ───

app.get('/api/permissions', authMiddleware, adminMiddleware, mainAdminMiddleware, async (req, res) => {
  const db = await getDb();
  const perms = await db.collection('permissions').find().toArray();
  res.json(perms);
});

app.get('/api/permissions/me', authMiddleware, async (req, res) => {
  if (req.user.username === 'admin') {
    return res.json({ username: 'admin', canManageMoney: true, canManageIdeas: true, canManageAllocations: true, canManageUsers: true, canManagePermissions: true });
  }
  const db = await getDb();
  const p = await db.collection('permissions').findOne({ username: req.user.username });
  res.json(p || { username: req.user.username, canManageMoney: false, canManageIdeas: true, canManageAllocations: false, canManageUsers: false, canManagePermissions: false });
});

app.put('/api/permissions/:username', authMiddleware, adminMiddleware, mainAdminMiddleware, async (req, res) => {
  const { username } = req.params;
  if (username === 'admin') return res.status(400).json({ error: 'Cannot modify main admin permissions' });
  const update = {};
  ['canManageMoney', 'canManageIdeas', 'canManageAllocations', 'canManageUsers'].forEach(f => {
    if (req.body[f] !== undefined) update[f] = Boolean(req.body[f]);
  });
  const db = await getDb();
  await db.collection('permissions').updateOne({ username }, { $set: update }, { upsert: true });
  res.json({ success: true });
});

// ─── STATS ───

app.get('/api/stats', authMiddleware, async (req, res) => {
  const db = await getDb();
  const totalMoney = await db.collection('money').aggregate([{ $group: { _id: null, total: { $sum: '$amount' } } }]).toArray();
  const total = totalMoney.length > 0 ? totalMoney[0].total : 0;
  const allocations = await db.collection('allocations').find().toArray();
  const allocsWithAmounts = allocations.map(a => ({ ...a, percentage: a.percentage || 0, amount: total * (a.percentage || 0) / 100 }));
  const allocTotal = allocsWithAmounts.reduce((s, a) => s + a.amount, 0);
  const allocPct = allocsWithAmounts.reduce((s, a) => s + a.percentage, 0);
  const entryCount = await db.collection('money').countDocuments();
  const ideaCount = await db.collection('ideas').countDocuments();
  const userCount = await db.collection('users').countDocuments();
  res.json({ totalMoney: total, allocations: allocsWithAmounts, allocTotal, allocPct, unallocatedPct: Math.max(0, 100 - allocPct), unallocated: Math.max(0, total - allocTotal), entryCount, ideaCount, userCount });
});

// ─── ADMIN ───

app.post('/api/admin/clear', authMiddleware, adminMiddleware, mainAdminMiddleware, async (req, res) => {
  const db = await getDb();
  await db.collection('money').deleteMany({});
  await db.collection('ideas').deleteMany({});
  await db.collection('allocations').deleteMany({});
  await db.collection('permissions').deleteMany({ username: { $ne: 'admin' } });
  res.json({ success: true, message: 'All data cleared. Admin accounts preserved.' });
});

// ─── SPA FALLBACK ───

app.use((req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

module.exports = app;
