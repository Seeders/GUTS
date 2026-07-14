/**
 * Stripe - just enough of it, over the REST API.
 *
 * No SDK dependency, on purpose: node:sqlite and the mailer are dependency-free
 * too, and the Droplet deploy is simpler for it. We only need two things - open a
 * hosted Checkout page, and verify the webhook that tells us it was paid - and
 * both are a few lines against api.stripe.com.
 *
 * A card number never touches this server. The client is redirected to Stripe's
 * page; we only ever see that a payment succeeded. That keeps us in the lowest
 * PCI tier (SAQ-A).
 *
 * Configuration (environment):
 *   STRIPE_SECRET_KEY       sk_test_… while testing, sk_live_… in production
 *   STRIPE_WEBHOOK_SECRET   whsec_…  from the webhook endpoint in the dashboard
 *
 * With no key set, configured() is false and the portal simply does not offer
 * online payment - staff still record payments by hand.
 */

const crypto = require('crypto');

const SECRET = process.env.STRIPE_SECRET_KEY || null;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || null;
const API = 'https://api.stripe.com/v1';
const TOLERANCE_S = 300;

function configured() {
    return !!SECRET;
}

async function api(path, params) {
    const res = await fetch(`${API}${path}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${SECRET}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams(params).toString()
    });

    const data = await res.json();
    if (!res.ok) {
        const message = (data && data.error && data.error.message) || `Stripe error (${res.status}).`;
        const err = new Error(message);
        err.status = 502;
        throw err;
    }
    return data;
}

/** A hosted Checkout page for one invoice. Returns { id, url }. */
async function createCheckoutSession({ amountCents, currency = 'usd', name, email,
    invoiceId, clientId, successUrl, cancelUrl }) {
    return api('/checkout/sessions', {
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: email || '',
        client_reference_id: String(invoiceId),
        'metadata[invoice_id]': String(invoiceId),
        'metadata[client_id]': String(clientId),
        'payment_intent_data[metadata][invoice_id]': String(invoiceId),
        'payment_intent_data[metadata][client_id]': String(clientId),
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': currency,
        'line_items[0][price_data][unit_amount]': String(amountCents),
        'line_items[0][price_data][product_data][name]': name || 'Invoice payment'
    });
}

/**
 * Verify a webhook and return the parsed event, or throw. This is the whole
 * reason the webhook route is served the RAW body: the signature is over the
 * exact bytes Stripe sent, so a re-serialized JSON would never match.
 */
function verifyWebhook(rawBody, signatureHeader) {
    if (!WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_SECRET is not set.');

    const parts = {};
    for (const piece of String(signatureHeader || '').split(',')) {
        const eq = piece.indexOf('=');
        if (eq > -1) parts[piece.slice(0, eq)] = piece.slice(eq + 1);
    }
    const timestamp = parts.t;
    const signature = parts.v1;
    if (!timestamp || !signature) throw new Error('Malformed Stripe-Signature header.');

    const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
    const expected = crypto.createHmac('sha256', WEBHOOK_SECRET)
        .update(`${timestamp}.${payload}`, 'utf8')
        .digest('hex');

    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        throw new Error('Stripe signature mismatch.');
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > TOLERANCE_S) {
        throw new Error('Stripe timestamp outside tolerance.');
    }

    return JSON.parse(payload);
}

module.exports = { configured, createCheckoutSession, verifyWebhook };
