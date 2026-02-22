const { Resend } = require('resend');
const { findByLicenseKey, updateRow, appendLog, COLS } = require('./lib/sheets');

const ADMIN_EMAIL = 'alecwisdom@gmail.com';

async function notifyAdmin(details) {
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    await resend.emails.send({
      from: 'Aletheia Licenses <delivery@monosprosmonon.com>',
      to: ADMIN_EMAIL,
      subject: `License Deactivated: ${details.key}`,
      html: `
        <div style="font-family: monospace; padding: 20px;">
          <h2>License Deactivated</h2>
          <p><strong>Key:</strong> ${details.key}</p>
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

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return res.status(500).json({ status: 'error', message: 'Server configuration error' });
  }

  try {
    // Find license record in Google Sheets
    const result = await findByLicenseKey(key);

    if (!result) {
      return res.status(404).json({ status: 'error', message: 'License key not found' });
    }

    const { rowIndex, row } = result;
    const machineField = (row[COLS.MACHINE_HASH] || '').trim();
    const formattedKey = (row[COLS.LICENSE_KEY] || '').trim();
    const customerEmail = (row[COLS.EMAIL] || '').trim();

    // Parse machine list
    const machines = machineField ? machineField.split(',').map(m => m.trim()).filter(Boolean) : [];

    // Verify this machine is activated
    if (!machines.includes(machine)) {
      return res.status(403).json({
        status: 'error',
        message: 'This license is not activated on this machine'
      });
    }

    // Remove this machine from the list
    const remaining = machines.filter(m => m !== machine);

    await updateRow(rowIndex, {
      [COLS.MACHINE_HASH]: remaining.join(','),
      [COLS.STATUS]: remaining.length > 0 ? 'Activated' : 'Deactivated'
    });

    await appendLog({ key: formattedKey, machine, email: customerEmail, result: 'Deactivated', details: `Remaining machines: ${remaining.join(', ') || 'none'}` }).catch(() => {});
    await notifyAdmin({ key: formattedKey, email: customerEmail, machine: machine });

    return res.status(200).json({ status: 'deactivated' });

  } catch (err) {
    console.error('Deactivation error:', err);
    return res.status(500).json({ status: 'error', message: 'Server error' });
  }
}
