const googleTokenUrl = 'https://oauth2.googleapis.com/token';
const adminEmail = 'malekshahbien@gmail.com';
const identityUrl = 'https://identitytoolkit.googleapis.com/v1';

class RequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

function encodeJwtPart(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function validUid(uid) {
  return typeof uid === 'string' && uid.length <= 128 && /^[^/\s]+$/.test(uid) && uid !== '.' && uid !== '..';
}

async function serviceAccessToken(env) {
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (account.project_id !== env.FIREBASE_PROJECT_ID) throw new Error('Service account project mismatch');
  const pem = account.private_key.replace(/-----[^-]+-----|\s/g, '');
  const pkcs8 = Uint8Array.from(atob(pem), character => character.charCodeAt(0));
  const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  const key = await crypto.subtle.importKey('pkcs8', pkcs8, algorithm, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: account.client_email, aud: googleTokenUrl, iat: now, exp: now + 600,
    scope: 'https://www.googleapis.com/auth/cloud-platform'
  };
  const assertion = [JSON.stringify({ alg: 'RS256', typ: 'JWT' }), JSON.stringify(claim)]
    .map(encodeJwtPart).join('.');
  const signature = await crypto.subtle.sign(algorithm, key, new TextEncoder().encode(assertion));
  const response = await fetch(googleTokenUrl, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion + '.' + encodeJwtPart(signature)
    })
  });
  if (!response.ok) throw new Error('OAuth exchange failed');
  const { access_token: accessToken } = await response.json();
  if (!accessToken) throw new Error('Missing OAuth access token');
  return accessToken;
}

async function verifyOwnerSession(request, env) {
  const token = /^Bearer ([\w.-]+)$/i.exec(request.headers.get('Authorization') || '')?.[1];
  if (!token || token.length > 8192) throw new RequestError(401, 'invalid-session');

  // Identity Toolkit verifies the signature and Firebase session using this project's web API key.
  const lookup = await fetch(identityUrl + '/accounts:lookup?key=' + encodeURIComponent(env.FIREBASE_API_KEY), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token })
  });
  if (!lookup.ok) {
    if ([400, 401, 403].includes(lookup.status)) throw new RequestError(401, 'invalid-session');
    throw new Error('Session lookup failed');
  }
  const user = (await lookup.json()).users?.[0];
  const payload = token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/');
  const claims = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(payload), c => c.charCodeAt(0))));
  const now = Math.floor(Date.now() / 1000);
  if (!user || user.disabled || !validUid(claims.sub) || claims.sub !== user.localId
      || claims.aud !== env.FIREBASE_PROJECT_ID
      || claims.iss !== 'https://securetoken.google.com/' + env.FIREBASE_PROJECT_ID
      || !Number.isFinite(claims.exp) || claims.exp <= now
      || !Number.isFinite(claims.auth_time) || claims.auth_time < Number(user.validSince ?? 0)
      || claims.email_verified !== true || user.emailVerified !== true
      || !normalizeEmail(user.email) || normalizeEmail(user.email) !== normalizeEmail(claims.email)
      || !['password', 'google.com'].includes(claims.firebase?.sign_in_provider)) {
    throw new RequestError(401, 'invalid-session');
  }
  return user;
}

function firebase(projectId, accessToken) {
  const root = 'projects/' + projectId + '/databases/(default)/documents';
  const documentsUrl = 'https://firestore.googleapis.com/v1/' + root;
  const accountsUrl = identityUrl + '/projects/' + projectId + '/accounts:';
  const headers = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
  const post = (url, data) => fetch(url, { method: 'POST', headers, body: JSON.stringify(data) });
  const name = (collection, id) => root + '/' + collection + '/' + id;

  return {
    name,
    async grantPage(after, limit) {
      const query = {
        from: [{collectionId: 'ownerInvites'}],
        orderBy: [{field: {fieldPath: '__name__'}, direction: 'ASCENDING'}], limit
      };
      if (after) query.startAt = {values: [{referenceValue: after}], before: false};
      const response = await post(documentsUrl + ':runQuery', {structuredQuery: query});
      if (!response.ok) throw new Error('Reading grant page failed');
      return (await response.json()).map(row => row.document).filter(Boolean);
    },
    async get(collection, id) {
      const response = await fetch(documentsUrl + '/' + collection + '/' + encodeURIComponent(id), { headers });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error('Reading Firestore failed');
      return response.json();
    },
    async commit(writes) {
      const response = await post(documentsUrl + ':commit', { writes });
      if (!response.ok) {
        const code = (await response.json().catch(() => ({}))).error?.status;
        if (['ABORTED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS', 'NOT_FOUND'].includes(code)) {
          throw new RequestError(409, 'retry');
        }
        throw new Error('Writing Firestore failed');
      }
    },
    async findUser(filter) {
      const response = await post(accountsUrl + 'lookup', filter);
      const data = await response.json();
      if (!response.ok && !['USER_NOT_FOUND', 'EMAIL_NOT_FOUND'].includes(data.error?.message)) {
        throw new Error('Looking up Auth account failed');
      }
      const users = data.users ?? [];
      if (users.length > 1) throw new Error('Multiple Auth accounts matched');
      return users[0];
    },
    async deleteUser(uid) {
      const response = await post(accountsUrl + 'delete', { localId: uid });
      if (!response.ok && (await response.json()).error?.message !== 'USER_NOT_FOUND') {
        throw new Error('Deleting Auth account failed');
      }
    }
  };
}

function protectOwner(target, owner) {
  if (!target) return;
  if (!validUid(target.localId)) throw new Error('Invalid target UID');
  if (target.localId === owner.localId || normalizeEmail(target.email) === adminEmail) {
    throw new RequestError(403, 'protected-account');
  }
}

function removeVersion(doc) {
  return { delete: doc.name, currentDocument: { updateTime: doc.updateTime } };
}

// A pending invitation has no Auth dependency until its first verified sign-in.
async function reconcileGrant(api, grant, addresses) {
  const email = normalizeEmail(grant?.name.split('/').pop());
  const uid = grant?.fields?.accountUid?.stringValue;
  if (!email || email === adminEmail || !validUid(uid)) return {removed: false};
  const target = await api.findUser({localId: [uid]});
  const sameAccount = target?.localId === uid && normalizeEmail(target.email) === email;
  const profile = await api.get('profiles', uid);
  const missingProfile = grant.fields.profileEstablished?.booleanValue === true && !profile;
  if (sameAccount && !target.disabled && target.emailVerified === true && !missingProfile &&
      grant.fields.revoked?.booleanValue !== true && grant.fields.approved?.booleanValue === true) {
    return {removed: false};
  }
  const legacy = await Promise.all(addresses.map(address => api.get('access', address)));
  const writes = [grant, ...legacy.filter(Boolean)].map(removeVersion);
  // A changed email may now use this UID and its profile under a different approval.
  if (profile && (!target || sameAccount)) writes.push(removeVersion(profile));
  await api.commit(writes);
  return {removed: true};
}

async function sweepGrants(env) {
  const api = firebase(env.FIREBASE_PROJECT_ID, await serviceAccessToken(env));
  const cursor = await api.get('_maintenance', 'authReconciliation');
  const after = cursor?.fields?.after?.referenceValue;
  const page = await api.grantPage(after, 5);
  for (const grant of page) {
    const address = grant.name.split('/').pop();
    try { await reconcileGrant(api, grant, [...new Set([address, normalizeEmail(address)])]); }
    catch (error) { if (!(error instanceof RequestError && error.status === 409)) throw error; }
  }
  const next = page.length === 5 ? page[page.length - 1].name : null;
  if (next || cursor) {
    const name = api.name('_maintenance', 'authReconciliation');
    const currentDocument = cursor ? {updateTime: cursor.updateTime} : {exists: false};
    await api.commit([next ? {update: {name, fields: {after: {referenceValue: next}}}, currentDocument}
      : {delete: name, currentDocument}]);
  }
}

async function revoke(api, owner, email, addresses) {
  const pendingName = api.name('accessRevocations', email);
  let pending = await api.get('accessRevocations', email);
  if (!pending) {
    const grants = (await Promise.all(addresses.flatMap(address =>
      ['ownerInvites', 'access'].map(collection => api.get(collection, address))))).filter(Boolean);
    if (!grants.length) {
      pending = await api.get('accessRevocations', email);
      if (!pending) throw new RequestError(404, 'grant-missing');
    } else {
      const target = await api.findUser({ email: [email] });
      protectOwner(target, owner);
      const boundUid = grants.find(doc => doc.name === api.name('ownerInvites', email))?.fields?.accountUid?.stringValue;
      const uid = boundUid || target?.localId || '';
      if (uid && (!validUid(uid) || uid === owner.localId)) throw new RequestError(409, 'account-changed');
      const profile = uid && (!target || uid === target.localId) ? await api.get('profiles', uid) : null;
      // A UID now registered under another email belongs to a different authorization.
      const boundTarget = uid && !target ? await api.findUser({localId:[uid]}) : target;
      const sameIdentity = !boundTarget || (boundTarget.localId === uid && normalizeEmail(boundTarget.email) === email);
      const writes = [
        ...grants.map(removeVersion),
        ...(profile && sameIdentity ? [removeVersion(profile)] : []),
        { update: { name: pendingName, fields: {uid:{stringValue: sameIdentity ? uid : ''}} }, currentDocument: { exists: false } }
      ];
      await api.commit(writes);
      pending = await api.get('accessRevocations', email);
      if (!pending) throw new RequestError(409, 'retry');
    }
  }

  // Bind retries to the original UID. If the account no longer exists, never delete a replacement.
  let uid = pending.fields?.uid?.stringValue;
  if (uid === undefined) {
    const target = await api.findUser({ email: [email] });
    protectOwner(target, owner);
    if (target && normalizeEmail(target.email) !== email) throw new Error('Email lookup mismatch');
    uid = target?.localId ?? '';
    await api.commit([{
      update: { name: pendingName, fields: { uid: { stringValue: uid } } },
      currentDocument: { updateTime: pending.updateTime }
    }]);
    pending = await api.get('accessRevocations', email);
    if (!pending || pending.fields?.uid?.stringValue !== uid) throw new RequestError(409, 'retry');
  }

  if (uid) {
    if (!validUid(uid)) throw new Error('Invalid pending UID');
    const target = await api.findUser({ localId: [uid] });
    if (target) {
      protectOwner(target, owner);
      if (target.localId !== uid || normalizeEmail(target.email) !== email) {
        throw new RequestError(409, 'account-changed');
      }
      await api.deleteUser(uid);
    }
  }
  if (await api.findUser({ email: [email] })) throw new RequestError(409, 'account-still-present');
  await api.commit([{ delete: pendingName, currentDocument: { updateTime: pending.updateTime } }]);
  return { accountDeleted: Boolean(uid), accountAbsent: true };
}

export default {
  async scheduled(_event, env) { await sweepGrants(env); },
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const headers = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    if (origin === env.ALLOWED_ORIGIN) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (value, status) => Response.json(value, { status, headers });
    const path = new URL(request.url).pathname;
    if (!['/revoke','/revoke-confirmed','/reconcile-access'].includes(path)) return respond({ code: 'not-found' }, 404);
    if (!origin || origin !== env.ALLOWED_ORIGIN) return respond({ code: 'origin-denied' }, 403);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...headers, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type'
      } });
    }
    if (request.method !== 'POST') return respond({ code: 'method-not-allowed' }, 405);

    try {
      const owner = await verifyOwnerSession(request, env);
      const body = await request.json().catch(() => null);
      const email = normalizeEmail(body?.email);
      if (email.length > 254 || !/^[^@/\s]+@[^@/\s]+\.[^@/\s]+$/.test(email)) {
        throw new RequestError(400, 'invalid-email');
      }
      if (normalizeEmail(owner.email) !== adminEmail) throw new RequestError(403, 'owner-required');
      if (email === adminEmail) throw new RequestError(403, 'protected-account');
      const api = firebase(env.FIREBASE_PROJECT_ID, await serviceAccessToken(env));
      const aliases = body?.addresses ?? [];
      if (!Array.isArray(aliases) || aliases.length > 12 || aliases.some(address =>
        typeof address !== 'string' || address.length > 254 || normalizeEmail(address) !== email)) {
        throw new RequestError(400, 'invalid-email-aliases');
      }
      const addresses = [...new Set([email, ...aliases])];
      if (path === '/reconcile-access') {
        return respond(await reconcileGrant(api, await api.get('ownerInvites', email), addresses), 200);
      }
      return respond(await revoke(api, owner, email, addresses), 200);
    } catch (error) {
      if (error instanceof RequestError) return respond({ code: error.message }, error.status);
      return respond({ code: 'service-error' }, 502);
    }
  }
};
