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
    if (s.record.dirty) localStorage.setItem(s.key, JSON.stringify(s.record));
    else localStorage.removeItem(s.key);
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
    else if (error.code === "permission-denied") deny(error.code);
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

async function enter(user, branchId, ticket) {
  const key = prefix + user.uid + ":store:" + branchId;
  if (!navigator.locks) { message("افتح التطبيق في متصفح حديث."); return; }
  await navigator.locks.request(key, {ifAvailable:true}, async lock => {
    if (ticket !== generation || auth.currentUser?.uid !== user.uid) return;
    if (!lock) { wanted = ""; message("أغلق نافذة الدفتر الأخرى ثم اضغط تحقق من الوصول."); return; }
    const record = JSON.parse(localStorage.getItem(key) || "null") || {revision:null,dirty:false,value:null};
    const s = { key, record, branchId, ref:db.collection("restaurants").doc(branchId).collection("ledgers").doc("main") };
    session = s;
    gate.hidden = true; workspace.hidden = false;
    byId("emailDisplay").textContent = user.email;
    statusText("جارٍ فتح دفتر الفرع…");
    byId("branchLabel").textContent = selectedName || branchId;
    const unsubscribe = s.ref.onSnapshot({includeMetadataChanges:true}, snap => {
      if (s !== session) return;
      if (!snap.metadata.fromCache && !snap.metadata.hasPendingWrites) schedule(s);
    }, error => { if (s === session) deny(error.code); });
    if (s.record.value) openLedger(s);
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
  if (config.projectId === "restaurant-3be9c" || config.authDomain?.startsWith("restaurant-3be9c.")) { message("استخدم إعدادات مشروع Firebase الجديد المستقل."); return; }
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
  auth.onAuthStateChanged(startAccess);

}
const ADMIN = "malekshahbien@gmail.com";
const emailOf = user => (user?.email || "").trim().toLowerCase();
let generation = 0, identity = 0, accessOff = [], wanted = "", selectedName = "";
const stores = new Map(), accounts = new Map();
const accessRef = email => db.collection("access").doc(email);
const storeRef = id => db.collection("restaurants").doc(id);
function closeLedger() {
  ++generation;
  const old = session; session = null; wanted = "";
  window.trackerBridge = null;
  if (old) { clearTimeout(old.timer); old.release?.(); }
  frame.onload = null; frame.src = "about:blank";
  workspace.hidden = true; gate.hidden = false; byId("choices").hidden = true;
  if (byId("adminPanel").open) byId("adminPanel").close();
}
function deny(reason) {
  closeLedger();
  message(reason === "permission-denied" ? "الوصول إلى هذا الفرع غير مفعّل. تواصل مع المدير." : reason);
}
function selectStore(user,id,name) {
  selectedName = name;
  if (wanted === id) { byId("branchLabel").textContent=name; return; }
  closeLedger(); wanted=id;
  enter(user,id,generation).catch(e => { if (wanted === id) deny(e.code || e.message); });
}
function adminRender() {
  const branch=byId("branch"), members=byId("members");
  branch.replaceChildren(...Array.from(stores, ([id,s]) => new Option(s.name,id)));
  branch.value=wanted;
  byId("branchOwner").textContent=stores.get(wanted)?.ownerEmail || ADMIN;
  members.replaceChildren();
  for (const [email,account] of accounts) {
    if (account.storeId !== wanted) continue;
    const row=document.createElement("div"), label=document.createElement("bdi"), button=document.createElement("button");
    row.className="member"; label.textContent=email;
    button.textContent=account.active ? "مفعّل · تعطيل" : "معطّل · تفعيل";
    button.onclick=()=>adminAction(()=>accessRef(email).update({active:!account.active}));
    row.append(label,button); members.append(row);
  }
  const owners=byId("owners"); owners.replaceChildren();
  for (const branch of stores.values()) {
    const row=document.createElement("p");
    const active=branch.ownerEmail===ADMIN || accounts.get(branch.ownerEmail)?.active;
    row.textContent=branch.name+" · "+branch.ownerEmail+" · "+(active?"مفعّل":"معطّل");
    owners.append(row);
  }
  if (!members.childElementCount) members.textContent="لا توجد حسابات إضافية لهذا الفرع.";
}
async function startAccess(user) {
  const token=++identity;
  for (const off of accessOff) off();
  accessOff=[]; closeLedger(); stores.clear(); accounts.clear();
  const admin=emailOf(user) === ADMIN && user?.emailVerified;
  byId("accountActions").hidden=!user;
  byId("verify").hidden=!user || user.emailVerified;
  byId("authForm").hidden=!!user; byId("google").hidden=!!user;
  byId("share").hidden=!admin;
  if (!user) { message(""); return; }
  if (!user.emailVerified) { message("أكّد بريدك ثم اضغط تحقق من الوصول."); return; }
  message("جارٍ التحقق من صلاحية الدخول…");
  const current=()=>token===identity && auth.currentUser?.uid===user.uid;
  const fail=e=>{if(current()) deny(e.code || e.message);};
  try {
    if (admin) {
      const main=storeRef("main");
      await db.runTransaction(async tx=>{
        if (!(await tx.get(main)).exists) tx.set(main,{name:"الفرع الرئيسي",ownerEmail:ADMIN});
      });
      if (!current()) return;
      accessOff.push(db.collection("restaurants").onSnapshot({includeMetadataChanges:true},snap=>{
        if (!current()) return;
        if (snap.metadata.fromCache) { deny("يلزم اتصال لتأكيد صلاحيات الفروع."); return; }
        stores.clear(); snap.forEach(d=>stores.set(d.id,d.data()));
        const last=sessionStorage.getItem(prefix+"admin-branch");
        const id=stores.has(wanted) ? wanted : stores.has(last) ? last : "main";
        if (stores.has(id)) selectStore(user,id,stores.get(id).name);
        adminRender();
      },fail));
      accessOff.push(db.collection("access").onSnapshot(snap=>{
        if (!current()) return;
        accounts.clear(); snap.forEach(d=>accounts.set(d.id,d.data())); adminRender();
      },fail));
    } else {
      let change=0;
      accessOff.push(accessRef(emailOf(user)).onSnapshot({includeMetadataChanges:true},async snap=>{
        const version=++change;
        if (!current()) return;
        if (snap.metadata.fromCache) {deny("يلزم اتصال للتحقق من صلاحية الفرع."); return;}
        const grant=snap.data();
        if (!grant?.active) {deny("permission-denied"); return;}
        if (wanted && wanted !== grant.storeId) closeLedger();
        try {
          const branch=await storeRef(grant.storeId).get({source:"server"});
          if (current() && version===change && branch.exists) selectStore(user,branch.id,branch.data().name);
        } catch(e) { if(version===change) fail(e); }
      },fail));
    }
  } catch(e) { fail(e); }
}
byId("checkAccess").onclick=async()=>{
  try {const u=auth.currentUser; await u.reload();await u.getIdToken(true);await startAccess(auth.currentUser);}
  catch(e){message(e.code || e.message);}
};
byId("verify").onclick=async()=>{
  try {await auth.currentUser.sendEmailVerification();message("أرسلنا رابط التأكيد إلى بريدك.");} catch(e){message(e.code || e.message);}
};
byId("leave").onclick=()=>auth.signOut().catch(e=>message(e.code));
byId("share").onclick=()=>{adminRender();byId("adminPanel").showModal();};
byId("closePanel").onclick=()=>byId("adminPanel").close();
byId("branch").onchange=e=>{
  const id=e.target.value;
  if (!stores.has(id)) return;
  sessionStorage.setItem(prefix+"admin-branch",id);
  selectStore(auth.currentUser,id,stores.get(id).name);adminRender();
};
async function adminAction(fn) {
  try {await fn();byId("adminMessage").textContent="تم الحفظ.";}
  catch(e){byId("adminMessage").textContent=e.code || e.message;}
}
async function assign(email, target, newName) {
  if (email.includes("/") || (email===ADMIN && !newName)) throw Error("حساب المدير يملك صلاحية جميع الفروع.");
  await db.runTransaction(async tx=>{
    const grant=email===ADMIN ? null : await tx.get(accessRef(email));
    const oldId=grant?.data()?.storeId;
    const old=oldId && oldId!==target.id ? await tx.get(storeRef(oldId)) : null;
    if (old?.data()?.ownerEmail===email) tx.update(old.ref,{ownerEmail:ADMIN});
    if (newName) tx.set(target,{name:newName,ownerEmail:email});
    if (email!==ADMIN) tx.set(accessRef(email),{storeId:target.id,active:true});
  });
}
byId("assign").onsubmit=e=>{
  e.preventDefault();const email=byId("memberEmail").value.trim().toLowerCase();
  adminAction(async()=>{await assign(email,storeRef(wanted));byId("memberEmail").value="";});
};
byId("newBranch").onsubmit=e=>{
  e.preventDefault();const name=byId("branchName").value.trim(), email=byId("ownerEmail").value.trim().toLowerCase();
  if (!name) return;
  const form=e.currentTarget, submit=form.querySelector("button");
  if (submit.disabled) return;
  submit.disabled=true;
  const target=db.collection("restaurants").doc();
  adminAction(async()=>{await assign(email,target,name);form.reset();}).finally(()=>{submit.disabled=false;});
};
window.addEventListener("offline",()=>{if(auth?.currentUser) deny("انقطع الاتصال. يُفتح الدفتر بعد التحقق مجددًا من صلاحية الفرع.");});
window.addEventListener("online",()=>{if(auth?.currentUser) startAccess(auth.currentUser);});

try { init(); } catch(error) { message("تعذّر بدء التطبيق. " + error.message); }
