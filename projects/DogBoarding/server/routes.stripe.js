/**
 * Stripe webhook - the source of truth for "this invoice was paid".
 *
 * We do NOT trust the browser redirect back from Stripe: a closed tab or a
 * dropped connection would leave the books out of step. Stripe posts here when
 * the payment actually settles, and only then do we record it.
 *
 * The route is mounted with a raw-body parser (see backend.js) so the signature
 * can be verified against the exact bytes Stripe sent.
 */

const db = require('./db');
const acct = require('./accounting');
const stripe = require('./stripe');

function webhook(req, res) {
    let event;
    try {
        // req.rawBody is the untouched bytes, stashed by the root server's JSON
        // parser (which runs before this route). Standalone, express.raw leaves
        // the Buffer on req.body instead. Either way, verify the exact bytes.
        event = stripe.verifyWebhook(req.rawBody || req.body, req.get('stripe-signature'));
    } catch (err) {
        console.warn('[stripe] webhook rejected:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            if (session.payment_status === 'paid') recordPayment(session);
        }
        // Acknowledge everything else so Stripe stops retrying it.
        res.json({ received: true });
    } catch (err) {
        console.error('[stripe] webhook handler error:', err);
        res.status(500).send('handler error');
    }
}

/**
 * Record a paid Checkout session as a payment against its invoice, and let the
 * accounting flip the invoice to 'paid' if that clears it.
 *
 * Idempotent: Stripe can deliver the same event more than once, so we key on the
 * payment_intent id and do nothing if it is already on file.
 */
function recordPayment(session) {
    const invoiceId = Number(session.metadata && session.metadata.invoice_id);
    const amount = Number(session.amount_total);
    const ref = `stripe:${session.payment_intent || session.id}`;
    if (!invoiceId || !amount) return;

    if (db.get('SELECT id FROM payments WHERE reference = ?', ref)) return;

    const invoice = db.get('SELECT client_id FROM invoices WHERE id = ?', invoiceId);
    if (!invoice) {
        console.warn(`[stripe] paid session for unknown invoice ${invoiceId}`);
        return;
    }

    db.insert('payments', {
        client_id: invoice.client_id,
        invoice_id: invoiceId,
        paid_on: db.today(),
        amount_cents: amount,
        method: 'card',
        reference: ref,
        notes: 'Paid online (Stripe)',
        created_at: db.nowIso()
    });
    acct.recomputeInvoice(invoiceId);
    console.log(`[stripe] recorded ${amount}c on invoice ${invoiceId} (${ref})`);
}

module.exports = { webhook };
