const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
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

    if (!/^\d{8}$/.test(merchantId) || merchantKey.length !== 13 || !['live', 'test'].includes(mode)) {
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
    subscriptionExpiresAt: { type: Date, default: null },
    invoiceProUntil: { type: Date, default: null }
}, { collection: 'useraccounts' }));

const PayFastPurchase = mongoose.model('PayFastPurchase', new mongoose.Schema({
    paymentId: { type: String, required: true, unique: true },
    userEmail: { type: String, default: '', lowercase: true, trim: true },
    purchaseType: { type: String, enum: ['plan', 'quickfix', 'invoicePro'], required: true },
    planId: { type: String, default: '' },
    planName: { type: String, default: '' },
    durationOption: { type: String, default: '' },
    amount: { type: Number, required: true },
    mode: { type: String, enum: ['test', 'live'], default: 'live' },
    status: { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
    createdAt: { type: Date, default: Date.now },
    paidAt: { type: Date, default: null }
}, { collection: 'payfastpurchases' }));

const BusinessDocument = mongoose.model('BusinessDocument', new mongoose.Schema({
    userEmail: { type: String, required: true, lowercase: true, trim: true },
    documentType: { type: String, default: 'invoice' },
    documentNumber: { type: String, default: '' },
    customerName: { type: String, default: '' },
    customerEmail: { type: String, default: '' },
    documentData: { type: mongoose.Schema.Types.Mixed, default: {} },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'businessdocuments' }));

const PasswordReset = mongoose.model('PasswordReset', new mongoose.Schema({
    email: { type: String, required: true, lowercase: true, trim: true },
    tokenHash: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'passwordresets' }));

const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, default: '' },
    requestType: { type: String, default: 'support' },
    serviceType: { type: String, default: '' },
    area: { type: String, default: '' },
    preferredDate: { type: String, default: '' },
    preferredTime: { type: String, default: '' },
    issue: { type: String, default: '' },
    details: { type: String, default: '' },
    remoteId: { type: String, default: '' },
    remotePassword: { type: String, default: '' },
    status: { type: String, default: 'New' },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

const SiteNotification = mongoose.model('SiteNotification', new mongoose.Schema({
    userEmail: { type: String, default: '' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
}, { collection: 'sitenotifications' }));

const CustomerReview = mongoose.model('CustomerReview', new mongoose.Schema({
    name: { type: String, required: true, maxlength: 100 },
    email: { type: String, default: '' },
    rating: { type: Number, required: true, min: 1, max: 5 },
    message: { type: String, required: true, maxlength: 1200 },
    consent: { type: Boolean, required: true, default: false },
    status: { type: String, enum: ['Pending', 'Published', 'Hidden'], default: 'Pending' },
    date: { type: Date, default: Date.now }
}, { collection: 'customerreviews' }));

// Middleware
app.use(cors());
app.use(express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
        req.rawBody = Buffer.from(buf);
    }
}));
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = Buffer.from(buf);
    }
}));

app.use(session({
    secret: process.env.SESSION_SECRET || 'change-this-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use(express.static(viewsPath, { index: false }));

// Helpers
function normaliseEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function safeText(value, maxLength = 2000) {
    return String(value || '').trim().slice(0, maxLength);
}

function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) {
        return next();
    }

    return res.status(401).json({
        error: true,
        message: 'Administrator authentication required.'
    });
}

function checkUserAuth(req, res, next) {
    if (req.session && req.session.userEmail) {
        return next();
    }

    return res.status(401).json({
        error: true,
        message: 'Please sign in to continue.'
    });
}

function createPasswordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, key) => {
            if (err) return reject(err);
            resolve(`${salt}:${key.toString('hex')}`);
        });
    });
}

async function verifyPassword(password, storedHash) {
    try {
        const [salt, hash] = String(storedHash || '').split(':');
        if (!salt || !hash) return false;

        const derivedKey = await scryptAsync(password, salt, 64);
        const storedKey = Buffer.from(hash, 'hex');

        return storedKey.length === derivedKey.length &&
            crypto.timingSafeEqual(storedKey, derivedKey);
    } catch (error) {
        return false;
    }
}

function getBaseUrl() {
    return String(process.env.PUBLIC_BASE_URL || 'https://www.itelements.help').replace(/\/+$/, '');
}

function sendPage(res, filename) {
    return res.sendFile(path.join(viewsPath, filename));
}

// Page routes
app.get('/', (req, res) => sendPage(res, 'index.html'));
app.get('/pricing', (req, res) => sendPage(res, 'pricing.html'));
app.get('/services', (req, res) => sendPage(res, 'services.html'));
app.get('/onsite-support', (req, res) => sendPage(res, 'onsite-support.html'));

// FIX: Reviews page route
app.get(['/reviews', '/reviews/', '/reviews.html'], (req, res) => {
    return sendPage(res, 'reviews.html');
});

// FIX: Business Support page route
app.get(['/business-support', '/business-support/', '/business-support.html'], (req, res) => {
    return sendPage(res, 'business-support.html');
});

app.get('/about', (req, res) => sendPage(res, 'about.html'));
app.get('/faq', (req, res) => sendPage(res, 'faq.html'));
app.get('/contact', (req, res) => sendPage(res, 'contact.html'));

// Subscription page aliases
app.get('/subscribe/:planId', (req, res) => {
    const planId = String(req.params.planId || '').toLowerCase();
    const plan = SLA_PLANS[planId];

    if (!plan) {
        return res.status(404).send('Subscription plan not found.');
    }

    return res.redirect(`/pricing?plan=${encodeURIComponent(planId)}`);
});

// Authentication and account routes
app.post('/api/register', async (req, res) => {
    try {
        const fullName = safeText(req.body.fullName, 120);
        const phone = safeText(req.body.phone, 40);
        const email = normaliseEmail(req.body.email);
        const password = String(req.body.password || '');

        if (!fullName || !phone || !email || password.length < 8) {
            return res.status(400).json({
                error: true,
                message: 'Please complete all fields. Your password must contain at least 8 characters.'
            });
        }

        const existing = await UserAccount.findOne({ email });

        if (existing) {
            return res.status(409).json({
                error: true,
                message: 'An account with this email address already exists.'
            });
        }

        const passwordHash = await createPasswordHash(password);

        const user = await UserAccount.create({
            fullName,
            phone,
            email,
            password: passwordHash
        });

        req.session.userEmail = user.email;
        req.session.userName = user.fullName;

        return res.json({
            success: true,
            message: 'Your account has been created successfully.'
        });
    } catch (err) {
        console.error('Registration error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not create your account.'
        });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const email = normaliseEmail(req.body.email);
        const password = String(req.body.password || '');

        const user = await UserAccount.findOne({ email });

        if (!user || !(await verifyPassword(password, user.password))) {
            return res.status(401).json({
                error: true,
                message: 'Incorrect email address or password.'
            });
        }

        req.session.userEmail = user.email;
        req.session.userName = user.fullName;

        return res.json({
            success: true,
            message: 'You have signed in successfully.'
        });
    } catch (err) {
        console.error('Login error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Unable to sign in right now.'
        });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

app.get('/api/client/profile-data', checkUserAuth, async (req, res) => {
    try {
        const user = await UserAccount.findOne(
            { email: req.session.userEmail },
            { password: 0 }
        ).lean();

        if (!user) {
            return res.status(404).json({
                error: true,
                message: 'Account not found.'
            });
        }

        return res.json({ user });
    } catch (err) {
        console.error('Profile data error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not load your profile.'
        });
    }
});

// Support request submission
app.post('/support', async (req, res) => {
    try {
        const name = safeText(req.body.name, 120);
        const email = normaliseEmail(req.body.email);
        const phone = safeText(req.body.phone, 40);
        const requestType = safeText(req.body.requestType || 'support', 40);
        const serviceType = safeText(req.body.serviceType, 150);
        const area = safeText(req.body.area, 150);
        const preferredDate = safeText(req.body.preferredDate, 40);
        const preferredTime = safeText(req.body.preferredTime, 40);
        const issue = safeText(req.body.issue, 3000);
        const details = safeText(req.body.details, 3000);
        const remoteId = safeText(req.body.remoteId, 100);
        const remotePassword = safeText(req.body.remotePassword, 100);

        if (!name || !email || (!issue && !details)) {
            return res.status(400).send('Please complete the required fields.');
        }

        const request = await SupportRequest.create({
            name,
            email,
            phone,
            requestType,
            serviceType,
            area,
            preferredDate,
            preferredTime,
            issue,
            details,
            remoteId,
            remotePassword
        });

        await SiteNotification.create({
            userEmail: email,
            title: 'Support request received',
            message: `Your support request ${request._id} has been received.`
        });

        console.log('New support request:', request._id);

        return res.redirect('/?support=sent');
    } catch (err) {
        console.error('Support request error:', err.message);
        return res.status(500).send('We could not submit your support request. Please try again.');
    }
});

// Customer reviews
app.get('/api/reviews', async (req, res) => {
    try {
        const reviews = await CustomerReview.find({
            status: 'Published',
            consent: true
        })
            .select('name rating message date')
            .sort({ date: -1 })
            .lean();

        return res.json({ reviews });
    } catch (err) {
        console.error('Load reviews error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not load reviews.'
        });
    }
});

app.post('/api/reviews', async (req, res) => {
    try {
        const name = safeText(req.body.name, 100);
        const email = normaliseEmail(req.body.email);
        const rating = Number(req.body.rating);
        const message = safeText(req.body.message, 1200);
        const consent = req.body.consent === true;

        if (name.length < 2 || message.length < 10 || !Number.isInteger(rating) ||
            rating < 1 || rating > 5 || !consent) {
            return res.status(400).json({
                error: true,
                message: 'Please provide your name, a rating, a review of at least 10 characters, and permission to publish it.'
            });
        }

        const recentReviews = await CustomerReview.countDocuments({
            email,
            date: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
        });

        if (email && recentReviews >= 3) {
            return res.status(429).json({
                error: true,
                message: 'You have submitted the maximum number of reviews for this hour.'
            });
        }

        await CustomerReview.create({
            name,
            email,
            rating,
            message,
            consent,
            status: 'Pending'
        });

        return res.json({
            success: true,
            message: 'Thank you. Your review has been submitted for approval.'
        });
    } catch (err) {
        console.error('Review submission error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not submit your review.'
        });
    }
});

app.get('/api/admin/reviews', checkAdminAuth, async (req, res) => {
    try {
        const reviews = await CustomerReview.find({})
            .select('-email')
            .sort({ date: -1 })
            .lean();

        return res.json({ reviews });
    } catch (err) {
        console.error('Admin reviews error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not load reviews.'
        });
    }
});

app.post('/api/admin/reviews/update-status', checkAdminAuth, async (req, res) => {
    try {
        const reviewId = safeText(req.body.reviewId, 100);
        const status = safeText(req.body.status, 20);

        if (!mongoose.isValidObjectId(reviewId) || !['Published', 'Hidden'].includes(status)) {
            return res.status(400).json({
                error: true,
                message: 'Invalid review or status.'
            });
        }

        const review = await CustomerReview.findByIdAndUpdate(
            reviewId,
            { $set: { status } },
            { new: true }
        );

        if (!review) {
            return res.status(404).json({
                error: true,
                message: 'Review not found.'
            });
        }

        return res.json({
            success: true,
            message: `Review ${status.toLowerCase()} successfully.`
        });
    } catch (err) {
        console.error('Update review status error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not update review status.'
        });
    }
});

// Client tickets
app.get('/api/tickets', checkUserAuth, async (req, res) => {
    try {
        const tickets = await SupportRequest.find({
            email: req.session.userEmail
        })
            .select('-remotePassword')
            .sort({ createdAt: -1 })
            .lean();

        return res.json({ tickets });
    } catch (err) {
        console.error('Tickets error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not load your support requests.'
        });
    }
});

app.post('/api/tickets/update-status', checkAdminAuth, async (req, res) => {
    try {
        const ticketId = safeText(req.body.ticketId, 100);
        const status = safeText(req.body.status, 40);

        if (!mongoose.isValidObjectId(ticketId)) {
            return res.status(400).json({
                error: true,
                message: 'Invalid support request.'
            });
        }

        const ticket = await SupportRequest.findByIdAndUpdate(
            ticketId,
            { $set: { status } },
            { new: true }
        ).select('-remotePassword');

        if (!ticket) {
            return res.status(404).json({
                error: true,
                message: 'Support request not found.'
            });
        }

        return res.json({ success: true, ticket });
    } catch (err) {
        console.error('Ticket status update error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not update support request.'
        });
    }
});

// Client notifications
app.get('/api/client/notifications', checkUserAuth, async (req, res) => {
    try {
        const notifications = await SiteNotification.find({
            userEmail: req.session.userEmail
        }).sort({ createdAt: -1 }).lean();

        return res.json({ notifications });
    } catch (err) {
        console.error('Notifications error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not load notifications.'
        });
    }
});

// Business documents
app.get('/api/business-documents', checkUserAuth, async (req, res) => {
    try {
        const documents = await BusinessDocument.find({
            userEmail: req.session.userEmail
        }).sort({ createdAt: -1 }).lean();

        return res.json({ documents });
    } catch (err) {
        console.error('Business documents error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not load business documents.'
        });
    }
});

app.post('/api/business-documents', checkUserAuth, async (req, res) => {
    try {
        const document = await BusinessDocument.create({
            userEmail: req.session.userEmail,
            documentType: safeText(req.body.documentType || 'invoice', 40),
            documentNumber: safeText(req.body.documentNumber, 100),
            customerName: safeText(req.body.customerName, 150),
            customerEmail: normaliseEmail(req.body.customerEmail),
            documentData: req.body.documentData || {}
        });

        return res.json({
            success: true,
            document
        });
    } catch (err) {
        console.error('Save business document error:', err.message);
        return res.status(500).json({
            error: true,
            message: 'Could not save business document.'
        });
    }
});

// Invoice pages
app.get('/tools/invoices', (req, res) => {
    return sendPage(res, 'invoice-maker.html');
});

app.get('/invoice-maker.html', checkUserAuth, (req, res) => {
    return sendPage(res, 'invoice-maker.html');
});

// PayFast helpers
function createPayFastSignature(data, passphrase = '') {
    const cryptoData = Object.keys(data)
        .filter(key => data[key] !== undefined && data[key] !== null && data[key] !== '')
        .map(key => `${key}=${encodeURIComponent(String(data[key]).trim()).replace(/%20/g, '+')}`)
        .join('&');

    const signatureData = passphrase
        ? `${cryptoData}&passphrase=${encodeURIComponent(passphrase.trim()).replace(/%20/g, '+')}`
        : cryptoData;

    return crypto.createHash('md5').update(signatureData).digest('hex');
}

function buildPayFastForm(data) {
    const config = payfastConfig();

    if (!config) {
        throw new Error('PayFast is not configured correctly. Check your Render environment variables.');
    }

    const payload = {
        merchant_id: config.merchantId,
        merchant_key: config.merchantKey,
        ...data
    };

    const passphrase = String(process.env.PAYFAST_PASSPHRASE || '').trim();

    if (passphrase) {
        payload.signature = createPayFastSignature(payload, passphrase);
    } else {
        payload.signature = createPayFastSignature(payload);
    }

    const fields = Object.entries(payload)
        .map(([key, value]) => `<input type="hidden" name="${key}" value="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`)
        .join('');

    return `<!doctype html><html><head><meta charset="utf-8"><title>Redirecting to PayFast</title></head><body><form id="payfast" action="${config.endpoint}" method="post">${fields}</form><script>document.getElementById('payfast').submit();</script></body></html>`;
}

async function createPendingPurchase(data) {
    return PayFastPurchase.create({
        paymentId: randomUUID(),
        userEmail: data.userEmail || '',
        purchaseType: data.purchaseType,
        planId: data.planId || '',
        planName: data.planName || '',
        durationOption: data.durationOption || '',
        amount: data.amount,
        mode: payfastConfig()?.mode || 'live',
        status: 'pending'
    });
}

// Quick fix checkout
app.post('/api/payment/payfast-quickfix', async (req, res) => {
    try {
        const durationOption = safeText(req.body.durationOption, 30);
        const option = QUICK_FIX_OPTIONS[durationOption];

        if (!option) {
            return res.status(400).send('Invalid support session option.');
        }

        const purchase = await createPendingPurchase({
            purchaseType: 'quickfix',
            durationOption,
            planName: option.label,
            amount: option.amount,
            userEmail: req.session.userEmail || ''
        });

        const baseUrl = getBaseUrl();

        return res.send(buildPayFastForm({
            amount: (option.amount / 100).toFixed(2),
            item_name: option.label,
            item_description: option.label,
            m_payment_id: purchase.paymentId,
            return_url: `${baseUrl}/payment/success`,
            cancel_url: `${baseUrl}/payment/cancel`,
            notify_url: `${baseUrl}/webhooks/payfast`
        }));
    } catch (err) {
        console.error('Quick fix checkout error:', err.message);
        return res.status(500).send('Unable to start payment. Please try again.');
    }
});

// Subscription checkout
app.post('/api/payment/payfast-plan-checkout', checkUserAuth, async (req, res) => {
    try {
        const planId = safeText(req.body.planId, 50).toLowerCase();
        const plan = SLA_PLANS[planId];

        if (!plan) {
            return res.status(400).send('Invalid subscription plan.');
        }

        const purchase = await createPendingPurchase({
            purchaseType: 'plan',
            planId,
            planName: plan.name,
            amount: plan.amount,
            userEmail: req.session.userEmail
        });

        const baseUrl = getBaseUrl();

        return res.send(buildPayFastForm({
            amount: (plan.amount / 100).toFixed(2),
            item_name: plan.name,
            item_description: plan.name,
            m_payment_id: purchase.paymentId,
            email_address: req.session.userEmail,
            return_url: `${baseUrl}/payment/success`,
            cancel_url: `${baseUrl}/payment/cancel`,
            notify_url: `${baseUrl}/webhooks/payfast`
        }));
    } catch (err) {
        console.error('Plan checkout error:', err.message);
        return res.status(500).send('Unable to start subscription payment.');
    }
});

// Invoice Pro checkout
app.post('/api/payment/payfast-invoice-checkout', checkUserAuth, async (req, res) => {
    try {
        const amount = 9900;

        const purchase = await createPendingPurchase({
            purchaseType: 'invoicePro',
            planName: 'Invoice Studio Pro',
            amount,
            userEmail: req.session.userEmail
        });

        const baseUrl = getBaseUrl();

        return res.send(buildPayFastForm({
            amount: (amount / 100).toFixed(2),
            item_name: 'Invoice Studio Pro',
            item_description: 'Invoice Studio Pro access',
            m_payment_id: purchase.paymentId,
            email_address: req.session.userEmail,
            return_url: `${baseUrl}/payment/success`,
            cancel_url: `${baseUrl}/payment/cancel`,
            notify_url: `${baseUrl}/webhooks/payfast`
        }));
    } catch (err) {
        console.error('Invoice Pro checkout error:', err.message);
        return res.status(500).send('Unable to start payment.');
    }
});

// PayFast ITN verification
app.post('/webhooks/payfast', async (req, res) => {
    try {
        const config = payfastConfig();

        if (!config) {
            return res.status(500).send('PayFast is not configured.');
        }

        const body = req.body || {};
        const paymentId = safeText(body.m_payment_id, 100);

        if (!paymentId) {
            return res.status(400).send('Missing payment ID.');
        }

        const purchase = await PayFastPurchase.findOne({ paymentId });

        if (!purchase || purchase.status === 'paid') {
            return res.status(200).send('OK');
        }

        if (purchase.mode !== config.mode) {
            return res.status(400).send('Payment mode mismatch.');
        }

        const validationResponse = await fetch(config.validateUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(body).toString()
        });

        const validationText = (await validationResponse.text()).trim();

        if (!validationResponse.ok || validationText !== 'VALID') {
            return res.status(400).send('PayFast validation failed.');
        }

        const expectedAmount = (purchase.amount / 100).toFixed(2);
        const receivedAmount = Number(body.amount_gross).toFixed(2);

        if (expectedAmount !== receivedAmount) {
            return res.status(400).send('Payment amount mismatch.');
        }

        if (body.payment_status !== 'COMPLETE') {
            return res.status(200).send('Payment not complete.');
        }

        purchase.status = 'paid';
        purchase.paidAt = new Date();
        await purchase.save();

        if (purchase.purchaseType === 'plan' && purchase.userEmail) {
            const user = await UserAccount.findOne({ email: purchase.userEmail });

            if (user) {
                const now = new Date();
                const expiry = new Date(now);
                expiry.setMonth(expiry.getMonth() + 1);

                user.subscriptionTier = purchase.planName;
                user.subscriptionStatus = 'Active';
                user.subscriptionPaidAt = now;
                user.subscriptionExpiresAt = expiry;

                await user.save();
            }
        }

        if (purchase.purchaseType === 'invoicePro' && purchase.userEmail) {
            const user = await UserAccount.findOne({ email: purchase.userEmail });

            if (user) {
                const expiry = new Date();
                expiry.setMonth(expiry.getMonth() + 1);
                user.invoiceProUntil = expiry;
                await user.save();
            }
        }

        return res.status(200).send('OK');
    } catch (err) {
        console.error('PayFast ITN error:', err.message);
        return res.status(500).send('Payment notification error.');
    }
});

// Payment return pages
app.get('/payment/success', (req, res) => {
    return res.redirect('/dashboard?payment=returned');
});

app.get('/payment/cancel', (req, res) => {
    return res.redirect('/pricing?payment=cancelled');
});

// Admin login
app.post('/api/admin/login', (req, res) => {
    const password = String(req.body.password || '');
    const adminPassword = String(process.env.ADMIN_PASSWORD || '');

    if (!adminPassword || password !== adminPassword) {
        return res.status(401).json({
            error: true,
            message: 'Incorrect administrator password.'
        });
    }

    req.session.isAdmin = true;

    return res.json({
        success: true,
        message: 'Administrator signed in.'
    });
});

app.post('/api/admin/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// Admin dashboard data
app.get('/api/admin/overview-data', checkAdminAuth, async (req, res) => {
    try {
        const now = new Date();

        await UserAccount.updateMany(
            { subscriptionStatus: 'Active', subscriptionExpiresAt: { $lte: now } },
            { $set: { subscriptionStatus: 'Expired' } }
        );

        const [users, tickets, payfastRevenueRows] = await Promise.all([
            UserAccount.find({}, { password: 0 }).sort({ fullName: 1 }).lean(),
            SupportRequest.find({}, { remotePassword: 0 }).lean(),
            PayFastPurchase.aggregate([
                { $match: { status: 'paid', mode: 'live', purchaseType: 'plan' } },
                { $group: { _id: null, cents: { $sum: '$amount' }, count: { $sum: 1 } } }
            ])
        ]);

        const activeSubscribers = users.filter(user => user.subscriptionStatus === 'Active');
        const inactiveUsers = users.filter(user => user.subscriptionStatus !== 'Active');
        const activeTickets = tickets.filter(ticket =>
            !['Resolved', 'Completed'].includes(ticket.status)
        ).length;

        const confirmedPlanRevenue = (payfastRevenueRows[0]?.cents || 0) / 100;
        const confirmedPaymentCount = payfastRevenueRows[0]?.count || 0;

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

app.listen(PORT, () => {
    console.log(`🚀 PRODUCTION ENGINE ACTIVE ON PORT ${PORT}`);
});
