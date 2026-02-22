const crypto = require('crypto');
const { Resend } = require('resend');
const { validateKey } = require('./lib/keygen');
const { findByLicenseKey, updateRow, appendLog, COLS } = require('./lib/sheets');

const ADMIN_EMAIL = 'alecwisdom@gmail.com';

// HMAC signing for activation tokens
function signToken(payload) {
  const secret = process.env.ACTIVATION_SECRET;
  if (!secret) throw new Error('ACTIVATION_SECRET not configured');
  const data = Buffer.from(JSON.stringify(payload)).toString('base64');
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `${data}.${sig}`;
}

async function notifyAdmin(action, details) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Aletheia Licenses <delivery@monosprosmonon.com>',
      to: ADMIN_EMAIL,
      subject: `License ${action}: ${details.key}`,
      html: `
        <div style="font-family: monospace; padding: 20px;">
          <h2>License ${action}</h2>
          <p><strong>Key:</strong> ${details.key}</p>
          <p><strong>Product:</strong> ${details.product}</p>
          <p><strong>Email:</strong> ${details.email || 'N/A'}</p>
          <p><strong>Machine:</strong> ${details.machine}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        </div>
      `
    });
  } catch (err) {
    console.error('Admin notification failed:', err);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ status: 'error', message: 'POST only' });
  }

  const { key, machine } = req.body || {};

  if (!key || !machine) {
    return res.status(400).json({ status: 'error', message: 'Missing key or machine' });
  }

  // Validate key format locally first
  const keyCheck = validateKey(key);
  if (!keyCheck.valid) {
    return res.status(400).json({ status: 'error', message: 'Invalid license key format' });
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(500).json({ status: 'error', message: 'Server configuration error' });
  }

  try {
    // Find license record in Google Sheets
    const result = await findByLicenseKey(key);

    if (!result) {
      await appendLog({ key, machine, result: 'Not Found', details: 'Key does not exist in sheet' }).catch(() => {});
      return res.status(404).json({ status: 'error', message: 'License key not found. Please check your key and try again.' });
    }

    const { rowIndex, row } = result;
    const machineField = (row[COLS.MACHINE_HASH] || '').trim();
    const formattedKey = (row[COLS.LICENSE_KEY] || '').trim();
    const customerEmail = (row[COLS.EMAIL] || '').trim();
    const status = (row[COLS.STATUS] || '').trim();

    // Block revoked keys
    if (status === 'Revoked') {
      await appendLog({ key: formattedKey, machine, email: customerEmail, result: 'Blocked (Revoked)', details: 'Key was revoked' }).catch(() => {});
      return res.status(403).json({
        status: 'error',
        message: 'This license key has been revoked.'
      });
    }

    // Parse existing machines (comma-separated, max 2)
    const MAX_MACHINES = 2;
    const machines = machineField ? machineField.split(',').map(m => m.trim()).filter(Boolean) : [];

    // Check if this machine is already activated
    const alreadyActivated = machines.includes(machine);

    if (!alreadyActivated && machines.length >= MAX_MACHINES) {
      // All slots full, block
      await appendLog({ key: formattedKey, machine, email: customerEmail, result: 'Blocked (Limit)', details: `Already on ${MAX_MACHINES} machines: ${machines.join(', ')}` }).catch(() => {});
      await notifyAdmin('BLOCKED', { key: formattedKey, product: keyCheck.product, email: customerEmail, machine: machine });
      return res.status(403).json({
        status: 'error',
        message: `License already activated on ${MAX_MACHINES} machines. Deactivate one first, then try again.`
      });
    }

    // Add this machine if not already present
    if (!alreadyActivated) {
      machines.push(machine);
    }

    // Save updated machine list to Google Sheets
    await updateRow(rowIndex, {
      [COLS.MACHINE_HASH]: machines.join(','),
      [COLS.STATUS]: 'Activated',
      [COLS.ACTIVATED_AT]: new Date().toISOString().split('T')[0]
    });

    // Generate signed activation token
    const payload = {
      key: formattedKey || key,
      machine: machine,
      product: keyCheck.product,
      issued: Math.floor(Date.now() / 1000)
    };

    const token = signToken(payload);

    // Log to Activation Log sheet
    const logResult = alreadyActivated ? 'Re-activated' : `Activated (slot ${machines.length}/${MAX_MACHINES})`;
    await appendLog({ key: formattedKey, machine, email: customerEmail, result: logResult, details: `Active machines: ${machines.join(', ')}` }).catch(() => {});

    // Notify admin of successful activation
    await notifyAdmin('Activated', { key: formattedKey, product: keyCheck.product, email: customerEmail, machine: machine });

    return res.status(200).json({
      status: 'activated',
      token: token,
      product: keyCheck.product
    });

  } catch (err) {
    console.error('Activation error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error. Please try again.' });
  }
}
