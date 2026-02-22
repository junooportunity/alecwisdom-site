const { Resend } = require('resend');
const { generateLicenseKey } = require('./lib/keygen');
const { findByEmail, appendRow, ensureHeaders } = require('./lib/sheets');

const resend = new Resend(process.env.RESEND_API_KEY);

// Test secret to prevent abuse — no fallback, must be configured
const TEST_SECRET = process.env.TEST_SECRET;

async function findExistingLicense(email) {
  try {
    const existing = await findByEmail(email);
    if (existing) {
      return existing.row[2]; // LICENSE_KEY column
    }
    return null;
  } catch (err) {
    return null;
  }
}

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST required' });
  }

  const { email, secret } = req.body;

  // Validate secret
  if (!TEST_SECRET || secret !== TEST_SECRET) {
    return res.status(401).json({ error: 'Invalid test secret' });
  }

  // Validate email
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  // Check for existing license
  const existingKey = await findExistingLicense(email);
  if (existingKey) {
    return res.status(200).json({
      success: true,
      message: 'Existing license found',
      email: email,
      licenseKey: existingKey,
      existing: true
    });
  }

  // Generate license key (AT = Aletheia full suite)
  const licenseKey = generateLicenseKey('AT');

  const downloadUrl = process.env.DOWNLOAD_URL || 'https://monosprosmonon.com/aletheia';

  // Create Google Sheets record
  let sheetsResult = null;
  try {
    await ensureHeaders();
    await appendRow({
      email: email,
      name: 'Test User',
      product: 'Aletheia',
      licenseKey: licenseKey,
      stripeSession: 'TEST-' + Date.now(),
      status: 'Delivered'
    });
    sheetsResult = 'success';
    console.log('Sheets record created for test:', email);
  } catch (err) {
    console.error('Sheets write error:', err);
    sheetsResult = 'failed: ' + err.message;
  }

  // Send email
  try {
    await resend.emails.send({
      from: 'Aletheia <delivery@monosprosmonon.com>',
      to: email,
      subject: 'Your Aletheia License Key (TEST)',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
          <p style="background: #ff6b6b; color: white; padding: 8px 16px; border-radius: 4px; display: inline-block; font-size: 12px; font-weight: bold;">TEST MODE</p>

          <h1 style="color: #0a0a0a; font-size: 24px; margin-bottom: 24px;">Thank you for your purchase</h1>

          <p style="color: #333; font-size: 16px; line-height: 1.6;">
            Your <strong>Aletheia</strong> license is ready. One key unlocks all four plugins.
          </p>

          <div style="background: #f5f5f5; border-radius: 8px; padding: 24px; margin: 24px 0; text-align: center;">
            <p style="color: #666; font-size: 14px; margin: 0 0 8px 0;">Your License Key</p>
            <p style="color: #0a0a0a; font-size: 24px; font-family: monospace; font-weight: bold; margin: 0; letter-spacing: 2px;">
              ${licenseKey}
            </p>
          </div>

          <a href="${downloadUrl}" style="display: inline-block; background: #0a0a0a; color: #fff; padding: 14px 28px; text-decoration: none; border-radius: 6px; margin: 24px 0; font-size: 16px;">
            Download Installer
          </a>

          <div style="background: #fafafa; border-radius: 8px; padding: 20px; margin: 24px 0;">
            <p style="color: #333; font-size: 14px; font-weight: bold; margin: 0 0 12px 0;">Getting Started</p>
            <ol style="color: #666; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
              <li>Download the installer for your OS (macOS, Windows, or Linux)</li>
              <li>Run the installer and enter your license key when prompted</li>
              <li>The installer activates your license automatically</li>
              <li>Open DaVinci Resolve &mdash; find Alpha, Phi, Helix, and Omega in Color page &rarr; OpenFX</li>
            </ol>
          </div>

          <p style="color: #666; font-size: 14px; margin-top: 32px;">
            Save your license key &mdash; you'll need it if you reinstall. Your key works on up to 2 machines.
          </p>

          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

          <p style="color: #999; font-size: 12px;">
            &copy; Monos Pros Monon
          </p>
        </div>
      `
    });

    return res.status(200).json({
      success: true,
      message: 'Test purchase completed',
      email: email,
      licenseKey: licenseKey,
      downloadUrl: downloadUrl,
      sheetsResult: sheetsResult
    });
  } catch (err) {
    console.error('Email failed:', err);
    return res.status(500).json({
      error: 'Email failed: ' + err.message,
      licenseKey: licenseKey
    });
  }
}
