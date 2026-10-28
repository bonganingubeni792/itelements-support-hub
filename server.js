const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const { randomUUID } = require('crypto');
const fs = require('fs');

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
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String,
    email: String,
    remoteId: String,
    remotePassword: String,
    issue: String,
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

app.use(cors());
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.yoco.com https://*.yoco.co.za; img-src 'self' data: https://*.whatsapp.com; connect-src 'self' https://*.yoco.co.za https://*.yoco.com");
    next();
});
app.use(express.urlencoded({ extended: true }));
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

app.get('/', (req, res) => res.sendFile(path.join(viewsPath, 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(viewsPath, 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(viewsPath, 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(viewsPath, 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(viewsPath, 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(viewsPath, 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(viewsPath, 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(viewsPath, 'admin.html')));

// Yoco Checkout API: create a hosted checkout on the server. The browser never
// receives the secret key, and the amount is calculated here from allowed hours.
app.post('/api/payment/yoco-checkout', async (req, res) => {
    const secretKey = process.env.YOCO_SECRET_KEY;
    if (!secretKey || !secretKey.startsWith('sk_test_')) {
        return res.status(503).json({ success: false, message: 'Set a valid Yoco TEST secret key in the server environment.' });
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

// Keep old clients from submitting fake browser-generated card tokens.
app.post('/api/payment/yoco-charge', (req, res) => {
    res.status(410).json({ success: false, message: 'Direct card charges are no longer supported. Use the hosted Yoco checkout.' });
});

app.post('/client/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;
        if (!fullName || !phone || !email || !password) return res.send('<script>alert("All fields required.");window.history.back();</script>');
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) return res.send('<script>alert("Email already registered.");window.history.back();</script>');
        const newUser = new UserAccount({ fullName: fullName.trim(), phone: phone.trim(), email: normalizedEmail, password });
        await newUser.save();
        req.session.isUser = true;
        req.session.userEmail = newUser.email;
        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');
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
        if (user && user.password === password) {
            req.session.isUser = true;
            req.session.userEmail = user.email;
            return res.send('<script>window.location.href="/dashboard";</script>');
        }
        res.send('<script>alert("Invalid credentials.");window.history.back();</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/admin/logout', (req, res) => { req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/client/login'); }); });
app.get('/client/logout', (req, res) => { req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/client/login'); }); });

app.post('/support', async (req, res) => {
    try {
        const { name, email, remoteId, remotePassword, issue } = req.body;
        await new SupportRequest({ name, email: email ? email.toLowerCase().trim() : (req.session.userEmail || ''), remoteId, remotePassword, issue, status: 'Open' }).save();
        res.send('<script>alert("Ticket logged successfully into queue!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send('Database sync error.'); }
});

app.get('/api/client/profile-data', checkUserAuth, async (req, res) => {
    try {
        const user = await UserAccount.findOne({ email: req.session.userEmail }, { password: 0 });
        const tickets = await SupportRequest.find({ email: req.session.userEmail }).sort({ date: -1 });
        res.json({ user, tickets });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/tickets', checkAdminAuth, async (req, res) => {
    try { res.json(await SupportRequest.find().sort({ date: -1 })); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/tickets/update-status', checkAdminAuth, async (req, res) => {
    try { await SupportRequest.findByIdAndUpdate(req.body.ticketId, { status: req.body.newStatus }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/admin/overview-data', checkAdminAuth, async (req, res) => {
    try { res.json({ users: await UserAccount.find({}, { password: 0 }), hourlyBookings: [] }); } catch (err) { res.status(500).json({ error: true }); }
});

app.listen(PORT, () => { console.log(`🚀 PRODUCTION ENGINE ACTIVE ON PORT ${PORT}`); });
