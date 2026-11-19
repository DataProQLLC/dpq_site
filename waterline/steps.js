// The steps after signing in on the web, shared by /waterline/ and the
// OAuth consent page: first their phone (a notification to the Waterline
// app, where they tap the number shown here), then the code from their
// authenticator app if two-step is on, which unlocks once the phone says
// yes. The database keeps the check (rpc.start_sign_in_check and friends),
// so a reload carries on where it was. No phone that can answer: only the
// code. Neither: straight through.
//
// The page provides the markup (ids below) and calls
//   WaterlineSteps.start({ sb, kind, client, showError, clearError,
//                          onShow, onDone, onSignedOut })
// kind 'web' or 'connect' (client: {id, name, returnTo}). onShow: the steps
// are about to show; onSignedOut(turnedDown): the phone said no, or they
// chose another account.

(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const show = (el, on = true) => { el.hidden = !on; };

  let o = null;              // the page's options
  let check = null;          // {id, state, by_phone, number, expires_at, denied_why, two_step}
  let timer = null;          // asking the server while the phone decides
  let ticker = null;         // the time left, each second
  let authenticators = [];   // their authenticator apps (TOTP)
  let phones = [];           // phone numbers set up for two-step
  let texted = null;         // {factorId, challengeId} once a code's been texted
  let finishing = false;

  function stop() {
    clearInterval(timer);
    clearInterval(ticker);
    timer = null;
    ticker = null;
  }

  function args() {
    const c = o.client || {};
    return { kind: o.kind || 'web', client_id: c.id || null, client_name: c.name || null, return_to: c.returnTo || null };
  }

  async function start(options) {
    stop();
    o = options;
    texted = null;
    finishing = false;
    o.clearError();
    const { data, error } = await o.sb.rpc('start_sign_in_check', args());
    if (error) return o.showError(error.message);
    check = data;
    // Done already this sign-in (a reload): nothing to show.
    if (check.state === 'done') return o.onDone();
    if (o.onShow) o.onShow();
    if (check.two_step) {
      const factors = await o.sb.auth.mfa.listFactors();
      authenticators = (factors.data && factors.data.totp) || [];
      phones = (factors.data && factors.data.phone) || [];
    }
    $('mfa-code').value = '';
    show($('steps'), true);
    await settle();
  }

  /// Where the check is now: show it, and do what comes next.
  async function settle() {
    render();
    if (check.state === 'waiting') {
      if (!timer) timer = setInterval(poll, 2000);
      if (!ticker) ticker = setInterval(renderTimeLeft, 1000);
      return;
    }
    stop();
    if (check.state === 'done') return o.onDone();
    if (check.state === 'denied') return denied();
    if (check.state === 'approved' && !check.two_step) return finish();
    if (check.state === 'approved' && authenticators.length) $('mfa-code').focus();
  }

  async function poll() {
    if (!check || check.state !== 'waiting') return;
    const { data, error } = await o.sb.rpc('sign_in_check', { check_id: check.id });
    if (error) return; // a blip: ask again next time
    const was = check.state;
    check = { ...data };
    if (check.state !== was) await settle();
  }

  function secondsLeft() {
    return Math.max(0, Math.round((new Date(check.expires_at).getTime() - Date.now()) / 1000));
  }

  function renderTimeLeft() {
    if (!check || check.state !== 'waiting') return;
    const left = secondsLeft();
    if (left === 0) {
      poll();
      return;
    }
    $('phone-status').textContent =
      `Waiting for your phone… ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }

  function render() {
    const byPhone = !!check.by_phone;
    const needsCode = !!check.two_step;
    show($('phone-step'), byPhone);
    show($('code-step'), needsCode);
    // Numbered only when there are two steps.
    document.querySelectorAll('#steps .step-num').forEach((el) => show(el, byPhone && needsCode));

    if (byPhone) {
      $('phone-number').textContent = check.number == null ? '' : String(check.number);
      $('phone-step').dataset.state = check.state;
      show($('phone-again-btn'), check.state === 'expired');
      if (check.state === 'waiting') {
        $('phone-text').textContent =
          'We sent a notification to the Waterline app on your phone. Open it and tap this number:';
        renderTimeLeft();
      } else if (check.state === 'approved' || check.state === 'done') {
        $('phone-text').textContent = 'You approved this on your phone.';
        $('phone-status').textContent = '✓ Approved';
      } else if (check.state === 'expired') {
        $('phone-text').textContent = 'Your phone didn’t answer in time.';
        $('phone-status').textContent = '';
      } else {
        $('phone-text').textContent = 'Turned down on your phone.';
        $('phone-status').textContent = '';
      }
    }

    if (needsCode) {
      const ready = check.state === 'approved';
      const codeOk = authenticators.length > 0 || texted;
      $('mfa-label').textContent = texted
        ? texted.label
        : authenticators.length ? 'Code from your authenticator app' : 'We’ll text a code to your phone';
      show($('mfa-code'), !!codeOk);
      $('mfa-code').disabled = !ready;
      $('mfa-btn').disabled = !ready;
      $('mfa-btn').textContent = codeOk ? 'Verify' : 'Text me a code';
      show($('code-wait'), !ready && byPhone);
      show($('text-me-row'), ready && authenticators.length > 0 && phones.length > 0 && !texted);
    }
  }

  async function denied() {
    o.showError(check.denied_why === 'wrong_number'
      ? 'The number tapped on your phone didn’t match, so this sign-in was turned down. Sign in again to try again.'
      : 'This sign-in was turned down on your phone.');
    show($('steps'), false);
    await o.sb.auth.signOut({ scope: 'local' });
    o.onSignedOut(true);
  }

  async function finish() {
    if (finishing) return;
    finishing = true;
    const { data, error } = await o.sb.rpc('finish_sign_in_check', { check_id: check.id });
    finishing = false;
    if (error) {
      if (error.hint === 'mfa_required') {
        check = { ...check, two_step: true };
        return render();
      }
      return o.showError(error.message);
    }
    check = data;
    show($('steps'), false);
    o.onDone();
  }

  async function textCode() {
    o.clearError();
    const factor = phones[0];
    const { data, error } = await o.sb.auth.mfa.challenge({ factorId: factor.id });
    if (error) return o.showError(error.message);
    const last4 = (factor.phone || '').slice(-4);
    texted = {
      factorId: factor.id,
      challengeId: data.id,
      label: last4 ? `Code we texted to the number ending ${last4}` : 'Code we texted you',
    };
    render();
    $('mfa-code').value = '';
    $('mfa-code').focus();
  }

  $('text-me-btn').addEventListener('click', textCode);

  $('mfa-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!check || check.state !== 'approved') return;
    o.clearError();
    if (!authenticators.length && !texted) return textCode();
    const code = $('mfa-code').value.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) return o.showError('Enter the 6-digit code.');
    $('mfa-btn').disabled = true;
    let error = null;
    if (texted) {
      ({ error } = await o.sb.auth.mfa.verify({ factorId: texted.factorId, challengeId: texted.challengeId, code }));
    } else {
      // A code from any of their authenticator apps: each is tried until one
      // takes it (as the app does).
      for (const [i, factor] of authenticators.entries()) {
        ({ error } = await o.sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code }));
        if (!error || error.code !== 'mfa_verification_failed' || i === authenticators.length - 1) break;
      }
    }
    $('mfa-btn').disabled = false;
    if (error) {
      $('mfa-code').value = '';
      return o.showError(error.code === 'mfa_verification_failed'
        ? 'That code didn’t work. Use the newest one from your authenticator app.'
        : error.message);
    }
    await finish();
  });

  $('phone-again-btn').addEventListener('click', () => start(o));

  $('steps-signout-btn').addEventListener('click', async () => {
    stop();
    show($('steps'), false);
    await o.sb.auth.signOut({ scope: 'local' });
    o.onSignedOut(false);
  });

  /// Whether this sign-in has finished its steps (for the same kind and
  /// app), asked of the server: before anything that relies on it.
  async function done(options) {
    o = options;
    const { data, error } = await o.sb.rpc('start_sign_in_check', args());
    return !error && data && data.state === 'done';
  }

  window.WaterlineSteps = { start, stop, done };
})();
