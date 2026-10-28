const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const https = require('https'); // Required to make native secure requests to Yoco APIs safely
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

// 💳 YOCO AUTOMATED GATEWAY PAYMENT CHARGE ROUTE ENDPOINT
app.post('/api/payment/yoco-charge', async (req, res) => {
    try {
        const { token, amountInCents, planName, isAdHoc } = req.body;

        if (!token || !amountInCents) {
            return res.status(400).json({ success: false, message: "Missing required tokenization properties." });
        }

        // Formulating payload metadata structure required by Yoco Online API Nodes
        const postData = JSON.stringify({
            token: token,
            amountInCents: amountInCents,
            currency: 'ZAR'
        });

        // Set up the HTTPS post parameters securely targeting the Yoco cloud gateway endpoints
        const options = {
            hostname: 'online.yoco.co.za', // Fixed target hostname connectivity typo
            port: 443,
            path: '/v1/charges',
            method: 'POST',
            headers: {
                'Authorization': 'Bearer sk_test_369adbdbY6Gbg60694549cdbf721', // Your private test secret key
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        // Fire request to Yoco servers
        const yocoReq = https.request(options, (yocoRes) => {
            let body = '';
            yocoRes.on('data', (chunk) => body += chunk);
            yocoRes.on('end', async () => {
                const responseData = JSON.parse(body);

                // Yoco processes successfully when the transaction record fields return 'successful'
                if (yocoRes.statusCode === 201 && responseData.status === 'successful') {
                    
                    // If it was triggered from a user logged inside their subscription panel deck dashboard:
                    if (!isAdHoc && req.session.userEmail) {
                        await UserAccount.findOneAndUpdate(
                            { email: req.session.userEmail },
                            { subscriptionTier: planName, subscriptionStatus: 'Active' }
                        );
                    }
                    return res.json({ success: true, data: responseData });
                } else {
                    return res.status(400).json({ success: false, error: responseData });
                }
            });
        });

        yocoReq.on('error', (e) => {
            console.error("❌ YOCO SERVICE DISPATCH FAILURE:", e);
            res.status(500).json({ success: false, message: "Gateway channel link timeout error." });
        });

        yocoReq.write(postData);
        yocoReq.end();

    } catch (error) {
        console.error("❌ CRITICAL TRANSACTION ENGINE FAULT:", error);
        res.status(500).json({ success: false, message: error.message });
    }
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

app.listen(PORT, () => { console.log(`🚀 PRODUCTION ENGINE ACTIVE ON PORT ${PORT}`); });
