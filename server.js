const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const crypto = require('crypto');
const { randomUUID } = crypto;
const fs = require('fs');
const scryptAsync = require('util').promisify(crypto.scrypt);

// Load .env for local development without requiring an extra package.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (match && !Object.prototype.hasOwnProperty.call(process.env, match[1])) {
            process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
        }
    }
}

const app = express();
const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGODB_URI;
const PRICE_PER_HOUR_CENTS = 35000;
const viewsPath = path.join(__dirname, 'views');
const SLA_PLANS = {
    basic: { name: 'Basic Support', amount: 29900 },
    standard: { name: 'Standard Tier', amount: 59900 },
    business: { name: 'Business Growth', amount: 249900 },
    corporate: { name: 'Corporate SLA', amount: 499900 }
};

function yocoModeForSecret(secretKey) {
    if (typeof secretKey !== 'string') return null;
    if (secretKey.startsWith('sk_test_')) return 'test';
    if (secretKey.startsWith('sk_live_')) return 'live';
    return null;
}

if (dbURI) {
    mongoose.connect(dbURI)
        .then(() => console.log('📁 Database connection established successfully'))
        .catch(err => console.error('❌ Cloud Database communication failure:', err.message));
} else {
    console.warn('⚠️ MONGODB_URI is not set; database features will not connect.');
}

const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' },
    subscriptionPaidAt: { type: Date, default: null },
    subscriptionExpiresAt: { type: Date, default: null }
}, { collection: 'useraccounts' }));

const YocoCheckout = mongoose.model('YocoCheckout', new mongoose.Schema({
    checkoutId: { type: String, required: true, unique: true },
    referenceId: { type: String, required: true, unique: true },
    userEmail: { type: String, required: true },
    planId: { type: String, required: true },
    planName: { type: String, required: true },
    amount: { type: Number, required: true },
    status: { type: String, default: 'pending' },
    eventId: { type: String, default: null },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'yococheckouts' }));

const PasswordReset = mongoose.model('PasswordReset', new mongoose.Schema({
    email: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'passwordresets' }));

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const derived = await scryptAsync(password, salt, 64);
    return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}

async function verifyAndUpgradePassword(user, candidate) {
    if (user.password.startsWith('scrypt$')) {
        const [, salt, storedHex] = user.password.split('$');
        if (!salt || !storedHex) return false;
        const derived = Buffer.from(await scryptAsync(candidate, salt, 64));
        const stored = Buffer.from(storedHex, 'hex');
        return derived.length === stored.length && crypto.timingSafeEqual(derived, stored);
    }

    // Existing accounts have plaintext passwords. Upgrade the hash after a
    // successful login so customers keep access while the database migrates.
    if (user.password !== candidate) return false;
    user.password = await hashPassword(candidate);
    await user.save();
    return true;
}

const resetRequestBuckets = new Map();
function rateLimitPasswordReset(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = resetRequestBuckets.get(key);
    if (!bucket || now - bucket.startedAt > 15 * 60 * 1000) {
        resetRequestBuckets.set(key, { startedAt: now, count: 1 });
        return next();
    }
    if (bucket.count >= 5) return res.status(429).json({ message: 'Too many reset requests. Please wait 15 minutes and try again.' });
    bucket.count += 1;
    return next();
}

async function sendPasswordResetEmail(to, resetUrl) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESET_EMAIL_FROM;
    if (!apiKey || !from) throw new Error('Password reset email settings are missing.');

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
            from,
            to: [to],
            subject: 'Reset your IT Elements password',
            html: `<p>We received a request to reset the password for your IT Elements account.</p><p><a href="${resetUrl}">Reset my password</a></p><p>This link expires in 15 minutes and can be used once. If you did not request this, you can ignore this email.</p>`
        })
    });
    if (!response.ok) {
        const details = await response.text();
        console.error('Password reset email provider error:', response.status, details);
        throw new Error('Password reset email could not be sent.');
    }
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>\"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function sendCustomerEmail(to, subject, paragraphs) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.SUPPORT_EMAIL_FROM || process.env.RESET_EMAIL_FROM;
    if (!to || !apiKey || !from) {
        console.info('Customer email skipped: recipient or Resend sender settings are not configured.');
        return false;
    }
    const html = paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join('');
    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from, to: [to], subject, html })
        });
        if (!response.ok) {
            console.error('Customer email provider error:', response.status, await response.text());
            return false;
        }
        return true;
    } catch (error) {
        console.error('Customer email delivery failed:', error.message);
        return false;
    }
}

function credentialEncryptionKey() {
    if (!process.env.SESSION_SECRET) throw new Error('Set a stable SESSION_SECRET before storing remote access passwords.');
    return crypto.createHash('sha256').update(`IT Elements support credential encryption:${process.env.SESSION_SECRET}`).digest();
}

function encryptSessionPassword(value) {
    if (!value) return '';
    if (String(value).startsWith('enc:v1:')) return String(value);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', credentialEncryptionKey(), iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return `enc:v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSessionPassword(value) {
    if (!value || !String(value).startsWith('enc:v1:')) return value || '';
    const [, version, ivHex, tagHex, encryptedHex] = String(value).split(':');
    if (version !== 'v1' || !ivHex || !tagHex || !encryptedHex) throw new Error('Stored remote access credential is invalid.');
    const decipher = crypto.createDecipheriv('aes-256-gcm', credentialEncryptionKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
}

const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    requestType: { type: String, enum: ['remote', 'onsite'], default: 'remote' },
    area: String,
    serviceType: String,
    preferredDate: String,
    preferredTime: String,
    confirmedVisitAt: Date,
    callOutFee: { type: Number, min: 0 },
    remoteId: String,
    remotePassword: String,
    issue: String,
    status: { type: String, enum: ['Open', 'Contacted', 'Session Confirmed', 'Visit Confirmed', 'Completed', 'On Hold', 'Resolved'], default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

const CustomerReview = mongoose.model('CustomerReview', new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    message: { type: String, required: true, maxlength: 1200 },
    consent: { type: Boolean, required: true, default: false },
    status: { type: String, enum: ['Pending', 'Published', 'Hidden'], default: 'Pending' },
    date: { type: Date, default: Date.now }
}, { collection: 'customerreviews' }));

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.yoco.com https://*.yoco.co.za; img-src 'self' data: https://*.whatsapp.com; connect-src 'self' https://*.yoco.co.za https://*.yoco.com");
    next();
});
app.use(express.urlencoded({ extended: true }));

// Yoco sends a signed raw body. Keep this route before express.json() so the
// signature is checked against the exact bytes Yoco sent.
app.post('/webhooks/yoco', express.raw({ type: 'application/json', limit: '100kb' }), async (req, res) => {
    const webhookSecret = process.env.YOCO_WEBHOOK_SECRET;
    if (!webhookSecret || !webhookSecret.startsWith('whsec_')) {
        return res.status(503).send('Yoco webhook secret is not configured.');
    }

    const webhookId = req.get('webhook-id');
    const timestamp = req.get('webhook-timestamp');
    const signatureHeader = req.get('webhook-signature') || '';
    const timestampSeconds = Number(timestamp);
    if (!webhookId || !Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 180) {
        return res.status(400).send('Invalid or expired webhook.');
    }

    try {
        const secretBytes = Buffer.from(webhookSecret.slice('whsec_'.length), 'base64');
        const signedContent = `${webhookId}.${timestamp}.${req.body.toString('utf8')}`;
        const expected = crypto.createHmac('sha256', secretBytes).update(signedContent).digest();
        const validSignature = signatureHeader.split(' ').some((versionedSignature) => {
            const [version, encodedSignature] = versionedSignature.split(',');
            if (version !== 'v1' || !encodedSignature) return false;
            const received = Buffer.from(encodedSignature, 'base64');
            return received.length === expected.length && crypto.timingSafeEqual(received, expected);
        });
        if (!validSignature) return res.status(403).send('Invalid webhook signature.');

        const event = JSON.parse(req.body.toString('utf8'));
        const payment = event.payload || {};
        const checkoutId = payment.metadata && payment.metadata.checkoutId;
        if (!checkoutId) return res.sendStatus(200);
        const configuredMode = yocoModeForSecret(process.env.YOCO_SECRET_KEY);
        if (!configuredMode || payment.mode !== configuredMode) {
            console.warn('Ignored a Yoco event whose mode does not match the configured key.');
            return res.sendStatus(200);
        }

        if (event.type === 'payment.failed') {
            await YocoCheckout.updateOne({ checkoutId, status: 'pending' }, { $set: { status: 'failed', eventId: event.id || null } });
            return res.sendStatus(200);
        }
        if (event.type !== 'payment.succeeded' || payment.status !== 'succeeded' || payment.currency !== 'ZAR') return res.sendStatus(200);

        const purchase = await YocoCheckout.findOne({ checkoutId, status: 'pending' });
        if (!purchase) return res.sendStatus(200); // Unknown or already processed checkout.
        if (Number(payment.amount) !== purchase.amount) {
            console.error('Yoco payment amount did not match the pending checkout:', checkoutId);
            return res.sendStatus(200);
        }

        const paidAt = new Date(event.createdDate || Date.now());
        const expiresAt = new Date(paidAt.getTime() + 30 * 24 * 60 * 60 * 1000);
        await UserAccount.findOneAndUpdate({ email: purchase.userEmail }, {
            $set: {
                subscriptionTier: purchase.planName,
                subscriptionStatus: 'Active',
                subscriptionPaidAt: paidAt,
                subscriptionExpiresAt: expiresAt
            }
        });
        await YocoCheckout.updateOne({ checkoutId, status: 'pending' }, {
            $set: { status: 'paid', eventId: event.id || null, paidAt, expiresAt }
        });
        await sendCustomerEmail(purchase.userEmail, 'Your IT Elements plan payment is confirmed', [
            `Yoco confirmed your payment for ${purchase.planName}.`,
            `Your 30-day support plan is active until ${expiresAt.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })}.`,
            'You can sign in to your IT Elements dashboard to view your plan and request support.'
        ]);
        return res.sendStatus(200);
    } catch (err) {
        console.error('Yoco webhook processing error:', err.message);
        return res.sendStatus(500);
    }
});

app.use(express.json({ limit: '20kb' }));
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production.');
}
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(session({
    secret: process.env.SESSION_SECRET || randomUUID(),
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 86400000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        httpOnly: true
    }
}));

function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

// Do not let static-file requests bypass the session checks on these pages.
app.get('/admin.html', checkAdminAuth, (req, res) => res.sendFile(path.join(viewsPath, 'admin.html')));
app.get('/dashboard.html', checkUserAuth, (req, res) => res.sendFile(path.join(viewsPath, 'dashboard.html')));
app.use(express.static(viewsPath, { index: false }));
app.use('/assets', express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(viewsPath, 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(viewsPath, 'pricing.html')));
app.get('/services', (req, res) => res.sendFile(path.join(viewsPath, 'services.html')));
app.get('/onsite-support', (req, res) => res.sendFile(path.join(viewsPath, 'onsite-support.html')));
app.get('/about', (req, res) => res.sendFile(path.join(viewsPath, 'about.html')));
app.get('/faq', (req, res) => res.sendFile(path.join(viewsPath, 'faq.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(viewsPath, 'contact.html')));
app.get('/subscribe/:planId', (req, res) => {
    const planId = String(req.params.planId || '');
    if (!SLA_PLANS[planId]) return res.status(404).send('Plan not found.');
    req.session.pendingPlanId = planId;
    if (req.session.isUser) return res.redirect(`/dashboard?plan=${encodeURIComponent(planId)}`);
    return res.redirect('/client/login');
});
app.get('/support', (req, res) => res.sendFile(path.join(viewsPath, 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(viewsPath, 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(viewsPath, 'client-login.html')));
app.get('/client/forgot-password', (req, res) => res.sendFile(path.join(viewsPath, 'forgot-password.html')));
app.get('/reset-password', (req, res) => res.sendFile(path.join(viewsPath, 'reset-password.html')));
app.get('/register', (req, res) => res.sendFile(path.join(viewsPath, 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(viewsPath, 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(viewsPath, 'admin.html')));

// Yoco Checkout API: create a hosted checkout on the server. The browser never
// receives the secret key, and the amount is calculated here from allowed hours.
app.post('/api/payment/yoco-checkout', async (req, res) => {
    const secretKey = process.env.YOCO_SECRET_KEY;
    if (!yocoModeForSecret(secretKey)) {
        return res.status(503).json({ success: false, message: 'Set a valid Yoco TEST or LIVE secret key in the server environment.' });
    }

    const hours = Number(req.body.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 5) {
        return res.status(400).json({ success: false, message: 'Choose a support duration from 1 to 5 hours.' });
    }

    try {
        const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
        const yocoResponse = await fetch('https://payments.yoco.com/api/checkouts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': randomUUID()
            },
            body: JSON.stringify({
                amount: PRICE_PER_HOUR_CENTS * hours,
                currency: 'ZAR',
                successUrl: `${publicBaseUrl}/?payment=returned`,
                cancelUrl: `${publicBaseUrl}/?payment=cancelled`,
                failureUrl: `${publicBaseUrl}/?payment=failed`,
                metadata: { product: 'remote-support', hours: String(hours) }
            })
        });

        const checkout = await yocoResponse.json().catch(() => ({}));
        if (!yocoResponse.ok) {
            console.error('Yoco checkout error:', yocoResponse.status, checkout);
            return res.status(502).json({ success: false, message: 'Yoco could not create the checkout. Check your test key and server logs.' });
        }
        if (typeof checkout.redirectUrl !== 'string' || !checkout.redirectUrl.startsWith('https://')) {
            return res.status(502).json({ success: false, message: 'Yoco did not return a valid checkout link.' });
        }
        return res.json({ success: true, redirectUrl: checkout.redirectUrl });
    } catch (err) {
        console.error('Yoco connection error:', err.message);
        return res.status(502).json({ success: false, message: 'Could not connect to Yoco. Please try again.' });
    }
});

// Create a one-time 30-day plan payment. The accepted plans and totals come
// from this server, never from a price sent by the browser.
app.post('/api/payment/yoco-plan-checkout', checkUserAuth, async (req, res) => {
    const secretKey = process.env.YOCO_SECRET_KEY;
    const userEmail = req.session.userEmail;
    const planId = String(req.body.planId || '');
    const plan = SLA_PLANS[planId];

    if (!userEmail) return res.status(403).json({ success: false, message: 'Sign in with a customer account before choosing a plan.' });
    if (!yocoModeForSecret(secretKey)) {
        return res.status(503).json({ success: false, message: 'A valid Yoco TEST or LIVE secret key is not configured on the server.' });
    }
    if (!plan) return res.status(400).json({ success: false, message: 'Choose one of the available support plans.' });

    try {
        const publicBaseUrl = (process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
        const referenceId = randomUUID();
        const yocoResponse = await fetch('https://payments.yoco.com/api/checkouts', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': randomUUID()
            },
            body: JSON.stringify({
                amount: plan.amount,
                currency: 'ZAR',
                successUrl: `${publicBaseUrl}/dashboard?payment=returned&ref=${encodeURIComponent(referenceId)}`,
                cancelUrl: `${publicBaseUrl}/dashboard?payment=cancelled&ref=${encodeURIComponent(referenceId)}`,
                failureUrl: `${publicBaseUrl}/dashboard?payment=failed&ref=${encodeURIComponent(referenceId)}`,
                metadata: { product: 'support-plan', planId, referenceId }
            })
        });

        const checkout = await yocoResponse.json().catch(() => ({}));
        if (!yocoResponse.ok || !checkout.id || typeof checkout.redirectUrl !== 'string' || !checkout.redirectUrl.startsWith('https://')) {
            console.error('Yoco plan checkout error:', yocoResponse.status, checkout);
            return res.status(502).json({ success: false, message: 'Yoco could not create the plan checkout. Check the server logs.' });
        }

        await YocoCheckout.create({
            checkoutId: checkout.id,
            referenceId,
            userEmail,
            planId,
            planName: plan.name,
            amount: plan.amount
        });
        return res.json({ success: true, redirectUrl: checkout.redirectUrl });
    } catch (err) {
        console.error('Yoco plan checkout error:', err.message);
        return res.status(502).json({ success: false, message: 'Could not start plan checkout. Please try again.' });
    }
});

// Keep old clients from submitting fake browser-generated card tokens.
app.post('/api/payment/yoco-charge', (req, res) => {
    res.status(410).json({ success: false, message: 'Direct card charges are no longer supported. Use the hosted Yoco checkout.' });
});

app.post('/client/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;
        if (!fullName || !phone || !email || !password) return res.status(400).send('<script>alert("Please complete every field.");window.history.back();</script>');
        if (fullName.trim().length < 2 || fullName.trim().length > 100) return res.status(400).send('<script>alert("Enter a name or company name between 2 and 100 characters.");window.history.back();</script>');
        if (phone.trim().length < 7 || phone.trim().length > 25) return res.status(400).send('<script>alert("Enter a valid contact phone number.");window.history.back();</script>');
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return res.status(400).send('<script>alert("Enter a valid email address.");window.history.back();</script>');
        if (password.length < 12 || password.length > 256) return res.status(400).send('<script>alert("Choose a password between 12 and 256 characters.");window.history.back();</script>');
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) return res.send('<script>alert("Email already registered.");window.history.back();</script>');
        const newUser = new UserAccount({ fullName: fullName.trim(), phone: phone.trim(), email: normalizedEmail, password: await hashPassword(password) });
        await newUser.save();
        req.session.isUser = true;
        req.session.userEmail = newUser.email;
        const nextUrl = req.session.pendingPlanId && SLA_PLANS[req.session.pendingPlanId]
            ? `/dashboard?plan=${encodeURIComponent(req.session.pendingPlanId)}`
            : '/dashboard';
        res.send(`<script>alert("Account created successfully!");window.location.href=${JSON.stringify(nextUrl)};</script>`);
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/client/login', async (req, res) => {
    try {
        const { email = '', password = '' } = req.body;
        if (process.env.ADMIN_PASSWORD && password === process.env.ADMIN_PASSWORD) {
            req.session.isAdmin = true;
            return res.send('<script>window.location.href="/admin";</script>');
        }
        const user = await UserAccount.findOne({ email: email.toLowerCase().trim() });
        if (user && await verifyAndUpgradePassword(user, password)) {
            req.session.isUser = true;
            req.session.userEmail = user.email;
            const nextUrl = req.session.pendingPlanId && SLA_PLANS[req.session.pendingPlanId]
                ? `/dashboard?plan=${encodeURIComponent(req.session.pendingPlanId)}`
                : '/dashboard';
            return res.send(`<script>window.location.href=${JSON.stringify(nextUrl)};</script>`);
        }
        res.send('<script>alert("Invalid credentials.");window.history.back();</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/auth/forgot-password', rateLimitPasswordReset, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ message: 'Enter a valid email address.' });
    }
    if (!process.env.RESEND_API_KEY || !process.env.RESET_EMAIL_FROM || !process.env.PUBLIC_BASE_URL) {
        console.error('Password reset is unavailable: set RESEND_API_KEY, RESET_EMAIL_FROM, and PUBLIC_BASE_URL.');
        return res.status(503).json({ message: 'Password reset email is not configured yet. Please contact IT Elements support.' });
    }

    try {
        const user = await UserAccount.findOne({ email });
        if (!user) return res.status(202).json({ message: 'If an account exists for that address, a reset link will be emailed.' });

        const token = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await PasswordReset.deleteMany({ email, usedAt: null });
        await PasswordReset.create({ email, tokenHash, expiresAt: new Date(Date.now() + 15 * 60 * 1000) });
        const baseUrl = process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
        const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

        try {
            await sendPasswordResetEmail(email, resetUrl);
        } catch (mailError) {
            await PasswordReset.deleteOne({ tokenHash });
            throw mailError;
        }
        return res.status(202).json({ message: 'If an account exists for that address, a reset link will be emailed.' });
    } catch (err) {
        console.error('Password reset request failed:', err.message);
        return res.status(503).json({ message: 'We could not send the reset email right now. Please contact IT Elements support.' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');
    if (password.length < 12) return res.status(400).json({ message: 'Choose a password with at least 12 characters.' });
    if (password.length > 256) return res.status(400).json({ message: 'Password is too long.' });
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ message: 'This reset link is invalid or expired. Request a new one.' });

    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const now = new Date();
        const reset = await PasswordReset.findOneAndUpdate(
            { tokenHash, usedAt: null, expiresAt: { $gt: now } },
            { $set: { usedAt: now } },
            { new: true }
        );
        if (!reset) return res.status(400).json({ message: 'This reset link is invalid, expired, or already used. Request a new one.' });

        try {
            const passwordHash = await hashPassword(password);
            const result = await UserAccount.updateOne({ email: reset.email }, { $set: { password: passwordHash } });
            if (!result.matchedCount) return res.status(400).json({ message: 'This account no longer exists. Contact IT Elements support.' });
            await PasswordReset.updateMany({ email: reset.email, usedAt: null }, { $set: { usedAt: now } });
            return res.json({ success: true, message: 'Password updated. You can now sign in with your new password.' });
        } catch (updateError) {
            await PasswordReset.updateOne({ _id: reset._id, usedAt: now }, { $set: { usedAt: null } });
            throw updateError;
        }
    } catch (err) {
        console.error('Password reset failed:', err.message);
        return res.status(500).json({ message: 'Password reset failed. Please request a new link and try again.' });
    }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/client/login'); }); });
app.get('/client/logout', (req, res) => { req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/client/login'); }); });

app.post('/support', async (req, res) => {
    try {
        const { name, email, phone, area, serviceType, preferredDate, preferredTime, details, remoteId, remotePassword, issue, requestType } = req.body;
        const isOnsiteEnquiry = requestType === 'onsite';
        const normalizedEmail = email ? String(email).toLowerCase().trim() : (req.session.userEmail || '');
        const request = new SupportRequest({
            name: String(name || '').trim(),
            email: normalizedEmail,
            phone: String(phone || '').trim(),
            requestType: isOnsiteEnquiry ? 'onsite' : 'remote',
            area: isOnsiteEnquiry ? String(area || '').trim() : '',
            serviceType: isOnsiteEnquiry ? String(serviceType || '').trim() : '',
            preferredDate: String(preferredDate || '').trim(),
            preferredTime: String(preferredTime || '').trim(),
            remoteId: String(remoteId || '').trim(),
            remotePassword: String(remotePassword || ''),
            issue: isOnsiteEnquiry ? String(details || issue || '').trim() : String(issue || '').trim(),
            status: 'Open'
        });
        await request.save();
        await sendCustomerEmail(normalizedEmail, isOnsiteEnquiry ? 'We received your on-site support enquiry' : 'We received your support request', isOnsiteEnquiry ? [
            `Hello ${request.name || 'there'}, we received your request for ${request.serviceType || 'on-site support'} in ${request.area || 'your area'}.`,
            'This is an enquiry, not a confirmed appointment. We will review availability and discuss any call-out or service cost before booking.',
            'You can follow this request in your client dashboard when you use the email address linked to your account.'
        ] : [
            `Hello ${request.name || 'there'}, your support request has been received and is marked Open.`,
            'We will review the issue and follow up. Share any temporary remote session password only when an engineer is ready to connect.'
        ]);
        if (isOnsiteEnquiry) return res.redirect('/onsite-support?sent=1');
        res.send('<script>alert("Ticket logged successfully into queue!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send('Database sync error.'); }
});

app.get('/api/client/profile-data', checkUserAuth, async (req, res) => {
    try {
        const user = await UserAccount.findOne({ email: req.session.userEmail }, { password: 0 });
        if (user && user.subscriptionStatus === 'Active' && user.subscriptionExpiresAt && user.subscriptionExpiresAt <= new Date()) {
            user.subscriptionStatus = 'Expired';
            await UserAccount.updateOne({ _id: user._id }, { $set: { subscriptionStatus: 'Expired' } });
        }
        const tickets = await SupportRequest.find({ email: req.session.userEmail }, { remotePassword: 0 }).sort({ date: -1 });
        const checkout = req.query.reference
            ? await YocoCheckout.findOne({ referenceId: String(req.query.reference), userEmail: req.session.userEmail }, { checkoutId: 0, userEmail: 0, __v: 0 })
            : null;
        res.json({ user, tickets, checkout });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/tickets', checkAdminAuth, async (req, res) => {
    try {
        const tickets = await SupportRequest.find().sort({ date: -1 }).lean();
        for (const ticket of tickets) {
            if (ticket.remotePassword && !String(ticket.remotePassword).startsWith('enc:v1:')) {
                const encrypted = encryptSessionPassword(ticket.remotePassword);
                await SupportRequest.updateOne({ _id: ticket._id }, { $set: { remotePassword: encrypted } });
                ticket.remotePassword = encrypted;
            }
            ticket.remotePassword = decryptSessionPassword(ticket.remotePassword);
        }
        res.json(tickets);
    } catch (err) {
        console.error('Admin ticket load error:', err.message);
        res.status(500).json({ error: true, message: 'Could not load tickets or decrypt a stored session password. Check that SESSION_SECRET has not changed.' });
    }
});

app.post('/api/tickets/update-status', checkAdminAuth, async (req, res) => {
        const { ticketId, newStatus } = req.body;
    if (!mongoose.isValidObjectId(ticketId)) return res.status(400).json({ success: false, message: 'Invalid ticket.' });
    try {
        const current = await SupportRequest.findById(ticketId);
        if (!current) return res.status(404).json({ success: false, message: 'Ticket not found.' });
        const isOnsite = current.requestType === 'onsite' || String(current.issue || '').startsWith('ON-SITE SUPPORT ENQUIRY');
        const allowedStatuses = isOnsite ? ['Open', 'Contacted', 'Visit Confirmed', 'Completed', 'On Hold', 'Resolved'] : ['Open', 'Contacted', 'Session Confirmed', 'On Hold', 'Resolved'];
        if (!allowedStatuses.includes(newStatus)) return res.status(400).json({ success: false, message: 'That status is not available for this request.' });
        const update = { status: newStatus };
        if (isOnsite && newStatus === 'Visit Confirmed') {
            const visitAt = new Date(req.body.confirmedVisitAt);
            const callOutFee = Number(req.body.callOutFee);
            if (!req.body.confirmedVisitAt || Number.isNaN(visitAt.getTime()) || visitAt.getTime() < Date.now() || String(req.body.callOutFee ?? '').trim() === '' || !Number.isFinite(callOutFee) || callOutFee < 0) {
                return res.status(400).json({ success: false, message: 'Enter a future confirmed visit date and time, and a call-out fee (enter 0 if there is no fee).' });
            }
            update.confirmedVisitAt = visitAt;
            update.callOutFee = callOutFee;
        }
        if (!isOnsite && newStatus === 'Session Confirmed') {
            const sessionAt = new Date(req.body.confirmedVisitAt);
            if (!req.body.confirmedVisitAt || Number.isNaN(sessionAt.getTime()) || sessionAt.getTime() < Date.now()) {
                return res.status(400).json({ success: false, message: 'Enter a future confirmed support session date and time.' });
            }
            update.confirmedVisitAt = sessionAt;
        }
        if (['Completed', 'Resolved'].includes(newStatus)) update.remotePassword = '';
        const updated = await SupportRequest.findByIdAndUpdate(ticketId, { $set: update }, { new: true });
        if ((current.status !== newStatus || newStatus === 'Visit Confirmed' || newStatus === 'Session Confirmed') && updated.email) {
            await sendCustomerEmail(updated.email, `Your IT Elements request is now ${newStatus}`, [
                `Hello ${updated.name || 'there'}, the status of your ${isOnsite ? 'on-site enquiry' : 'support ticket'} is now ${newStatus}.`,
                isOnsite && newStatus === 'Visit Confirmed' ? `Your visit is confirmed for ${updated.confirmedVisitAt.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Call-out fee: R${Number(updated.callOutFee || 0).toFixed(2)}. Please sign in to your client dashboard for these details.` : !isOnsite && newStatus === 'Session Confirmed' ? `Your remote support session is confirmed for ${updated.confirmedVisitAt.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Sign in to your client dashboard to view the appointment.` : 'Sign in to your client dashboard to follow your request.'
            ]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Could not update ticket status.' }); }
});

app.get('/api/reviews', async (req, res) => {
    try {
        const reviews = await CustomerReview.find({ status: 'Published', consent: true }, { email: 0, consent: 0, status: 0 }).sort({ date: -1 }).limit(12).lean();
        res.json({ reviews });
    } catch (err) { res.status(500).json({ reviews: [] }); }
});

const reviewSubmissionBuckets = new Map();
app.post('/api/reviews', async (req, res) => {
    const bucketKey = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = reviewSubmissionBuckets.get(bucketKey);
    if (bucket && now - bucket.startedAt < 60 * 60 * 1000 && bucket.count >= 3) {
        return res.status(429).json({ success: false, message: 'Please wait before submitting more feedback.' });
    }
    if (!bucket || now - bucket.startedAt >= 60 * 60 * 1000) reviewSubmissionBuckets.set(bucketKey, { startedAt: now, count: 1 });
    else bucket.count += 1;

    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const message = String(req.body.message || '').trim();
    const rating = Number(req.body.rating);
    if (name.length < 2 || name.length > 100 || message.length < 10 || message.length > 1200 || !Number.isInteger(rating) || rating < 1 || rating > 5 || req.body.consent !== true) {
        return res.status(400).json({ success: false, message: 'Add your name, a 1–5 rating, feedback of at least 10 characters, and permission to publish it.' });
    }
    try {
        await CustomerReview.create({ name, email, rating, message, consent: true, status: 'Pending' });
        await sendCustomerEmail(email, 'Thank you for your feedback', ['Thank you for sharing feedback with IT Elements. Your review is awaiting approval and will only appear publicly after it is reviewed.']);
        res.json({ success: true, message: 'Thank you. Your feedback has been sent for review and will not be published until approved.' });
    } catch (err) { res.status(500).json({ success: false, message: 'Could not save your feedback. Please try again.' }); }
});

app.get('/api/admin/reviews', checkAdminAuth, async (req, res) => {
    try { res.json(await CustomerReview.find().sort({ date: -1 }).lean()); }
    catch (err) { res.status(500).json({ error: true, message: 'Could not load customer feedback.' }); }
});

app.post('/api/admin/reviews/update-status', checkAdminAuth, async (req, res) => {
    const { reviewId, status } = req.body;
    if (!mongoose.isValidObjectId(reviewId) || !['Published', 'Hidden'].includes(status)) return res.status(400).json({ success: false, message: 'Invalid review or status.' });
    try {
        const review = await CustomerReview.findByIdAndUpdate(reviewId, { status }, { new: true });
        if (!review) return res.status(404).json({ success: false, message: 'Review not found.' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: 'Could not update the review.' }); }
});

app.get('/api/admin/overview-data', checkAdminAuth, async (req, res) => {
    try {
        const now = new Date();
        await UserAccount.updateMany(
            { subscriptionStatus: 'Active', subscriptionExpiresAt: { $lte: now } },
            { $set: { subscriptionStatus: 'Expired' } }
        );
        const [users, tickets, revenueRows] = await Promise.all([
            UserAccount.find({}, { password: 0 }).sort({ fullName: 1 }).lean(),
            SupportRequest.find({}, { remotePassword: 0 }).lean(),
            YocoCheckout.aggregate([
                { $match: { status: 'paid' } },
                { $group: { _id: null, cents: { $sum: '$amount' }, count: { $sum: 1 } } }
            ])
        ]);
        const activeSubscribers = users.filter(user => user.subscriptionStatus === 'Active');
        const inactiveUsers = users.filter(user => user.subscriptionStatus !== 'Active');
        const activeTickets = tickets.filter(ticket => !['Resolved', 'Completed'].includes(ticket.status)).length;
        const confirmedPlanRevenue = revenueRows.length ? revenueRows[0].cents / 100 : 0;
        res.json({
            users,
            activeSubscribers,
            inactiveUsers,
            stats: {
                activeTickets,
                activeSubscribers: activeSubscribers.length,
                inactiveUsers: inactiveUsers.length,
                confirmedPlanRevenue,
                confirmedPlanPayments: revenueRows.length ? revenueRows[0].count : 0
            }
        });
    } catch (err) {
        console.error('Admin overview error:', err.message);
        res.status(500).json({ error: true, message: 'Could not load admin overview.' });
    }
});

app.listen(PORT, () => { console.log(`🚀 PRODUCTION ENGINE ACTIVE ON PORT ${PORT}`); });
