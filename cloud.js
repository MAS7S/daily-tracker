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
let accessRevoked = false;

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
function listenForUpdates(ref, onData, onError) {
  let stop, timer, closed = false;
  function subscribe() {
    stop = ref.onSnapshot({includeMetadataChanges:true}, onData, error => {
      if (closed) return;
      if (["unavailable", "deadline-exceeded"].includes(error.code)) {
        timer = setTimeout(subscribe, 3000);
      } else onError(error);
    });
  }
  subscribe();
  return () => { closed = true; clearTimeout(timer); stop(); };
}
function openLedger(s) {
  if (s !== session) return;
  if (s.open) {
    frame.contentWindow?.refreshLedger?.();
    return;
  }
  window.trackerBridge = {
    read: () => structuredClone(s.record.value),
    storeName: () => stores.get(s.branchId)?.name || "",
    canEditStoreName: () => s === session && s.branchId === wanted && owned.has(s.branchId),
    editStoreName: () => { if (s === session && s.branchId === wanted) openStoreNameDialog(); },
    save(value) {
      if (s !== session) throw Error("Account changed");
      const copy = JSON.parse(JSON.stringify(value));
      if (JSON.stringify(copy) === JSON.stringify(s.record.value)) return;
      setState(s, {...s.record, value:copy, dirty:true});
      statusText(!navigator.onLine || s.needsAccessCheck ? pendingSync() : "حُفظ على الجهاز • بانتظار المزامنة");
      schedule(s);
    }
  };
  frame.onload = () => {
    if (session !== s) return;
    const bar = byId("bar");
    const frameWindow = frame.contentWindow;
    bar.classList.remove("scrolled");
    let previousScroll = frameWindow.scrollY;
    let previousHeight = frameWindow.innerHeight;
    frameWindow.addEventListener("scroll", () => {
      if (session !== s) return;
      const current = Math.max(0, frameWindow.scrollY);
      if (frameWindow.innerHeight !== previousHeight) {
        previousHeight = frameWindow.innerHeight;
        previousScroll = current;
        if (current < 16) bar.classList.remove("scrolled");
        return;
      }
      const delta = current - previousScroll;
      if (current < 16 || delta < -8) {
        bar.classList.remove("scrolled");
      } else if (current > 48 && delta > 8) {
        bar.classList.add("scrolled");
      }
      if (current < 16 || Math.abs(delta) > 8) {
        previousScroll = current;
      }
    }, {passive:true});
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
  const value = JSON.parse(chunks.map(doc => doc.data().text).join(""));
  if (!value || !Array.isArray(value.data) || !value.data.length) throw Error("invalid-ledger");
  return value;
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
  if (!navigator.onLine || s.needsAccessCheck) {
    if (!s.storageError) statusText(pendingSync());
    return;
  }
  if (s.busy) { s.again = true; return; }
  s.busy = true;
  try {
    if (s.storageError) persist(s);
    const snap = await s.ref.get({source:"server"});
    if (s !== session || s.needsAccessCheck) return;
    const head = snap.exists ? snap.data() : {revision:null,parts:0};
    if (snap.exists && (typeof head.revision !== "string" || !head.revision ||
        !Number.isInteger(head.parts) || head.parts < 1 || head.parts > 160)) throw Error("invalid-ledger");
    if (head.revision !== s.record.revision || (!s.open && snap.exists && !s.record.dirty)) {
      const remote = head.parts ? await readValue(s, head) : null;
      if (s !== session) return;
      if (s.record.dirty && JSON.stringify(s.record.value) !== JSON.stringify(remote)) {
        showConflict(s, head, remote); return;
      }
      if (s.open && editing() && !s.record.dirty) { schedule(s, 2500); return; }
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
    else if (error.message === "invalid-ledger" || error instanceof SyntaxError) statusText(t("Could not read the saved ledger. Check its backup before editing.", "تعذّرت قراءة الدفتر المحفوظ. راجع نسخته الاحتياطية قبل التعديل."));
    else if (error.message === "ledger-too-large") statusText("تجاوز الدفتر حد المزامنة. صدّر نسخة احتياطية قبل تقليل حجمه.");
    else {
      statusText(s.open ? pendingSync() : cacheNotice());
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
    const unsubscribe = listenForUpdates(s.ref, snap => {
      if (s !== session) return;
      if (snap.metadata.fromCache) {
        if (s.open) {
          s.needsAccessCheck = true;
          if (!s.storageError && !s.conflict) statusText(pendingSync());
        }
      } else if (!snap.metadata.hasPendingWrites) {
        if (s.needsAccessCheck) void checkSession();
        else schedule(s);
      }
    }, error => { if (s === session) deny(error.code); });
    schedule(s,0);
    await new Promise(resolve => { s.release = resolve; });
    unsubscribe();
  });
}

byId("retry").onclick = () => session?.needsAccessCheck ? checkSession() : session && schedule(session,0);
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
  emailLinkPending = auth.isSignInWithEmailLink(location.href);
  auth.onAuthStateChanged(user => { if (!emailLinkPending) void startAccess(user); });

}
const pendingDeletions = new Set();
const revocationUrl = window.dailyTrackerRevocationUrl;
const ADMIN = "malekshahbien@gmail.com";
const emailOf = user => (user?.email || "").trim().toLowerCase();
const accessRef = email => db.collection("access").doc(email);
const storeRef = id => db.collection("restaurants").doc(id);
const inviteRef = email => db.collection("ownerInvites").doc(email);
const profileRef = user => db.collection("profiles").doc(user.uid);
const t = (en, ar) => document.documentElement.lang === "ar" ? ar : en;
const cacheNotice = () => t("Connect to verify store access.", "اتصل بالإنترنت للتحقق من صلاحية الفرع.");
const pendingSync = () => t("Waiting for connection to sync", "بانتظار الاتصال للمزامنة");
let emailLinkPending = false;
let generation = 0, identity = 0, wanted = "";
let listeners = [];
let sessionIdentity, checkingSession, retryAccess = false;
let auditingGrants = false, lastGrantAudit = 0;
let profileReady = false;
let adminMode = false, profileName = "", invite, ready;
const owned = new Map(), stores = new Map(), invitations = new Map(), legacyAccess = new Map();

function closeLedger() {
  ++generation;
  const old = session;
  session = null;
  wanted = "";
  window.trackerBridge = null;
  if (old) { clearTimeout(old.timer); old.release?.(); }
  frame.onload = null;
  if (frame.getAttribute("src") && frame.getAttribute("src") !== "about:blank") frame.src = "about:blank";
  workspace.hidden = true;
  gate.hidden = false;
  byId("choices").hidden = true;
}
function backupRevokedDrafts(user, ledger) {
  const ledgerPrefix = prefix + user.uid + ":store:";
  const keys = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(ledgerPrefix)) keys.add(key);
  }
  if (ledger?.key.startsWith(ledgerPrefix)) keys.add(ledger.key);
  const links = byId("draftBackups");
  for (const key of keys) {
    const raw = localStorage.getItem(key);
    let record;
    try { record = key === ledger?.key ? ledger.record : JSON.parse(raw); }
    catch { /* Preserve an unreadable draft verbatim for recovery. */ }
    if (record?.dirty || (!record && raw)) {
      const store = key.slice(ledgerPrefix.length);
      const content = record?.value ? JSON.stringify({
        ...record.value, app:"daily-income-expense-tracker", version:3, exported:new Date().toISOString()
      }, null, 2) : raw;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([content], {type:"application/json"}));
      link.download = keys.size === 1 ? "daily-tracker-unsynced.json" : "daily-tracker-unsynced-" + store + ".json";
      link.textContent = t("Download unsynced backup", "تنزيل نسخة التغييرات غير المتزامنة") + " (" + store + ")";
      links.append(link, document.createElement("br"));
      try { link.click(); } catch { /* The link remains available for a manual download. */ }
    }
    localStorage.removeItem(key);
  }
}
function deny(reason) {
  const ledger = session;
  closeLedger();
  for (const id of ["adminPanel", "nameDialog", "storeNameDialog", "createDialog"]) byId(id).close();
  const user = auth?.currentUser;
  if (reason !== "permission-denied" || !user) {
    message(reason);
    return;
  }
  accessRevoked = true;
  ++identity;
  listeners.forEach(stop => stop());
  listeners = [];
  stores.clear();
  invite = null;
  profileName = "";
  try {
    backupRevokedDrafts(user, ledger);
    sessionStorage.removeItem(prefix + emailOf(user) + ":store");
  } catch (error) {
    console.warn("Could not clear the signed-out account cache.", error.name);
  }
  showRevokedMessage();
  void auth.signOut().catch(error => {
    console.warn("Could not sign out after access was denied.", error.code);
  });
}
function showRevokedMessage() {
  message(t("Access revoked. Contact the owner for approval.", "تم إلغاء الوصول. تواصل مع المالك للحصول على موافقة."));
}
let accessPanelMode = "grant";
let invitationsStatus = "loading", legacyAccessStatus = "loading";

function renderPanel() {
  const showList = accessPanelMode === "list";
  byId("grantTitle").hidden = showList;
  byId("authorizedTitle").hidden = !showList;
  byId("adminPanel").setAttribute("aria-labelledby", showList ? "authorizedTitle" : "grantTitle");
  byId("inviteOwner").hidden = showList;
  byId("invitationList").hidden = false;
  byId("invitationListTitle").textContent = showList
    ? t("Verified users", "المستخدمون الموثّقون")
    : t("Pending invitations and previous access", "الدعوات المعلّقة والصلاحيات السابقة");

  const list = byId("invitations");
  list.replaceChildren();
  const entries = new Map([...legacyAccess].map(([email, grant]) => [email, {...grant, legacy: true}]));
  for (const [email, approval] of invitations) {
    if (email.toLowerCase() !== ADMIN) entries.set(email, approval);
  }

  for (const email of pendingDeletions) entries.set(email, { deletionPending: true });
  for (const [email, approval] of entries) {
    const verifiedUser = activeApproval(approval) && Boolean(approval.accountUid)
      && approval.accountConfirmed === true && !approval.legacy;
    if (showList !== verifiedUser) entries.delete(email);
  }
  const statuses = showList ? [invitationsStatus] : [invitationsStatus, legacyAccessStatus];
  const incomplete = statuses.includes("failed");
  if (incomplete || !entries.size) {
    const notice = document.createElement("li");
    notice.className = "invitation-empty";
    notice.textContent = incomplete
      ? t("Some email addresses could not be loaded.", "تعذّر تحميل بعض عناوين البريد الإلكتروني.")
      : statuses.includes("loading")
        ? t("Loading email addresses…", "جارٍ تحميل عناوين البريد الإلكتروني…")
        : showList ? t("No verified users yet.", "لا يوجد مستخدمون موثّقون بعد.")
        : t("No pending invitations.", "لا توجد دعوات معلّقة.");
    list.append(notice);
  }

  const labels = {
    pending: t("Pending", "قيد الانتظار"),
    active: t("Active", "مُفعّل"),
    needsApproval: t("Needs approval", "تحتاج موافقة"),
    legacy: t("Previous access", "صلاحية سابقة"),
    revoked: t("Revoked", "ملغاة")
  };
  const ordered = [...entries].sort(([first], [second]) => first.localeCompare(second));
  for (const [email, approval] of ordered) {
    let state = "pending";
    if (approval.revoked === true) state = "revoked";
    else if (approval.legacy) state = "legacy";
    else if (!activeApproval(approval)) state = "needsApproval";
    else if (approval.accountConfirmed && approval.accountUid) state = "active";
    const row = document.createElement("li");
    row.className = "invitation-row";
    row.dataset.state = state;
    const details = document.createElement("div");
    details.className = "invitation-details";
    const address = document.createElement("bdi");
    address.textContent = email;
    const status = document.createElement("span");
    status.className = "invitation-status";
    status.textContent = labels[state];
    const account = document.createElement("small");
    account.className = "invitation-account";
    account.textContent = state === "active" ? t("Account active and verified", "الحساب مُفعّل وجاهز للاستخدام")
      : state === "pending" ? t("Awaiting user sign-in", "بانتظار إكمال المستخدم للتسجيل")
      : approval.accountConfirmed === true && approval.accountUid
      ? t("Verified sign-in recorded", "سبق تأكيد الدخول")
      : t("No verified sign-in recorded", "لا يوجد دخول مؤكّد حتى الآن");
    details.append(address, status, account);
    row.append(details);

    const button = document.createElement("button");
    button.type = "button";
    button.textContent = approval.deletionPending ? t("Finish account deletion", "إكمال حذف الحساب") : t("Revoke access", "إلغاء الوصول");
    button.setAttribute("aria-label", t("Revoke access for ", "إلغاء الوصول لـ ") + email);
    button.setAttribute("data-revoke", "");
    button.onclick = async () => {
      if (button.disabled || !window.confirm((revocationUrl ? t("Revoke access and permanently delete the sign-in account for ", "إلغاء الوصول وحذف حساب تسجيل الدخول نهائيًا لـ ") : t("Revoke access for ", "إلغاء الوصول لـ ")) + email + "?")) return;
      button.disabled = true;
      try {
        if (await adminAction(() => revokeEmailAccess(email))) {
          byId("adminMessage").textContent = t("Access revoked.", "تم إلغاء الوصول.");
        }
      } finally {
        button.disabled = false;
      }
    };
    row.append(button);
    list.append(row);
  }
}
function activeApproval(approval) {
  return approval?.approved === true && (approval.revoked === undefined || approval.revoked === false);
}
function hasBoundApproval(user) {
  return Boolean(user && activeApproval(invite) && invite.accountUid === user.uid && invite.accountConfirmed === true);
}
function canCreateInvitedStore() {
  return !adminMode && hasBoundApproval(auth.currentUser) && owned.size === 0
    && Boolean(invite.pendingStoreId) && !invite.usedStoreId;
}
function canCreateStore() {
  return ready && (adminMode ? owned.size === 0 : canCreateInvitedStore());
}
function renderToolbar() {
  const selector = byId("activeBranch");
  const switchStore = new Option(t("Switch store", "تبديل المحل"), "");
  switchStore.disabled = true;
  selector.replaceChildren(switchStore, ...[...stores].map(([id, store]) => new Option(store.name, id)));
  selector.value = "";
  selector.hidden = !adminMode || stores.size < 2;
  const canManageAccess = adminMode;
  byId("share").hidden = byId("authorized").hidden = !canManageAccess;
  byId("bar").dataset.role = canManageAccess ? "owner" : "member";
  byId("useInvite").hidden = !canCreateStore();
  byId("profileName").textContent = profileName || t("Add name","إضافة اسم");
  byId("emailDisplay").textContent = auth.currentUser?.email || "";
  if (byId("adminPanel").open && !adminMode) byId("adminPanel").close();
}
function selectStore(id) {
  if (!stores.has(id)) return;
  if (wanted !== id) {
    closeLedger();
    wanted = id;
    sessionStorage.setItem(prefix + emailOf(auth.currentUser) + ":store", id);
    const ticket = generation;
    enter(auth.currentUser, id, ticket).catch(error => {
      if (ticket === generation) deny(error.code || error.message);
    });
  }
  renderToolbar();
}
async function refreshView() {
  if (!ready || !navigator.onLine) return;
  const user = auth.currentUser;
  const directEmail = emailOf(user);
  if (!user) return;
  stores.clear();
  if (!adminMode && !hasBoundApproval(user)) {
    deny("permission-denied");
    return;
  }
  for (const [id, store] of owned) {
    if (store.ownerActive == null || store.ownerActive === true) stores.set(id, store);
  }
  if (!adminMode && stores.size > 1) {
    const last = sessionStorage.getItem(prefix + directEmail + ":store");
    const approved = invite?.usedStoreId;
    const primary = [approved, wanted, last].find(id => stores.has(id)) || stores.keys().next().value;
    const store = stores.get(primary);
    stores.clear();
    stores.set(primary, store);
  }
  if (!adminMode && !stores.size && !canCreateInvitedStore()) {
    deny("permission-denied");
    return;
  }
  if (!profileReady) return;
  if (!profileName) {
    if (!byId("nameDialog").open) {
      byId("userName").value = user.displayName || "";
      byId("nameFeedback").textContent = "";
      byId("nameDialog").showModal();
    }
    return;
  }
  if (stores.size) {
    const last = sessionStorage.getItem(prefix + directEmail + ":store");
    selectStore(stores.has(wanted) ? wanted : stores.has(last) ? last : stores.keys().next().value);
    frame.contentWindow?.refreshStoreTitle?.();
  } else {
    if (wanted || session) closeLedger();
    workspace.hidden = false;
    gate.hidden = true;
    statusText(adminMode
      ? (owned.size === 0 ? t("Create your store to open a new ledger.", "أنشئ محلك لفتح دفتر جديد.") : "")
      : t("You have approval to create one store.", "لديك موافقة لإنشاء فرع واحد."));
    renderToolbar();
  }
}
async function startAccess(user) {
  const token = ++identity;
  if (sessionIdentity && sessionIdentity.uid !== user?.uid) {
    try { sessionStorage.removeItem(prefix + sessionIdentity.email + ":store"); } catch {}
    byId("userName").value = byId("ownerEmail").value = "";
    byId("adminMessage").textContent = byId("emailDisplay").textContent = byId("profileName").textContent = "";
    byId("invitations").replaceChildren();
  }
  sessionIdentity = user ? {uid:user.uid, email:emailOf(user), verified:user.emailVerified} : null;
  checkingSession = null;
  retryAccess = false;
  lastGrantAudit = 0;
  pendingDeletions.clear();
  workspace.inert = false;
  listeners.forEach(stop => stop());
  listeners = [];
  closeLedger();
  for (const id of ["adminPanel", "nameDialog", "storeNameDialog", "createDialog"]) byId(id).close();
  [owned, stores, invitations, legacyAccess].forEach(map => map.clear());
  invitationsStatus = legacyAccessStatus = "loading";
  invite = null;
  ready = profileReady = false;
  profileName = "";
  const email = emailOf(user);
  adminMode = email === ADMIN;
  byId("adminOnly").hidden = !adminMode;
  byId("accountActions").hidden = !user;
  byId("verify").hidden = !user || user.emailVerified;
  byId("googleIdentity").hidden = !!user;
  byId("authForm").hidden = byId("google").hidden = byId("forgot").hidden = !!user;
  if (!user) {
    byId("password").value = "";
    delete byId("verify").dataset.sentFor;
    if (accessRevoked) showRevokedMessage();
    else message(navigator.onLine ? "" : cacheNotice());
    return;
  }
  accessRevoked = false;
  const backups = byId("draftBackups");
  for (const link of backups.querySelectorAll("a")) URL.revokeObjectURL(link.href);
  backups.replaceChildren();
  if (!navigator.onLine) { retryAccess = true; message(cacheNotice()); return; }
  const current = () => identity === token && auth.currentUser?.uid === user.uid;
  const snapshotIdentity = sessionIdentity;
  if (!await validateIdentity(user, snapshotIdentity, true) || !current()) return;
  if (!snapshotIdentity.verified && user.emailVerified) {
    await requestVerifiedSignIn();
    return;
  }
  sessionIdentity.verified = user.emailVerified;
  byId("verify").hidden = user.emailVerified;
  if (!user.emailVerified) { message("أكّد بريدك ثم اضغط تحقق من الوصول."); return; }
  message("");
  const fail = error => { if (current()) deny(error.code || error.message); };
  const listen = (ref, apply, onError = fail) => {
    return listenForUpdates(ref, snap => {
      if (!current() || snap.metadata.hasPendingWrites) return;
      if (snap.metadata.fromCache) return;
      apply(snap);
    }, error => { if (current()) onError(error); });
  };
  let stopOwned = null, stopProfile = null;
  let claiming = false;
  const closeOwnedWatch = () => {
    stopOwned?.();
    stopProfile?.();
    stopOwned = stopProfile = null;
    profileReady = false;
    ready = false;
    owned.clear();
  };
  listeners.push(closeOwnedWatch);

  const watchOwned = () => {
    if (stopOwned) return;
    stopProfile = listen(profileRef(user), snap => {
      if (!snap.exists && !adminMode && invite?.profileEstablished === true) {
        deny("permission-denied");
        return;
      }
      profileName = snap.data()?.name || "";
      profileReady = true;
      if (profileName && !adminMode && !invite?.profileEstablished) {
        inviteRef(email).update({profileEstablished:true}).catch(fail);
      }
      void refreshView();
    });
    const query = db.collection("restaurants").where("ownerEmail", "==", email);
    stopOwned = listen(query, snap => {
      owned.clear();
      snap.forEach(doc => owned.set(doc.id, doc.data()));
      ready = true;
      void refreshView();
    }, error => {
      closeOwnedWatch();
      fail(error);
    });
  };
  try {
    if (adminMode) {
      watchOwned();
      if (revocationUrl) listeners.push(listen(db.collection("accessRevocations"), snap => {
        pendingDeletions.clear();
        snap.forEach(doc => pendingDeletions.add(doc.id));
        renderPanel();
      }, error => console.error("Could not load pending account deletions", error.code)));
      listeners.push(listen(db.collection("ownerInvites"), snap => {
        invitations.clear();
        snap.forEach(doc => invitations.set(doc.id, doc.data()));
        invitationsStatus = "ready";
        renderPanel();
        void auditBoundGrants();
      }, () => {
        invitations.clear();
        invitationsStatus = "failed";
        renderPanel();
      }));
      listeners.push(listen(db.collection("access"), snap => {
        legacyAccess.clear();
        snap.forEach(doc => {
          if (doc.id.toLowerCase() !== ADMIN) legacyAccess.set(doc.id, doc.data());
        });
        legacyAccessStatus = "ready";
        renderPanel();
      }, () => {
        legacyAccess.clear();
        legacyAccessStatus = "failed";
        renderPanel();
      }));
    } else {
      const approval = inviteRef(email);
      listeners.push(listen(approval, snap => {
        invite = snap.data();
        if (hasBoundApproval(user)) {
          watchOwned();
          return;
        }
        closeOwnedWatch();
        if (!activeApproval(invite) || (invite.accountUid && invite.accountUid !== user.uid)) {
          deny("permission-denied");
          return;
        }
        if (claiming) return;
        claiming = true;
        db.runTransaction(async tx => {
          const pending = (await tx.get(approval)).data();
          if (!current() || !activeApproval(pending)) {
            throw Error(t("This email needs approval from the owner.", "هذا البريد يحتاج موافقة المالك."));
          }
          if (pending.accountUid === user.uid && pending.accountConfirmed === true) return;
          if (pending.accountUid && pending.accountUid !== user.uid) {
            throw Error(t("This account needs a new approval from the owner.", "هذا الحساب يحتاج موافقة جديدة من المالك."));
          }
          tx.update(approval, {accountUid: user.uid, accountConfirmed: true});
        }).catch(error => {
          if (current() && !hasBoundApproval(user)) fail(error);
        }).finally(() => { claiming = false; });
      }));
    }
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
async function revokeEmailAccess(address) {
  const email = address.trim().toLowerCase();
  if (!adminMode || email === ADMIN) return;
  const addresses = new Set([email, address]);
  for (const id of [...invitations.keys(), ...legacyAccess.keys()]) {
    if (id.trim().toLowerCase() === email) addresses.add(id);
  }
  if (!revocationUrl) throw Error(t("Account deletion is unavailable.", "خدمة حذف الحساب غير متاحة."));
  const token = await auth.currentUser.getIdToken(true);
  const response = await fetch(revocationUrl + "/revoke-confirmed", {
    method: "POST", redirect: "error",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({email, addresses: [...addresses]})
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.accountAbsent !== true) {
    throw Error(t("Account deletion could not be confirmed. Try again.", "تعذّر تأكيد حذف الحساب. أعد المحاولة."));
  }
}
// Reload the Auth record independently of the ledger. A transient network failure
// must not turn into a revocation or interrupt an in-progress edit.
async function validateIdentity(user, expected, initial) {
  try {
    await user.reload();
    if (sessionIdentity !== expected || auth.currentUser?.uid !== expected.uid) return false;
    const idToken = await user.getIdTokenResult(true);
    if (sessionIdentity !== expected || auth.currentUser?.uid !== expected.uid) return false;
    if (emailOf(user) !== expected.email || idToken.claims.sub !== expected.uid
        || String(idToken.claims.email || "").trim().toLowerCase() !== expected.email
        || (expected.verified && !user.emailVerified)
        || (user.emailVerified && idToken.claims.email_verified !== true)) {
      deny("permission-denied");
      return false;
    }
    return true;
  } catch (error) {
    if (sessionIdentity !== expected) return false;
    if (["auth/user-disabled", "auth/user-not-found", "auth/user-token-expired",
      "auth/invalid-user-token"].includes(error.code)) {
      deny("permission-denied");
    } else if (initial) {
      retryAccess = true;
      message(cacheNotice());
    }
    return false;
  }
}

async function auditBoundGrants() {
  if (!revocationUrl || !adminMode || invitationsStatus !== "ready" || auditingGrants
      || !navigator.onLine || document.hidden || Date.now() - lastGrantAudit < 300000) return;
  const user = auth.currentUser;
  const epoch = identity;
  if (!user) return;
  auditingGrants = true;
  lastGrantAudit = Date.now();
  try {
    const token = await user.getIdToken();
    for (const [address, approval] of [...invitations]) {
      if (epoch !== identity) return;
      if (!activeApproval(approval) || !approval.accountUid) continue;
      const email = address.trim().toLowerCase();
      const aliases = [...new Set([email, address, ...[...legacyAccess.keys()].filter(id => id.trim().toLowerCase() === email)])];
      const response = await fetch(revocationUrl + "/reconcile-access", {
        method:"POST", redirect:"error",
        headers:{Authorization:"Bearer " + token, "Content-Type":"application/json"},
        body:JSON.stringify({email, addresses:aliases})
      });
      if (!response.ok) throw Error("Access reconciliation returned " + response.status);
    }
  } catch (error) {
    console.warn("Could not reconcile account approvals.", error.message);
  } finally {
    auditingGrants = false;
  }
}

async function requestVerifiedSignIn() {
  await auth.signOut();
  byId("authFeedback").textContent = t("Email verified. Sign in to open your account.", "تم تأكيد البريد. سجّل الدخول لفتح حسابك.");
}
async function checkSession(manual = false) {
  const expected = sessionIdentity;
  const user = auth.currentUser;
  if (!user || !expected || !navigator.onLine || checkingSession === expected) return;
  checkingSession = expected;
  try {
    if (retryAccess || (manual && !session && !ready)) {
      await startAccess(user);
      return;
    }
    if (!await validateIdentity(user, expected, false) || sessionIdentity !== expected) return;
    if (user.emailVerified !== expected.verified) {
      await requestVerifiedSignIn();
      return;
    }
    const ledger = session;
    if (ledger?.needsAccessCheck) {
      try {
        if (!adminMode) {
          const approval = (await inviteRef(expected.email).get({source:"server"})).data();
          if (session !== ledger || sessionIdentity !== expected) return;
          if (!activeApproval(approval) || approval.accountUid !== user.uid || approval.accountConfirmed !== true) {
            deny("permission-denied"); return;
          }
        }
        // This server read also checks store ownership and ledger permissions.
        await ledger.ref.get({source:"server"});
        if (session !== ledger || sessionIdentity !== expected || !navigator.onLine) return;
        ledger.needsAccessCheck = false;
        schedule(ledger, 0);
      } catch (error) {
        if (session === ledger && error.code === "permission-denied") deny(error.code);
        return;
      }
    }
    if (manual && ready && !session) await refreshView();
    void auditBoundGrants();
  } finally {
    if (checkingSession === expected) checkingSession = null;
  }
}
byId("checkAccess").onclick = () => checkSession(true);
byId("verify").onclick = async () => {
  const user = auth.currentUser;
  const button = byId("verify");
  if (!user || button.disabled || button.dataset.sentFor === user.uid) return;
  button.disabled = true;
  try {
    await user.sendEmailVerification();
    button.dataset.sentFor = user.uid;
    message("أرسلنا رابط التأكيد إلى بريدك.");
  } catch (error) { message(error.code || error.message); }
  finally { button.disabled = false; }
};
byId("leave").onclick = () => auth.signOut().catch(error => message(error.code));
function openAccessPanel(mode) {
  if (!adminMode) return;
  accessPanelMode = mode;
  byId("adminMessage").textContent = "";
  renderPanel();
  byId("adminPanel").showModal();
  if (mode === "list") void auditBoundGrants();
}
byId("share").onclick = () => openAccessPanel("grant");
byId("authorized").onclick = () => openAccessPanel("list");
byId("closePanel").onclick = () => byId("adminPanel").close();
byId("activeBranch").onchange = event => selectStore(event.target.value);
document.addEventListener("tracker-language", () => {
  const storePrompt = byId("activeBranch").options[0];
  if (storePrompt) storePrompt.textContent = t("Switch store", "تبديل المحل");
  renderPanel();
  if (byId("status").dataset.saved === "true") statusText("تمت المزامنة");
});

byId("inviteOwner").onsubmit = async event => {
  event.preventDefault();
  if (!adminMode) return;
  const saved = await adminAction(async () => {
    const email = readEmail("ownerEmail");
    if (email === ADMIN) throw Error(t("Enter the invitee’s email.", "أدخل بريد الشخص المدعو."));
    const ref = inviteRef(email);
    const id = db.collection("restaurants").doc().id;
    await db.runTransaction(async tx => {
      const current = (await tx.get(ref)).data();
      if (!current) {
        tx.set(ref, {pendingStoreId: id, approved: true});
      } else if (!activeApproval(current)) {
        tx.update(ref, {approved: true, revoked: false, accountUid: firebase.firestore.FieldValue.delete(), accountConfirmed: firebase.firestore.FieldValue.delete(), profileEstablished: firebase.firestore.FieldValue.delete()});
      } else {
        throw Error(t("This email already has an active invitation.", "لهذا البريد دعوة مفعّلة بالفعل."));
      }
    });
  }, event.currentTarget);
  if (saved) {
    byId("adminMessage").textContent = t("Invitation approved.", "تمت الموافقة على الدعوة.");
  }
};
byId("useInvite").onclick = () => {
  if (!canCreateStore()) return;
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
    if (!canCreateStore()) {
      throw Error(t("You can only create one store.", "يمكنك إنشاء محل واحد فقط."));
    }
    if (adminMode) {
      await storeRef("primary-store").set({name, ownerEmail: email, ownerActive: true});
      return;
    }
    const expected = invite.pendingStoreId;
    const ref = inviteRef(email);
    await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      const approval = current.data();
      if (!expected || !activeApproval(approval) || approval.accountUid !== user.uid
        || approval.pendingStoreId !== expected || approval.usedStoreId) {
        throw Error(t("This approval is no longer available.", "هذه الموافقة لم تعد متاحة."));
      }
      tx.set(storeRef(expected), {name, ownerEmail: email, ownerActive: true});
      tx.update(ref, {pendingStoreId: "", usedStoreId: expected});
    });
    sessionStorage.setItem(prefix + email + ":store", expected);
    if (stores.has(expected)) selectStore(expected);
  }, event.currentTarget, "createFeedback");
  if (ok) byId("createDialog").close();
};
function openStoreNameDialog() {
  const current = stores.get(wanted);
  if (!current || !owned.has(wanted)) return;
  byId("newStoreName").value = current.name;
  byId("storeNameFeedback").textContent = "";
  byId("storeNameDialog").showModal();
}
byId("cancelStoreName").onclick = () => byId("storeNameDialog").close();
byId("storeNameForm").onsubmit = async event => {
  event.preventDefault();
  const id = wanted;
  const token = identity;
  if (!owned.has(id) || !stores.has(id)) return;
  const saved = await adminAction(async () => {
    const name = readName("newStoreName");
    await storeRef(id).update({name});
  }, event.currentTarget, "storeNameFeedback");
  if (saved && token === identity) byId("storeNameDialog").close();
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
    const batch = db.batch();
    batch.set(profileRef(user), {name}, {merge:true});
    if (!adminMode) batch.update(inviteRef(emailOf(user)), {profileEstablished:true});
    await batch.commit();
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
  if (session) {
    session.needsAccessCheck = true;
    if (!session.storageError && !session.conflict) statusText(pendingSync());
  } else message(cacheNotice());
});
window.addEventListener("online", () => {
  void checkSession();
});

document.addEventListener("visibilitychange", () => { if (!document.hidden) void checkSession(); });
setInterval(() => { if (!document.hidden) void checkSession(); }, 60000);

document.addEventListener("tracker-email-link-finished", () => {
  if (!emailLinkPending) return;
  emailLinkPending = false;
  void startAccess(auth.currentUser);
});

try { init(); } catch (error) { message("تعذّر بدء التطبيق. " + error.message); }
