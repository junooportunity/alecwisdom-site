const Stripe = require('stripe');
const { Resend } = require('resend');
const { generateLicenseKey } = require('./lib/keygen');
const { findByEmail, appendRow, ensureHeaders, markTrialConverted, COLS } = require('./lib/sheets');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Product ID to config mapping
// IMPORTANT: Replace 'REPLACE_WITH_STRIPE_PRODUCT_ID' with the actual Stripe product ID
// after creating the Aletheia product in the Stripe Dashboard.
const PRODUCTS = {
  'prod_U1o4n9sa3udqOi': {
    name: 'Aletheia',
    productCode: 'AT',
  },
};

export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      buf,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;

    const customerEmail = session.customer_details?.email;
    const customerName = session.customer_details?.name;

    if (!customerEmail) {
      console.error('No customer email found');
      return res.status(400).json({ error: 'No customer email' });
    }

    const lineItems = await stripe.checkout.sessions.listLineItems(session.id);

    for (const item of lineItems.data) {
      const productId = item.price?.product;
      const product = PRODUCTS[productId];

      if (!product) {
        console.error('Unknown product:', productId);
        continue;
      }

      // Check for existing license in Google Sheets
      let licenseKey = null;
      let isExisting = false;

      try {
        await ensureHeaders();
        const existing = await findByEmail(customerEmail);
        if (existing) {
          licenseKey = existing.row[COLS.LICENSE_KEY];
          isExisting = true;
        }
      } catch (err) {
        console.error('Sheets lookup error:', err);
      }

      // Generate new license key if none exists
      if (!licenseKey) {
        licenseKey = generateLicenseKey(product.productCode);
      }

      // Download URL for installer (direct link, no token gating)
      const downloadUrl = process.env.DOWNLOAD_URL || 'https://monosprosmonon.com/aletheia';

      // Create Google Sheets record (only if new license)
      if (!isExisting) {
        try {
          await appendRow({
            email: customerEmail,
            name: customerName || '',
            product: product.name,
            licenseKey: licenseKey,
            stripeSession: session.id,
            purchaseDate: new Date().toISOString().split('T')[0],
            status: 'Delivered'
          });
          console.log('Sheets record created for:', customerEmail);
        } catch (err) {
          console.error('Sheets write error:', err);
        }
      }

      // Send email via Resend
      try {
        await resend.emails.send({
          from: 'Aletheia <delivery@monosprosmonon.com>',
          to: customerEmail,
          subject: 'Your Aletheia License Key',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #ffffff;">
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

              <p style="color: #666; font-size: 14px;">
                <a href="https://monosprosmonon.com/aletheia" style="color: #3498db;">Download User Guide</a>
              </p>

              <p style="color: #666; font-size: 14px; margin-top: 32px;">
                Save your license key &mdash; you'll need it if you reinstall. Your key works on up to 2 machines.
              </p>

              <p style="color: #666; font-size: 14px;">
                Questions? Reply to this email.
              </p>

              <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">

              <p style="color: #999; font-size: 12px;">
                &copy; Monos Pros Monon
              </p>
            </div>
          `
        });
        console.log('Email sent to:', customerEmail, 'License:', licenseKey);
      } catch (emailErr) {
        console.error('Failed to send email:', emailErr);
      }

      // Mark trial signup as converted (if they came through the trial)
      try {
        await markTrialConverted(customerEmail);
      } catch (err) {
        console.error('Trial conversion tracking error:', err);
      }
    }
  }

  res.status(200).json({ received: true });
}
