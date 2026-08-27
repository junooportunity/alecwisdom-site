const jwt = require('jsonwebtoken');

const SPREADSHEET_ID = '1Y5p0OuTlBmMJuu3olQERYDtMiiV_MiKP1aUlJryw48k';
const SHEET_NAME = 'Signups';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

// Column mapping (0-indexed) matching existing sheet headers:
// A: Email, B: Name, C: License Key, D: Type, E: Date, F: Source, G: Machine Hash, H: Status, I: Activated At
const COLS = {
  EMAIL: 0,         // A
  NAME: 1,          // B
  LICENSE_KEY: 2,    // C
  TYPE: 3,           // D (was "Product" — sheet uses "Type")
  DATE: 4,           // E (purchase date)
  SOURCE: 5,         // F (stripe session / source)
  MACHINE_HASH: 6,   // G (new — for activation)
  STATUS: 7,         // H (new — Delivered/Activated/Deactivated)
  ACTIVATED_AT: 8    // I (new — activation date)
};

let cachedToken = null;
let tokenExpiry = 0;

// Get access token from service account
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiry - 60) return cachedToken;

  const keyJson = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  const payload = {
    iss: keyJson.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const assertion = jwt.sign(payload, keyJson.private_key, { algorithm: 'RS256' });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${assertion}`
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google auth failed: ${err}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = now + data.expires_in;
  return cachedToken;
}

// Get all rows from sheet (returns array of row arrays, skipping header)
async function getAllRows() {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets read failed: ${err}`);
  }

  const data = await res.json();
  const rows = data.values || [];
  // Skip header row
  return rows.length > 1 ? rows.slice(1) : [];
}

// Find row by license key (handles both formatted and unformatted)
async function findByLicenseKey(key) {
  const clean = key.replace(/-/g, '').toUpperCase();
  const formatted = `${clean.slice(0,4)}-${clean.slice(4,8)}-${clean.slice(8,12)}-${clean.slice(12,16)}`;

  const rows = await getAllRows();
  for (let i = 0; i < rows.length; i++) {
    const rowKey = (rows[i][COLS.LICENSE_KEY] || '').trim();
    if (rowKey === key || rowKey === formatted || rowKey.replace(/-/g, '').toUpperCase() === clean) {
      return { rowIndex: i + 2, row: rows[i] };
    }
  }
  return null;
}

// Find row by source (stripe checkout session id)
async function findBySource(source) {
  const target = (source || '').trim();
  if (!target) return null;
  const rows = await getAllRows();
  for (let i = 0; i < rows.length; i++) {
    if ((rows[i][COLS.SOURCE] || '').toString().trim() === target) {
      return { rowIndex: i + 2, row: rows[i] };
    }
  }
  return null;
}

// Find row by email
async function findByEmail(email) {
  const target = email.toLowerCase().trim();
  const rows = await getAllRows();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][COLS.EMAIL] && rows[i][COLS.EMAIL].toString().toLowerCase().trim() === target) {
      return { rowIndex: i + 2, row: rows[i] };
    }
  }
  return null;
}

// Append a new row
async function appendRow(rowData) {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!A:I:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;

  const values = [
    rowData.email || '',
    rowData.name || '',
    rowData.licenseKey || '',
    rowData.type || rowData.product || '',
    rowData.date || new Date().toISOString().split('T')[0],
    rowData.source || rowData.stripeSession || '',
    rowData.machineHash || '',
    rowData.status || 'Delivered',
    rowData.activatedAt || ''
  ];

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [values] })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets append failed: ${err}`);
  }

  return await res.json();
}

// Update specific cells in a row (rowIndex is 1-based sheet row number)
async function updateRow(rowIndex, updates) {
  const token = await getAccessToken();

  const data = [];
  for (const [colIndex, value] of Object.entries(updates)) {
    const col = String.fromCharCode(65 + parseInt(colIndex));
    data.push({
      range: `${SHEET_NAME}!${col}${rowIndex}`,
      values: [[value]]
    });
  }

  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: data
    })
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets update failed: ${err}`);
  }

  return await res.json();
}

// Ensure new columns have headers (G, H, I)
async function ensureHeaders() {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!G1:I1`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  const data = await res.json();
  if (!data.values || data.values.length === 0 || data.values[0].length < 3) {
    const writeUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${SHEET_NAME}!G1:I1?valueInputOption=RAW`;
    await fetch(writeUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [['Machine Hash', 'Status', 'Activated At']] })
    });
  }
}

const LOG_SHEET = 'Activation Log';

// Append a row to the Activation Log sheet (creates headers if needed)
async function appendLog(logData) {
  const token = await getAccessToken();

  // Ensure the Activation Log sheet exists with headers
  const checkUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(LOG_SHEET)}!A1:F1`;
  const checkRes = await fetch(checkUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!checkRes.ok) {
    // Sheet doesn't exist — create it
    const addSheetUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate`;
    await fetch(addSheetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: [{ addSheet: { properties: { title: LOG_SHEET } } }]
      })
    });

    // Write headers
    const headerUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(LOG_SHEET)}!A1:F1?valueInputOption=RAW`;
    await fetch(headerUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ values: [['Timestamp', 'License Key', 'Machine Hash', 'Email', 'Result', 'Details']] })
    });
  }

  const values = [
    logData.timestamp || new Date().toISOString(),
    logData.key || '',
    logData.machine || '',
    logData.email || '',
    logData.result || '',       // Activated, Re-activated, Blocked, Revoked, Not Found
    logData.details || ''
  ];

  const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(LOG_SHEET)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  const res = await fetch(appendUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [values] })
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Activation log write failed:', err);
  }
}

// Mark a trial signup as converted (purchased) in the Trial Signups sheet
const TRIAL_SHEET = 'Trial Signups';

async function markTrialConverted(email) {
  const token = await getAccessToken();
  const target = email.toLowerCase().trim();

  const searchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TRIAL_SHEET)}!A:A`;
  const searchRes = await fetch(searchUrl, {
    headers: { 'Authorization': `Bearer ${token}` }
  });

  if (!searchRes.ok) return; // Trial sheet might not exist yet

  const data = await searchRes.json();
  const rows = data.values || [];

  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] && rows[i][0].toLowerCase().trim() === target) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex < 0) return; // Not a trial user

  const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(TRIAL_SHEET)}!H${rowIndex}?valueInputOption=RAW`;
  await fetch(updateUrl, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ values: [[new Date().toISOString().split('T')[0]]] })
  });
}

module.exports = { COLS, findByLicenseKey, findByEmail, findBySource, appendRow, updateRow, ensureHeaders, appendLog, markTrialConverted, SPREADSHEET_ID };
