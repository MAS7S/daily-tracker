"use strict";
const byId = id => document.getElementById(id);
const gate = byId("gate"), workspace = byId("workspace"), frame = byId("ledger");
const statusText = value => { byId("status").textContent = value; };
const message = value => { byId("message").textContent = value; };
const config = window.firebaseConfig;
const prefix = "daily-tracker:" + location.pathname.replace(/index\.html$/, "") + ":" + config.projectId + ":";
let session, auth, db;

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", {updateViaCache:"none"}).then(registration => {
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) registration.update().catch(() => {});
    });
  }).catch(() => message("تعذّر تجهيز التطبيق للعمل دون اتصال. افتحه عبر HTTPS ثم أعد المحاولة."));
}

function persist(s) {
  try {
    localStorage.setItem(s.key, JSON.stringify(s.record));
    s.storageError = false;
  } catch (error) {
    s.storageError = true;
    statusText("تعذّر الحفظ على الجهاز. أبقِ الصفحة مفتوحة وصدّر نسخة احتياطية.");
    throw error;
  }
}
function setState(s, record) {
  s.record = record;
  persist(s);
}
function schedule(s, delay = 500) {
  clearTimeout(s.timer);
  s.timer = setTimeout(() => reconcile(s), delay);
}
function openLedger(s) {
  if (s !== session) return;
  window.trackerBridge = {
    read: () => s.record.value,
    save(value) {
      if (s !== session) throw Error("Account changed");
      const copy = JSON.parse(JSON.stringify(value));
      if (JSON.stringify(copy) === JSON.stringify(s.record.value)) return;
      setState(s, {...s.record, value:copy, dirty:true});
      statusText("حُفظ على الجهاز • بانتظار المزامنة");
      schedule(s);
    }
  };
  frame.onload = () => {
    if (session === s && !s.record.value && frame.contentWindow.snapshot)
      window.trackerBridge.save(frame.contentWindow.snapshot());
  };
  frame.src = "./tracker.html";
  s.open = true;
}
function editing() {
  const doc = frame.contentDocument;
  return doc && (doc.querySelector(".modal.on") ||
    (document.activeElement === frame && doc.activeElement?.matches("input,select,textarea")));
}
function download(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify({
    app:"daily-income-expense-tracker", version:3, exported:new Date().toISOString(), ...value
  }, null, 2)], {type:"application/json"}));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function readValue(s, head) {
  const chunks = await Promise.all(Array.from({length:head.parts}, (_, i) =>
    s.ref.collection("parts").doc(String(i)).get({source:"server"})));
  if (chunks.some(doc => !doc.exists || doc.data().revision !== head.revision))
    throw Error("revision-changed");
  return JSON.parse(chunks.map(doc => doc.data().text).join(""));
}
async function push(s) {
  const record = s.record;
  const revision = crypto.randomUUID();
  const chunks = JSON.stringify(record.value).match(/[\s\S]{1,48000}/gu);
  if (chunks.length > 160) throw Error("ledger-too-large");
  await db.runTransaction(async tx => {
    const snap = await tx.get(s.ref);
    const previous = snap.exists ? snap.data() : {revision:null, parts:0};
    if (previous.revision !== record.revision) throw Error("revision-changed");
    chunks.forEach((text, i) => tx.set(s.ref.collection("parts").doc(String(i)), {revision,text}));
    for (let i = chunks.length; i < previous.parts; i++) tx.delete(s.ref.collection("parts").doc(String(i)));
    tx.set(s.ref, {revision, parts:chunks.length});
  });
  if (s !== session) return;
  setState(s, {...s.record, revision, dirty:s.record !== record});
}
function showConflict(s, head, remote) {
  s.conflict = {head, remote};
  byId("choices").hidden = false;
  byId("conflictText").textContent = "تغيّر الدفتر على جهازين. اختر النسخة المعتمدة. سيُنزّل التطبيق نسخة احتياطية من الدفتر الآخر قبل الاستبدال.";
  statusText("تحتاج المزامنة إلى اختيار نسخة");
}
async function reconcile(s) {
  if (s !== session || s.conflict) return;
  if (s.busy) { s.again = true; return; }
  s.busy = true;
  try {
    if (s.storageError) persist(s);
    const snap = await s.ref.get({source:"server"});
    if (s !== session) return;
    const head = snap.exists ? snap.data() : {revision:null,parts:0};
    if (head.revision !== s.record.revision) {
      const remote = head.parts ? await readValue(s, head) : null;
      if (s !== session) return;
      if (s.record.dirty && JSON.stringify(s.record.value) !== JSON.stringify(remote)) {
        showConflict(s, head, remote); return;
      }
      if (s.open && editing() && !s.record.dirty) {
        statusText("وصل تحديث من جهاز آخر. سيظهر بعد إنهاء التحرير."); schedule(s, 2500); return;
      }
      setState(s, {revision:head.revision,value:remote,dirty:false});
      openLedger(s);
    } else if (s.record.dirty) {
      await push(s);
    } else if (!s.open) {
      openLedger(s);
    }
    if (s === session) {
      statusText(s.record.dirty ? "بانتظار المزامنة…" : "تمت المزامنة");
      if (s.record.dirty) schedule(s);
    }
  } catch (error) {
    if (s !== session) return;
    if (s.storageError) return;
    if (error.message === "revision-changed") schedule(s, 100);
    else if (error.code === "permission-denied") statusText("رفض Firestore الوصول. راجع قواعد المشروع ثم اضغط تحديث.");
    else if (error.message === "ledger-too-large") statusText("تجاوز الدفتر حد المزامنة. صدّر نسخة احتياطية قبل تقليل حجمه.");
    else {
      statusText(s.open ? "بانتظار الاتصال للمزامنة • النسخة على الجهاز" : "يلزم الاتصال لتحميل الدفتر أول مرة. " + (error.code || ""));
      schedule(s, 12000);
    }
  } finally {
    s.busy = false;
    if (s.again) { s.again = false; schedule(s); }
  }
}

async function enter(user) {
  const key = prefix + user.uid;
  if (!navigator.locks) { message("افتح التطبيق في متصفح حديث يدعم Web Locks."); return; }
  await navigator.locks.request(key, {ifAvailable:true}, async lock => {
    if (!lock) { message("الدفتر مفتوح في نافذة أخرى. أغلقها ثم حدّث الصفحة."); return; }
    if (auth.currentUser?.uid !== user.uid) return;
    const stored = localStorage.getItem(key);
    const record = stored ? JSON.parse(stored) : {revision:null,dirty:false,value:null};
    const s = { key, record, ref:db.collection("users").doc(user.uid).collection("ledgers").doc("main") };
    session = s;
    // A legacy store belongs to exactly one account. Keep the source backup untouched.
    const legacy = localStorage.getItem("daily-tracker-v2");
    const ownerKey = prefix + "legacy-owner";
    if (!stored && legacy && (!localStorage.getItem(ownerKey) || localStorage.getItem(ownerKey) === user.uid)) {
      const old = JSON.parse(legacy);
      if (Array.isArray(old?.data) && old.data.length) {
        localStorage.setItem(ownerKey,user.uid);
        setState(s,{revision:null,dirty:true,value:old});
      }
    }
    gate.hidden = true; workspace.hidden = false;
    byId("emailDisplay").textContent = user.email || "";
    statusText("جارٍ فتح الدفتر…");
    if (s.record.value) openLedger(s);
    const unsubscribe = s.ref.onSnapshot({includeMetadataChanges:true}, snap => {
      if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) schedule(s);
    }, () => schedule(s));
    schedule(s,0);
    await new Promise(resolve => { s.release = resolve; });
    unsubscribe();
  });
}

byId("retry").onclick = () => session && schedule(session,0);
window.addEventListener("online", byId("retry").onclick);
window.addEventListener("beforeunload", e => {
  if (session?.storageError) { e.preventDefault(); e.returnValue = ""; }
});
byId("download").onclick = () => download(session.record.value, "daily-tracker-device.json");
function resolveConflict(useDevice) {
  const s = session, conflict = s?.conflict;
  if (!conflict || !confirm("تأكيد اعتماد النسخة المختارة؟")) return;
  const backup = useDevice ? conflict.remote : s.record.value;
  if (backup) download(backup, useDevice ? "daily-tracker-cloud.json" : "daily-tracker-device.json");
  setState(s, {revision:conflict.head.revision, value:useDevice ? s.record.value : conflict.remote, dirty:useDevice});
  s.conflict = null; byId("choices").hidden = true;
  if (!useDevice || !s.open) openLedger(s);
  schedule(s,0);
}
byId("accept").onclick = () => resolveConflict(false);
byId("replace").onclick = () => resolveConflict(true);
byId("logout").onclick = async () => {
  if (session?.storageError) { statusText("صدّر بياناتك قبل الخروج فقد تعذّر الحفظ المحلي."); return; }
  if (session?.record.dirty && !confirm("هناك تغييرات على الجهاز بانتظار المزامنة. ستُستأنف عند دخولك بالحساب نفسه. هل تريد الخروج؟")) return;
  try { await auth.signOut(); } catch(e) { statusText(e.code || e.message); }
};

function init() {
  if (!config.apiKey || config.apiKey.includes("REPLACE")) {
    message("أضف إعدادات مشروع Firebase الجديد إلى firebase-config.js لتفعيل تسجيل الدخول.");
    gate.querySelectorAll("input,button").forEach(el => el.disabled = true); return;
  }
  firebase.initializeApp(config);
  auth = firebase.auth(); db = firebase.firestore();
  const act = async fn => {
    const buttons = gate.querySelectorAll("button");
    buttons.forEach(b => b.disabled = true); message("جارٍ تسجيل الدخول…");
    try { await fn(); }
    catch(error) { message("تعذّر تسجيل الدخول. " + (error.code || error.message)); }
    finally { buttons.forEach(b => b.disabled = false); }
  };
  byId("google").onclick = () => act(() => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()));
  byId("authForm").onsubmit = e => {
    e.preventDefault();
    const method = e.submitter?.id === "create" ? "createUserWithEmailAndPassword" : "signInWithEmailAndPassword";
    act(() => auth[method](byId("email").value.trim(),byId("password").value));
  };
  auth.onAuthStateChanged(user => {
    if (session && user?.uid !== auth.currentUser?.uid) return;
    if (session && (!user || session.key !== prefix + user.uid)) {
      const old = session; session = null; window.trackerBridge = null;
      frame.remove(); workspace.hidden = true; clearTimeout(old.timer); old.release?.(); location.reload(); return;
    }
    if (!user) { message(""); return; }
    enter(user).catch(e => message("تعذّر فتح النسخة المحلية. " + (e.code || e.message)));
  });
}
try { init(); } catch(error) { message("تعذّر بدء التطبيق. " + error.message); }
