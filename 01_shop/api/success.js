const { findBySource, COLS } = require('./lib/sheets');

const DOWNLOADS = {
  mac: 'https://downloads.monosprosmonon.com/v1.1.1/Aletheia-Installer.pkg',
  win: 'https://downloads.monosprosmonon.com/v1.1.1/Aletheia-Installer.exe'
};

function page({ title, body, refresh }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
${refresh ? '<meta http-equiv="refresh" content="4">' : ''}
<title>${title}</title>
<style>
  html, body { margin: 0; padding: 0; min-height: 100%; background: #0a0a0a; color: #e8e6e0;
    font-family: 'Times New Roman', Times, serif; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 72px 24px; text-align: center; }
  h1 { font-size: 1.6rem; font-weight: 400; letter-spacing: 0.08em; margin: 0 0 8px 0; }
  p { color: #b9b5ac; font-size: 1rem; line-height: 1.6; }
  .key { font-family: 'SF Mono', Menlo, monospace; font-size: 1.35rem; letter-spacing: 0.12em;
    background: #161616; border: 1px solid #2c2c2c; border-radius: 8px;
    padding: 18px 12px; margin: 28px 0; user-select: all; }
  .btn { display: inline-block; margin: 6px; padding: 13px 26px; border: 1px solid #3a3a3a;
    border-radius: 8px; color: #e8e6e0; text-decoration: none; font-size: 0.95rem;
    letter-spacing: 0.05em; }
  .btn:hover { background: #1a1a1a; border-color: #555; }
  .steps { text-align: left; margin: 32px auto 0 auto; max-width: 420px; color: #b9b5ac;
    font-size: 0.95rem; line-height: 1.7; }
  .fine { color: #777; font-size: 0.85rem; margin-top: 40px; }
  a { color: #b9b5ac; }
</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}

export default async function handler(req, res) {
  const sessionId = (req.query && req.query.session_id) || '';

  if (!sessionId || !sessionId.startsWith('cs_')) {
    res.status(400).setHeader('Content-Type', 'text/html');
    return res.send(page({
      title: 'Aletheia',
      body: `<h1>Something's missing</h1>
        <p>This page needs a checkout reference to find your license.
        Use the link from your purchase, or write to
        <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a>
        and we'll sort it out.</p>`
    }));
  }

  // Verify the session with Stripe — never show a key for an unpaid session
  let session;
  try {
    const sr = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { 'Authorization': `Bearer ${process.env.STRIPE_SECRET_KEY}` }
    });
    if (!sr.ok) throw new Error(`Stripe lookup ${sr.status}`);
    session = await sr.json();
  } catch (err) {
    console.error('Success page Stripe lookup failed:', err);
    res.status(502).setHeader('Content-Type', 'text/html');
    return res.send(page({
      title: 'Aletheia',
      body: `<h1>One moment</h1>
        <p>We couldn't verify the purchase just now. Refresh in a few seconds,
        or write to <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a>.</p>`,
      refresh: true
    }));
  }

  if (session.payment_status !== 'paid') {
    res.status(402).setHeader('Content-Type', 'text/html');
    return res.send(page({
      title: 'Aletheia',
      body: `<h1>Payment not completed</h1>
        <p>This checkout hasn't finished. If you believe that's wrong, write to
        <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a>.</p>`
    }));
  }

  // Paid — find the license the webhook registered for this session
  let found = null;
  try {
    found = await findBySource(sessionId);
  } catch (err) {
    console.error('Success page sheet lookup failed:', err);
  }

  if (!found) {
    // Webhook race: payment confirmed but the key isn't registered yet. Auto-retry.
    res.status(200).setHeader('Content-Type', 'text/html');
    return res.send(page({
      title: 'Aletheia — preparing your license',
      body: `<h1>Payment confirmed</h1>
        <p>Your license key is being generated. This page will refresh on its own —
        it usually takes a few seconds.</p>
        <p class="fine">Stuck for more than a minute? Write to
        <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a>.</p>`,
      refresh: true
    }));
  }

  const key = found.row[COLS.LICENSE_KEY];
  res.status(200).setHeader('Content-Type', 'text/html');
  return res.send(page({
    title: 'Aletheia — your license',
    body: `<h1>Thank you</h1>
      <p>Your Aletheia license is ready. One key unlocks all four plugins.</p>
      <div class="key">${key}</div>
      <div>
        <a class="btn" href="${DOWNLOADS.mac}">Download for macOS</a>
        <a class="btn" href="${DOWNLOADS.win}">Download for Windows</a>
      </div>
      <div class="steps">
        1. Run the installer<br>
        2. Enter your license key when prompted<br>
        3. Restart DaVinci Resolve — the plugins appear under OpenFX
      </div>
      <p class="fine">A copy of this key was emailed to ${found.row[COLS.EMAIL] || 'you'}
      (check spam if it's not in your inbox). Keep the key somewhere safe.<br>
      Questions: <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a></p>`
  }));
}
