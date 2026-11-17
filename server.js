const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const crypto = require('crypto');
const dns = require('dns').promises;
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

const QUICK_FIX_OPTIONS = Object.freeze({
    '30min': { amount: 20000, label: '30-minute quick fix' },
    '1hour': { amount: 35000, label: '1-hour support session' },
    '2hours': { amount: 70000, label: '2-hour support session' },
    '3hours': { amount: 105000, label: '3-hour support session' },
    '4hours': { amount: 140000, label: '4-hour support session' },
    '5hours': { amount: 175000, label: '5-hour support session' }
});

const viewsPath = path.join(__dirname, 'views');

const SLA_PLANS = {
    basic: { name: 'Basic Support', amount: 29900 },
    standard: { name: 'Standard Tier', amount: 59900 },
    business: { name: 'Business Growth', amount: 249900 },
    'business-growth': { name: 'Business Growth', amount: 249900 },
    corporate: { name: 'Corporate SLA', amount: 499900 },
    'corporate-sla': { name: 'Corporate SLA', amount: 499900 }
};

function payfastConfig() {
    const merchantId = String(process.env.PAYFAST_MERCHANT_ID || '').trim();
    const merchantKey = String(process.env.PAYFAST_MERCHANT_KEY || '').trim();
    const mode = String(process.env.PAYFAST_MODE || 'live').toLowerCase();

    if (
        !/^\d{8}$/.test(merchantId) ||
        merchantKey.length !== 13 ||
        !['live', 'test'].includes(mode)
    ) {
        return null;
    }

    return {
        merchantId,
        merchantKey,
        mode,
        endpoint: mode === 'test'
            ? 'https://sandbox.payfast.co.za/eng/process'
            : 'https://www.payfast.co.za/eng/process',
        validateUrl: mode === 'test'
            ? 'https://sandbox.payfast.co.za/eng/query/validate'
            : 'https://www.payfast.co.za/eng/query/validate'
    };
}

// Database connection
if (dbURI) {
    mongoose.connect(dbURI)
        .then(() => console.log('📁 Database connection established successfully'))
        .catch(err => console.error('❌ Cloud Database communication failure:', err.message));
} else {
    console.warn('⚠️ MONGODB_URI is not set; database features will not connect.');
}

// Customer accounts
const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' },
    subscriptionPaidAt: { type: Date, default: null },
    subscriptionExpiresAt: { type: Date, default: null },
    invoiceProUntil: { type: Date, default: null }
}, { collection: 'useraccounts' }));


// IT Elements Store products
const StoreProduct = mongoose.model('StoreProduct', new mongoose.Schema({
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sku: { type: String, default: '', trim: true, maxlength: 60 },
    category: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, default: '', trim: true, maxlength: 2000 },
    price: { type: Number, required: true, min: 0 },
    compareAtPrice: { type: Number, default: 0, min: 0 },
    productType: { type: String, enum: ['normal', 'sale'], default: 'normal' },
    stock: { type: Number, default: 0, min: 0 },
    imageUrl: { type: String, default: '', trim: true, maxlength: 1000 },
    images: { type: [String], default: [] },
    status: { type: String, enum: ['active', 'draft'], default: 'active' },
    featured: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'storeproducts' }));


// Private customer carts: one MongoDB document per signed-in account.
// Cart contents are never fetched by email supplied by the browser; the session
// identity is the only source of ownership.
const StoreCustomerCart = mongoose.model('StoreCustomerCart', new mongoose.Schema({
    ownerEmail: { type: String, required: true, lowercase: true, trim: true, unique: true, index: true },
    items: [{
        productId: { type: mongoose.Schema.Types.ObjectId, required: true },
        quantity: { type: Number, required: true, min: 1, max: 999 }
    }],
    updatedAt: { type: Date, default: Date.now }
}, { collection: 'storecustomercarts' }));

// PayFast purchases
const PayFastPurchase = mongoose.model('PayFastPurchase', new mongoose.Schema({
    paymentId: { type: String, required: true, unique: true },
    userEmail: { type: String, default: '', lowercase: true, trim: true },
    purchaseType: {
        type: String,
        enum: ['plan', 'quickfix', 'invoicePro', 'storeOrder'],
        required: true
    },
    planId: { type: String, default: '' },
    planName: { type: String, default: '' },
    durationOption: { type: String, default: '' },
    orderDetails: { type: mongoose.Schema.Types.Mixed, default: null },
    amount: { type: Number, required: true },
    mode: { type: String, enum: ['test', 'live'], default: 'live' },
    status: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    },
    pfPaymentId: { type: String, default: '' },
    fulfilmentStatus: { type: String, enum: ['new', 'processing', 'ready', 'shipped', 'completed', 'cancelled'], default: 'new' },
    paidAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'payfastpurchases' }));

// Saved invoices and quotations
const BusinessDocument = mongoose.model('BusinessDocument', new mongoose.Schema({
    ownerEmail: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
    },
    kind: {
        type: String,
        enum: ['invoice', 'quote'],
        required: true
    },
    number: { type: String, required: true },
    business: { type: Object, default: {} },
    customer: { type: Object, default: {} },
    layout: {
        type: String,
        enum: ['modern', 'classic', 'compact', 'ledger'],
        default: 'modern'
    },
    discountRate: { type: Number, min: 0, max: 100, default: 0 },
    discountCents: { type: Number, min: 0, default: 0 },
    issueDate: { type: String, default: '' },
    dueDate: { type: String, default: '' },
    reference: { type: String, default: '' },
    paymentTerms: { type: String, default: '' },
    items: { type: [Object], default: [] },
    vatRate: { type: Number, enum: [0, 15], default: 0 },
    subtotalCents: { type: Number, required: true },
    vatCents: { type: Number, required: true },
    totalCents: { type: Number, required: true },
    notes: { type: String, default: '' },
    paymentInstructions: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'businessdocuments' }));

// Password resets
const PasswordReset = mongoose.model('PasswordReset', new mongoose.Schema({
    email: { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date, default: null },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'passwordresets' }));

// Password hashing
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

        return derived.length === stored.length &&
            crypto.timingSafeEqual(derived, stored);
    }

    // Migrate existing plaintext passwords after successful login.
    if (user.password !== candidate) return false;

    user.password = await hashPassword(candidate);
    await user.save();

    return true;
}

// Password reset rate limiting
const resetRequestBuckets = new Map();

function rateLimitPasswordReset(req, res, next) {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const bucket = resetRequestBuckets.get(key);

    if (!bucket || now - bucket.startedAt > 15 * 60 * 1000) {
        resetRequestBuckets.set(key, {
            startedAt: now,
            count: 1
        });
        return next();
    }

    if (bucket.count >= 5) {
        return res.status(429).json({
            message: 'Too many reset requests. Please wait 15 minutes and try again.'
        });
    }

    bucket.count += 1;
    return next();
}

// Password reset email
async function sendPasswordResetEmail(to, resetUrl) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESET_EMAIL_FROM;

    if (!apiKey || !from) {
        throw new Error('Password reset email settings are missing.');
    }

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from,
            to: [to],
            subject: 'Reset your IT Elements password',
            html: `
                <p>We received a request to reset the password for your IT Elements account.</p>
                <p><a href="${resetUrl}">Reset my password</a></p>
                <p>This link expires in 15 minutes and can be used once.</p>
                <p>If you did not request this, you can ignore this email.</p>
            `
        })
    });

    if (!response.ok) {
        const details = await response.text();
        console.error('Password reset email provider error:', response.status, details);
        throw new Error('Password reset email could not be sent.');
    }
}

function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

// General customer email
async function sendCustomerEmail(to, subject, paragraphs) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.SUPPORT_EMAIL_FROM || process.env.RESET_EMAIL_FROM;

    if (!to || !apiKey || !from) {
        console.info('Customer email skipped: recipient or Resend sender settings are not configured.');
        return false;
    }

    const html = paragraphs
        .map(text => `<p>${escapeHtml(text)}</p>`)
        .join('');

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from,
                to: [to],
                subject,
                html
            })
        });

        if (!response.ok) {
            console.error(
                'Customer email provider error:',
                response.status,
                await response.text()
            );
            return false;
        }

        return true;
    } catch (error) {
        console.error('Customer email delivery failed:', error.message);
        return false;
    }
}

// Encrypt remote access passwords before storing them.
function credentialEncryptionKey() {
    if (!process.env.SESSION_SECRET) {
        throw new Error('Set a stable SESSION_SECRET before storing remote access passwords.');
    }

    return crypto.createHash('sha256')
        .update(`IT Elements support credential encryption:${process.env.SESSION_SECRET}`)
        .digest();
}

function encryptSessionPassword(value) {
    if (!value) return '';

    if (String(value).startsWith('enc:v1:')) {
        return String(value);
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(
        'aes-256-gcm',
        credentialEncryptionKey(),
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(String(value), 'utf8'),
        cipher.final()
    ]);

    return `enc:v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSessionPassword(value) {
    if (!value || !String(value).startsWith('enc:v1:')) {
        return value || '';
    }

    const [, version, ivHex, tagHex, encryptedHex] = String(value).split(':');

    if (version !== 'v1' || !ivHex || !tagHex || !encryptedHex) {
        throw new Error('Stored remote access credential is invalid.');
    }

    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        credentialEncryptionKey(),
        Buffer.from(ivHex, 'hex')
    );

    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));

    return Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, 'hex')),
        decipher.final()
    ]).toString('utf8');
}

// Support requests
const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String,
    email: String,
    phone: String,
    requestType: {
        type: String,
        enum: ['remote', 'onsite'],
        default: 'remote'
    },
    area: String,
    serviceType: String,
    preferredDate: String,
    preferredTime: String,
    confirmedVisitAt: Date,
    callOutFee: { type: Number, min: 0 },
    remoteId: String,
    remotePassword: String,
    issue: String,
    messages: [{
        sender: {
            type: String,
            enum: ['customer', 'admin'],
            required: true
        },
        name: {
            type: String,
            required: true,
            maxlength: 100
        },
        body: {
            type: String,
            required: true,
            maxlength: 2000
        },
        date: { type: Date, default: Date.now }
    }],
    status: {
        type: String,
        enum: [
            'Open',
            'Contacted',
            'Session Confirmed',
            'Visit Confirmed',
            'Completed',
            'On Hold',
            'Resolved'
        ],
        default: 'Open'
    },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

// Site notifications
const SiteNotification = mongoose.model('SiteNotification', new mongoose.Schema({
    recipientRole: {
        type: String,
        enum: ['admin', 'customer'],
        required: true,
        index: true
    },
    recipientEmail: {
        type: String,
        default: '',
        lowercase: true,
        trim: true,
        index: true
    },
    ticketId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupportRequest',
        required: true,
        index: true
    },
    requestType: {
        type: String,
        enum: ['remote', 'onsite'],
        default: 'remote'
    },
    actorName: { type: String, required: true, maxlength: 100 },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, required: true, maxlength: 240 },
    createdAt: { type: Date, default: Date.now, index: true },
    readAt: { type: Date, default: null }
}, { collection: 'sitenotifications' }));

async function createSiteNotification({
    role,
    email = '',
    ticket,
    actor,
    title,
    body
}) {
    if (!ticket || !ticket._id || (role === 'customer' && !email)) {
        return;
    }

    await SiteNotification.create({
        recipientRole: role,
        recipientEmail: role === 'customer'
            ? String(email).toLowerCase().trim()
            : '',
        ticketId: ticket._id,
        requestType: ticket.requestType === 'onsite' ? 'onsite' : 'remote',
        actorName: String(actor || 'IT Elements Support').slice(0, 100),
        title: String(title || 'Request update').slice(0, 140),
        body: String(body || 'There is an update to your request.').slice(0, 240)
    });
}

// Customer reviews
const CustomerReview = mongoose.model('CustomerReview', new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    message: { type: String, required: true, maxlength: 1200 },
    consent: { type: Boolean, required: true, default: false },
    status: {
        type: String,
        enum: ['Pending', 'Published', 'Hidden'],
        default: 'Pending'
    },
    date: { type: Date, default: Date.now }
}, { collection: 'customerreviews' }));


// Middleware
app.use(cors());

app.use((req, res, next) => {
    res.setHeader(
        'Content-Security-Policy',
       "default-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https:; connect-src 'self'"
    );
    next();
});

app.use(express.urlencoded({
    extended: false,
    limit: '100kb',
    verify(req, res, buffer) {
        if (req.path === '/webhooks/payfast') {
            req.payfastRawBody = Buffer.from(buffer);
        }
    }
}));

function payfastEncode(value) {
    return encodeURIComponent(String(value).trim())
        .replace(/[!'()*~]/g, character =>
            '%' + character.charCodeAt(0).toString(16).toUpperCase()
        )
        .replace(/%[0-9a-f]{2}/gi, escape => escape.toUpperCase())
        .replace(/%20/g, '+');
}

function payfastSignature(fields, passphrase = '') {
    const pairs = Object.entries(fields)
        .filter(([key, value]) =>
            key !== 'signature' &&
            value !== undefined &&
            value !== null &&
            String(value).trim() !== ''
        )
        .map(([key, value]) => `${key}=${payfastEncode(value)}`);

    if (passphrase) {
        pairs.push(`passphrase=${payfastEncode(passphrase)}`);
    }

    return crypto.createHash('md5')
        .update(pairs.join('&'))
        .digest('hex');
}

function safeSignatureEqual(provided, expected) {
    const left = Buffer.from(String(provided || '').toLowerCase(), 'hex');
    const right = Buffer.from(String(expected || '').toLowerCase(), 'hex');

    return left.length === right.length &&
        left.length > 0 &&
        crypto.timingSafeEqual(left, right);
}

async function payfastSourceIsValid(ip) {
    const normalizedIp = String(ip || '').replace(/^::ffff:/, '');
    const hosts = [
        'www.payfast.co.za',
        'w1w.payfast.co.za',
        'w2w.payfast.co.za'
    ];

    if (payfastConfig()?.mode === 'test') {
        hosts.push('sandbox.payfast.co.za');
    }

    for (const host of hosts) {
        try {
            const addresses = await dns.lookup(host, { all: true });

            if (addresses.some(address =>
                address.address.replace(/^::ffff:/, '') === normalizedIp
            )) {
                return true;
            }
        } catch (_) {
            // Try the remaining PayFast addresses.
        }
    }

    return false;
}

// Only a verified PayFast ITN can mark a purchase as paid.
async function markPayFastPurchasePaid(fields) {
    const config = payfastConfig();

    const purchase = await PayFastPurchase.findOne({
        paymentId: String(fields.m_payment_id || '')
    });

    if (
        !config ||
        !purchase ||
        purchase.status === 'paid' ||
        purchase.mode !== config.mode
    ) {
        return purchase;
    }

    const paidAmount = Math.round(Number(fields.amount_gross) * 100);

    if (
        fields.payment_status !== 'COMPLETE' ||
        String(fields.merchant_id) !== config.merchantId ||
        paidAmount !== purchase.amount
    ) {
        return purchase;
    }

    const paidAt = new Date();

    const update = {
        status: 'paid',
        paidAt,
        pfPaymentId: String(fields.pf_payment_id || '')
    };

    if (purchase.purchaseType === 'plan') {
        update.expiresAt = new Date(
            paidAt.getTime() + 30 * 24 * 60 * 60 * 1000
        );
    } else if (purchase.purchaseType === 'invoicePro') {
        const user = await UserAccount.findOne({
            email: purchase.userEmail
        });

        update.expiresAt = new Date(
            Math.max(
                paidAt.getTime(),
                user?.invoiceProUntil?.getTime() || 0
            ) + 30 * 24 * 60 * 60 * 1000
        );
    }

    const saved = await PayFastPurchase.updateOne(
        { _id: purchase._id, status: 'pending' },
        { $set: update }
    );

    if (saved.modifiedCount && purchase.purchaseType === 'plan') {
        await UserAccount.findOneAndUpdate(
            { email: purchase.userEmail },
            {
                $set: {
                    subscriptionTier: purchase.planName,
                    subscriptionStatus: 'Active',
                    subscriptionPaidAt: paidAt,
                    subscriptionExpiresAt: update.expiresAt
                }
            }
        );
    }

    if (saved.modifiedCount && purchase.purchaseType === 'invoicePro') {
        await UserAccount.findOneAndUpdate(
            { email: purchase.userEmail },
            { $set: { invoiceProUntil: update.expiresAt } }
        );

        await sendCustomerEmail(
            purchase.userEmail,
            'IT Elements Invoice Pro is active',
            [
                'PayFast confirmed your Invoice Pro payment.',
                `Your extra document allowance is active until ${update.expiresAt.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })}.`,
                'Open the Invoice Maker from your customer portal to create invoices and quotes.'
            ]
        );
    }

    if (saved.modifiedCount && purchase.purchaseType === 'storeOrder' && Array.isArray(purchase.orderDetails?.items)) {
        for (const item of purchase.orderDetails.items) {
            await StoreProduct.updateOne(
                { _id: item.productId, stock: { $gte: item.quantity } },
                { $inc: { stock: -item.quantity }, $set: { updatedAt: paidAt } }
            );
        }
    }

    if (purchase.purchaseType === 'plan' && saved.modifiedCount) {
        await sendCustomerEmail(
            purchase.userEmail,
            'Your IT Elements plan payment is confirmed',
            [
                `PayFast confirmed your payment for ${purchase.planName}.`,
                `Your 30-day support plan is active until ${update.expiresAt.toLocaleDateString('en-ZA', { timeZone: 'Africa/Johannesburg' })}.`,
                'Sign in to your IT Elements dashboard to view your plan and request support.'
            ]
        );
    }

    return purchase;
}

// PayFast ITN webhook
app.post('/webhooks/payfast', async (req, res) => {
    const config = payfastConfig();

    if (!config) {
        return res.status(503).send('PayFast merchant settings are not configured.');
    }

    try {
        const raw = Buffer.isBuffer(req.payfastRawBody)
            ? req.payfastRawBody.toString('utf8')
            : '';

        const pairs = raw.split('&')
            .filter(Boolean)
            .map(part => {
                const separator = part.indexOf('=');

                const decode = value =>
                    decodeURIComponent(String(value || '').replace(/\+/g, ' '));

                return [
                    decode(separator < 0 ? part : part.slice(0, separator)),
                    decode(separator < 0 ? '' : part.slice(separator + 1))
                ];
            });

        const fields = Object.fromEntries(pairs);

        if (
            !fields.signature ||
            !safeSignatureEqual(
                fields.signature,
                payfastSignature(
                    Object.fromEntries(pairs),
                    process.env.PAYFAST_PASSPHRASE || ''
                )
            )
        ) {
            return res.status(401).send('Invalid PayFast signature.');
        }

        if (String(fields.merchant_id || '') !== config.merchantId) {
            return res.status(400).send('Merchant ID mismatch.');
        }

        if (
            process.env.PAYFAST_VERIFY_SOURCE !== 'false' &&
            !(await payfastSourceIsValid(req.ip))
        ) {
            return res.status(403).send('Unrecognized PayFast source address.');
        }

        const validationResponse = await fetch(config.validateUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: raw,
            signal: AbortSignal.timeout(10000)
        });

        const validation = (await validationResponse.text()).trim();

        if (!validationResponse.ok || validation !== 'VALID') {
            return res.status(400).send(
                'PayFast notification could not be validated.'
            );
        }

        await markPayFastPurchasePaid(fields);

        return res.sendStatus(200);
    } catch (error) {
        console.error('PayFast notification error:', error.message);
        return res.sendStatus(500);
    }
});

// JSON request support
app.use(express.json({ limit: '60mb' }));

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production.');
}

if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
}

// Customer and administrator sessions
app.use(session({
    name: 'itelements.sid',
    secret: process.env.SESSION_SECRET || randomUUID(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    ...(dbURI ? { store: MongoStore.create({ mongoUrl: dbURI, collectionName: 'sessions', ttl: 14 * 24 * 60 * 60 }) } : {}),
    cookie: {
        maxAge: 14 * 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        httpOnly: true
    }
}));

function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    return res.redirect('/client/login');
}

// Private IT Elements Store Manager
app.get(['/admin/store', '/admin/store/'], checkAdminAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'store-admin.html'));
});


function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) {
        return next();
    }

    if (!req.session) req.session = {};
    if (req.path === '/dashboard' || req.path === '/dashboard/') {
        req.session.returnTo = '/dashboard';
    } else if (req.path === '/account' || req.path === '/account/') {
        req.session.returnTo = '/account';
    } else if (
        req.path === '/tools/invoices' ||
        req.path === '/invoice-maker.html'
    ) {
        req.session.returnTo = '/tools/invoices';
    }

    return res.redirect('/client/login');
}

// Protect private pages before the static views middleware.
app.get('/admin.html', checkAdminAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'admin.html'));
});

// Private IT Elements Store Manager
app.get(['/admin/store', '/admin/store/'], checkAdminAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'store-admin.html'));
});

// Also protect direct access to the Store Manager HTML file
app.get('/store-admin.html', checkAdminAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'store-admin.html'));
});

app.get('/dashboard.html', checkUserAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'dashboard.html'));
});

// Invoice Maker is public. Customer dashboards remain protected.
app.get('/invoice-maker.html', (req, res) => {
    res.sendFile(path.join(viewsPath, 'invoice-maker.html'));
});

// Public static assets (shared CSS/JS) are referenced from the site root.
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Public website pages.
app.use(express.static(viewsPath, { index: false }));

// Backwards-compatible asset URL used by product images and logos.
app.use('/assets', express.static(path.join(__dirname, 'public')));

// Main website pages
// The IT Elements support homepage is the public landing page.
app.get('/', (req, res) => {
    res.sendFile(path.join(viewsPath, 'index.html'));
});

// Keep /home as a backwards-compatible homepage URL.
app.get('/home', (req, res) => {
    res.sendFile(path.join(viewsPath, 'index.html'));
});

app.get('/pricing', (req, res) => {
    res.sendFile(path.join(viewsPath, 'pricing.html'));
});

app.get('/services', (req, res) => {
    res.sendFile(path.join(viewsPath, 'services.html'));
});

app.get('/onsite-support', (req, res) => {
    res.sendFile(path.join(viewsPath, 'onsite-support.html'));
});

app.get('/about', (req, res) => {
    res.sendFile(path.join(viewsPath, 'about.html'));
});

// These two page routes were missing.
app.get(['/reviews', '/reviews/'], (req, res) => {
    res.sendFile(path.join(viewsPath, 'reviews.html'));
});

app.get(['/business-support', '/business-support/'], (req, res) => {
    res.sendFile(path.join(viewsPath, 'business-support.html'));
});

app.get('/faq', (req, res) => {
    res.sendFile(path.join(viewsPath, 'faq.html'));
});

app.get('/contact', (req, res) => {
    res.sendFile(path.join(viewsPath, 'contact.html'));
});

app.get(['/booking', '/booking/'], (req, res) => {
    res.sendFile(path.join(viewsPath, 'booking.html'));
});

app.get(['/billing', '/billing/'], checkUserAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'billing.html'));
});

app.get(['/business-tools', '/business-tools/'], (req, res) => {
    res.sendFile(path.join(viewsPath, 'business-tools.html'));
});

// IT Elements Online Store
app.get(['/store', '/store/', '/store.html'], (req, res) => {
    res.sendFile(path.join(viewsPath, 'store.html'));
});

// ============================================
// IT ELEMENTS ONLINE STORE API
// ============================================

// Clean and validate product information
function cleanStoreProduct(body = {}) {
    const name = String(body.name || '').trim();
    const sku = String(body.sku || '').trim();
    const category = String(body.category || '').trim();
    const description = String(body.description || '').trim();
    const imageUrl = String(body.imageUrl || '').trim();
    const incomingImages = Array.isArray(body.images) ? body.images : [];
    const imageCandidates = [imageUrl, ...incomingImages]
        .map(value => String(value || '').trim())
        .filter(Boolean);
    const validImages = [];
    for (const candidate of imageCandidates) {
        let normalized = '';
        if (/^\/(?:assets\/)?uploads\/products\/[a-f0-9-]+\.(?:jpg|jpeg|png|webp|avif)$/i.test(candidate)) {
            normalized = candidate;
        } else {
            try {
                const parsed = new URL(candidate);
                if (!['http:', 'https:'].includes(parsed.protocol)) {
                    return { error: 'Product images must use an HTTP or HTTPS address.' };
                }
                normalized = parsed.href;
            } catch (_) {
                return { error: 'One of the product image addresses is invalid.' };
            }
        }
        if (!validImages.includes(normalized)) validImages.push(normalized);
        if (validImages.length >= 20) break;
    }
    const primaryImage = validImages[0] || '';

    const price = Number(body.price);
    const compareAtPrice = body.compareAtPrice === '' ||
        body.compareAtPrice === null ||
        body.compareAtPrice === undefined
        ? 0
        : Number(body.compareAtPrice);

    const stock = Number(body.stock);

    const status = ['active', 'draft'].includes(body.status)
        ? body.status
        : 'draft';

    if (!name || name.length > 120) {
        return {
            error: 'Enter a product name between 1 and 120 characters.'
        };
    }

    if (!category || category.length > 80) {
        return {
            error: 'Enter a product category.'
        };
    }

    if (
        !Number.isFinite(price) ||
        price < 0 ||
        price > 100000000
    ) {
        return {
            error: 'Enter a valid selling price.'
        };
    }

    if (
        !Number.isFinite(compareAtPrice) ||
        compareAtPrice < 0 ||
        compareAtPrice > 100000000
    ) {
        return {
            error: 'Enter a valid previous price.'
        };
    }

    if (
        !Number.isInteger(stock) ||
        stock < 0 ||
        stock > 10000000
    ) {
        return {
            error: 'Stock must be a whole number of zero or more.'
        };
    }

    if (sku.length > 60 || description.length > 2000) {
        return {
            error: 'The SKU or description is too long.'
        };
    }

    return {
        product: {
            name,
            sku,
            category,
            price,
            compareAtPrice,
            productType: body.productType === 'sale' ? 'sale' : 'normal',
            stock,
            status,
            imageUrl: primaryImage,
            images: validImages,
            description,
            featured: body.featured === true ||
                body.featured === 'true' ||
                body.featured === 'on',
            updatedAt: new Date()
        }
    };
}

// ADMIN: Upload product images from the administrator's computer.
// Files are restricted by size, extension, MIME type and file signature.
const productUploadDir = path.join(__dirname, 'public', 'uploads', 'products');
const PRODUCT_IMAGE_TYPES = {
    'image/jpeg': { ext: 'jpg', signature: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
    'image/png': { ext: 'png', signature: bytes => bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) },
    'image/webp': { ext: 'webp', signature: bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' },
    'image/avif': { ext: 'avif', signature: bytes => bytes.toString('ascii', 4, 12).includes('ftypavif') }
};

app.post('/api/admin/store/upload-image', checkAdminAuth, async (req, res) => {
    try {
        const match = String(req.body && req.body.imageData || '').match(/^data:(image\/(?:jpeg|png|webp|avif));base64,([A-Za-z0-9+/=]+)$/);
        if (!match) return res.status(400).json({ success: false, message: 'Choose a JPG, PNG, WebP or AVIF image.' });
        const mime = match[1];
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
            return res.status(400).json({ success: false, message: 'Product images must be 5 MB or smaller.' });
        }
        const type = PRODUCT_IMAGE_TYPES[mime];
        if (!type || !type.signature(bytes)) {
            return res.status(400).json({ success: false, message: 'The image file is invalid or its format does not match.' });
        }
        await fs.promises.mkdir(productUploadDir, { recursive: true });
        const filename = `${randomUUID()}.${type.ext}`;
        await fs.promises.writeFile(path.join(productUploadDir, filename), bytes, { flag: 'wx' });
        return res.status(201).json({ success: true, imageUrl: `/assets/uploads/products/${filename}` });
    } catch (err) {
        console.error('Product image upload error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not upload this product image.' });
    }
});

// PUBLIC: Load active products for the online store
function getStoreCartOwner(req) {
    const customerEmail = String(req.session?.userEmail || '').trim().toLowerCase();
    if (customerEmail) return customerEmail;
    // Admin sessions do not carry a customer email. Give the single IT Elements
    // admin account its own stable cart identity instead of silently using guest storage.
    if (req.session?.isAdmin) return 'admin@itelements.help';
    return '';
}

app.get('/api/store/auth-status', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const authenticated = !!(req.session && (req.session.isUser || req.session.isAdmin));
    const cartOwner = authenticated ? getStoreCartOwner(req) : '';
    res.json({ authenticated, email: req.session?.userEmail || '', cartOwner });
});

// A customer's saved cart is private to their signed-in account and persists
// in MongoDB across logout, browser restarts, and other devices.
app.get('/api/store/cart', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    const email = getStoreCartOwner(req);
    if (!req.session || !(req.session.isUser || req.session.isAdmin) || !email) {
        return res.status(401).json({ success: false, message: 'Please sign in to view your saved cart.' });
    }
    try {
        const saved = await StoreCustomerCart.findOne({ ownerEmail: email }).lean();
        const items = (saved?.items || []).map(item => ({
            id: String(item.productId),
            qty: Math.max(1, Math.floor(Number(item.quantity) || 1))
        }));
        return res.json({ success: true, items });
    } catch (err) {
        console.error('Store cart load failed:', err.message);
        return res.status(500).json({ success: false, message: 'Could not load your saved cart.' });
    }
});

app.put('/api/store/cart', async (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    const email = getStoreCartOwner(req);
    if (!req.session || !(req.session.isUser || req.session.isAdmin) || !email) {
        return res.status(401).json({ success: false, message: 'Please sign in to save your cart.' });
    }
    try {
        const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
        if (incoming.length > 100) {
            return res.status(400).json({ success: false, message: 'Your cart contains too many different products.' });
        }
        const merged = new Map();
        for (const item of incoming) {
            const id = String(item?.id || item?.productId || '');
            const qty = Math.floor(Number(item?.qty ?? item?.quantity));
            if (!mongoose.isValidObjectId(id) || !Number.isInteger(qty) || qty < 1 || qty > 999) {
                return res.status(400).json({ success: false, message: 'One of the cart items is invalid.' });
            }
            merged.set(id, (merged.get(id) || 0) + qty);
        }
        const ids = [...merged.keys()];
        const products = ids.length
            ? await StoreProduct.find({ _id: { $in: ids }, status: 'active' }).select('_id stock').lean()
            : [];
        const productMap = new Map(products.map(p => [String(p._id), Math.max(0, Number(p.stock) || 0)]));
        const items = [];
        for (const [id, qty] of merged) {
            if (!productMap.has(id)) continue;
            // Preserve requested quantity in the saved cart; checkout performs
            // the final stock validation so a temporary stock change is visible.
            items.push({ productId: id, quantity: qty });
        }
        await StoreCustomerCart.findOneAndUpdate(
            { ownerEmail: email },
            { $set: { items, updatedAt: new Date() }, $setOnInsert: { ownerEmail: email } },
            { upsert: true, new: true, runValidators: true }
        );
        return res.json({ success: true, saved: items.length });
    } catch (err) {
        console.error('Store cart save failed:', err.message);
        return res.status(500).json({ success: false, message: 'Could not save your cart. Please try again.' });
    }
});


app.get('/api/store/products', async (req, res) => {
    try {
        // Product catalogue data changes infrequently. A short browser cache
        // avoids repeatedly downloading the same catalogue on every visit.
        res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');

        const products = await StoreProduct.find({ status: 'active' })
            .select('name sku category description price compareAtPrice stock imageUrl images status featured createdAt')
            .sort({ featured: -1, createdAt: -1 })
            .lean();

        return res.json({ success: true, products });
    } catch (err) {
        console.error('Public store products error:', err.message);
        return res.status(500).json({
            success: false,
            message: 'Could not load store products.',
            products: []
        });
    }
});

// Load the full image gallery only when a customer opens a product.
app.get('/api/store/products/:id', async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) {
            return res.status(400).json({ success: false, message: 'Invalid product.' });
        }

        const product = await StoreProduct.findOne({
            _id: req.params.id,
            status: 'active'
        }).select('-__v').lean();

        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }

        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        return res.json({ success: true, product });
    } catch (err) {
        console.error('Public store product detail error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not load this product.' });
    }
});

// ADMIN: Load all products, including drafts
// ADMIN: Store orders created through the PayFast product checkout.
app.get('/api/admin/store/orders', checkAdminAuth, async (req, res) => {
    try {
        const orders = await PayFastPurchase.find({ purchaseType: 'storeOrder', status: 'paid' })
            .select('paymentId userEmail orderDetails amount mode status pfPaymentId paidAt createdAt fulfilmentStatus')
            .sort({ createdAt: -1 })
            .limit(500)
            .lean();
        return res.json({ success: true, orders });
    } catch (err) {
        console.error('Admin store orders error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not load store orders.' });
    }
});

// ADMIN: Update order fulfilment stage (does not alter PayFast payment status).
app.patch('/api/admin/store/orders/:id/fulfilment', checkAdminAuth, async (req, res) => {
    const allowed = ['new', 'processing', 'ready', 'shipped', 'completed', 'cancelled'];
    const fulfilmentStatus = String(req.body.fulfilmentStatus || '');
    if (!mongoose.isValidObjectId(req.params.id) || !allowed.includes(fulfilmentStatus)) {
        return res.status(400).json({ success: false, message: 'Invalid order or fulfilment status.' });
    }
    try {
        const order = await PayFastPurchase.findOneAndUpdate(
            { _id: req.params.id, purchaseType: 'storeOrder', status: 'paid' },
            { $set: { fulfilmentStatus } },
            { new: true }
        ).select('paymentId fulfilmentStatus status');
        if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
        return res.json({ success: true, order });
    } catch (err) {
        console.error('Store order update error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not update this order.' });
    }
});

app.get('/api/admin/store/products', checkAdminAuth, async (req, res) => {
    try {
        const products = await StoreProduct.find()
            .select('-__v')
            .sort({ createdAt: -1 })
            .lean();

        return res.json({
            success: true,
            products
        });
    } catch (err) {
        console.error('Admin store products error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Could not load your products.'
        });
    }
});

// ADMIN: Add a new product
app.post('/api/admin/store/products', checkAdminAuth, async (req, res) => {
    const cleaned = cleanStoreProduct(req.body || {});

    if (cleaned.error) {
        return res.status(400).json({
            success: false,
            message: cleaned.error
        });
    }

    try {
        const product = await StoreProduct.create(cleaned.product);

        return res.status(201).json({
            success: true,
            message: 'Product added successfully.',
            product
        });
    } catch (err) {
        console.error('Add store product error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Could not add this product.'
        });
    }
});

// ADMIN: Save stock quantities for multiple products in one request.
app.patch('/api/admin/store/products/stock', checkAdminAuth, async (req, res) => {
    const updates = Array.isArray(req.body && req.body.updates) ? req.body.updates : [];
    if (!updates.length || updates.length > 500) {
        return res.status(400).json({ success: false, message: 'Submit between 1 and 500 stock updates.' });
    }
    const cleaned = [];
    const seen = new Set();
    for (const item of updates) {
        const id = String(item && item.id || '');
        const stock = Number(item && item.stock);
        if (!mongoose.isValidObjectId(id) || seen.has(id) || !Number.isInteger(stock) || stock < 0 || stock > 10000000) {
            return res.status(400).json({ success: false, message: 'One or more product IDs or stock quantities are invalid.' });
        }
        seen.add(id);
        cleaned.push({ id, stock });
    }
    try {
        const results = await Promise.all(cleaned.map(item =>
            StoreProduct.updateOne({ _id: item.id }, { $set: { stock: item.stock, updatedAt: new Date() } })
        ));
        const updated = results.reduce((sum, result) => sum + (result.modifiedCount || result.nModified || 0) + (result.matchedCount === 1 && (result.modifiedCount || result.nModified || 0) === 0 ? 1 : 0), 0);
        return res.json({ success: true, updated, requested: cleaned.length });
    } catch (err) {
        console.error('Bulk stock update error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not save stock quantities.' });
    }
});

// ADMIN: Edit an existing product
app.put('/api/admin/store/products/:id', checkAdminAuth, async (req, res) => {
    const productId = String(req.params.id || '');

    if (!mongoose.isValidObjectId(productId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid product.'
        });
    }

    const cleaned = cleanStoreProduct(req.body || {});

    if (cleaned.error) {
        return res.status(400).json({
            success: false,
            message: cleaned.error
        });
    }

    try {
        const product = await StoreProduct.findByIdAndUpdate(
            productId,
            {
                $set: cleaned.product
            },
            {
                new: true,
                runValidators: true
            }
        );

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found.'
            });
        }

        return res.json({
            success: true,
            message: 'Product updated successfully.',
            product
        });
    } catch (err) {
        console.error('Update store product error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Could not update this product.'
        });
    }
});


// ADMIN: Import products in batches after the admin has reviewed the images and selected rows.
app.post('/api/admin/store/products/bulk', checkAdminAuth, async (req, res) => {
    const incoming = Array.isArray(req.body && req.body.products) ? req.body.products : [];
    if (!incoming.length || incoming.length > 500) {
        return res.status(400).json({ success: false, message: 'Choose between 1 and 500 products per import.' });
    }
    const cleaned = [];
    const errors = [];
    incoming.forEach((item, index) => {
        const result = cleanStoreProduct(item || {});
        if (result.error) errors.push({ row: index + 1, message: result.error });
        else cleaned.push(result.product);
    });
    if (!cleaned.length) {
        return res.status(400).json({ success: false, message: 'No valid products were supplied.', errors });
    }
    try {
        const created = await StoreProduct.insertMany(cleaned, { ordered: true });
        return res.status(201).json({ success: true, message: 'Product import completed.', created: created.length, skipped: errors.length, errors });
    } catch (err) {
        console.error('Bulk store product import error:', err.message);
        return res.status(500).json({ success: false, message: 'Import stopped because a product could not be saved. Check the catalogue before retrying.', created: 0, skipped: errors.length });
    }
});

// ADMIN: Bulk publish, draft or delete selected product IDs.
app.post('/api/admin/store/products/bulk-action', checkAdminAuth, async (req, res) => {
    const action = String(req.body && req.body.action || '');
    const ids = Array.isArray(req.body && req.body.ids) ? [...new Set(req.body.ids.map(String))] : [];
    if (!['publish', 'draft', 'delete'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid bulk action.' });
    if (!ids.length || ids.length > 2000 || ids.some(id => !mongoose.isValidObjectId(id))) return res.status(400).json({ success: false, message: 'Select valid products for this action.' });
    try {
        if (action === 'delete') {
            const result = await StoreProduct.deleteMany({ _id: { $in: ids } });
            return res.json({ success: true, deleted: result.deletedCount || 0 });
        }
        const result = await StoreProduct.updateMany(
            { _id: { $in: ids } },
            { $set: { status: action === 'publish' ? 'active' : 'draft', updatedAt: new Date() } }
        );
        return res.json({ success: true, updated: result.modifiedCount || 0 });
    } catch (err) {
        console.error('Bulk store action error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not complete the bulk action.' });
    }
});

// ADMIN: Permanently delete every product after a typed confirmation.
app.delete('/api/admin/store/products', checkAdminAuth, async (req, res) => {
    if (!req.body || req.body.confirm !== 'DELETE ALL') return res.status(400).json({ success: false, message: 'Confirmation required.' });
    try {
        const result = await StoreProduct.deleteMany({});
        return res.json({ success: true, deleted: result.deletedCount || 0 });
    } catch (err) {
        console.error('Delete all store products error:', err.message);
        return res.status(500).json({ success: false, message: 'Could not delete the product catalogue.' });
    }
});

// ADMIN: Delete a product
app.delete('/api/admin/store/products/:id', checkAdminAuth, async (req, res) => {
    const productId = String(req.params.id || '');

    if (!mongoose.isValidObjectId(productId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid product.'
        });
    }

    try {
        const product = await StoreProduct.findByIdAndDelete(productId);

        if (!product) {
            return res.status(404).json({
                success: false,
                message: 'Product not found.'
            });
        }

        return res.json({
            success: true,
            message: 'Product deleted successfully.'
        });
    } catch (err) {
        console.error('Delete store product error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Could not delete this product.'
        });
    }
});

// Subscription links
app.get('/subscribe/:planId', (req, res) => {
    const planId = String(req.params.planId || '');

    if (!SLA_PLANS[planId]) {
        return res.status(404).send('Plan not found.');
    }

    req.session.pendingPlanId = planId;

    if (req.session.isUser) {
        return res.redirect(`/dashboard?plan=${encodeURIComponent(planId)}`);
    }

    return res.redirect('/client/login');
});

// Support and account pages
app.get('/support', (req, res) => {
    res.sendFile(path.join(viewsPath, 'support.html'));
});

app.get('/admin/login', (req, res) => {
    res.sendFile(path.join(viewsPath, 'client-login.html'));
});

app.get('/client/login', (req, res) => {
    if (req.query.next === '/store' || String(req.query.next || '').startsWith('/store?')) req.session.returnTo = '/store?resumeCart=1';
    else if (req.query.next === '/dashboard') req.session.returnTo = '/dashboard';
    else if (req.query.next === '/account') req.session.returnTo = '/account';

    // If the visitor is already authenticated, send them to their workspace
    // instead of showing the sign-in page again.
    if (req.session && req.session.isAdmin) {
        return res.redirect('/admin');
    }

    if (req.session && req.session.isUser) {
        const nextUrl = req.session.returnTo === '/tools/invoices'
            ? '/tools/invoices'
            : req.session.returnTo === '/store?resumeCart=1'
                ? '/store?resumeCart=1'
                : req.session.returnTo === '/account'
                    ? '/account'
                    : '/dashboard';
        delete req.session.returnTo;
        return res.redirect(nextUrl);
    }

    return res.sendFile(path.join(viewsPath, 'client-login.html'));
});

app.get('/client/forgot-password', (req, res) => {
    res.sendFile(path.join(viewsPath, 'forgot-password.html'));
});

app.get('/reset-password', (req, res) => {
    res.sendFile(path.join(viewsPath, 'reset-password.html'));
});

app.get('/register', (req, res) => {
    if (req.query.next === '/store' || String(req.query.next || '').startsWith('/store?')) req.session.returnTo = '/store?resumeCart=1';
    else if (req.query.next === '/dashboard') req.session.returnTo = '/dashboard';
    else if (req.query.next === '/account') req.session.returnTo = '/account';
    res.sendFile(path.join(viewsPath, 'register.html'));
});

app.get('/dashboard', checkUserAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'dashboard.html'));
});

app.get('/account', checkUserAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, private');
    res.sendFile(path.join(viewsPath, 'account.html'));
});


// Invoice Maker must require a signed-in customer.
app.get('/tools/invoices', checkUserAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'invoice-maker.html'));
});

// Admin page
app.get('/admin', checkAdminAuth, (req, res) => {
    res.sendFile(path.join(viewsPath, 'admin.html'));
});

// Create PayFast checkout
async function createPayFastCheckout({
    email,
    amount,
    purchaseType,
    planId = '',
    planName = '',
    durationOption = '',
    orderDetails = null
}) {
    const config = payfastConfig();

    if (!config) {
        throw Object.assign(
            new Error(
                'Check the PayFast Render settings: PAYFAST_MERCHANT_ID must be the 8-digit Merchant ID and PAYFAST_MERCHANT_KEY must be the 13-character Merchant Key. Do not enter your passphrase as the Merchant Key.'
            ),
            { statusCode: 503 }
        );
    }

    const configuredBaseUrl = String(process.env.PUBLIC_BASE_URL || '').trim();
    const publicBaseUrl = (configuredBaseUrl || 'https://www.itelements.co.za').replace(/\/$/, '');

    if (!/^https:\/\//i.test(publicBaseUrl)) {
        throw Object.assign(
            new Error('Set PUBLIC_BASE_URL to your deployed HTTPS website address.'),
            { statusCode: 503 }
        );
    }

    const paymentId = `ite-${randomUUID()}`;

    if (mongoose.connection.readyState !== 1) {
        throw Object.assign(
            new Error('Secure payment is temporarily unavailable because the order database is not connected. Please try again shortly.'),
            { statusCode: 503 }
        );
    }

    await PayFastPurchase.create({
        paymentId,
        userEmail: email,
        purchaseType,
        planId,
        planName,
        durationOption,
        orderDetails,
        amount,
        mode: config.mode
    });

    const returnPath = purchaseType === 'plan'
        ? '/dashboard'
        : purchaseType === 'invoicePro'
            ? '/tools/invoices'
            : purchaseType === 'storeOrder'
                ? '/store'
                : '/';

    const fields = {
        merchant_id: config.merchantId,
        merchant_key: config.merchantKey,
        return_url: `${publicBaseUrl}${returnPath}?payment=returned&${purchaseType === 'plan' || purchaseType === 'invoicePro' ? 'payfastId' : 'paymentId'}=${encodeURIComponent(paymentId)}`,
        cancel_url: `${publicBaseUrl}${returnPath}?payment=cancelled`,
        notify_url: `${publicBaseUrl}/webhooks/payfast`,
        email_address: email,
        m_payment_id: paymentId,
        amount: (amount / 100).toFixed(2),
        item_name: purchaseType === 'plan'
            ? `IT Elements ${planName} 30-day support plan`
            : purchaseType === 'invoicePro'
                ? 'IT Elements Invoice Pro 30-day access'
                : purchaseType === 'storeOrder'
                    ? 'IT Elements Online Store Order'
                    : `IT Elements ${QUICK_FIX_OPTIONS[durationOption]?.label || 'remote support session'}`,
        item_description: purchaseType === 'plan'
            ? 'One-time payment for 30 days of support; renew manually.'
            : purchaseType === 'invoicePro'
                ? 'One-time payment for 30 days of additional invoice and quote creation.'
                : purchaseType === 'storeOrder'
                    ? 'IT Elements products purchased through the online store.'
                    : 'One-time remote support session.'
    };

    fields.signature = payfastSignature(
        fields,
        process.env.PAYFAST_PASSPHRASE || ''
    );

    return {
        action: config.endpoint,
        fields,
        paymentId
    };
}

// Quick-fix checkout
app.post('/api/payment/payfast-quickfix', async (req, res) => {
    const durationOption = String(req.body.durationOption || '');
    const quickFix = QUICK_FIX_OPTIONS[durationOption];
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!quickFix) {
        return res.status(400).json({
            success: false,
            message: 'Choose one of the available quick-fix sessions.'
        });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            success: false,
            message: 'Enter a valid email address for your payment receipt.'
        });
    }

    try {
        return res.json({
            success: true,
            ...(await createPayFastCheckout({
                email,
                amount: quickFix.amount,
                purchaseType: 'quickfix',
                durationOption
            }))
        });
    } catch (err) {
        return res.status(err.statusCode || 502).json({
            success: false,
            message: err.message || 'Could not start PayFast checkout. Please try again.'
        });
    }
});

// Online store checkout: account required; all prices and stock are verified server-side.
app.post('/api/payment/payfast-product-checkout', async (req, res) => {
    try {
        const email = String((req.session && req.session.userEmail) || req.body.email || '').trim().toLowerCase();
        const customerName = String(req.body.customerName || '').trim().slice(0, 100);
        const phone = String(req.body.phone || '').trim().slice(0, 30);
        const deliveryMethod = 'delivery';
        const deliveryAddress = String(req.body.deliveryAddress || '').trim().slice(0, 500);
        const rawItems = Array.isArray(req.body.items) ? req.body.items : [];

        const normalizedPhone = phone.replace(/[\s().-]/g, '');
        if (customerName.length < 2) {
            return res.status(400).json({ success: false, message: 'Please enter your full name.' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid email address.' });
        }
        if (!/^\+?[0-9]{7,20}$/.test(normalizedPhone)) {
            return res.status(400).json({ success: false, message: 'Please enter a valid phone number, including your country code.' });
        }
        if (deliveryAddress.length < 8) {
            return res.status(400).json({ success: false, message: 'Please enter your delivery address.' });
        }
        if (!rawItems.length || rawItems.length > 30) {
            return res.status(400).json({ success: false, message: 'Your cart is empty or contains too many items.' });
        }

        const quantities = new Map();
        for (const row of rawItems) {
            const id = String(row.id || row.productId || '');
            const qty = Math.floor(Number(row.qty ?? row.quantity));
            if (!mongoose.isValidObjectId(id) || !Number.isInteger(qty) || qty < 1 || qty > 99) {
                return res.status(400).json({ success: false, message: 'One of the cart items has an invalid quantity.' });
            }
            quantities.set(id, (quantities.get(id) || 0) + qty);
        }

        const ids = [...quantities.keys()];
        const products = await StoreProduct.find({ _id: { $in: ids }, status: 'active' }).lean();
        if (products.length !== ids.length) {
            return res.status(409).json({ success: false, message: 'A product in your cart is no longer available. Please refresh the store.' });
        }

        let subtotalCents = 0;
        const orderItems = products.map(product => {
            const quantity = quantities.get(String(product._id));
            const stock = Math.max(0, Number(product.stock) || 0);
            if (stock < quantity) throw Object.assign(new Error(`${product.name} has only ${stock} available.`), { statusCode: 409 });
            const unitPriceCents = Math.round(Number(product.price) * 100);
            if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 1) throw Object.assign(new Error(`Invalid price for ${product.name}.`), { statusCode: 400 });
            subtotalCents += unitPriceCents * quantity;
            return {
                productId: String(product._id),
                name: product.name,
                sku: product.sku || '',
                imageUrl: String(product.imageUrl || (Array.isArray(product.images) ? product.images.find(Boolean) : '') || ''),
                quantity,
                unitPriceCents
            };
        });

        if (!Number.isSafeInteger(subtotalCents) || subtotalCents < 1) {
            return res.status(400).json({ success: false, message: 'The order subtotal is invalid.' });
        }

        // IT Elements delivery policy: R80 below R755; free at R755 and above.
        // Collection never incurs a delivery charge.
        const deliveryFeeCents = deliveryMethod === 'delivery' && subtotalCents < 75500 ? 8000 : 0;
        const totalCents = subtotalCents + deliveryFeeCents;

        const checkout = await createPayFastCheckout({
            email,
            amount: totalCents,
            purchaseType: 'storeOrder',
            orderDetails: {
                customerName,
                phone: normalizedPhone,
                deliveryMethod,
                deliveryAddress: deliveryMethod === 'delivery' ? deliveryAddress : '',
                subtotalCents,
                deliveryFeeCents,
                totalCents,
                items: orderItems
            }
        });
        return res.json({ success: true, ...checkout });
    } catch (err) {
        console.error('[STORE CHECKOUT] Payment preparation failed:', err && err.message ? err.message : err);
        return res.status(err.statusCode || 502).json({
            success: false,
            message: err.message || 'Secure payment could not be prepared. Please contact IT Elements.'
        });
    }
});

// Monthly support plan checkout
app.post('/api/payment/payfast-plan-checkout', checkUserAuth, async (req, res) => {
    const userEmail = String(req.session.userEmail || '').toLowerCase();
    const planId = String(req.body.planId || '');
    const plan = SLA_PLANS[planId];

    if (!userEmail) {
        return res.status(403).json({
            success: false,
            message: 'Sign in with a customer account before choosing a plan.'
        });
    }

    if (!plan) {
        return res.status(400).json({
            success: false,
            message: 'Choose one of the available support plans.'
        });
    }

    try {
        return res.json({
            success: true,
            ...(await createPayFastCheckout({
                email: userEmail,
                amount: plan.amount,
                purchaseType: 'plan',
                planId,
                planName: plan.name
            }))
        });
    } catch (err) {
        return res.status(err.statusCode || 502).json({
            success: false,
            message: err.message || 'Could not start PayFast checkout. Please try again.'
        });
    }
});

// Invoice Pro checkout
app.post('/api/payment/payfast-invoice-checkout', checkUserAuth, async (req, res) => {
    const email = String(req.session.userEmail || '').trim().toLowerCase();

    if (!email) {
        return res.status(403).json({
            success: false,
            message: 'Sign in to enable Invoice Pro.'
        });
    }

    try {
        return res.json({
            success: true,
            ...(await createPayFastCheckout({
                email,
                amount: 4900,
                purchaseType: 'invoicePro'
            }))
        });
    } catch (err) {
        return res.status(err.statusCode || 502).json({
            success: false,
            message: err.message || 'Could not start PayFast checkout.'
        });
    }
});

// Payment status
app.get('/api/payment/payfast-status', async (req, res) => {
    const paymentId = String(req.query.paymentId || '');

    if (!/^ite-[a-f0-9-]{36}$/i.test(paymentId)) {
        return res.status(400).json({ success: false });
    }

    const purchase = await PayFastPurchase.findOne(
        { paymentId },
        { userEmail: 0, __v: 0 }
    );

    if (!purchase) {
        return res.status(404).json({ success: false });
    }

    return res.json({
        success: true,
        checkout: purchase
    });
});

app.get('/api/payment/payfast-invoice-status', checkUserAuth, async (req, res) => {
    const paymentId = String(
        req.query.payfastId || req.query.paymentId || ''
    );

    if (!/^ite-[a-f0-9-]{36}$/i.test(paymentId)) {
        return res.status(400).json({ success: false });
    }

    const purchase = await PayFastPurchase.findOne({
        paymentId,
        userEmail: invoiceOwner(req),
        purchaseType: 'invoicePro'
    }, {
        status: 1,
        expiresAt: 1,
        createdAt: 1
    }).lean();

    if (!purchase) {
        return res.status(404).json({ success: false });
    }

    return res.json({
        success: true,
        status: purchase.status,
        expiresAt: purchase.expiresAt
    });
});

// Invoice Maker helpers
function invoiceOwner(req) {
    return String(req.session.userEmail || '').trim().toLowerCase();
}

function cleanInvoiceText(value, max = 180) {
    return String(value || '').trim().slice(0, max);
}

function cleanInvoiceLogo(value) {
    const logo = String(value || '');

    return logo.length <= 60000 &&
        /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/.test(logo)
        ? logo
        : '';
}

async function invoiceAllowance(email) {
    const now = new Date();
    const monthStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        1
    );

    const [user, used] = await Promise.all([
        UserAccount.findOne({ email }, { invoiceProUntil: 1 }),
        BusinessDocument.countDocuments({
            ownerEmail: email,
            createdAt: { $gte: monthStart }
        })
    ]);

    const proUntil = user?.invoiceProUntil || null;
    const pro = Boolean(proUntil && new Date(proUntil) > now);

    return {
        pro,
        proUntil,
        used,
        freeLimit: 3,
        remaining: pro ? null : Math.max(0, 3 - used)
    };
}

// Invoice Maker access
app.get('/api/invoice-tools/status', checkUserAuth, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await invoiceAllowance(invoiceOwner(req)))
        });
    } catch (_) {
        res.status(500).json({
            success: false,
            message: 'Could not load Invoice Maker access.'
        });
    }
});

// Load saved invoices and quotes
app.get('/api/invoices', checkUserAuth, async (req, res) => {
    try {
        const documents = await BusinessDocument.find(
            { ownerEmail: invoiceOwner(req) },
            { ownerEmail: 0, __v: 0 }
        )
            .sort({ createdAt: -1 })
            .limit(100)
            .lean();

        res.json({
            success: true,
            documents
        });
    } catch (_) {
        res.status(500).json({
            success: false,
            message: 'Could not load your saved documents.'
        });
    }
});

// Save an invoice or quotation
app.post('/api/invoices', checkUserAuth, async (req, res) => {
    try {
        const ownerEmail = invoiceOwner(req);
        const allowance = await invoiceAllowance(ownerEmail);

        if (!allowance.pro && allowance.remaining <= 0) {
            return res.status(402).json({
                success: false,
                code: 'UPGRADE_REQUIRED',
                message: 'Your three free documents for this month have been used. Enable Invoice Pro for R49 per 30 days, or return next month.'
            });
        }

        const body = req.body || {};

        const kind = body.kind === 'quote'
            ? 'quote'
            : body.kind === 'invoice'
                ? 'invoice'
                : '';

        if (!kind) {
            return res.status(400).json({
                success: false,
                message: 'Choose invoice or quote.'
            });
        }

        const layout = [
            'modern',
            'classic',
            'compact',
            'ledger'
        ].includes(body.layout)
            ? body.layout
            : 'modern';

        const vatRate = Number(body.vatRate) === 15 ? 15 : 0;
        const discountRate = Number(body.discountRate || 0);

        if (
            !Number.isFinite(discountRate) ||
            discountRate < 0 ||
            discountRate > 100
        ) {
            return res.status(400).json({
                success: false,
                message: 'Discount must be between 0% and 100%.'
            });
        }

        const itemsInput = Array.isArray(body.items)
            ? body.items.slice(0, 30)
            : [];

        const items = itemsInput.map(item => {
            const description = cleanInvoiceText(item?.description, 160);
            const quantity = Number(item?.quantity);
            const unitPriceCents = Math.round(Number(item?.unitPrice) * 100);

            if (
                !description ||
                !Number.isFinite(quantity) ||
                quantity <= 0 ||
                quantity > 100000 ||
                !Number.isSafeInteger(unitPriceCents) ||
                unitPriceCents < 0 ||
                unitPriceCents > 100000000
            ) {
                return null;
            }

            return {
                description,
                quantity,
                unitPriceCents,
                lineTotalCents: Math.round(quantity * unitPriceCents)
            };
        });

        if (!items.length || items.some(item => !item)) {
            return res.status(400).json({
                success: false,
                message: 'Add at least one valid item with a description, quantity, and non-negative price.'
            });
        }

        const subtotalCents = items.reduce(
            (sum, item) => sum + item.lineTotalCents,
            0
        );

        const discountCents = Math.round(
            subtotalCents * discountRate / 100
        );

        const taxableSubtotalCents = subtotalCents - discountCents;
        const vatCents = Math.round(taxableSubtotalCents * vatRate / 100);
        const totalCents = taxableSubtotalCents + vatCents;

        if (
            !Number.isSafeInteger(totalCents) ||
            totalCents > 1000000000
        ) {
            return res.status(400).json({
                success: false,
                message: 'The document total is too large.'
            });
        }

        const now = new Date();
        const prefix = kind === 'invoice' ? 'INV' : 'QUO';

        const number = `${prefix}-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

        const saved = await BusinessDocument.create({
            ownerEmail,
            kind,
            number,
            layout,
            business: {
                name: cleanInvoiceText(body.business?.name, 100),
                email: cleanInvoiceText(body.business?.email, 120),
                phone: cleanInvoiceText(body.business?.phone, 40),
                address: cleanInvoiceText(body.business?.address, 240),
                vatNumber: cleanInvoiceText(body.business?.vatNumber, 40),
                logoText: cleanInvoiceText(body.business?.logoText, 40),
                logoImage: cleanInvoiceLogo(body.business?.logoImage)
            },
            customer: {
                name: cleanInvoiceText(body.customer?.name, 100),
                email: cleanInvoiceText(body.customer?.email, 120),
                phone: cleanInvoiceText(body.customer?.phone, 40),
                address: cleanInvoiceText(body.customer?.address, 240)
            },
            issueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.issueDate || ''))
                ? body.issueDate
                : now.toISOString().slice(0, 10),
            dueDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.dueDate || ''))
                ? body.dueDate
                : '',
            reference: cleanInvoiceText(body.reference, 100),
            paymentTerms: cleanInvoiceText(body.paymentTerms, 500),
            items,
            vatRate,
            discountRate,
            discountCents,
            subtotalCents,
            vatCents,
            totalCents,
            notes: cleanInvoiceText(body.notes, 1200),
            paymentInstructions: cleanInvoiceText(body.paymentInstructions, 500)
        });

        res.status(201).json({
            success: true,
            document: {
                ...saved.toObject(),
                ownerEmail: undefined,
                __v: undefined
            },
            ...(await invoiceAllowance(ownerEmail))
        });
    } catch (_) {
        res.status(500).json({
            success: false,
            message: 'Could not save this document. Please try again.'
        });
    }
});

// Delete a saved invoice or quote
app.delete('/api/invoices/:id', checkUserAuth, async (req, res) => {
    try {
        const removed = await BusinessDocument.deleteOne({
            _id: req.params.id,
            ownerEmail: invoiceOwner(req)
        });

        if (!removed.deletedCount) {
            return res.status(404).json({
                success: false,
                message: 'Document not found.'
            });
        }

        res.json({ success: true });
    } catch (_) {
        res.status(400).json({
            success: false,
            message: 'Could not remove that document.'
        });
    }
});

// Customer registration
app.post('/client/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;

        if (!fullName || !phone || !email || !password) {
            return res.status(400).send(
                '<script>alert("Please complete every field.");window.history.back();</script>'
            );
        }

        if (fullName.trim().length < 2 || fullName.trim().length > 100) {
            return res.status(400).send(
                '<script>alert("Enter a name or company name between 2 and 100 characters.");window.history.back();</script>'
            );
        }

        if (phone.trim().length < 7 || phone.trim().length > 25) {
            return res.status(400).send(
                '<script>alert("Enter a valid contact phone number.");window.history.back();</script>'
            );
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
            return res.status(400).send(
                '<script>alert("Enter a valid email address.");window.history.back();</script>'
            );
        }

        if (password.length < 12 || password.length > 256) {
            return res.status(400).send(
                '<script>alert("Choose a password between 12 and 256 characters.");window.history.back();</script>'
            );
        }

        const normalizedEmail = email.toLowerCase().trim();

        const existingUser = await UserAccount.findOne({
            email: normalizedEmail
        });

        if (existingUser) {
            return res.send(
                '<script>alert("Email already registered.");window.history.back();</script>'
            );
        }

        const newUser = new UserAccount({
            fullName: fullName.trim(),
            phone: phone.trim(),
            email: normalizedEmail,
            password: await hashPassword(password)
        });

        await newUser.save();

        req.session.isUser = true;
        req.session.userEmail = newUser.email;

        const nextUrl = req.session.returnTo === '/tools/invoices'
            ? '/tools/invoices'
            : req.session.returnTo === '/store?resumeCart=1'
                ? '/store?resumeCart=1'
            : req.session.pendingPlanId && SLA_PLANS[req.session.pendingPlanId]
                ? `/dashboard?plan=${encodeURIComponent(req.session.pendingPlanId)}`
                : req.session.returnTo === '/dashboard' ? '/dashboard'
            : req.session.returnTo === '/account' ? '/account' : '/store';

        delete req.session.returnTo;

        res.send(
            `<script>alert("Account created successfully!");window.location.href=${JSON.stringify(nextUrl)};</script>`
        );
    } catch (err) {
        console.error('Registration error:', err.message);
        res.status(500).send('Could not create your account. Please try again.');
    }
});

// Customer and admin login
app.post('/client/login', async (req, res) => {
    try {
        const { email = '', password = '' } = req.body;

        if (
            process.env.ADMIN_PASSWORD &&
            password === process.env.ADMIN_PASSWORD
        ) {
            req.session.regenerate((regenerateError) => {
                if (regenerateError) {
                    console.error('Admin session creation failed:', regenerateError.message);
                    return res.status(500).send('Unable to start your session. Please try again.');
                }
                req.session.isAdmin = true;
                req.session.save((saveError) => {
                    if (saveError) {
                        console.error('Admin session save failed:', saveError.message);
                        return res.status(500).send('Unable to save your session. Please try again.');
                    }
                    return res.redirect('/admin');
                });
            });
            return;
        }

        const normalizedEmail = String(email).toLowerCase().trim();

        const user = await UserAccount.findOne({
            email: normalizedEmail
        });

        if (user && await verifyAndUpgradePassword(user, password)) {
            const nextUrl = req.session.returnTo === '/tools/invoices'
                ? '/tools/invoices'
                : req.session.returnTo === '/store?resumeCart=1'
                    ? '/store?resumeCart=1'
                : req.session.pendingPlanId && SLA_PLANS[req.session.pendingPlanId]
                    ? `/dashboard?plan=${encodeURIComponent(req.session.pendingPlanId)}`
                    : req.session.returnTo === '/dashboard' ? '/dashboard'
                : req.session.returnTo === '/account' ? '/account' : '/store';

            req.session.regenerate((regenerateError) => {
                if (regenerateError) {
                    console.error('Customer session creation failed:', regenerateError.message);
                    return res.status(500).send('Unable to start your session. Please try again.');
                }
                req.session.isUser = true;
                req.session.userEmail = user.email;
                req.session.save((saveError) => {
                    if (saveError) {
                        console.error('Customer session save failed:', saveError.message);
                        return res.status(500).send('Unable to save your session. Please try again.');
                    }
                    return res.redirect(nextUrl);
                });
            });
            return;
        }

        res.send(
            '<script>alert("Invalid credentials.");window.history.back();</script>'
        );
    } catch (err) {
        console.error('Login error:', err.message);
        res.status(500).send('Unable to sign in right now.');
    }
});

// Forgot password
app.post('/api/auth/forgot-password', rateLimitPasswordReset, async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            message: 'Enter a valid email address.'
        });
    }

    if (
        !process.env.RESEND_API_KEY ||
        !process.env.RESET_EMAIL_FROM ||
        !process.env.PUBLIC_BASE_URL
    ) {
        console.error(
            'Password reset is unavailable: set RESEND_API_KEY, RESET_EMAIL_FROM, and PUBLIC_BASE_URL.'
        );

        return res.status(503).json({
            message: 'Password reset email is not configured yet. Please contact IT Elements support.'
        });
    }

    try {
        const user = await UserAccount.findOne({ email });

        if (!user) {
            return res.status(202).json({
                message: 'If an account exists for that address, a reset link will be emailed.'
            });
        }

        const token = crypto.randomBytes(32).toString('hex');

        const tokenHash = crypto.createHash('sha256')
            .update(token)
            .digest('hex');

        await PasswordReset.deleteMany({
            email,
            usedAt: null
        });

        await PasswordReset.create({
            email,
            tokenHash,
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        });

        const baseUrl = process.env.PUBLIC_BASE_URL.replace(/\/$/, '');

        const resetUrl =
            `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;

        try {
            await sendPasswordResetEmail(email, resetUrl);
        } catch (mailError) {
            await PasswordReset.deleteOne({ tokenHash });
            throw mailError;
        }

        return res.status(202).json({
            message: 'If an account exists for that address, a reset link will be emailed.'
        });
    } catch (err) {
        console.error('Password reset request failed:', err.message);

        return res.status(503).json({
            message: 'We could not send the reset email right now. Please contact IT Elements support.'
        });
    }
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
    const token = String(req.body.token || '');
    const password = String(req.body.password || '');

    if (password.length < 12) {
        return res.status(400).json({
            message: 'Choose a password with at least 12 characters.'
        });
    }

    if (password.length > 256) {
        return res.status(400).json({
            message: 'Password is too long.'
        });
    }

    if (!/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).json({
            message: 'This reset link is invalid or expired. Request a new one.'
        });
    }

    try {
        const tokenHash = crypto.createHash('sha256')
            .update(token)
            .digest('hex');

        const now = new Date();

        const reset = await PasswordReset.findOneAndUpdate(
            {
                tokenHash,
                usedAt: null,
                expiresAt: { $gt: now }
            },
            {
                $set: { usedAt: now }
            },
            { new: true }
        );

        if (!reset) {
            return res.status(400).json({
                message: 'This reset link is invalid, expired, or already used. Request a new one.'
            });
        }

        try {
            const passwordHash = await hashPassword(password);

            const result = await UserAccount.updateOne(
                { email: reset.email },
                { $set: { password: passwordHash } }
            );

            if (!result.matchedCount) {
                return res.status(400).json({
                    message: 'This account no longer exists. Contact IT Elements support.'
                });
            }

            await PasswordReset.updateMany(
                { email: reset.email, usedAt: null },
                { $set: { usedAt: now } }
            );

            return res.json({
                success: true,
                message: 'Password updated. You can now sign in with your new password.'
            });
        } catch (updateError) {
            await PasswordReset.updateOne(
                { _id: reset._id, usedAt: now },
                { $set: { usedAt: null } }
            );

            throw updateError;
        }
    } catch (err) {
        console.error('Password reset failed:', err.message);

        return res.status(500).json({
            message: 'Password reset failed. Please request a new link and try again.'
        });
    }
});

// Logout
app.get('/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/');
    });
});

app.get('/client/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect('/');
    });
});

// Notifications
app.get('/api/notifications', (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    return checkUserAuth(req, res, next);
}, async (req, res) => {
    try {
        const filter = req.session.isAdmin
            ? { recipientRole: 'admin' }
            : {
                recipientRole: 'customer',
                recipientEmail: String(req.session.userEmail || '').toLowerCase()
            };

        const notifications = await SiteNotification.find(filter)
            .sort({ createdAt: -1 })
            .limit(40)
            .lean();

        res.json({
            notifications: notifications.map(item => ({
                id: String(item._id),
                ticketId: String(item.ticketId),
                actorName: item.actorName,
                title: item.title,
                body: item.body,
                createdAt: item.createdAt,
                read: Boolean(item.readAt),
                requestType: item.requestType || ''
            }))
        });
    } catch (err) {
        console.error('Notification load failed:', err.message);

        res.status(500).json({
            message: 'Could not load notifications.'
        });
    }
});

app.post('/api/notifications/:notificationId/read', (req, res, next) => {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    return checkUserAuth(req, res, next);
}, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.notificationId)) {
        return res.status(400).json({ success: false });
    }

    try {
        const filter = req.session.isAdmin
            ? {
                _id: req.params.notificationId,
                recipientRole: 'admin'
            }
            : {
                _id: req.params.notificationId,
                recipientRole: 'customer',
                recipientEmail: String(req.session.userEmail || '').toLowerCase()
            };

        await SiteNotification.updateOne(
            filter,
            { $set: { readAt: new Date() } }
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Could not update notification.'
        });
    }
});

// Support request submission
app.post('/support', async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            area,
            serviceType,
            preferredDate,
            preferredTime,
            details,
            remoteId,
            remotePassword,
            issue,
            requestType
        } = req.body;

        const isOnsiteEnquiry = requestType === 'onsite';

        const normalizedEmail = email
            ? String(email).toLowerCase().trim()
            : (req.session.userEmail || '');

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
            remotePassword: encryptSessionPassword(String(remotePassword || '')),
            issue: isOnsiteEnquiry
                ? String(details || issue || '').trim()
                : String(issue || '').trim(),
            status: 'Open'
        });

        if (!request.name || !request.email || !request.issue) {
            return res.status(400).send(
                'Please complete your name, email address and support details.'
            );
        }

        await request.save();

        const requestLabel = isOnsiteEnquiry
            ? 'on-site visit enquiry'
            : 'remote support ticket';

        await createSiteNotification({
            role: 'admin',
            ticket: request,
            actor: request.name || 'Customer',
            title: `New ${requestLabel}`,
            body: `${request.name || 'A customer'} submitted a ${requestLabel}.`
        });

        await sendCustomerEmail(
            process.env.SUPPORT_NOTIFICATION_EMAIL || 'bongani@itelements.co.za',
            `New ${requestLabel} from ${request.name || 'customer'}`,
            [
                `${request.name || 'A customer'} submitted a ${requestLabel}.`,
                `Email: ${normalizedEmail || 'not provided'}. Sign in to the Admin console to review it.`
            ]
        );

        await sendCustomerEmail(
            normalizedEmail,
            isOnsiteEnquiry
                ? 'We received your on-site support enquiry'
                : 'We received your support request',
            isOnsiteEnquiry
                ? [
                    `Hello ${request.name || 'there'}, we received your request for ${request.serviceType || 'on-site support'} in ${request.area || 'your area'}.`,
                    'This is an enquiry, not a confirmed appointment. We will review availability and discuss any call-out or service cost before booking.',
                    'You can follow this request in your client dashboard when you use the email address linked to your account.'
                ]
                : [
                    `Hello ${request.name || 'there'}, your support request has been received and is marked Open.`,
                    'We will review the issue and follow up. Share any temporary remote session password only when an engineer is ready to connect.'
                ]
        );

        if (isOnsiteEnquiry) {
            if (req.body.returnToDashboard === '1' && req.session.isUser) {
                return res.redirect('/dashboard?request=onsite-sent#onsite-history');
            }

            return res.redirect('/onsite-support?sent=1');
        }

        if (req.body.returnToDashboard === '1' && req.session.isUser) {
            return res.redirect('/dashboard?request=remote-sent#ticket-history');
        }

        res.send(
            '<script>alert("Ticket logged successfully into queue!");window.location.href="/dashboard";</script>'
        );
    } catch (err) {
        console.error('Support request error:', err.message);
        res.status(500).send('Database sync error.');
    }
});

// Customer account centre: only data belonging to the signed-in session is returned.
app.get('/api/client/account-data', checkUserAuth, async (req, res) => {
    try {
        const email = String(req.session.userEmail || '').toLowerCase();
        const user = await UserAccount.findOne({ email }, { password: 0 }).lean();
        if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
        const [orders, purchases, tickets, documents, cart] = await Promise.all([
            PayFastPurchase.find({ userEmail: email, purchaseType: 'storeOrder' }).select('paymentId orderDetails amount status fulfilmentStatus paidAt createdAt').sort({ createdAt: -1 }).limit(50).lean(),
            PayFastPurchase.find({ userEmail: email, purchaseType: { $ne: 'storeOrder' } }).select('paymentId purchaseType planName amount status paidAt createdAt').sort({ createdAt: -1 }).limit(50).lean(),
            SupportRequest.find({ email }, { remotePassword: 0 }).sort({ date: -1 }).limit(50).lean(),
            BusinessDocument.find({ ownerEmail: email }).select('kind number totalCents issueDate dueDate createdAt').sort({ createdAt: -1 }).limit(50).lean(),
            StoreCustomerCart.findOne({ ownerEmail: email }).select('items updatedAt').lean()
        ]);
        res.set('Cache-Control', 'no-store, private');
        res.json({ success: true, user, orders, purchases, tickets, documents, cart });
    } catch (err) {
        console.error('Customer account data error:', err.message);
        res.status(500).json({ success: false, message: 'Could not load your account.' });
    }
});

app.patch('/api/client/account-profile', checkUserAuth, async (req, res) => {
    try {
        const fullName = String(req.body.fullName || '').trim().slice(0, 100);
        const phone = String(req.body.phone || '').trim().slice(0, 30);
        if (!fullName || !phone) return res.status(400).json({ success: false, message: 'Please enter your name and phone number.' });
        const user = await UserAccount.findOneAndUpdate(
            { email: String(req.session.userEmail || '').toLowerCase() },
            { $set: { fullName, phone } },
            { new: true, runValidators: true, projection: { password: 0 } }
        );
        if (!user) return res.status(404).json({ success: false, message: 'Account not found.' });
        res.json({ success: true, user: { fullName: user.fullName, phone: user.phone, email: user.email } });
    } catch (err) {
        console.error('Customer profile update error:', err.message);
        res.status(500).json({ success: false, message: 'Could not update your profile.' });
    }
});

// Customer profile and dashboard data
app.get('/api/client/profile-data', checkUserAuth, async (req, res) => {
    try {
        const user = await UserAccount.findOne(
            { email: req.session.userEmail },
            { password: 0 }
        );

        if (
            user &&
            user.subscriptionStatus === 'Active' &&
            user.subscriptionExpiresAt &&
            user.subscriptionExpiresAt <= new Date()
        ) {
            user.subscriptionStatus = 'Expired';

            await UserAccount.updateOne(
                { _id: user._id },
                { $set: { subscriptionStatus: 'Expired' } }
            );
        }

        const tickets = await SupportRequest.find(
            { email: req.session.userEmail },
            { remotePassword: 0 }
        ).sort({ date: -1 });

        const checkout = req.query.payfastId
            ? await PayFastPurchase.findOne(
                {
                    paymentId: String(req.query.payfastId),
                    userEmail: req.session.userEmail
                },
                { userEmail: 0, __v: 0 }
            )
            : null;

        res.json({
            user,
            tickets,
            checkout
        });
    } catch (err) {
        console.error('Client profile error:', err.message);
        res.status(500).json({ error: true });
    }
});

// Customer ticket replies
app.post('/api/client/tickets/:ticketId/messages', checkUserAuth, async (req, res) => {
    const ticketId = req.params.ticketId;
    const body = String(req.body.message || '').trim();

    if (!mongoose.isValidObjectId(ticketId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid ticket.'
        });
    }

    if (body.length < 2 || body.length > 2000) {
        return res.status(400).json({
            success: false,
            message: 'Your reply must be between 2 and 2,000 characters.'
        });
    }

    try {
        const ticket = await SupportRequest.findOneAndUpdate(
            {
                _id: ticketId,
                email: req.session.userEmail
            },
            {
                $push: {
                    messages: {
                        $each: [{
                            sender: 'customer',
                            name: req.session.userName || 'Customer',
                            body,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            },
            { new: true }
        );

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found for your account.'
            });
        }

        await createSiteNotification({
            role: 'admin',
            ticket,
            actor: ticket.name || 'Customer',
            title: `New message on ${ticket.requestType === 'onsite' ? 'on-site enquiry' : 'support ticket'}`,
            body: `${ticket.name || 'A customer'} sent a new message. Sign in to read it.`
        });

        await sendCustomerEmail(
            process.env.SUPPORT_NOTIFICATION_EMAIL || 'bongani@itelements.co.za',
            `New customer reply on ticket ${ticket._id}`,
            [
                `${ticket.name || 'Customer'} (${ticket.email}) replied to a support request.`,
                'A new message is waiting in the Admin console. For privacy, the message text is not included in this email.'
            ]
        );

        res.json({
            success: true,
            messages: ticket.messages
        });
    } catch (err) {
        console.error('Customer ticket reply failed:', err.message);

        res.status(500).json({
            success: false,
            message: 'Could not send your reply. Please try again.'
        });
    }
});

// Admin ticket list
app.get('/api/tickets', checkAdminAuth, async (req, res) => {
    try {
        const tickets = await SupportRequest.find()
            .sort({ date: -1 })
            .lean();

        for (const ticket of tickets) {
            if (
                ticket.remotePassword &&
                !String(ticket.remotePassword).startsWith('enc:v1:')
            ) {
                const encrypted = encryptSessionPassword(ticket.remotePassword);

                await SupportRequest.updateOne(
                    { _id: ticket._id },
                    { $set: { remotePassword: encrypted } }
                );

                ticket.remotePassword = encrypted;
            }

            ticket.remotePassword = decryptSessionPassword(
                ticket.remotePassword
            );
        }

        res.json(tickets);
    } catch (err) {
        console.error('Admin ticket load error:', err.message);

        res.status(500).json({
            error: true,
            message: 'Could not load tickets or decrypt a stored session password. Check that SESSION_SECRET has not changed.'
        });
    }
});

// Admin ticket replies
app.post('/api/admin/tickets/:ticketId/messages', checkAdminAuth, async (req, res) => {
    const ticketId = req.params.ticketId;
    const body = String(req.body.message || '').trim();

    if (!mongoose.isValidObjectId(ticketId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid ticket.'
        });
    }

    if (body.length < 2 || body.length > 2000) {
        return res.status(400).json({
            success: false,
            message: 'Your reply must be between 2 and 2,000 characters.'
        });
    }

    try {
        const ticket = await SupportRequest.findByIdAndUpdate(
            ticketId,
            {
                $push: {
                    messages: {
                        $each: [{
                            sender: 'admin',
                            name: 'IT Elements Support',
                            body,
                            date: new Date()
                        }],
                        $slice: -100
                    }
                }
            },
            { new: true }
        );

        if (!ticket) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found.'
            });
        }

        await createSiteNotification({
            role: 'customer',
            email: ticket.email,
            ticket,
            actor: 'IT Elements Support',
            title: 'New reply from IT Elements Support',
            body: 'Your support team sent a new message. Sign in to read it.'
        });

        await sendCustomerEmail(
            ticket.email,
            'New reply from IT Elements Support',
            [
                `IT Elements Support replied to your ${ticket.requestType === 'onsite' ? 'on-site enquiry' : 'support ticket'}.`,
                'Sign in to your client dashboard to see the reply and continue the conversation. For privacy, the message text is not included in this email.'
            ]
        );

        res.json({
            success: true,
            messages: ticket.messages
        });
    } catch (err) {
        console.error('Admin ticket reply failed:', err.message);

        res.status(500).json({
            success: false,
            message: 'Could not send your reply. Please try again.'
        });
    }
});

// Update ticket status
app.post('/api/tickets/update-status', checkAdminAuth, async (req, res) => {
    const { ticketId, newStatus } = req.body;

    if (!mongoose.isValidObjectId(ticketId)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid ticket.'
        });
    }

    try {
        const current = await SupportRequest.findById(ticketId);

        if (!current) {
            return res.status(404).json({
                success: false,
                message: 'Ticket not found.'
            });
        }

        const isOnsite =
            current.requestType === 'onsite' ||
            String(current.issue || '').startsWith('ON-SITE SUPPORT ENQUIRY');

        const allowedStatuses = isOnsite
            ? ['Open', 'Contacted', 'Visit Confirmed', 'Completed', 'On Hold', 'Resolved']
            : ['Open', 'Contacted', 'Session Confirmed', 'On Hold', 'Resolved'];

        if (!allowedStatuses.includes(newStatus)) {
            return res.status(400).json({
                success: false,
                message: 'That status is not available for this request.'
            });
        }

        const update = { status: newStatus };

        if (isOnsite && newStatus === 'Visit Confirmed') {
            const visitAt = new Date(req.body.confirmedVisitAt);
            const callOutFee = Number(req.body.callOutFee);

            if (
                !req.body.confirmedVisitAt ||
                Number.isNaN(visitAt.getTime()) ||
                visitAt.getTime() < Date.now() ||
                String(req.body.callOutFee ?? '').trim() === '' ||
                !Number.isFinite(callOutFee) ||
                callOutFee < 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Enter a future confirmed visit date and time, and a call-out fee (enter 0 if there is no fee).'
                });
            }

            update.confirmedVisitAt = visitAt;
            update.callOutFee = callOutFee;
        }

        if (!isOnsite && newStatus === 'Session Confirmed') {
            const sessionAt = new Date(req.body.confirmedVisitAt);

            if (
                !req.body.confirmedVisitAt ||
                Number.isNaN(sessionAt.getTime()) ||
                sessionAt.getTime() < Date.now()
            ) {
                return res.status(400).json({
                    success: false,
                    message: 'Enter a future confirmed support session date and time.'
                });
            }

            update.confirmedVisitAt = sessionAt;
        }

        if (['Completed', 'Resolved'].includes(newStatus)) {
            update.remotePassword = '';
        }

        const updated = await SupportRequest.findByIdAndUpdate(
            ticketId,
            { $set: update },
            { new: true }
        );

        if (
            (current.status !== newStatus ||
                newStatus === 'Visit Confirmed' ||
                newStatus === 'Session Confirmed') &&
            updated.email
        ) {
            await createSiteNotification({
                role: 'customer',
                email: updated.email,
                ticket: updated,
                actor: 'IT Elements Support',
                title: `Request status: ${newStatus}`,
                body: `Your ${isOnsite ? 'on-site enquiry' : 'support ticket'} is now ${newStatus}.`
            });

            await sendCustomerEmail(
                updated.email,
                `Your IT Elements request is now ${newStatus}`,
                [
                    `Hello ${updated.name || 'there'}, the status of your ${isOnsite ? 'on-site enquiry' : 'support ticket'} is now ${newStatus}.`,
                    isOnsite && newStatus === 'Visit Confirmed'
                        ? `Your visit is confirmed for ${updated.confirmedVisitAt.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Call-out fee: R${Number(updated.callOutFee || 0).toFixed(2)}. Please sign in to your client dashboard for these details.`
                        : !isOnsite && newStatus === 'Session Confirmed'
                            ? `Your remote support session is confirmed for ${updated.confirmedVisitAt.toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })}. Sign in to your client dashboard to view the appointment.`
                            : 'Sign in to your client dashboard to follow your request.'
                ]
            );
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Ticket status update error:', err.message);

        res.status(500).json({
            success: false,
            message: 'Could not update ticket status.'
        });
    }
});

// Public reviews
app.get('/api/reviews', async (req, res) => {
    try {
        const reviews = await CustomerReview.find(
            {
                status: 'Published',
                consent: true
            },
            {
                email: 0,
                consent: 0,
                status: 0
            }
        )
            .sort({ date: -1 })
            .limit(12)
            .lean();

        res.json({ reviews });
    } catch (err) {
        console.error('Load reviews error:', err.message);
        res.status(500).json({ reviews: [] });
    }
});

// Review submission rate limiting
const reviewSubmissionBuckets = new Map();

app.post('/api/reviews', async (req, res) => {
    const bucketKey = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const bucket = reviewSubmissionBuckets.get(bucketKey);

    if (
        bucket &&
        now - bucket.startedAt < 60 * 60 * 1000 &&
        bucket.count >= 3
    ) {
        return res.status(429).json({
            success: false,
            message: 'Please wait before submitting more feedback.'
        });
    }

    if (!bucket || now - bucket.startedAt >= 60 * 60 * 1000) {
        reviewSubmissionBuckets.set(bucketKey, {
            startedAt: now,
            count: 1
        });
    } else {
        bucket.count += 1;
    }

    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const message = String(req.body.message || '').trim();
    const rating = Number(req.body.rating);

    if (
        name.length < 2 ||
        name.length > 100 ||
        message.length < 10 ||
        message.length > 1200 ||
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5 ||
        req.body.consent !== true
    ) {
        return res.status(400).json({
            success: false,
            message: 'Add your name, a 1–5 rating, feedback of at least 10 characters, and permission to publish it.'
        });
    }

    try {
        await CustomerReview.create({
            name,
            email,
            rating,
            message,
            consent: true,
            status: 'Pending'
        });

        await sendCustomerEmail(
            email,
            'Thank you for your feedback',
            [
                'Thank you for sharing feedback with IT Elements. Your review is awaiting approval and will only appear publicly after it is reviewed.'
            ]
        );

        res.json({
            success: true,
            message: 'Thank you. Your feedback has been sent for review and will not be published until approved.'
        });
    } catch (err) {
        console.error('Review submission error:', err.message);

        res.status(500).json({
            success: false,
            message: 'Could not save your feedback. Please try again.'
        });
    }
});

// Admin reviews
app.get('/api/admin/reviews', checkAdminAuth, async (req, res) => {
    try {
        const reviews = await CustomerReview.find()
            .sort({ date: -1 })
            .lean();

        res.json(reviews);
    } catch (err) {
        res.status(500).json({
            error: true,
            message: 'Could not load customer feedback.'
        });
    }
});

app.post('/api/admin/reviews/update-status', checkAdminAuth, async (req, res) => {
    const { reviewId, status } = req.body;

    if (
        !mongoose.isValidObjectId(reviewId) ||
        !['Published', 'Hidden'].includes(status)
    ) {
        return res.status(400).json({
            success: false,
            message: 'Invalid review or status.'
        });
    }

    try {
        const review = await CustomerReview.findByIdAndUpdate(
            reviewId,
            { status },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({
                success: false,
                message: 'Review not found.'
            });
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: 'Could not update the review.'
        });
    }
});

// Reset a customer's subscription from Admin
app.post('/api/admin/subscriptions/reset', checkAdminAuth, async (req, res) => {
    const userId = String(req.body.userId || '');

    if (!mongoose.isValidObjectId(userId)) {
        return res.status(400).json({
            success: false,
            message: 'Choose a valid customer account.'
        });
    }

    try {
        const user = await UserAccount.findByIdAndUpdate(
            userId,
            {
                $set: {
                    subscriptionTier: 'None (Unpaid)',
                    subscriptionStatus: 'Inactive',
                    subscriptionPaidAt: null,
                    subscriptionExpiresAt: null
                }
            },
            {
                new: true,
                projection: { password: 0 }
            }
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'Customer account not found.'
            });
        }

        return res.json({ success: true });
    } catch (err) {
        console.error('Admin subscription reset error:', err.message);

        return res.status(500).json({
            success: false,
            message: 'Could not reset this customer plan.'
        });
    }
});

// Admin dashboard overview
app.get('/api/admin/overview-data', checkAdminAuth, async (req, res) => {
    try {
        const now = new Date();

        await UserAccount.updateMany(
            {
                subscriptionStatus: 'Active',
                subscriptionExpiresAt: { $lte: now }
            },
            {
                $set: { subscriptionStatus: 'Expired' }
            }
        );

        const [users, tickets, payfastRevenueRows] = await Promise.all([
            UserAccount.find(
                {},
                { password: 0 }
            )
                .sort({ fullName: 1 })
                .lean(),

            SupportRequest.find(
                {},
                { remotePassword: 0 }
            ).lean(),

            PayFastPurchase.aggregate([
                {
                    $match: {
                        status: 'paid',
                        mode: 'live',
                        purchaseType: 'plan'
                    }
                },
                {
                    $group: {
                        _id: null,
                        cents: { $sum: '$amount' },
                        count: { $sum: 1 }
                    }
                }
            ])
        ]);

        const activeSubscribers = users.filter(
            user => user.subscriptionStatus === 'Active'
        );

        const inactiveUsers = users.filter(
            user => user.subscriptionStatus !== 'Active'
        );

        const activeTickets = tickets.filter(
            ticket => !['Resolved', 'Completed'].includes(ticket.status)
        ).length;

        const confirmedPlanRevenue =
            (payfastRevenueRows[0]?.cents || 0) / 100;

        const confirmedPaymentCount =
            payfastRevenueRows[0]?.count || 0;

        res.json({
            users,
            activeSubscribers,
            inactiveUsers,
            stats: {
                activeTickets,
                activeSubscribers: activeSubscribers.length,
                inactiveUsers: inactiveUsers.length,
                confirmedPlanRevenue,
                confirmedPlanPayments: confirmedPaymentCount
            }
        });
    } catch (err) {
        console.error('Admin overview error:', err.message);

        res.status(500).json({
            error: true,
            message: 'Could not load admin overview.'
        });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`🚀 PRODUCTION ENGINE ACTIVE ON PORT ${PORT}`);
});
