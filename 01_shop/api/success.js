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
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { min-height: 100%; background: #0a0a0a; color: #cccccc;
    font-family: 'Times New Roman', Times, serif; line-height: 1.6; }
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center;
    padding: 5rem 2rem 1.5rem; }
  .hero-logo { width: 150px; opacity: 0.9; }
  .hero-tagline { font-size: 0.9rem; font-style: italic; margin: 0.75rem auto 1rem; opacity: 0.85; }
  .divider { width: min(520px, 84vw); border: none; border-top: 1px solid rgba(255,255,255,0.12); }
  .hero-name { font-size: 2.5rem; font-weight: 300; letter-spacing: 0.2em; text-transform: uppercase;
    color: #ffffff; margin-top: 1.5rem; margin-bottom: 0.35rem; }
  .hero-greek { font-size: 1.1rem; font-style: italic; color: #888888; margin-bottom: 0.5rem;
    letter-spacing: 0.05em; }
  .hero-subtitle { font-size: 1rem; font-weight: 400; letter-spacing: 0.3em; text-transform: uppercase;
    color: #666666; }
  .wrap { max-width: 620px; margin: 0 auto; padding: 1.5rem 2rem 4rem; text-align: center; }
  .lede { font-size: 1.05rem; font-style: italic; color: #e0e0e0; margin-bottom: 1.75rem; }
  .key-label { font-size: 0.65rem; letter-spacing: 0.25em; text-transform: uppercase;
    color: #555555; margin-bottom: 0.75rem; }
  .key { font-family: 'SF Mono', Menlo, monospace; font-size: 1.3rem; letter-spacing: 0.14em;
    color: #ffffff; background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.12);
    border-radius: 8px; padding: 18px 12px; margin: 0 0 2rem 0; user-select: all; }
  .btn { display: inline-block; margin: 0.35rem; padding: 12px 26px;
    font-family: 'Times New Roman', Times, serif; font-size: 0.8rem;
    letter-spacing: 0.15em; text-transform: uppercase; color: #cccccc; text-decoration: none;
    background: rgba(255,255,255,0.03); border: 0.5px solid rgba(255,255,255,0.12);
    border-radius: 8px; transition: border-color 0.2s ease, color 0.2s ease; }
  .btn:hover { border-color: rgba(255,255,255,0.28); color: #ffffff; }
  .steps { text-align: left; margin: 2.25rem auto 0; max-width: 420px; color: #999999;
    font-size: 0.9rem; line-height: 1.9; }
  .steps em { color: #666666; }
  .fine { color: #666666; font-size: 0.8rem; margin-top: 2.75rem; line-height: 1.7; }
  a { color: #999999; }
  a:hover { color: #cccccc; }
</style>
</head>
<body>
<section class="hero">
  <a href="https://monosprosmonon.com"><img class="hero-logo" src="https://monosprosmonon.com/01_images/monos-logo.png" alt="Monos Pros Monon"></a>
  <p class="hero-tagline">a company</p>
  <hr class="divider">
  <h1 class="hero-name">Aletheia</h1>
  <p class="hero-greek">&#7936;&#955;&#942;&#952;&#949;&#953;&#945; &middot; truth, unconcealment</p>
  <p class="hero-subtitle">Color Grading Suite</p>
</section>
<div class="wrap">${body}</div>
</body>
</html>`;
}

export default async function handler(req, res) {
  const sessionId = (req.query && req.query.session_id) || '';

  if (!sessionId || !sessionId.startsWith('cs_')) {
    res.status(400).setHeader('Content-Type', 'text/html');
    return res.send(page({
      title: 'Aletheia',
      body: `<p class="lede">Something's missing.</p>
        <p class="fine">This page needs a checkout reference to find your license.
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
      body: `<p class="lede">One moment.</p>
        <p class="fine">We couldn't verify the purchase just now. This page will retry on its own,
        or write to <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a>.</p>`,
      refresh: true
    }));
  }

  if (session.payment_status !== 'paid') {
    res.status(402).setHeader('Content-Type', 'text/html');
    return res.send(page({
      title: 'Aletheia',
      body: `<p class="lede">Payment not completed.</p>
        <p class="fine">This checkout hasn't finished. If you believe that's wrong, write to
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
      body: `<p class="lede">Payment confirmed.</p>
        <p class="fine">Your license key is being generated. This page refreshes on its own;
        it usually takes a few seconds.<br>
        Stuck for more than a minute? Write to
        <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a>.</p>`,
      refresh: true
    }));
  }

  const key = found.row[COLS.LICENSE_KEY];
  res.status(200).setHeader('Content-Type', 'text/html');
  return res.send(page({
    title: 'Aletheia — your license',
    body: `<p class="lede">Thank you. Your license is ready. One key unlocks all four plugins.</p>
      <p class="key-label">Your License Key</p>
      <div class="key">${key}</div>
      <div>
        <a class="btn" href="${DOWNLOADS.mac}">Download for macOS</a>
        <a class="btn" href="${DOWNLOADS.win}">Download for Windows</a>
      </div>
      <div class="steps">
        1. Run the installer<br>
        2. Enter your license key when prompted<br>
        3. Restart DaVinci Resolve <em>(the plugins appear under OpenFX)</em>
      </div>
      <p class="fine">A copy of this key was emailed to ${found.row[COLS.EMAIL] || 'you'}
      (check spam if it's not in your inbox). Keep the key somewhere safe.<br>
      Questions: <a href="mailto:support@monosprosmonon.com">support@monosprosmonon.com</a></p>`
  }));
}
