// The month report: a book's month of the Plan, where it's headed, and its
// accounts (rpc.web_month_report). The database answers only a browser
// that finished signing in on the web (its phone, then two-step), so the
// page sends anyone else to /waterline/ first and back here after.

(() => {
  'use strict';

  // ---- config -------------------------------------------------------------
  // Staging for now (as /waterline/ and the docs); for production change
  // these two and the connect-src in index.html.
  const SUPABASE_URL = 'https://omxtckxgcybejfnyngxq.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_hk2tDWK2mS1HfY2R0RqUfw_JYijMaVB';
  const SIGN_IN = '/waterline/?next=/waterline/reports/';
  // -------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const show = (el, on = true) => { el.hidden = !on; };

  if (window.top !== window.self) {
    document.body.textContent = 'This page can’t be shown inside another site.';
    return;
  }
  if (!window.supabase || !window.WaterlineChart) {
    $('status').textContent = '';
    $('error').textContent = 'Couldn’t load the page. Check your connection and reload.';
    show($('error'));
    return;
  }

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  // ---- Formatting (amounts come in cents) --------------------------------

  const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const money = (cents) => dollars.format((cents || 0) / 100);
  const moneyOf = (d) => dollars.format(d);
  /// Axis labels: all compact once the axis reaches $10,000 ($5K, $10K),
  /// else in full ($500, $1,000): one style per axis.
  const moneyShort = (d, compact) => (d === 0 ? '$0' : compact
    ? `${d < 0 ? '-' : ''}$${Number((Math.abs(d) / 1000).toFixed(1))}K`
    : dollars.format(Math.round(d)).replace(/\.00$/, ''));
  const asDate = (iso) => { const [y, m, d] = iso.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const shortDay = (iso) => asDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const longDay = (iso) => asDate(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const monthName = (d) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstOf = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const words = (key) => (key || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

  function cell(row, text, cls) {
    const td = document.createElement('td');
    td.textContent = text;
    if (cls) td.className = cls;
    row.appendChild(td);
    return td;
  }

  // ---- State --------------------------------------------------------------

  let books = [];
  let bookId = null;
  let month = firstOf(new Date());
  let report = null;

  async function start() {
    const { data } = await sb.auth.getSession();
    if (!data || !data.session) return needSignIn();
    // Kept from before in this tab, but ended since: sign in again.
    const { error: gone } = await sb.auth.getUser();
    if (gone) {
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      return needSignIn();
    }
    const account = await sb.rpc('my_account');
    if (account.error) return fail(account.error);
    // Not on their plan (Free keeps its money on the phone): say so first.
    const feature = (account.data.features || {}).web_reports || {};
    if (!feature.included || feature.disabled) return fail({ hint: 'feature_locked' });
    books = (account.data.books || []).filter((b) => !b.delete_after);
    if (!books.length) {
      $('status').textContent = 'There are no books on your account yet. Make one in the Waterline app.';
      return;
    }
    const select = $('book');
    select.replaceChildren(...books.map((b) => {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.name;
      return o;
    }));
    bookId = books[0].id;
    await load();
  }

  function needSignIn() {
    $('status').textContent = '';
    show($('signin-needed'));
  }

  function fail(error) {
    if (error && ['web_check', 'mfa_required'].includes(error.hint)) {
      window.location.replace(SIGN_IN);
      return;
    }
    $('status').textContent = '';
    if (error && error.hint === 'feature_locked') {
      show($('report'), false);
      show($('locked'));
      return;
    }
    $('error').textContent = (error && error.message) || 'Something went wrong. Reload to try again.';
    show($('error'));
  }

  async function load() {
    $('report').classList.add('loading');
    const { data, error } = await sb.rpc('web_month_report', { book_id: bookId, month: isoDay(month) });
    $('report').classList.remove('loading');
    if (error) return fail(error);
    report = data;
    $('status').textContent = '';
    show($('error'), false);
    render();
    show($('report'));
  }

  // ---- Render -------------------------------------------------------------

  function render() {
    const m = report.month;
    const t = m.totals || {};
    $('title').textContent = monthName(month);
    $('subtitle').textContent = report.book ? report.book.name : '';
    $('month-name').textContent = monthName(month);
    $('book').value = bookId;
    document.title = `${report.book ? report.book.name : 'Waterline'}, ${monthName(month)} — Waterline`;

    $('in').textContent = money(t.in);
    $('in-sub').textContent = `${money(t.in_paid)} in so far`;
    $('out').textContent = money(t.out);
    $('out-sub').textContent = `${money(t.out_paid)} out so far`;
    $('net').textContent = money((t.in || 0) - (t.out || 0));
    const off = t.off_plan || 0;
    $('off').textContent = off === 0 ? 'On plan' : money(Math.abs(off));
    $('off-sub').textContent = off > 0 ? 'Better than planned' : off < 0 ? 'Worse than planned' : 'Paid as planned so far';

    renderForecast();
    renderItems(m.occurrences || []);
    renderAccounts(report.accounts || []);
    renderGroups(m.groups || []);
    $('printed').textContent = `Printed ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`
      + ` · Waterline by DataProQ LLC`;
  }

  function renderForecast() {
    const f = report.forecast || {};
    const daily = (f.daily || []).map((p) => ({ on: p.on, dollars: (p.total || 0) / 100 }));
    const floor = (f.floor || 0) / 100;
    $('forecast-sub').textContent = daily.length
      ? `Your accounts added up, the next ${daily.length} days (cards and loans left out).`
      : 'No forecast yet: add accounts and your Plan in the app.';
    window.WaterlineChart.draw($('chart'), {
      points: daily, floor, money: moneyOf, moneyShort, day: shortDay,
    });
    const body = $('forecast-table').tBodies[0];
    body.replaceChildren(...daily.map((p) => {
      const row = document.createElement('tr');
      cell(row, longDay(p.on));
      cell(row, moneyOf(p.dollars), 'num');
      return row;
    }));
  }

  const STATE = { paid: 'Paid', expected: 'Upcoming', upcoming: 'Upcoming', missed: 'Missed', skipped: 'Skipped', late: 'Late', past: 'Past' };

  function renderItems(items) {
    const body = $('items').tBodies[0];
    const sorted = [...items].sort((a, b) => (a.on || '').localeCompare(b.on || '') || (a.name || '').localeCompare(b.name || ''));
    body.replaceChildren(...sorted.map((o) => {
      const row = document.createElement('tr');
      const account = o.direction === 'transfer' && o.to_account_name
        ? `${o.account_name || ''} → ${o.to_account_name}` : (o.account_name || '—');
      cell(row, shortDay(o.on || o.due_on));
      const item = cell(row, o.name);
      const under = document.createElement('span');
      under.className = 'sub acct-sub';
      under.textContent = account;
      item.appendChild(under);
      cell(row, account, 'col-acct');
      const cents = o.actual ?? o.planned ?? 0;
      const sign = o.direction === 'in' ? '+' : o.direction === 'out' ? '−' : '';
      cell(row, `${sign}${money(cents)}`, 'num');
      const state = cell(row, '');
      const chip = document.createElement('span');
      chip.className = `chip ${o.state || ''}`;
      chip.textContent = STATE[o.state] || words(o.state);
      state.appendChild(chip);
      return row;
    }));
    show($('items-empty'), !sorted.length);
  }

  function renderAccounts(accounts) {
    const body = $('accounts').tBodies[0];
    body.replaceChildren(...accounts.map((a) => {
      const row = document.createElement('tr');
      const name = cell(row, a.name);
      const sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = [words(a.type_key), a.last4 ? `•••• ${a.last4}` : null].filter(Boolean).join(' · ');
      name.appendChild(sub);
      const bal = cell(row, money(a.balance_cents), 'num');
      if (a.balance_as_of) {
        const as = document.createElement('span');
        as.className = 'sub';
        as.textContent = `as of ${shortDay(a.balance_as_of)}`;
        bal.appendChild(as);
      }
      return row;
    }));
  }

  function renderGroups(groups) {
    const box = $('groups');
    show($('groups-card'), groups.length > 0);
    box.replaceChildren(...groups.map((g) => {
      const row = document.createElement('div');
      row.className = 'group';
      const head = document.createElement('div');
      head.className = 'group-head';
      const name = document.createElement('span');
      name.textContent = g.name;
      const amounts = document.createElement('span');
      amounts.className = 'num';
      amounts.textContent = `${money(g.actual)} of ${money(g.planned)}`;
      head.append(name, amounts);
      const bar = document.createElement('div');
      bar.className = 'group-bar';
      bar.setAttribute('role', 'img');
      const share = g.planned ? Math.min((g.actual || 0) / g.planned, 1) : 0;
      bar.setAttribute('aria-label', `${Math.round(((g.actual || 0) / (g.planned || 1)) * 100)}% of planned`);
      const fill = document.createElement('span');
      fill.style.width = `${(share * 100).toFixed(1)}%`;
      if ((g.actual || 0) > (g.planned || 0)) fill.className = 'over';
      bar.appendChild(fill);
      const note = document.createElement('span');
      note.className = 'sub';
      note.textContent = (g.actual || 0) > (g.planned || 0)
        ? `${money(g.actual - g.planned)} over`
        : `${money((g.planned || 0) - (g.actual || 0))} left`;
      row.append(head, bar, note);
      return row;
    }));
  }

  // ---- Controls -----------------------------------------------------------

  $('book').addEventListener('change', (e) => { bookId = e.target.value; load(); });
  $('prev').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() - 1, 1); load(); });
  $('next').addEventListener('click', () => { month = new Date(month.getFullYear(), month.getMonth() + 1, 1); load(); });
  $('print').addEventListener('click', () => window.print());

  // The chart fits its box: drawn again when that changes.
  let last = 0;
  new ResizeObserver(() => {
    const w = $('chart').clientWidth;
    if (report && Math.abs(w - last) > 4) { last = w; renderForecast(); }
  }).observe($('chart'));

  start();
})();
