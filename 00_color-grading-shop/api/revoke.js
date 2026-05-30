const { Resend } = require('resend');
const { findByLicenseKey, updateRow, appendLog, COLS } = require('./lib/sheets');

const ADMIN_SECRET = process.env.ACTIVATION_SECRET; // reuse as admin auth

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'POST only' });
  }

  const { key, secret, reason } = req.body || {};

  // Admin auth — must provide the ACTIVATION_SECRET
  if (!secret || secret !== ADMIN_SECRET) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' });
  }

  if (!key) {
    return res.status(400).json({ status: 'error', message: 'Missing key' });
  }

  try {
    const result = await findByLicenseKey(key);

    if (!result) {
      return res.status(404).json({ status: 'error', message: 'License key not found' });
    }

    const { rowIndex, row } = result;
    const formattedKey = (row[COLS.LICENSE_KEY] || '').trim();
    const customerEmail = (row[COLS.EMAIL] || '').trim();
    const machines = (row[COLS.MACHINE_HASH] || '').trim();

    // Revoke: clear all machines, set status to Revoked
    await updateRow(rowIndex, {
      [COLS.MACHINE_HASH]: '',
      [COLS.STATUS]: 'Revoked'
    });

    // Notify customer their key has been revoked
    if (customerEmail) {
      try {
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'Monos Pros Monon <delivery@monosprosmonon.com>',
          to: customerEmail,
          subject: 'License Key Revoked',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
              <h1 style="color: #0a0a0a; font-size: 24px;">License Key Revoked</h1>
              <p style="color: #333; font-size: 16px; line-height: 1.6;">
                Your license key <strong>${formattedKey}</strong> has been revoked${reason ? ': ' + reason : '.'}.
              </p>
              <p style="color: #666; font-size: 14px;">
                If you believe this is an error, please reply to this email.
              </p>
            </div>
          `
        });
      } catch (err) {
        console.error('Failed to notify customer:', err);
      }
    }

    await appendLog({ key: formattedKey, machine: machines || 'all', email: customerEmail, result: 'Revoked', details: reason || 'Admin revoked' }).catch(() => {});

    return res.status(200).json({
      status: 'revoked',
      key: formattedKey,
      email: customerEmail,
      previousMachines: machines
    });

  } catch (err) {
    console.error('Revoke error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
}
