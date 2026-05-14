const admin = require('firebase-admin');

const DATABASE_URL = "https://peppes-stock-default-rtdb.firebaseio.com";

let initialized = false;

function init() {
  if (initialized) return;
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    console.warn('[firebase] FIREBASE_SERVICE_ACCOUNT not set, skipping init');
    return;
  }
  const serviceAccount = JSON.parse(raw);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: DATABASE_URL
  });
  initialized = true;
}

function ref(path) {
  init();
  return admin.database().ref(path);
}

async function get(path) {
  const snap = await ref(path).once('value');
  return snap.val();
}

async function set(path, data) {
  await ref(path).set(data);
}

async function del(path) {
  await ref(path).remove();
}

module.exports = { init, ref, get, set, del };
