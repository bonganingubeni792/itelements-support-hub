// =========================================================================
// IT ELEMENTS SUPPORT - DEFINITIVE PRODUCTION CONTROL CORE ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const app = express();

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGODB_URI;

mongoose.connect(dbURI)
    .then(() => console.log('📁 IT Elements Production Database connection established successfully'))
    .catch(err => console.error('❌ Cloud Database communication failure:', err));

// 👤 USER ACCOUNT SCHEMATIC
const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

// 🎫 SUPPORT REQUEST TICKET SCHEMATIC
const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String,
    email: String,
    remoteId: String,
    remotePassword: String,
    issue: String,
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(__dirname));

app.use(session({
    secret: 'itelements-secure-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000, secure: false }
}));

// 🔍 LIVE TELEMETRY DATA PATH ENDPOINT BRIDGE
app.get('/api/tickets', async (req, res) => {
    try {
        const tickets = await SupportRequest.find().sort({ date: -1 });
        res.json(tickets);
    } catch (err) {
        res.status(500).json([]);
    }
});

// 🔄 DYNAMIC STATUS MANAGER PIPELINE ROUTE
app.post('/api/tickets/update-status', async (req, res) => {
    try {
        const { ticketId, newStatus } = req.body;
        await SupportRequest.findByIdAndUpdate(ticketId, { status: newStatus });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: true });
    }
});

// VIEW MAPPINGS
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// USER MANAGEMENT
app.post('/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;
        const newUser = new UserAccount({ fullName, phone, email: email.toLowerCase().trim(), password });
        await newUser.save();
        req.session.isUser = true;
        req.session.userEmail = newUser.email;
        res.send('<script>alert("Account created!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/client/login', async (req, res) => {
    try {
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
        res.send('<script>alert("Invalid credentials.");window.history.back();</script>');
    } catch (err) { res.status(500).send(err.message); }
});

// TICKETING DATA INTAKE
app.post('/support', async (req, res) => {
    try {
        const { name, email, remoteId, remotePassword, issue } = req.body;
        await new SupportRequest({ name, email: email ? email.toLowerCase().trim() : '', remoteId, remotePassword, issue, status: 'Open' }).save();
        res.send('<script>alert("Ticket logged!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send("Database sync error."); }
});

// ENGINE LISTENER STARTUP
app.listen(PORT, () => {
    console.log(`🚀 PRODUCTION ENGINE RUNNING ON PORT ${PORT}`);
});
