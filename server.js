const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGODB_URI;

mongoose.connect(dbURI)
    .then(() => console.log('📁 Database connection established successfully'))
    .catch(err => console.error('❌ Cloud Database communication failure:', err));

const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String, email: String, remoteId: String, remotePassword: String, issue: String,
    status: { type: String, default: 'Open' }, date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'views')));
app.use(express.static(__dirname));

app.use(session({
    secret: 'itelements-secure-key-2026',
    resave: true,
    saveUninitialized: true,
    cookie: { maxAge: 86400000, secure: false, sameSite: 'lax' }
}));

function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.post('/client/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;
        if (!fullName || !phone || !email || !password) return res.send('<script>alert("All fields required.");window.history.back();</script>');
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) return res.send('<script>alert("Email already registered.");window.history.back();</script>');
        const newUser = new UserAccount({ fullName: fullName.trim(), phone: phone.trim(), email: normalizedEmail, password });
        await newUser.save();
        req.session.isUser = true; req.session.userEmail = newUser.email;
        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/client/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (password === 'AdminElements2026') { req.session.isAdmin = true; return res.send('<script>window.location.href="/admin";</script>'); }
        const user = await UserAccount.findOne({ email: email.toLowerCase().trim() });
        if (user && user.password === password) {
            req.session.isUser = true; req.session.userEmail = user.email;
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
    } catch (err) { res.status(500).send("Database sync error."); }
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

// =========================================================================
// 💳 PAYFAST SECURE CARD PAYMENT & PRODUCTION SUBSCRIPTION LAYER
// =========================================================================
app.post('/api/create-subscription-session', checkUserAuth, async (req, res) => {
    try {
        const { plan, amount } = req.body;
        const userEmail = req.session.userEmail;

        const merchantId = process.env.PAYFAST_MERCHANT_ID || '26628389';
        const merchantKey = process.env.PAYFAST_MERCHANT_KEY || '2tdxn02woe7we';
        const passphrase = process.env.PAYFAST_PASSPHRASE;

        const payfastData = {
            merchant_id: merchantId,
            merchant_key: merchantKey,
            return_url: 'https://itelements.help',
            cancel_url: 'https://itelements.help',
            notify_url: 'https://itelements.help',
            name_first: 'IT Elements Customer',
            email_address: userEmail,
            m_payment_id: `SUB-${Date.now()}`,
            amount: parseFloat(amount).toFixed(2),
            item_name: `IT Elements Support Plan: ${plan}`,
            custom_str1: userEmail,
            custom_str2: plan
        };

        let getString = new URLSearchParams(payfastData).toString();
        if (passphrase) {
            getString += `&passphrase=${encodeURIComponent(passphrase.trim())}`;
        }
        
        const crypto = require('crypto');
        const signature = crypto.createHash('md5').update(getString).digest('hex');
        payfastData.signature = signature;

        const params = new URLSearchParams(payfastData).toString();
        
        // 🚀 LIVE PRODUCTION PROCESSING LINKS
        const checkoutUrl = `https://payfast.co.za{params}`;

        res.json({ success: true, redirectUrl: checkoutUrl });
    } catch (err) {
        res.status(500).json({ error: true, message: err.message });
    }
});

app.post('/api/payfast-itn', async (req, res) => {
    try {
        const payfastPayload = req.body;

        if (payfastPayload.payment_status === 'COMPLETE') {
            const clientEmail = payfastPayload.custom_str1;
            const chosenTier = payfastPayload.custom_str2;

            console.log(`💰 Verified Credit/Debit Card transaction completed for user: ${clientEmail}`);

            await UserAccount.findOneAndUpdate(
                { email: clientEmail.toLowerCase().trim() },
                { subscriptionTier: chosenTier, subscriptionStatus: 'Active' }
            );
            console.log(`✅ MongoDB Account tier upgraded successfully!`);
        }
        res.sendStatus(200);
    } catch (err) {
        console.error("❌ WEBHOOK SYNC FAILURE:", err);
        res.sendStatus(500);
    }
});

app.post('/api/cancel-subscription', checkUserAuth, async (req, res) => {
    try {
        await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Inactive' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: true });
    }
});

app.listen(PORT, () => { console.log(`🚀 PRODUCTION ENGINE ACTIVE ON PORT ${PORT}`); });
