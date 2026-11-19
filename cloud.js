"use strict";
const byId = id => document.getElementById(id);
const gate = byId("gate"), workspace = byId("workspace"), frame = byId("ledger");
const statusText = value => {
  const saved = value === "تمت المزامنة";
  byId("status").textContent = saved ? t("Saved to cloud", value) : value;
  byId("status").dataset.saved = String(saved);
  byId("retry").hidden = !session || saved;
};
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
    } else {
      if (!s.open) openLedger(s);
      if (s.record.dirty) await push(s);
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
    if (!lock) { deny("أغلق نافذة الدفتر الأخرى ثم اضغط تحقق من الوصول."); return; }
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
  auth.onAuthStateChanged(startAccess);

}
const ADMIN = "malekshahbien@gmail.com";
const emailOf = user => (user?.email || "").trim().toLowerCase();
const accessRef = email => db.collection("access").doc(email);
const storeRef = id => db.collection("restaurants").doc(id);
const inviteRef = email => db.collection("ownerInvites").doc(email);
const profileRef = user => db.collection("profiles").doc(user.uid);
const t = (en, ar) => document.documentElement.lang === "ar" ? ar : en;
const cacheNotice = () => t("Connect to verify store access.", "اتصل بالإنترنت للتحقق من صلاحية الفرع.");
let generation = 0, identity = 0, wanted = "", selectedName = "";
let listeners = [], stopWorker, stopMembers;
let adminMode = false, profileName = "", nameLoading = false, invite, grant, worker, ready;
const owned = new Map(), stores = new Map(), accounts = new Map(), invitations = new Map();

function closeLedger() {
  ++generation;
  const old = session;
  session = null;
  wanted = "";
  window.trackerBridge = null;
  if (old) { clearTimeout(old.timer); old.release?.(); }
  frame.onload = null;
  frame.src = "about:blank";
  workspace.hidden = true;
  gate.hidden = false;
  byId("choices").hidden = true;
}
function deny(reason) {
  closeLedger();
  for (const id of ["adminPanel", "nameDialog", "createDialog"]) byId(id).close();
  message(reason === "permission-denied"
    ? t("Store access is disabled or you have no invitation.", "لا توجد دعوة لهذا الحساب أو أن صلاحية الفرع معطّلة.")
    : reason);
}
function manages(id) {
  return stores.has(id) && owned.has(id);
}
let accessPanelMode = "grant";
function renderPanel() {
  const showList = accessPanelMode === "list";
  byId("grantTitle").hidden = showList;
  byId("authorizedTitle").hidden = !showList;
  byId("adminPanel").setAttribute("aria-labelledby", showList ? "authorizedTitle" : "grantTitle");
  byId("assign").hidden = showList;
  byId("teamList").hidden = !showList;
  byId("inviteOwner").hidden = showList;
  byId("pendingApprovals").hidden = !showList;
  const current = stores.get(wanted);
  byId("ownStore").hidden = !manages(wanted);
  const branch = byId("branch");
  branch.replaceChildren(...[...stores].filter(([id]) => manages(id))
    .map(([id, store]) => new Option(store.name, id)));
  branch.value = wanted;
  byId("shareBranchPicker").hidden = branch.options.length < 2;
  byId("branchOwner").textContent = current?.ownerEmail || "";
  const members = byId("members");
  members.replaceChildren();
  for (const [email, account] of accounts) {
    if (account.storeId !== wanted || email === current?.ownerEmail) continue;
    const row = document.createElement("div");
    const label = document.createElement("bdi");
    const button = document.createElement("button");
    row.className = "member";
    label.textContent = email;
    button.textContent = account.active ? t("Disable", "تعطيل") : t("Enable", "تفعيل");
    button.onclick = () => adminAction(() => accessRef(email).update({active: !account.active}));
    row.append(label, button);
    members.append(row);
  }
  if (!members.childElementCount) members.textContent = t("No workers yet.", "لا يوجد عمّال بعد.");
  const owners = byId("owners");
  owners.replaceChildren();
  for (const [email, approval] of invitations) {
    if (!approval.pendingStoreId) continue;
    const row = document.createElement("div");
    const label = document.createElement("bdi");
    const button = document.createElement("button");
    row.className = "member";
    label.textContent = email;
    button.textContent = t("Cancel approval", "إلغاء الموافقة");
    button.onclick = () => adminAction(() => cancelApproval(email, approval.pendingStoreId));
    row.append(label, button);
    owners.append(row);
  }
  if (!owners.childElementCount) owners.textContent = t("No pending approvals.", "لا توجد موافقات معلّقة.");
}
function renderToolbar() {
  const selector = byId("activeBranch");
  selector.replaceChildren(...[...stores].map(([id, store]) => new Option(store.name, id)));
  selector.value = wanted;
  selector.hidden = stores.size < 2;
  const canManageAccess = adminMode || manages(wanted);
  byId("share").hidden = byId("authorized").hidden = !canManageAccess;
  byId("useInvite").hidden = adminMode || !invite?.pendingStoreId;
  byId("profileName").textContent = profileName;
  byId("emailDisplay").textContent = auth.currentUser?.email || "";
  if (byId("adminPanel").open && !adminMode && !manages(wanted)) byId("adminPanel").close();
}
function listenMembers() {
  stopMembers?.();
  stopMembers = null;
  accounts.clear();
  renderPanel();
  if (!manages(wanted)) return;
  const id = wanted;
  stopMembers = db.collection("access").where("storeId", "==", id).onSnapshot(snap => {
    if (wanted !== id) return;
    accounts.clear();
    snap.forEach(doc => accounts.set(doc.id, doc.data()));
    renderPanel();
  }, error => {
    if (wanted === id) byId("adminMessage").textContent = error.code || error.message;
  });
}
function selectStore(id) {
  const store = stores.get(id);
  if (!store) return;
  selectedName = store.name;
  byId("branchLabel").textContent = store.name;
  if (wanted !== id) {
    closeLedger();
    wanted = id;
    sessionStorage.setItem(prefix + emailOf(auth.currentUser) + ":store", id);
    const ticket = generation;
    enter(auth.currentUser, id, ticket).catch(error => {
      if (ticket === generation) deny(error.code || error.message);
    });
    listenMembers();
  }
  renderToolbar();
}
async function refreshView() {
  if (!ready || !navigator.onLine) return;
  const user = auth.currentUser;
  const token = identity;
  const directEmail = emailOf(user);
  if (!user) return;
  stores.clear();
  for (const [id, store] of owned) {
    const allowed = store.ownerActive ?? (adminMode || (grant?.active && grant.storeId === id));
    if (allowed) stores.set(id, store);
  }
  if (worker && grant?.active && worker.id === grant.storeId && worker.store.ownerEmail !== directEmail) {
    stores.set(worker.id, worker.store);
  }
  if (!adminMode && !stores.size && !invite?.pendingStoreId) {
    deny("permission-denied");
    return;
  }
  if (!profileName) {
    if (nameLoading || byId("nameDialog").open) return;
    nameLoading = true;
    try {
      const snap = await profileRef(user).get({source: "server"});
      if (token !== identity || (!adminMode && !stores.size && !invite?.pendingStoreId)) return;
      profileName = snap.data()?.name || "";
      if (!profileName) {
        byId("userName").value = user.displayName || "";
        byId("nameFeedback").textContent = "";
        byId("nameDialog").showModal();
        return;
      }
    } catch (error) {
      if (token === identity) deny(error.code || error.message);
      return;
    } finally {
      if (token === identity) nameLoading = false;
    }
  }
  if (stores.size) {
    const last = sessionStorage.getItem(prefix + directEmail + ":store");
    selectStore(stores.has(wanted) ? wanted : stores.has(last) ? last : stores.keys().next().value);
  } else {
    closeLedger();
    workspace.hidden = false;
    gate.hidden = true;
    byId("branchLabel").textContent = "";
    statusText(adminMode ? "" : t("You have approval to create one store.", "لديك موافقة لإنشاء فرع واحد."));
    renderToolbar();
  }
}
async function startAccess(user) {
  const token = ++identity;
  listeners.forEach(stop => stop());
  listeners = [];
  stopWorker?.();
  stopMembers?.();
  stopWorker = stopMembers = null;
  closeLedger();
  for (const id of ["adminPanel", "nameDialog", "createDialog"]) byId(id).close();
  [owned, stores, accounts, invitations].forEach(map => map.clear());
  invite = grant = worker = null;
  ready = nameLoading = false;
  profileName = "";
  const email = emailOf(user);
  adminMode = email === ADMIN;
  byId("adminOnly").hidden = !adminMode;
  byId("accountActions").hidden = !user;
  byId("verify").hidden = !user || user.emailVerified;
  byId("authForm").hidden = byId("google").hidden = byId("forgot").hidden = !!user;
  if (!user) { message(""); return; }
  if (!user.emailVerified) { message("أكّد بريدك ثم اضغط تحقق من الوصول."); return; }
  message("جارٍ التحقق من صلاحية الدخول…");
  const current = () => identity === token && auth.currentUser?.uid === user.uid;
  const received = new Set();
  const fail = error => { if (current()) deny(error.code || error.message); };
  const listen = (key, ref, apply) => {
    listeners.push(ref.onSnapshot({includeMetadataChanges: true}, snap => {
      if (!current() || snap.metadata.hasPendingWrites) return;
      if (snap.metadata.fromCache) {
        if (received.has(key)) deny(cacheNotice());
        return;
      }
      apply(snap);
      received.add(key);
      ready = received.has("owned") && (adminMode || ["grant", "invite"].every(k => received.has(k)));
      if (key === "grant" && grant?.active && !owned.has(grant.storeId) && !worker) return;
      if (ready) void refreshView();
    }, fail));
  };
  try {
    const collection = db.collection("restaurants");
    if (adminMode) {
      listen("invites", db.collection("ownerInvites"), snap => {
        invitations.clear();
        snap.forEach(doc => invitations.set(doc.id, doc.data()));
        renderPanel();
      });
    } else {
      listen("invite", inviteRef(email), snap => { invite = snap.data(); });
      listen("grant", accessRef(email), snap => {
        grant = snap.data();
        const id = grant?.active ? grant.storeId : "";
        if (!id || worker?.id !== id) worker = null;
        stopWorker?.();
        stopWorker = null;
        if (!id) return;
        stopWorker = storeRef(id).onSnapshot({includeMetadataChanges: true}, store => {
          if (!current() || !grant?.active || grant.storeId !== id || store.metadata.hasPendingWrites) return;
          if (store.metadata.fromCache) return;
          worker = store.exists ? {id, store: store.data()} : null;
          void refreshView();
        }, error => {
          if (!current() || grant?.storeId !== id) return;
          worker = null;
          if (error.code === "permission-denied") void refreshView();
          else fail(error);
        });
      });
    }
    listen("owned", collection.where("ownerEmail", "==", email), snap => {
      owned.clear();
      snap.forEach(doc => owned.set(doc.id, doc.data()));
    });
  } catch (error) { fail(error); }
}
async function adminAction(action, form, feedbackId = "adminMessage") {
  const button = form?.querySelector("button");
  if (button?.disabled) return false;
  if (button) button.disabled = true;
  const feedback = byId(feedbackId);
  feedback.textContent = "";
  try {
    await action();
    feedback.textContent = t("Saved.", "تم الحفظ.");
    form?.reset();
    return true;
  } catch (error) {
    feedback.textContent = error.code || error.message;
    return false;
  } finally {
    if (button) button.disabled = false;
  }
}
function onSubmit(id, action, feedbackId) {
  byId(id).onsubmit = event => {
    event.preventDefault();
    void adminAction(action, event.currentTarget, feedbackId);
  };
}
function readEmail(id) {
  const email = byId(id).value.trim().toLowerCase();
  if (!email || email.includes("/")) throw Error(t("Enter a valid email.", "أدخل بريدًا صحيحًا."));
  return email;
}
function readName(id) {
  const name = byId(id).value.trim();
  if (!name) throw Error(t("Enter a name.", "أدخل اسمًا."));
  return name;
}
async function cancelApproval(email, id) {
  await db.runTransaction(async tx => {
    const ref = inviteRef(email);
    const snap = await tx.get(ref);
    if (snap.data()?.pendingStoreId === id) tx.update(ref, {pendingStoreId: ""});
  });
}
byId("checkAccess").onclick = async () => {
  try {
    const user = auth.currentUser;
    await user.reload();
    await user.getIdToken(true);
    await startAccess(auth.currentUser);
  } catch (error) { message(error.code || error.message); }
};
byId("verify").onclick = async () => {
  try {
    await auth.currentUser.sendEmailVerification();
    message("أرسلنا رابط التأكيد إلى بريدك.");
  } catch (error) { message(error.code || error.message); }
};
byId("leave").onclick = () => auth.signOut().catch(error => message(error.code));
function openAccessPanel(mode) {
  if (!adminMode && !manages(wanted)) return;
  accessPanelMode = mode;
  byId("adminMessage").textContent = "";
  renderPanel();
  byId("adminPanel").showModal();
}
byId("share").onclick = () => openAccessPanel("grant");
byId("authorized").onclick = () => openAccessPanel("list");
byId("closePanel").onclick = () => byId("adminPanel").close();
byId("activeBranch").onchange = byId("branch").onchange = event => selectStore(event.target.value);
document.addEventListener("tracker-language", () => {
  renderPanel();
  if (byId("status").dataset.saved === "true") statusText("تمت المزامنة");
});

onSubmit("assign", async () => {
  const email = readEmail("memberEmail");
  const id = wanted;
  const store = stores.get(id);
  if (email === ADMIN || email === store?.ownerEmail) {
    throw Error(t("This email already manages the store.", "هذا البريد يدير الفرع بالفعل."));
  }
  const ref = accessRef(email);
  const grant = {storeId: id, active: true};
  try {
    await ref.set(grant);
  } catch (error) {
    if (error.code !== "permission-denied") throw error;
    throw Error(t("This worker may already belong to another store.",
      "تعذّرت إضافة العامل. قد يكون مسندًا إلى فرع آخر."));
  }
});
onSubmit("inviteOwner", async () => {
  const email = readEmail("ownerEmail");
  if (email === ADMIN) throw Error(t("Enter the invitee’s email.", "أدخل بريد الشخص المدعو."));
  const ref = inviteRef(email);
  const id = db.collection("restaurants").doc().id;
  await db.runTransaction(async tx => {
    const current = await tx.get(ref);
    if (current.data()?.pendingStoreId) {
      throw Error(t("This email already has one unused approval.", "لهذا البريد موافقة واحدة لم تُستخدم بعد."));
    }
    tx.set(ref, {pendingStoreId: id});
  });
});
byId("useInvite").onclick = () => {
  byId("createFeedback").textContent = "";
  byId("createDialog").showModal();
};
byId("cancelCreate").onclick = () => byId("createDialog").close();
byId("createInvitedStore").onsubmit = async event => {
  event.preventDefault();
  const ok = await adminAction(async () => {
    const name = readName("invitedStoreName");
    const user = auth.currentUser;
    const email = emailOf(user);
    const expected = invite?.pendingStoreId;
    const ref = inviteRef(email);
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!expected || current.data()?.pendingStoreId !== expected) {
        throw Error(t("This approval is no longer available.", "هذه الموافقة لم تعد متاحة."));
      }
      tx.set(storeRef(expected), {name, ownerEmail: email, ownerActive: true});
      tx.update(ref, {pendingStoreId: ""});
    });
    sessionStorage.setItem(prefix + email + ":store", expected);
    if (stores.has(expected)) selectStore(expected);
  }, event.currentTarget, "createFeedback");
  if (ok) byId("createDialog").close();
};
byId("nameDialog").addEventListener("cancel", event => { if (!profileName) event.preventDefault(); });
byId("editName").onclick = () => {
  byId("userName").value = profileName;
  byId("nameFeedback").textContent = "";
  byId("nameDialog").showModal();
};
byId("nameForm").onsubmit = async event => {
  event.preventDefault();
  const user = auth.currentUser;
  const token = identity;
  const ok = await adminAction(async () => {
    const name = readName("userName");
    await profileRef(user).set({name});
    if (token === identity) {
      profileName = name;
      byId("profileName").textContent = name;
    }
  }, event.currentTarget, "nameFeedback");
  if (ok && token === identity) {
    byId("nameDialog").close();
    void refreshView();
  }
};
window.addEventListener("offline", () => {
  if (auth?.currentUser) deny(cacheNotice());
});
window.addEventListener("online", () => {
  if (auth?.currentUser) void startAccess(auth.currentUser);
});

try { init(); } catch (error) { message("تعذّر بدء التطبيق. " + error.message); }
