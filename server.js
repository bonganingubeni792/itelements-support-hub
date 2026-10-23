// =========================================================================
// IT ELEMENTS SUPPORT - DEFINITIVE PRODUCTION CONTROL CORE ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const app = express();

// 📌 PORT MAPPING
const PORT = process.env.PORT || 3000;

// 📌 MONGODB ATLAS CONNECTION
const dbURI = process.env.MONGODB_URI;
if (!dbURI) {
    console.error("❌ CRITICAL CONFIGURATION ERROR: process.env.MONGODB_URI is undefined!");
    console.error("Please add your MongoDB connection string to the Environment tab in your Render Dashboard.");
}
mongoose.connect(dbURI)
    .then(() => console.log('📁 Cloud Database connection established successfully!'))
    .catch(err => console.error('❌ Cloud Database communication failure:', err));

// 👤 USER ACCOUNT MODEL
const userAccountSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' });
const UserAccount = mongoose.model('UserAccount', userAccountSchema);

// 🎫 SUPPORT REQUEST MODEL
const supportRequestSchema = new mongoose.Schema({
    name: String,
    email: String,
    remoteId: String,
    remotePassword: String,
    issue: String,
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' });
const SupportRequest = mongoose.model('SupportRequest', supportRequestSchema);

// ⚙️ EXPRESS MIDDLEWARE
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));
app.use(session({
    secret: process.env.SESSION_SECRET || 'itelements-secure-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, secure: false }
}));

// 🔐 AUTH HELPERS
function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

// 🌐 STATIC ROUTES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// 👤 REGISTRATION PIPELINE
app.post('/client/register', async (req, res) => { await handleRegistration(req, res); });
app.post('/register', async (req, res) => { await handleRegistration(req, res); });
async function handleRegistration(req, res) {
    try {
        const { fullName, phone, email, password } = req.body;
        if (!fullName || !phone || !email || !password) {
            return res.send('<script>alert("All registration fields are strictly required.");window.history.back();</script>');
        }
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.send('<script>alert("This email address is already registered inside our cloud system.");window.history.back();</script>');
        }
        const newUser = new UserAccount({ fullName: fullName.trim(), phone: phone.trim(), email: normalizedEmail, password });
        await newUser.save();
        req.session.isUser = true;
        req.session.userEmail = newUser.email;
        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');
    } catch (err) {
        console.error("❌ Registration crash:", err);
        res.status(500).send(`<h3>HTTP ERROR 500</h3><p>${err.message}</p>`);
    }
}

// 🔑 LOGIN PIPELINE
app.post('/client/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.send('<script>alert("Please input both your registered email and secure key combination.");window.history.back();</script>');
        }
        if (password === 'AdminElements2026') {
            req.session.isAdmin = true;
            return res.send('<script>window.location.href="/admin";</script>');
        }
        const normalizedEmail = email.toLowerCase().trim();
        const user = await UserAccount.findOne({ email: normalizedEmail });
        if (user && user.password === password) {
            req.session.isUser = true;
            req.session.userEmail = user.email;
            return res.send('<script>window.location.href="/dashboard";</script>');
        }
        res.send('<script>alert("Invalid credentials.");window.history.back();</script>');
    } catch (err) {
        console.error("❌ Login crash:", err);
        res.status(500).send(`<h3>HTTP ERROR 500</h3><p>${err.message}</p>`);
    }
});

// 🎫 SUPPORT TICKET SUBMISSION
app.post('/support', async (req, res) => {
    try {
        const { name, email, remoteId, remotePassword, issue } = req.body;
        await new SupportRequest({
            name,
            email: email ? email.toLowerCase().trim() : '',
            remoteId,
            remotePassword,
            issue,
            status: 'Open'
        }).save();
        res.send('<script>alert("Ticket logged successfully!");window.location.href="/dashboard";</script>');
    } catch (err) {
        console.error("❌ Support submission crash:", err);
        res.status(500).send("Database sync error.");
    }
});

// 🔍 FETCH TICKETS
app.get('/api/tickets', checkAdminAuth, async (req, res) => {
    try {
        const tickets = await SupportRequest.find().sort({ date: -1 });
        res.json(tickets);
    } catch (err) {
        console.error("❌ Ticket fetch crash:", err);
        res.status(500).json({ error: true, message: err.message });
    }
});

// 🔄 UPDATE TICKET STATUS
app.post('/api/tickets/:id/status', checkAdminAuth, async (req, res) => {
    try {
        const { status } = req.body;
        if (!['Open', 'Hold', 'Resolved'].includes(status)) {
            return res.status(400).json({ error: true, message: 'Invalid status value' });
        }
        await SupportRequest.findByIdAndUpdate(req.params.id, { status });
        res.json({ success: true });
    } catch (err) {
        console.error("❌ Ticket status update crash:", err);
        res.status(500).json({ error: true, message: err.message });
    }
});

// 💳 SUBSCRIPTION ACTIVATION
app.post('/api/create-subscription-session', checkUserAuth, async (req, res) => {
    try {
        const { plan } = req.body;
        await UserAccount.findOneAndUpdate(
            { email: req.session.userEmail },
            { subscriptionTier: plan, subscriptionStatus: 'Active' }
        );
        res.json({ success: true, redirectUrl: '/dashboard' });
    } catch (err) {
        res.status(500).json({ error: true });
    }
});

// ❌ SUBSCRIPTION CANCELLATION
app.post('/api/cancel-subscription', checkUserAuth, async (req, res) => {
    try {
        await UserAccount.findOneAndUpdate(
            { email: req.session.userEmail },
            { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Inactive' }
        );
        res.json({ success: true, message: 'Subscription successfully canceled.' });
    } catch (err) {
        res.status(500).json({ error: true, details: err.message });
    }
});

// 🚀 START SERVER
app.listen(PORT, () => {
    console.log(`🚀 PRODUCTION IT ELEMENT
