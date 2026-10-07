// =========================================================================
// // IT ELEMENTS SUPPORT - DEFINITIVE PRODUCTION CONTROL CORE ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const app = express();

// 📌 PORT MAPPING: Dynamically assigns production cloud nodes or defaults to 3000
const PORT = process.env.PORT || 3000;

// 📌 MONGODB ATLAS ROUTING LAYER: Grabs the live cloud variable from Render environment grids
const dbURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/itelementsDB';

mongoose.connect(dbURI)
    .then(() => console.log('📁 IT Elements Production Database connection established successfully'))
    .catch(err => console.error('❌ Cloud Database communication failure:', err));

// 👤 USER ACCOUNT DATA SCHEMATICS MODEL Configuration
const userAccountSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' });

const UserAccount = mongoose.model('UserAccount', userAccountSchema);

// 🎫 SUPPORT REQUEST TICKET SCHEMATICS MODEL Configuration
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
    cookie: { 
        maxAge: 3600000, 
        secure: false // Set to true if utilizing custom SSL termination properties directly in Render headers
    }
}));

// SECURITY BOUNDARY CONTROLLERS
function checkAdminAuth(req, res, next) {
    if (req.session && req.session.isAdmin) return next();
    res.redirect('/client/login');
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) return next();
    res.redirect('/client/login');
}

// 🌐 ROUTING PATH MAPPINGS FOR STATIC VIEW INTERFACES
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', checkUserAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', checkAdminAuth, (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

// 👤 SECURE CLIENT ACCOUNT REGISTRATION PIPELINE (WITH EXPLICIT ERROR WRAPPERS)
app.post('/register', async (req, res) => {
    try {
        const { fullName, phone, email, password } = req.body;

        // Validation safety checkpoint
        if (!fullName || !phone || !email || !password) {
            return res.send('<script>alert("All registration fields are strictly required.");window.history.back();</script>');
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check for existing duplicates in the cloud data arrays
        const existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) {
            return res.send('<script>alert("This email address is already registered inside our cloud system.");window.history.back();</script>');
        }

        // Instantiating a clean profile row mapped directly to our Mongoose model
        const newUser = new UserAccount({
            fullName: fullName.trim(),
            phone: phone.trim(),
            email: normalizedEmail,
            password: password
        });

        // Committing records to your active MongoDB Atlas data clusters
        await newUser.save();

        // Establish an active authenticated server session instantly
        req.session.isUser = true;
        req.session.userEmail = newUser.email;

        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');

    } catch (err) {
        console.error("❌ CRITICAL ACCOUNT REGISTRATION CRASH IN PRODUCTION:", err);
        res.status(500).send(`<h3>HTTP ERROR 500: Database Sync Failure During Registration</h3><p>Details: ${err.message}</p>`);
    }
});

// 🔑 SECURE CLIENT/ADMIN LOGIN PIPELINE INTERACTION ENGINE
app.post('/client/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.send('<script>alert("Please input both your registered email and secure key combination.");window.history.back();</script>');
        }

        // Administrative Master Override Configuration Gateway
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

        res.send('<script>alert("Invalid access credentials combination. Please verify your email or password properties.");window.history.back();</script>');

    } catch (err) {
        console.error("❌ CRITICAL DATABASE ACCESS EXCEPTION ENCOUNTERED ON LOGIN:", err);
        res.status(500).send(`<h3>HTTP ERROR 500: Server Login Validation Fault</h3><p>Details: ${err.message}</p>`);
    }
});

// 🎫 TICKETING ENGINE SUBMISSION INTERFACE DATA ROUTING
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
        
        res.send('<script>alert("Ticket logged successfully into queue!");window.location.href="/dashboard";</script>');
    } catch (err) {
        console.error("❌ CLOUD DATA DISPATCH EXCEPTION ENCOUNTERED ON SUPPORT:", err);
        res.status(500).send("Database sync error.");
    }
});

// 💳 AUTOMATED SUBSCRIPTION ACTIVATION DATA INTERFACES
app.post('/api/create-subscription-session', checkUserAuth, async (req, res) => {
    try {
        const { plan } = req.body;
        await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: plan, subscriptionStatus: 'Active' });
        res.json({ success: true, redirectUrl: '/dashboard' });
    } catch (err) {
        res.status(500).json({ error: true });
    }
});

// ❌ MEMBERSHIP CANCEL ENGINE ROUTING SYSTEM
app.post('/api/client/cancel-subscription', checkUserAuth, async (req, res) => {
    try {
        const clientEmail = req.session.userEmail;
        await UserAccount.findOneAndUpdate({ email: clientEmail }, { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Cancelled / Inactive' });
        res.redirect('/dashboard'); 
    } catch (err) {
        res.status(500).send("Status update failed.");
    }
});

// 📊 PRIVATE API DISPATCH LAYER FOR THE MASTER ADMINISTRATIVE INTERFACE VIEWS
app.get('/api/admin/tickets', checkAdminAuth, async (req, res) => { res.json(await SupportRequest.find().sort({ date: -1 })); });
app.get('/api/admin/subscribers', checkAdminAuth, async (req, res) => { res.json(await UserAccount.find()); });
app.post('/admin/requests/status/:id/:targetStatus', checkAdminAuth, async (req, res) => {
    await SupportRequest.findByIdAndUpdate(req.params.id, { status: req.params.targetStatus });
    res.redirect('/admin');
});

// 🚪 SERVER SESSION DESTRUCTION TERMINATION LAYER
app.get('/admin/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

app.listen(PORT, () => console.log(`🚀 PRODUCTION IT ELEMENTS HUB RUNNING SECURELY LIVE ON ENVIRONMENT NODE PORT ${PORT}`));
