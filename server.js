const express = require('express'), mongoose = require('mongoose'), path = require('path'), session = require('express-session'), cors = require('cors'), https = require('https'), app = express();
const PORT = process.env.PORT || 3000, dbURI = process.env.MONGODB_URI;
app.set('trust proxy', 1);

mongoose.connect(dbURI).then(() => console.log('📁 DB Success')).catch(err => console.error('❌ DB Failure', err));

const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true }, phone: { type: String, required: true }, email: { type: String, required: true, unique: true }, password: { type: String, required: true }, subscriptionTier: { type: String, default: 'None (Unpaid)' }, subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String, email: String, remoteId: String, remotePassword: String, issue: String, status: { type: String, default: 'Open' }, date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

const HourlyBooking = mongoose.model('HourlyBooking', new mongoose.Schema({
    email: { type: String, default: 'Guest / Anonymous' }, hoursAllocated: Number, amountPaid: Number, paymentReference: String, status: { type: String, default: 'Pending Verification' }, date: { type: Date, default: Date.now }
}, { collection: 'hourlybookings' }));

app.use(cors()); app.use(express.urlencoded({ extended: true })); app.use(express.json());
app.use(express.static(path.join(__dirname, 'views'))); app.use(express.static(__dirname));
app.use(session({ secret: 'itelements-secure-key-2026', resave: true, saveUninitialized: true, cookie: { maxAge: 86400000, secure: false, sameSite: 'lax' } }));

const checkAdmin = (req, res, next) => (req.session && req.session.isAdmin) ? next() : res.status(401).json({ error: 'Admin Denied' });
const checkUser = (req, res, next) => (req.session && (req.session.isUser || req.session.isAdmin)) ? next() : res.status(401).json({ error: 'User Denied' });

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'views', 'index.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'views', 'pricing.html')));
app.get('/support', (req, res) => res.sendFile(path.join(__dirname, 'views', 'support.html')));
app.get('/admin/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/client/login', (req, res) => res.sendFile(path.join(__dirname, 'views', 'client-login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'views', 'register.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'views', 'dashboard.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

app.post('/client/register', async (req, res) => {
    try {
        let { fullName, phone, email, password } = req.body; if (!fullName || !phone || !email || !password) return res.send('<script>alert("All fields required.");window.history.back();</script>');
        let normEmail = email.toLowerCase().trim(), existing = await UserAccount.findOne({ email: normEmail }); if (existing) return res.send('<script>alert("Email registered.");window.history.back();</script>');
        let newUser = new UserAccount({ fullName: fullName.trim(), phone: phone.trim(), email: normEmail, password }); await newUser.save();
        req.session.isUser = true; req.session.userEmail = newUser.email; res.send('<script>alert("Account created!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/client/login', async (req, res) => {
    try {
        let { email, password } = req.body; if (password === 'AdminElements2026') { req.session.isAdmin = true; return res.send('<script>window.location.href="/admin";</script>'); }
        let user = await UserAccount.findOne({ email: email.toLowerCase().trim() }); if (user && user.password === password) { req.session.isUser = true; req.session.userEmail = user.email; return res.send('<script>window.location.href="/dashboard";</script>'); }
        res.send('<script>alert("Invalid credentials.");window.history.back();</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/admin/logout', (req, res) => req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/client/login'); }));
app.get('/client/logout', (req, res) => req.session.destroy(() => { res.clearCookie('connect.sid'); res.redirect('/client/login'); }));

app.post('/support', async (req, res) => {
    try {
        let { name, email, remoteId, remotePassword, issue = "" } = req.body;
        await new SupportRequest({ name, email: email ? email.toLowerCase().trim() : (req.session.userEmail || 'Guest'), remoteId, remotePassword, issue, status: 'Open' }).save();
        res.send('<script>alert("Ticket logged!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send("Sync error."); }
});

app.get('/api/client/profile-data', checkUser, async (req, res) => {
    try { res.json({ user: await UserAccount.findOne({ email: req.session.userEmail }, { password: 0 }), tickets: await SupportRequest.find({ email: req.session.userEmail }).sort({ date: -1 }) }); } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/tickets', checkAdmin, async (req, res) => {
    try { res.json(await SupportRequest.find().sort({ date: -1 })); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/tickets/update-status', checkAdmin, async (req, res) => {
    try { await SupportRequest.findByIdAndUpdate(req.body.ticketId, { status: req.body.newStatus }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/bookings/hourly', async (req, res) => {
    try {
        let { hours, amount, reference, email } = req.body; await new HourlyBooking({ email: email || 'Guest', hoursAllocated: parseInt(hours), amountPaid: parseFloat(amount), paymentReference: reference, status: 'Active' }).save(); res.json({ success: true });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/admin/overview-data', checkAdmin, async (req, res) => {
    try { res.json({ users: await UserAccount.find({}, { password: 0 }), hourlyBookings: await HourlyBooking.find().sort({ date: -1 }) }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/bookings/update-status', checkAdmin, async (req, res) => {
    try { await HourlyBooking.findByIdAndUpdate(req.body.bookingId, { status: req.body.status }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/create-subscription-session', checkUser, async (req, res) => {
    try { await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: req.body.plan, subscriptionStatus: 'Active' }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/cancel-subscription', checkUser, async (req, res) => {
    try { await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Inactive' }); res.send('<script>alert("Canceled.");window.location.href="/dashboard";</script>'); } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/paystack/initialize-hourly', async (req, res) => {
    try {
        let hrs = req.body.hours, totalZAR = parseInt(hrs || 1) * 350, paymentRef = "ITE-HOURLY-" + Math.floor(100000 + Math.random() * 900000);
        await new HourlyBooking({ email: req.session.userEmail || 'Ad-Hoc Guest', hoursAllocated: parseInt(hrs), amountPaid: totalZAR, paymentReference: paymentRef, status: 'Pending Verification' }).save();
        let payload = JSON.stringify({ email: req.session.userEmail || 'customer@itelements.help', amount: totalZAR * 100, reference: paymentRef, callback_url: "https://" + req.get('host') + "/api/paystack/verify-callback" });
        let options = { hostname: 'api.paystack.co', port: 443, path: '/transaction/initialize', method: 'POST', headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json', 'Content-Length': payload.length } };
        let paystackReq = https.request(options, (paystackRes) => {
            let data = ''; paystackRes.on('data', chunk => data += chunk);
            paystackRes.on('end', () => { let resp = JSON.parse(data); if (resp.status && resp.data.authorization_url) { res.json({ success: true, redirectUrl: resp.data.authorization_url }); } else { res.status(400).json({ success: false }); } });
        });
        paystackReq.write(payload); paystackReq.end();
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/paystack/verify-callback', async (req, res) => {
    try { await HourlyBooking.findOneAndUpdate({ paymentReference: req.query.reference }, { status: 'Active' }); res.send('<script>alert("✅ Payment Successful!");window.location.href="/dashboard";</script>'); } catch(e) { res.redirect('/'); }
});

app.post('/api/paystack/initialize-subscription', checkUser, async (req, res) => {
    try {
        let name = req.body.planName, price = name === 'Basic Support' ? 299 : name === 'Standard Tier' ? 599 : name === 'Business Growth' ? 2499 : name === 'Corporate SLA' ? 4999 : 0, paymentRef = "ITE-SUB-" + Math.floor(100000 + Math.random() * 900000);
        let payload = JSON.stringify({ email: req.session.userEmail, amount: price * 100, reference: paymentRef, callback_url: "https://" + req.get('host') + "/api/paystack/verify-subscription?plan=" + encodeURIComponent(name) });
