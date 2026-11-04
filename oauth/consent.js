// OAuth 2.1 consent page for Supabase Auth's OAuth server.
//
// Supabase sends the user here as /oauth/consent?authorization_id=...
// This page signs the user in if needed, shows who is asking for access,
// and calls approveAuthorization / denyAuthorization. Supabase then hands back
// the redirect_url (with the code or an access_denied error) and we go there.
//
// Everything here is public: the publishable key is designed to ship in
// browser code, and RLS is what protects data.

(() => {
  'use strict';

  // ---- config -------------------------------------------------------------
  const SUPABASE_URL = 'https://omxtckxgcybejfnyngxq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hk2tDWK2mS1HfY2R0RqUfw_JYijMaVB';
  const APP_NAME = 'Waterline';

  // Redirect hosts we recognise. Anything else still works but gets a warning.
  const KNOWN_REDIRECT_HOSTS = {
    'claude.ai': 'Claude',
    'chatgpt.com': 'ChatGPT',
  };
  // Desktop tools (Claude Code, Cursor, etc.) redirect to the user's own machine.
  const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

  // Plain-English text for each scope. Add Waterline-specific scopes here
  // when you define them (e.g. 'waterline:read').
  const SCOPE_TEXT = {
    openid: 'Confirm who you are',
    email: 'See your email address',
    profile: 'See your basic profile',
    phone: 'See your phone number',
  };
  // -------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const show = (el, on = true) => { el.hidden = !on; };

  // Refuse to run inside a frame. GitHub Pages can't send frame-ancestors,
  // and a framed consent page is a clickjacking risk.
  if (window.top !== window.self) {
    document.body.textContent = 'This page cannot be displayed inside another site.';
    return;
  }

  document.querySelectorAll('.app-name').forEach((el) => { el.textContent = APP_NAME; });

  function setStatus(text) {
    $('status').textContent = text || '';
    show($('status'), !!text);
  }
  function showError(text) {
    $('error').textContent = text;
    show($('error'), true);
  }
  function clearError() { show($('error'), false); }

  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');
  if (!authorizationId || !/^[A-Za-z0-9_-]{8,200}$/.test(authorizationId)) {
    setStatus('');
    showError('This link is missing its authorization request. Start the connection again from the app you are connecting.');
    return;
  }

  if (!window.supabase || !window.supabase.createClient) {
    setStatus('');
    showError('Could not load the sign-in library. Check your connection and reload.');
    return;
  }

  // Session kept per tab only, so nothing lingers on a shared computer.
  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  // ---- sign-in ------------------------------------------------------------
  let mode = 'phone';
  let sentTo = null; // { phone } or { email }

  function setMode(next) {
    mode = next;
    $('tab-phone').setAttribute('aria-selected', String(mode === 'phone'));
    $('tab-email').setAttribute('aria-selected', String(mode === 'email'));
    show($('phone-field'), mode === 'phone');
    show($('email-field'), mode === 'email');
    show($('sms-note'), mode === 'phone');
    clearError();
  }
  $('tab-phone').addEventListener('click', () => setMode('phone'));
  $('tab-email').addEventListener('click', () => setMode('email'));

  function normalizePhone(raw) {
    const trimmed = raw.trim();
    const digits = trimmed.replace(/\D/g, '');
    if (trimmed.startsWith('+')) return digits.length >= 8 ? '+' + digits : null;
    if (digits.length === 10) return '+1' + digits;
    if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
    return null;
  }

  $('send-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    let payload;
    if (mode === 'phone') {
      const phone = normalizePhone($('phone').value);
      if (!phone) return showError('Enter a mobile number, e.g. (215) 555-0123.');
      payload = { phone };
    } else {
      const email = $('email').value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Enter a valid email address.');
      payload = { email };
    }

    $('send-btn').disabled = true;
    // shouldCreateUser: false — this page only signs in existing accounts.
    const { error } = await sb.auth.signInWithOtp({ ...payload, options: { shouldCreateUser: false } });
    $('send-btn').disabled = false;
    if (error) {
      return showError(
        /signups? not allowed|not found/i.test(error.message)
          ? `No ${APP_NAME} account uses that ${mode === 'phone' ? 'number' : 'email'}. Sign in the same way you do in the app.`
          : error.message
      );
    }

    sentTo = payload;
    $('sent-to').textContent = payload.phone || payload.email;
    show($('send-form'), false);
    show($('verify-form'), true);
    $('code').value = '';
    $('code').focus();
  });

  $('verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const token = $('code').value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) return showError('Enter the code from your message.');

    $('verify-btn').disabled = true;
    const { error } = await sb.auth.verifyOtp(
      sentTo.phone ? { phone: sentTo.phone, token, type: 'sms' } : { email: sentTo.email, token, type: 'email' }
    );
    $('verify-btn').disabled = false;
    if (error) return showError(error.message);

    show($('signin'), false);
    await loadConsent();
  });

  $('restart-btn').addEventListener('click', () => {
    sentTo = null;
    clearError();
    show($('verify-form'), false);
    show($('send-form'), true);
  });

  // ---- consent ------------------------------------------------------------
  function describeRedirect(uri) {
    let url;
    try { url = new URL(uri); } catch { return { label: uri, known: false }; }

    if (url.protocol === 'https:' && KNOWN_REDIRECT_HOSTS[url.hostname]) {
      return { label: `${url.hostname} (${KNOWN_REDIRECT_HOSTS[url.hostname]})`, known: true };
    }
    if (url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname)) {
      return { label: 'an app on this computer (' + url.host + ')', known: false };
    }
    if (url.protocol === 'https:') return { label: url.hostname, known: false };
    return { label: url.protocol.replace(':', '') + ' app link', known: false };
  }

  function renderScopes(scopeString) {
    const list = $('scopes');
    list.replaceChildren();
    const scopes = (scopeString || '').split(/\s+/).filter(Boolean);
    const items = scopes.length ? scopes : ['__default'];
    for (const s of items) {
      const li = document.createElement('li');
      li.textContent = s === '__default'
        ? `Use your ${APP_NAME} data on your behalf`
        : (SCOPE_TEXT[s] || `Use the "${s}" permission`);
      list.appendChild(li);
    }
  }

  async function loadConsent() {
    setStatus('Checking the request…');
    const { data, error } = await sb.auth.oauth.getAuthorizationDetails(authorizationId);

    if (error) {
      setStatus('');
      return showError(
        /expired|not found|invalid/i.test(error.message)
          ? 'This request has expired or was already used. Start the connection again from the app you are connecting.'
          : error.message
      );
    }

    // Already approved earlier: Supabase gives us the finished redirect.
    if (data && !('authorization_id' in data) && data.redirect_url) {
      setStatus('Already approved. Returning you to the app…');
      window.location.replace(data.redirect_url);
      return;
    }

    const clientName = (data.client && data.client.name) || 'An app';
    $('title').textContent = `Connect ${clientName}?`;
    $('client-name').textContent = clientName;

    const redirect = describeRedirect(data.redirect_uri);
    $('redirect-host').textContent = redirect.label;
    show($('unknown-warning'), !redirect.known);

    if (data.client && data.client.uri) {
      $('client-site').textContent = data.client.uri;
      show($('client-site-row'), true);
    }

    renderScopes(data.scope);
    $('who').textContent = (data.user && data.user.email) || (await currentUserLabel());

    setStatus('');
    show($('consent'), true);
  }

  async function currentUserLabel() {
    const { data } = await sb.auth.getUser();
    const u = data && data.user;
    return (u && (u.email || u.phone)) || 'your account';
  }

  async function decide(approve) {
    clearError();
    $('approve-btn').disabled = true;
    $('deny-btn').disabled = true;
    setStatus(approve ? 'Approving…' : 'Denying…');

    const fn = approve ? sb.auth.oauth.approveAuthorization : sb.auth.oauth.denyAuthorization;
    const { data, error } = await fn.call(sb.auth.oauth, authorizationId, { skipBrowserRedirect: true });

    if (error || !data || !data.redirect_url) {
      $('approve-btn').disabled = false;
      $('deny-btn').disabled = false;
      setStatus('');
      return showError((error && error.message) || 'Something went wrong. Try again.');
    }

    setStatus(approve ? 'Approved. Returning you to the app…' : 'Denied. Returning you to the app…');
    show($('consent'), false);
    window.location.replace(data.redirect_url);
  }

  $('approve-btn').addEventListener('click', () => decide(true));
  $('deny-btn').addEventListener('click', () => decide(false));

  $('signout-btn').addEventListener('click', async () => {
    await sb.auth.signOut({ scope: 'local' });
    show($('consent'), false);
    $('title').textContent = 'Authorize access';
    setStatus('');
    show($('signin'), true);
  });

  // ---- start --------------------------------------------------------------
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      await loadConsent();
    } else {
      setStatus('');
      show($('signin'), true);
    }
  })();
})();
