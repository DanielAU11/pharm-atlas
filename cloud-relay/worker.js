const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function bearerToken(request) {
  const authorization = request.headers.get('authorization') || '';
  return authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
}

function validEnvelope(value) {
  return value && typeof value === 'object'
    && typeof value.iv === 'string' && value.iv.length >= 16
    && typeof value.data === 'string' && value.data.length > 0
    && typeof value.tag === 'string' && value.tag.length >= 16;
}

export class PharmAtlasVault {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const token = bearerToken(request);
    if (token.length < 32) return json({ error: 'Vault credentials were rejected.' }, 401);
    const tokenHash = await sha256(token);
    const savedTokenHash = await this.state.storage.get('tokenHash');

    if (!savedTokenHash) {
      if (request.method !== 'PUT') return json({ error: 'Vault not found.' }, 404);
    } else if (savedTokenHash !== tokenHash) {
      return json({ error: 'Vault credentials were rejected.' }, 401);
    }

    const record = await this.state.storage.get('record');
    if (request.method === 'GET') {
      if (!record) return json({ error: 'Vault not found.' }, 404);
      return json(record);
    }

    if (request.method !== 'PUT') return json({ error: 'Method not allowed.' }, 405);
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 25 * 1024 * 1024) return json({ error: 'Encrypted payload is too large.' }, 413);
    const payload = await request.json().catch(() => null);
    if (!validEnvelope(payload?.envelope)) return json({ error: 'A valid encrypted envelope is required.' }, 400);
    if (!savedTokenHash) await this.state.storage.put('tokenHash', tokenHash);

    const expectedRevision = request.headers.get('if-match') || '';
    if (record && (expectedRevision === '*' || expectedRevision !== record.revision)) {
      return json({ error: 'Vault changed.', revision: record.revision }, 412);
    }
    if (!record && expectedRevision && expectedRevision !== '*') {
      return json({ error: 'Vault has not been initialized.' }, 412);
    }

    const next = {
      revision: crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
      envelope: payload.envelope
    };
    await this.state.storage.put('record', next);
    return json({ revision: next.revision, updatedAt: next.updatedAt });
  }
}

function cors(response, origin) {
  const headers = new Headers(response.headers);
  headers.set('access-control-allow-origin', origin || '*');
  headers.set('access-control-allow-methods', 'GET, PUT, OPTIONS');
  headers.set('access-control-allow-headers', 'Authorization, Content-Type, If-Match');
  headers.set('vary', 'Origin');
  headers.set('x-content-type-options', 'nosniff');
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('origin') || '';
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }), origin);
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/v1\/vaults\/([A-Za-z0-9_-]{8,128})$/);
    if (!match) return cors(json({ error: 'Not found.' }, 404), origin);
    const id = env.PHARMATLAS_VAULTS.idFromName(match[1]);
    const response = await env.PHARMATLAS_VAULTS.get(id).fetch(request);
    return cors(response, origin);
  }
};
