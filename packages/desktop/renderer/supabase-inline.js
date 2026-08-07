// ── Inline Supabase Client ──────────────────────────────────────────────
// Minimal REST + Auth wrapper for Supabase. Works in Electron without bundler.
// Replaces the ES module import('./supabase.js') which fails in Electron.

(function() {
  const SUPABASE_URL = 'https://nknoznglfiyzlahjsgbl.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rbm96bmdsZml5emxhaGpzZ2JsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMjYzNTQsImV4cCI6MjEwMTcwMjM1NH0.bqgie6QV3-k61Vyu-k5mCFXFLK9xhb_qzP1zgASnlKE';

  let _accessToken = null;
  let _refreshTimer = null;
  let _authCallback = null;

  function headers() {
    const h = { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
    if (_accessToken) h['Authorization'] = 'Bearer ' + _accessToken;
    return h;
  }

  async function rest(path, opts = {}) {
    const url = SUPABASE_URL + '/rest/v1/' + path;
    const res = await fetch(url, { headers: headers(), ...opts });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(body || res.statusText);
    }
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) return res.json();
    return null;
  }

  async function rpc(fn, params = {}) {
    const url = SUPABASE_URL + '/rest/v1/rpc/' + fn;
    const res = await fetch(url, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function scheduleRefresh(expiresIn) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    // Refresh 60s before expiry
    _refreshTimer = setTimeout(async () => {
      try { await refreshSession(); } catch (e) { console.warn('[supabase] auto-refresh failed:', e); }
    }, Math.max((expiresIn - 60) * 1000, 30000));
  }

  async function refreshSession() {
    const refreshToken = localStorage.getItem('tl_sb_refresh');
    if (!refreshToken) return null;
    const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) { signOut(); return null; }
    const data = await res.json();
    _accessToken = data.access_token;
    localStorage.setItem('tl_sb_access', data.access_token);
    localStorage.setItem('tl_sb_refresh', data.refresh_token);
    localStorage.setItem('tl_sb_user', JSON.stringify(data.user));
    scheduleRefresh(data.expires_in || 3600);
    if (_authCallback) _authCallback('TOKEN_REFRESHED', data.user);
    return data;
  }

  // ── Public API ────────────────────────────────────────────────────────
  window.tunelessSupabase = {
    isConfigured: () => true,

    onAuthChange(cb) { _authCallback = cb; },

    async getSession() {
      const access = localStorage.getItem('tl_sb_access');
      const refresh = localStorage.getItem('tl_sb_refresh');
      const userStr = localStorage.getItem('tl_sb_user');
      if (access && userStr) {
        _accessToken = access;
        return { user: JSON.parse(userStr), access_token: access };
      }
      // Try refresh
      if (refresh) {
        const data = await refreshSession();
        if (data) return { user: data.user, access_token: data.access_token };
      }
      return null;
    },

    async signIn(email, password) {
      const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error_description || body.msg || 'Sign in failed');
      _accessToken = body.access_token;
      localStorage.setItem('tl_sb_access', body.access_token);
      localStorage.setItem('tl_sb_refresh', body.refresh_token);
      localStorage.setItem('tl_sb_user', JSON.stringify(body.user));
      scheduleRefresh(body.expires_in || 3600);
      if (_authCallback) _authCallback('SIGNED_IN', body.user);
      return body;
    },

    async signUp(email, password, displayName) {
      const res = await fetch(SUPABASE_URL + '/auth/v1/signup', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email, password,
          data: { full_name: displayName || email.split('@')[0] },
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error_description || body.msg || 'Sign up failed');
      return body;
    },

    async signOut() {
      const refresh = localStorage.getItem('tl_sb_refresh');
      if (refresh) {
        try {
          await fetch(SUPABASE_URL + '/auth/v1/logout', {
            method: 'POST',
            headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: refresh }),
          });
        } catch {}
      }
      _accessToken = null;
      localStorage.removeItem('tl_sb_access');
      localStorage.removeItem('tl_sb_refresh');
      localStorage.removeItem('tl_sb_user');
      if (_refreshTimer) clearTimeout(_refreshTimer);
      if (_authCallback) _authCallback('SIGNED_OUT', null);
    },

    async resetPassword(email) {
      const res = await fetch(SUPABASE_URL + '/auth/v1/recover', {
        method: 'POST',
        headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error('Failed to send reset link');
    },

    // ── REST helpers ──────────────────────────────────────────────────
    async from(table) {
      const query = { _table: table, _filters: [], _order: null, _single: false, _select: '*' };
      const self = this;
      const chain = {
        select(cols) { query._select = cols || '*'; return chain; },
        eq(col, val) { query._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return chain; },
        in(col, vals) { query._filters.push(`${col}=in.(${vals.map(v => encodeURIComponent(v)).join(',')})`); return chain; },
        order(col, opts) { query._order = `${col}.${opts?.ascending ? 'asc' : 'desc'}`; return chain; },
        single() { query._single = true; return chain; },
        async then(resolve, reject) {
          try {
            let path = query._table + '?select=' + query._select;
            if (query._filters.length) path += '&' + query._filters.join('&');
            if (query._order) path += '&order=' + query._order;
            const data = await rest(path);
            resolve(query._single ? (data?.[0] || null) : data);
          } catch (e) { reject(e); }
        },
      };
      return chain;
    },

    async insert(rows) {
      const table = rows._table || arguments[1];
      const data = await rest(table, { method: 'POST', body: JSON.stringify(Array.isArray(rows) ? rows : [rows]) });
      return { data, error: null };
    },

    async upsert(rows, opts) {
      const table = rows._table || arguments[2];
      const headersObj = headers();
      if (opts?.onConflict) headersObj['Prefer'] = 'resolution=merge-duplicates';
      const url = SUPABASE_URL + '/rest/v1/' + table;
      const res = await fetch(url, {
        method: 'POST',
        headers: headersObj,
        body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
      });
      if (!res.ok) return { data: null, error: { message: await res.text() } };
      return { data: await res.json(), error: null };
    },

    async delete(table) {
      const chain = { _table: table, _filters: [], eq(col, val) { this._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return this; } };
      chain.then = async (resolve, reject) => {
        try {
          let path = table + '?';
          if (chain._filters.length) path += chain._filters.join('&');
          await rest(path, { method: 'DELETE' });
          resolve({ data: null, error: null });
        } catch (e) { reject(e); }
      };
      return chain;
    },

    async update(table, data) {
      const chain = { _table: table, _data: data, _filters: [], eq(col, val) { this._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return this; } };
      chain.then = async (resolve, reject) => {
        try {
          let path = table + '?';
          if (chain._filters.length) path += chain._filters.join('&');
          await rest(path, { method: 'PATCH', body: JSON.stringify(chain._data) });
          resolve({ data: null, error: null });
        } catch (e) { reject(e); }
      };
      return chain;
    },

    removeChannel() {},
    channel() { return { on() { return this; }, subscribe() { return this; } }; },
  };
})();
