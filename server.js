// =========================================================================
// IT ELEMENTS SUPPORT - DEFINITIVE PRODUCTION CONTROL CORE ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const app = express();

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGODB_URI;

if (!dbURI) {
    console.error("❌ CRITICAL CONFIGURATION ERROR: process.env.MONGODB_URI is undefined!");
}

mongoose.connect(dbURI)
    .then(() => console.log('📁 IT Elements Production Database connection established successfully'))
    .catch(err => console.error('❌ Cloud Database communication failure:', err));

// 👤 USER ACCOUNT MODEL
const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

// 🎫 SUPPORT REQUEST TICKET MODEL
const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String,
    email: String,
    remoteId: String,
    remotePassword: String,
    issue: String,
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

// MIDDLEWARE
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

// SECURITY AUTOMATION GATEWAYS
function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

// 🌐 ROUTING VIEW INTERFACES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// 👤 ACCOUNT REGISTRATION ROUTE PIPELINE
app.post('/client/register', async (req, res) => { await handleRegistration(req, res); });
app.post('/register', async (req, res) => { await handleRegistration(req, res); });

async function handleRegistration(req, res) {
    try {
        const { fullName, phone, email, password } = req.body;
        if (!fullName || !phone || !email || !password) {
            return res.send('<script>alert("All fields are strictly required.");window.history.back();</script>');
        }
        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.send('<script>alert("Email already registered inside cloud.");window.history.back();</script>');
        }
        const newUser = new UserAccount({ fullName: fullName.trim(), phone: phone.trim(), email: normalizedEmail, password });
        await newUser.save();
        req.session.isUser = true;
        req.session.userEmail = newUser.email;
        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');
    } catch (err) {
        res.status(500).send(`<h3>Registration Failure</h3><p>${err.message}</p>`);
    }
}

// 🔑 CLIENT/ADMIN LOGIN ROUTE PIPELINE
app.post('/client/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.send('<script>alert("Please input both fields.");window.history.back();</script>');
        }
        if (password === 'AdminElements2026') {
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
    } catch (err) {
        res.status(500).send(`<h3>Login Failure</h3><p>${err.message}</p>`);
    }
});

// 🎫 TICKETING DISPATCH SUBMISSION INTERFACE ROUTING
app.post('/support', async (req, res) => {
    try {
        const { name, email, remoteId, remotePassword, issue } = req.body;
        await new SupportRequest({ name, email: email ? email.toLowerCase().trim() : '', remoteId, remotePassword, issue, status: 'Open' }).save();
        res.send('<script>alert("Ticket logged successfully!");window.location.href="/dashboard";</script>');
    } catch (err) {
        res.status(500).send("Database sync error.");
    }
});

// 🔍 LIVE TICKET FETCH ROUTE FOR THE ADMIN DASHBOARD
app.get('/api/tickets', checkAdminAuth, async (req, res) => {
    try {
        const tickets = await SupportRequest.find().sort({ date: -1 });
        res.json(tickets);
    } catch (err) {
        res.status(500).json({ error: true, message: err.message });
    }
});

// 🔄 DYNAMIC STATUS CONTROLLER ENGINE FOR TICKET ROUTING MANAGER
app.post('/api/tickets/update-status', checkAdminAuth, async (req, res) => {
    try {
        const { ticketId, newStatus } = req.body;
        const allowed = ['Open', 'On Hold', 'Resolved'];
        if (!allowed.includes(newStatus)) return res.status(400).json({ error: true });
        
        await SupportRequest.findByIdAndUpdate(ticketId, { status: newStatus });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: true, message: err.message });
    }
});

// 💳 SUBSCRIPTION MANAGER ROUTING CHANNELS
app.post('/api/create-subscription-session', checkUserAuth, async (req, res) => {
    try {
        await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: req.body.plan, subscriptionStatus: 'Active' });
        res.json({ success: true, redirectUrl: '/dashboard' });
    } catch (err) {
        res.status(500).json({ error: true });
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

// 🚀 INITIALIZE SYSTEM SERVER LISTENERS
app.listen(PORT, () => {
    console.log(`🚀 PRODUCTION IT ELEMENTS ENGINE ACTIVE ON PORT ${PORT}`);
});
