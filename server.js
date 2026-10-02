// =========================================================================
// // IT ELEMENTS SUPPORT - PRODUCTION CLOUD CONTROL CORE ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const app = express();

// 📌 FIXED: Dynamic Port mapping allows Cloud Data Centers to assign public nodes automatically
const PORT = process.env.PORT || 3000;

// 📌 FIXED: Fallback database engine automatically selects Cloud Mongo or Localhost testing strings
const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/itelementsDB';

mongoose.connect(dbURI)
    .then(() => console.log('📁 IT Elements Production Database connection established successfully'))
    .catch(err => console.error('❌ Database communication failure:', err));

// 👤 USER ACCOUNT SCHEMA PROFILE MODEL Configuration
const userAccountSchema = new mongoose.Schema({
    fullName: String,
    phone: String,
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' });

const UserAccount = mongoose.model('UserAccount', userAccountSchema);

// 🎫 SUPPORT REQUEST TICKET SCHEMA MODEL Configuration
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

// ⚙️ EXPRESS MIDDLEWARE CONFIGURATIONS
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
    secret: process.env.SESSION_SECRET || 'itelements-secure-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, secure: false } // Set to true if running behind explicit HTTPS proxies later
}));

// SECURITY PROTECTION INTERFACES
function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

// 🌐 ROUTING PATH MAPPINGS FOR STATIC TEMPLATE INTERFACES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// 💳 AUTOMATED SUBSCRIBE AND ACTIVATION LINK ENDPOINT
app.post('/api/create-subscription-session', checkUserAuth, async (req, res) => {
    try {
        const { plan } = req.body;
        await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: plan, subscriptionStatus: 'Active' });
        res.json({ success: true, redirectUrl: '/dashboard' });
    } catch (err) {
        res.status(500).json({ error: true });
    }
});

// ❌ SECURE AUTOMATED CLIENT MEMBERSHIP CANCELLATION REDIRECT ENGINE
app.post('/api/client/cancel-subscription', checkUserAuth, async (req, res) => {
    try {
        const clientEmail = req.session.userEmail;
        await UserAccount.findOneAndUpdate({ email: clientEmail }, { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Cancelled / Inactive' });
        res.redirect('/dashboard'); 
    } catch (err) {
        res.status(500).send("Status update failed.");
    }
});

// AUTHENTICATION CORE AND DISPATCH ENDPOINTS
app.post('/client/login', async (req, res) => {
    const { email, password } = req.body;
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
    res.send('<script>alert("Invalid access credentials combo.");window.history.back();</script>');
});

app.post('/support', async (req, res) => {
    try {
        const { name, email, remoteId, remotePassword, issue } = req.body;
        await new SupportRequest({ name, email, remoteId, remotePassword, issue, status: 'Open' }).save();
        res.send('<script>alert("Ticket logged successfully into queue!");window.location.href="/dashboard";</script>');
    } catch (err) {
        res.status(500).send("Database sync error.");
    }
});

app.get('/api/admin/tickets', checkAdminAuth, async (req, res) => { res.json(await SupportRequest.find().sort({ date: -1 })); });
app.get('/api/admin/subscribers', checkAdminAuth, async (req, res) => { res.json(await UserAccount.find()); });
app.post('/admin/requests/status/:id/:targetStatus', checkAdminAuth, async (req, res) => {
    await SupportRequest.findByIdAndUpdate(req.params.id, { status: req.params.targetStatus });
    res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(PORT, () => console.log(`🚀 PRODUCTION IT ELEMENTS HUB DEPLOYED ON PUBLIC NODE PORT ${PORT}`));
