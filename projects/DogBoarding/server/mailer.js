/**
 * Outbound email - deliberately pluggable.
 *
 * A boarding business on a fresh Droplet has no way to send mail: DigitalOcean
 * blocks SMTP port 25 by default, and self-hosted mail lands in spam. So this
 * starts in a mode that needs no external service: when nothing is configured,
 * a "sent" email is written to the server log instead, and account activation
 * falls back to an admin approving the pending account in the back office.
 *
 * Point it at a real provider by setting SMTP_URL (e.g.
 * smtps://user:pass@smtp.provider.com) or the SMTP_HOST/PORT/USER/PASS set, and
 * installing nodemailer (npm i nodemailer). Then verification emails go out for
 * real, with no other change.
 */

function configured() {
    return !!(process.env.SMTP_URL || process.env.SMTP_HOST);
}

async function send({ to, subject, text, html }) {
    if (!configured()) {
        console.log(`[dogboarding:mail] (no mailer configured) would email ${to}: ${subject}`);
        if (text) console.log(`[dogboarding:mail] ---\n${text}\n---`);
        return { delivered: false, reason: 'not_configured' };
    }

    let nodemailer;
    try {
        nodemailer = require('nodemailer');
    } catch {
        console.warn('[dogboarding:mail] SMTP is configured but nodemailer is not installed (npm i nodemailer).');
        console.log(`[dogboarding:mail] to ${to}: ${subject}\n${text || ''}`);
        return { delivered: false, reason: 'no_nodemailer' };
    }

    const transport = process.env.SMTP_URL
        ? nodemailer.createTransport(process.env.SMTP_URL)
        : nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT || 587),
            secure: process.env.SMTP_SECURE === '1',
            auth: process.env.SMTP_USER
                ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                : undefined
        });

    const from = process.env.MAIL_FROM || 'no-reply@dogboarding.local';
    await transport.sendMail({ from, to, subject, text, html });
    return { delivered: true };
}

module.exports = { send, configured };
