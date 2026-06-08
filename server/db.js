const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME = 'texlmaxima';

let cachedClient = null;
let cachedDb = null;

async function connectDB() {
  if (cachedDb) return cachedDb;

  const client = new MongoClient(MONGO_URI, {
    tls: true,
    tlsAllowInvalidCertificates: true,
    serverSelectionTimeoutMS: 15000,
  });

  await client.connect();
  cachedClient = client;
  cachedDb = client.db(DB_NAME);

  const users = cachedDb.collection('users');
  const existingAdmin = await users.findOne({ role: 'admin' });
  if (!existingAdmin) {
    const bcrypt = require('bcryptjs');
    const hashedPw = await bcrypt.hash('admin123', 10);
    await users.insertOne({
      username: 'admin',
      password: hashedPw,
      name: 'Main Admin',
      role: 'admin',
      createdBy: 'system',
      createdAt: new Date().toISOString(),
    });
    await cachedDb.collection('permissions').insertOne({
      username: 'admin',
      canManageMoney: true,
      canManageIdeas: true,
      canManageAllocations: true,
      canManageUsers: true,
      canManagePermissions: true,
    });
    console.log('Default admin created: admin / admin123');
  }

  return cachedDb;
}

async function getDb() {
  if (cachedDb) return cachedDb;
  return connectDB();
}

module.exports = { connectDB, getDb };
