// Waterline on the web: sign in with the account made in the app (Google,
// an emailed code, or a password), then the two-step code if it's on, then
// a page about the account. More (reports) comes later.
//
// Everything here is public: the publishable key is made to ship in browser
// code, and the database decides what each person can see. The session is
// kept per tab (sessionStorage), so nothing lingers on a shared computer.

(() => {
  'use strict';

  // ---- config -------------------------------------------------------------
  // Staging for now. For production change these two (and the connect-src in
  // index.html's Content-Security-Policy).
  const SUPABASE_URL = 'https://omxtckxgcybejfnyngxq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hk2tDWK2mS1HfY2R0RqUfw_JYijMaVB';
  // Where Google and emailed links come back to. Must be in Supabase's
  // Authentication > URL Configuration > Redirect URLs.
  const HERE = new URL('/waterline/', window.location.origin).href;
  // -------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const show = (el, on = true) => { el.hidden = !on; };

  // Not inside another site's frame (GitHub Pages can't send frame-ancestors).
  if (window.top !== window.self) {
    document.body.textContent = 'This page can’t be shown inside another site.';
    return;
  }

  function setStatus(text) { $('status').textContent = text || ''; }
  function showError(text) { $('error').textContent = text; show($('error'), true); }
  function clearError() { show($('error'), false); }
  function heading(title, subtitle) {
    $('title').textContent = title;
    $('subtitle').textContent = subtitle;
  }
  function only(section) {
    for (const id of ['signin', 'two-step', 'home']) show($(id), id === section);
  }

  /// What went wrong, in words to act on.
  function explain(error) {
    const code = error && error.code;
    const message = (error && error.message) || 'Something went wrong. Try again.';
    if (code === 'invalid_credentials') {
      return 'That email and password don’t match. If you sign in with Google or a code, use that instead.';
    }
    if (code === 'otp_expired') return 'That code has expired or isn’t right. Send a new one.';
    if (code === 'mfa_verification_failed') return 'That code didn’t work. Use the newest one from your authenticator app.';
    if (code === 'over_email_send_rate_limit' || code === 'over_sms_send_rate_limit') {
      return 'We’ve just sent you one. Wait a minute, then try again.';
    }
    if (code === 'over_request_rate_limit') return 'Too many tries. Wait a minute, then try again.';
    if (code === 'otp_disabled' || /signups? not allowed|not found/i.test(message)) {
      return 'No Waterline account uses that email. Make your account in the Waterline app first.';
    }
    return message;
  }

  if (!window.supabase || !window.supabase.createClient) {
    setStatus('');
    showError('Couldn’t load the sign-in library. Check your connection and reload.');
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  // ---- Where they are -----------------------------------------------------

  async function route() {
    clearError();
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return showSignIn();
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!error && aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') return showTwoStep();
    return showHome(data.session, aal);
  }

  // ---- Signing in ---------------------------------------------------------

  function showSignIn() {
    heading('Sign in to Waterline', 'Use the account you made in the Waterline app.');
    setStatus('');
    only('signin');
  }

  function useTab(which) {
    const code = which === 'code';
    $('tab-code').setAttribute('aria-selected', String(code));
    $('tab-password').setAttribute('aria-selected', String(!code));
    show($('send-form'), code);
    show($('verify-form'), false);
    show($('password-form'), !code);
    clearError();
  }
  $('tab-code').addEventListener('click', () => useTab('code'));
  $('tab-password').addEventListener('click', () => useTab('password'));

  $('google-btn').addEventListener('click', async () => {
    clearError();
    $('google-btn').disabled = true;
    const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: HERE } });
    if (error) {
      $('google-btn').disabled = false;
      showError(explain(error));
    }
    // Otherwise the browser is on its way to Google.
  });

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let sentTo = null;

  $('send-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const email = $('email').value.trim();
    if (!emailPattern.test(email)) return showError('Enter your email address.');
    $('send-btn').disabled = true;
    // Only accounts that already exist: accounts are made in the app.
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: HERE },
    });
    $('send-btn').disabled = false;
    if (error) return showError(explain(error));
    sentTo = email;
    $('sent-to').textContent = email;
    show($('send-form'), false);
    show($('verify-form'), true);
    $('code').value = '';
    $('code').focus();
  });

  $('verify-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const token = $('code').value.replace(/\s/g, '');
    if (!/^\d{6,10}$/.test(token)) return showError('Enter the code from the email.');
    $('verify-btn').disabled = true;
    const { error } = await sb.auth.verifyOtp({ email: sentTo, token, type: 'email' });
    $('verify-btn').disabled = false;
    if (error) return showError(explain(error));
    await route();
  });

  $('restart-btn').addEventListener('click', () => {
    sentTo = null;
    useTab('code');
    $('email').focus();
  });

  $('password-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    const email = $('pw-email').value.trim();
    const password = $('password').value;
    if (!emailPattern.test(email)) return showError('Enter your email address.');
    if (!password) return showError('Enter your password.');
    $('password-btn').disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password });
    $('password-btn').disabled = false;
    if (error) return showError(explain(error));
    $('password').value = '';
    await route();
  });

  // ---- Two-step verification ----------------------------------------------

  let authenticators = [];   // their authenticator apps (TOTP), oldest first
  let phones = [];           // phone numbers set up for two-step
  let texted = null;         // {factorId, challengeId} once a code's been texted

  async function showTwoStep() {
    heading('Two-step verification', 'One more step: the code that proves it’s you.');
    setStatus('');
    texted = null;
    const { data, error } = await sb.auth.mfa.listFactors();
    if (error) return showError(explain(error));
    authenticators = data.totp || [];
    phones = data.phone || [];
    $('mfa-label').textContent = authenticators.length
      ? 'Code from your authenticator app'
      : 'We’ll text a code to your phone';
    $('mfa-btn').textContent = authenticators.length ? 'Verify' : 'Text me a code';
    show($('mfa-code'), authenticators.length > 0);
    show($('text-me-row'), authenticators.length > 0 && phones.length > 0);
    $('mfa-code').value = '';
    only('two-step');
    if (authenticators.length) $('mfa-code').focus();
  }

  async function textCode() {
    clearError();
    const factor = phones[0];
    const { data, error } = await sb.auth.mfa.challenge({ factorId: factor.id });
    if (error) return showError(explain(error));
    texted = { factorId: factor.id, challengeId: data.id };
    const last4 = (factor.phone || '').slice(-4);
    $('mfa-label').textContent = last4 ? `Code we texted to the number ending ${last4}` : 'Code we texted you';
    $('mfa-btn').textContent = 'Verify';
    show($('mfa-code'), true);
    show($('text-me-row'), false);
    $('mfa-code').value = '';
    $('mfa-code').focus();
  }
  $('text-me-btn').addEventListener('click', textCode);

  $('mfa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    clearError();
    if (!authenticators.length && !texted) return textCode();
    const code = $('mfa-code').value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return showError('Enter the 6-digit code.');
    $('mfa-btn').disabled = true;
    let error = null;
    if (texted) {
      ({ error } = await sb.auth.mfa.verify({ ...texted, code }));
    } else {
      // A code from any of their authenticator apps: each is tried until one
      // takes it (as the app does).
      for (const [i, factor] of authenticators.entries()) {
        ({ error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code }));
        if (!error || error.code !== 'mfa_verification_failed' || i === authenticators.length - 1) break;
      }
    }
    $('mfa-btn').disabled = false;
    if (error) {
      $('mfa-code').value = '';
      return showError(explain(error));
    }
    await route();
  });

  // ---- Signed in ----------------------------------------------------------

  async function showHome(session, aal) {
    const user = session.user;
    heading('Waterline', 'You’re signed in.');
    $('who').textContent = user.email || user.phone || 'You';
    setStatus('');
    only('home');

    const [account, billing, factors] = await Promise.all([
      sb.rpc('my_account'),
      sb.rpc('my_billing'),
      sb.auth.mfa.listFactors(),
    ]);
    if (account.error || billing.error) {
      showError('Couldn’t load your account. Reload to try again.');
      return;
    }
    const me = account.data || {};
    const bill = billing.data || {};

    const name = me.first_name || me.display_name;
    if (name) heading(`Hi, ${name}`, 'You’re signed in to Waterline.');

    const sub = bill.subscription;
    const shared = bill.shared;
    let plan = 'Free';
    let planNote = '';
    if (sub && sub.plan_name) {
      plan = sub.plan_name;
      if (sub.status === 'trialing') planNote = 'Free trial';
    } else if (shared && shared.plan_name) {
      plan = shared.plan_name;
      planNote = shared.owner_name ? `Shared by ${shared.owner_name}` : 'Shared with you';
    }
    setFact('plan', plan, planNote);
    show($('free-note'), plan === 'Free');

    const hasTwoStep = !factors.error &&
      ((factors.data.totp || []).length + (factors.data.phone || []).length) > 0;
    if (aal && aal.currentLevel === 'aal2') setFact('two-step-state', 'On', 'Entered this sign-in');
    else if (hasTwoStep) setFact('two-step-state', 'On');
    else setFact('two-step-state', 'Off', 'Turn it on in the app: Profile → Security');

    // Every feature is listed, with whether their plan includes it.
    const api = (me.features && me.features.api_access) || {};
    if (api.included && !api.disabled) {
      setFact('api-state', 'Included', api.requires_mfa && !hasTwoStep
        ? 'Turn on two-step in the app, then make keys: Profile → Security → API keys'
        : 'Make keys in the app: Profile → Security → API keys');
    } else {
      setFact('api-state', 'Not on your plan', api.plan_name ? `Comes with ${api.plan_name}` : '');
    }
  }

  function setFact(id, value, note) {
    const dd = $(id);
    dd.textContent = value;
    if (note) {
      const span = document.createElement('span');
      span.className = 'sub';
      span.textContent = note;
      dd.appendChild(span);
    }
  }

  // Ends this browser's session (on the server too), nothing else.
  async function signOut() {
    await sb.auth.signOut({ scope: 'local' });
    useTab('code');
    await route();
  }
  $('signout-btn').addEventListener('click', signOut);
  $('mfa-signout-btn').addEventListener('click', signOut);

  // ---- Start --------------------------------------------------------------

  (async () => {
    // Back from Google: supabase-js has swapped ?code= for a session by now.
    const params = new URLSearchParams(window.location.search);
    const failed = params.get('error_description') || params.get('error');
    if (params.has('code') || failed) {
      await sb.auth.getSession();
      window.history.replaceState(null, '', window.location.pathname);
    }
    await route();
    if (failed) {
      showError(/access_denied/.test(failed) ? 'Google sign-in was cancelled.' : failed);
    }
  })();
})();
