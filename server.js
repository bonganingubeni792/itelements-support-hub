// =========================================================================
// // IT ELEMENTS SUPPORT - COMPLETE SYNCHRONIZED RUNTIME ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const app = express();

// 📌 VARIABLE PORT MAPPING FOR PRODUCTION CLOUD DEPLOYMENTS
const PORT = process.env.PORT || 3000;

// 📌 DEFINITIVE MONGO OMNI STRING FOR RAILWAY INFRASTRUCTURE
const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/itelementsDB';

mongoose.connect(dbURI)
    .then(() => console.log('📁 Cloud Database connection established successfully!'))
    .catch(err => console.error('❌ Database connection drop fault:', err));

// 👤 USER ACCOUNT PROFILE SCHEMA Configuration
const userAccountSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: String,
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' });

const UserAccount = mongoose.model('UserAccount', userAccountSchema);

// 🎫 SUPPORT REQUEST TICKET SCHEMA Configuration
const supportRequestSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true },
    remoteId: { type: String, required: true },
    remotePassword: { type: String, required: true },
    issue: { type: String, required: true },
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' });

const SupportRequest = mongoose.model('SupportRequest', supportRequestSchema);

// ⚙️ MIDDLEWARE PARSING LOGIC ENGINE CONFIGURATIONS
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
    secret: process.env.SESSION_SECRET || 'itelements-secure-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, secure: false }
}));

// SECURITY INTERFACE FILTERS
function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

// 🌐 ROUTING VIEW PATH INTERFACES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// =========================================================================
// // 🎫 SECURE SUPPORT TICKETS REGISTRATION DISPATCH PIPELINE
// =========================================================================
app.post('/support', async (req, res) => {
    try {
        const { name, email, remoteId, remotePassword, issue } = req.body;

        // Validates input completeness before sending data strings to storage
        if (!name || !email || !remoteId || !remotePassword || !issue) {
            return res.send('<script>alert("All processing form inputs are mandatory!");window.history.back();</script>');
        }

        // Commits data bundle directly into your Cloud MongoDB supportrequests collection table
        await new SupportRequest({
            name: name.trim(),
            email: email.toLowerCase().trim(),
            remoteId: remoteId.trim(),
            remotePassword: remotePassword.trim(),
            issue: issue.trim()
        }).save();

        res.send('<script>alert("Ticket logged successfully into queue!");window.location.href="/dashboard";</script>');
    } catch (err) {
        console.error("❌ Data execution write error:", err);
        res.status(500).send("Database sync error.");
    }
});

// =========================================================================
// // 👤 USER REGISTRATION DISPATCH PIPELINE
// =========================================================================
app.post('/client/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;
        const missingMatch = await UserAccount.findOne({ email: email.toLowerCase().trim() });
        if (missingMatch) {
            return res.send('<script>alert("This email address is already registered. Please login.");window.history.back();</script>');
        }
        await new UserAccount({ fullName, phone, email: email.toLowerCase().trim(), password }).save();
        req.session.isUser = true;
        req.session.userEmail = email.toLowerCase().trim();
        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');
    } catch (err) {
        res.status(500).send("Database registration failure.");
    }
});

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
    res.send('<script>alert("Invalid credentials combo.");window.history.back();</script>');
});

app.post('/api/create-subscription-session', checkUserAuth, async (req, res) => {
    try {
        const { plan } = req.body;
        await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: plan, subscriptionStatus: 'Active' });
        res.json({ success: true, redirectUrl: '/dashboard' });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/client/cancel-subscription', checkUserAuth, async (req, res) => {
    try {
        await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Cancelled / Inactive' });
        res.redirect('/dashboard'); 
    } catch (err) { res.status(500).send("Status update failed."); }
});

app.get('/api/admin/tickets', checkAdminAuth, async (req, res) => { res.json(await SupportRequest.find().sort({ date: -1 })); });
app.get('/api/admin/subscribers', checkAdminAuth, async (req, res) => { res.json(await UserAccount.find()); });
app.post('/admin/requests/status/:id/:targetStatus', checkAdminAuth, async (req, res) => {
    await SupportRequest.findByIdAndUpdate(req.params.id, { status: req.params.targetStatus });
    res.redirect('/admin');
});

app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(PORT, () => console.log(`🚀 PRODUCTION IT ELEMENTS ENGINE ACTIVE ON PORT ${PORT}`));
