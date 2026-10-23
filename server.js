var express = require('express');
var mongoose = require('mongoose');
var path = require('path');
var session = require('express-session');
var cors = require('cors');
var https = require('https');
var app = express();

var PORT = process.env.PORT || 3000;
var dbURI = process.env.MONGODB_URI;

app.set('trust proxy', 1);

mongoose.connect(dbURI).then(function () {
    console.log('📁 Database connected successfully');
}).catch(function (err) {
    console.error('❌ Database connection failure:', err);
});

var UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

var SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String, email: String, remoteId: String, remotePassword: String, issue: String,
    status: { type: String, default: 'Open' }, date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

var HourlyBooking = mongoose.model('HourlyBooking', new mongoose.Schema({
    email: { type: String, default: 'Guest / Anonymous' }, hoursAllocated: Number, amountPaid: Number,
    paymentReference: String, status: { type: String, default: 'Pending Verification' }, date: { type: Date, default: Date.now }
}, { collection: 'hourlybookings' }));
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
    if (req.session && req.session.isAdmin) { return next(); }
    res.status(401).json({ error: 'Unauthorized Admin Access' });
}
function checkUserAuth(req, res, next) {
    if (req.session && (req.session.isUser || req.session.isAdmin)) { return next(); }
    res.status(401).json({ error: 'Unauthorized Session' });
}

app.get('/', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'index.html')); });
app.get('/pricing', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'pricing.html')); });
app.get('/support', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'support.html')); });
app.get('/admin/login', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'client-login.html')); });
app.get('/client/login', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'client-login.html')); });
app.get('/register', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'register.html')); });
app.get('/dashboard', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'dashboard.html')); });
app.get('/admin', function (req, res) { res.sendFile(path.join(__dirname, 'views', 'admin.html')); });

app.post('/client/register', async function (req, res) {
    try {
        var fName = req.body.fullName; var ph = req.body.phone; var em = req.body.email; var pw = req.body.password;
        if (!fName || !ph || !em || !pw) { return res.send('<script>alert("All fields required.");window.history.back();</script>'); }
        var normalizedEmail = em.toLowerCase().trim();
        var existingUser = await UserAccount.findOne({ email: normalizedEmail });
        if (existingUser) { return res.send('<script>alert("Email already registered.");window.history.back();</script>'); }
        var newUser = new UserAccount({ fullName: fName.trim(), phone: ph.trim(), email: normalizedEmail, password: pw });
        await newUser.save(); req.session.isUser = true; req.session.userEmail = newUser.email;
        res.send('<script>alert("Account created successfully!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/client/login', async function (req, res) {
    try {
        var em = req.body.email; var pw = req.body.password;
        if (pw === 'AdminElements2026') { req.session.isAdmin = true; return res.send('<script>window.location.href="/admin";</script>'); }
        var user = await UserAccount.findOne({ email: em.toLowerCase().trim() });
        if (user && user.password === pw) { req.session.isUser = true; req.session.userEmail = user.email; return res.send('<script>window.location.href="/dashboard";</script>'); }
        res.send('<script>alert("Invalid credentials.");window.history.back();</script>');
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/admin/logout', function (req, res) { req.session.destroy(function () { res.clearCookie('connect.sid'); res.redirect('/client/login'); }); });
app.get('/client/logout', function (req, res) { req.session.destroy(function () { res.clearCookie('connect.sid'); res.redirect('/client/login'); }); });

app.post('/support', async function (req, res) {
    try {
        var n = req.body.name; var em = req.body.email; var rid = req.body.remoteId; var rpw = req.body.remotePassword; var msg = req.body.issue || "";
        await new SupportRequest({ name: n, email: em ? em.toLowerCase().trim() : (req.session.userEmail || 'Guest Account'), remoteId: rid, remotePassword: rpw, issue: msg, status: 'Open' }).save();
        res.send('<script>alert("Ticket logged successfully!");window.location.href="/dashboard";</script>');
    } catch (err) { res.status(500).send("Database sync error."); }
});

app.get('/api/client/profile-data', checkUserAuth, async function (req, res) {
    try {
        var user = await UserAccount.findOne({ email: req.session.userEmail }, { password: 0 });
        var tickets = await SupportRequest.find({ email: req.session.userEmail }).sort({ date: -1 });
        res.json({ user: user, tickets: tickets });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/tickets', checkAdminAuth, async function (req, res) {
    try { res.json(await SupportRequest.find().sort({ date: -1 })); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/tickets/update-status', checkAdminAuth, async function (req, res) {
    try { await SupportRequest.findByIdAndUpdate(req.body.ticketId, { status: req.body.newStatus }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/bookings/hourly', async function (req, res) {
    try {
        var hrs = req.body.hours; var amt = req.body.amount; var ref = req.body.reference; var em = req.body.email;
        await new HourlyBooking({ email: em || 'Guest Client', hoursAllocated: parseInt(hrs), amountPaid: parseFloat(amt), paymentReference: ref, status: 'Active' }).save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/admin/overview-data', checkAdminAuth, async function (req, res) {
    try {
        var usersList = await UserAccount.find({}, { password: 0 });
        var hourlyBookings = await HourlyBooking.find().sort({ date: -1 });
        res.json({ users: usersList, hourlyBookings: hourlyBookings });
    } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/bookings/update-status', checkAdminAuth, async function (req, res) {
    try { await HourlyBooking.findByIdAndUpdate(req.body.bookingId, { status: req.body.status }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/create-subscription-session', checkUserAuth, async function (req, res) {
    try { await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: req.body.plan, subscriptionStatus: 'Active' }); res.json({ success: true }); } catch (err) { res.status(500).json({ error: true }); }
});

app.post('/api/cancel-subscription', checkUserAuth, async function (req, res) {
    try { await UserAccount.findOneAndUpdate({ email: req.session.userEmail }, { subscriptionTier: 'None (Unpaid)', subscriptionStatus: 'Inactive' }); res.send('<script>alert("Canceled.");window.location.href="/dashboard";</script>'); } catch (err) { res.status(500).send(err.message); }
});

app.post('/api/paystack/initialize-hourly', async function (req, res) {
    try {
        var hrs = req.body.hours; var totalAmountZAR = parseInt(hrs || 1) * 350; var paymentReference = "ITE-HOURLY-" + Math.floor(100000 + Math.random() * 900000);
        await new HourlyBooking({ email: req.session.userEmail || 'Ad-Hoc Guest Client', hoursAllocated: parseInt(hrs), amountPaid: totalAmountZAR, paymentReference: paymentReference, status: 'Pending Verification' }).save();
        var paystackPayload = JSON.stringify({ email: req.session.userEmail || 'customer@itelements.help', amount: totalAmountZAR * 100, reference: paymentReference, callback_url: "https://" + req.get('host') + "/api/paystack/verify-callback" });
        var options = { hostname: 'api.paystack.co', port: 443, path: '/transaction/initialize', method: 'POST', headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json', 'Content-Length': paystackPayload.length } };
        var paystackReq = https.request(options, function (paystackRes) {
            var data = ''; paystackRes.on('data', function (chunk) { data += chunk; });
            paystackRes.on('end', function () {
                var responseData = JSON.parse(data);
                if (responseData.status && responseData.data.authorization_url) { res.json({ success: true, redirectUrl: responseData.data.authorization_url }); } else { res.status(400).json({ success: false }); }
            });
        });
        paystackReq.write(paystackPayload); paystackReq.end();
    } catch (err) { res.status(500).json({ error: true }); }
});

app.get('/api/paystack/verify-callback', async function (req, res) {
    try { await HourlyBooking.findOneAndUpdate({ paymentReference: req.query.reference }, { status: 'Active' }); res.send('<script>alert("✅ Payment Successful!");window.location.href="/dashboard";</script>'); } catch (e) { res.redirect('/'); }
});

app.post('/api/paystack/initialize-subscription', checkUserAuth, async function (req, res) {
    try {
        var planName = req.body.planName; var planPrice = planName === 'Basic Support' ? 299 : planName === 'Standard Tier' ? 599 : planName === 'Business Growth' ? 2499 : planName === 'Corporate SLA' ? 4999 : 0;
        var paymentReference = "ITE-SUB-" + Math.floor(100000 + Math.random() * 900000);
        var paystackPayload = JSON.stringify({ email: req.session.userEmail, amount: planPrice * 100, reference: paymentReference, callback_url: "https://" + req.get('host') + "/api/paystack/verify-subscription?plan=" + encodeURIComponent(planName) });
        var options = { hostname: 'api.paystack.co', port: 443, path: '/transaction/initialize', method: 'POST', headers: { Authorization: "Bearer " + process.env.PAYSTACK_SECRET_KEY, 'Content-Type': 'application/json', 'Content-Length': paystackPayload.length } };
        var paystackReq = https.request(options, function (paystackRes) {
            var data = ''; paystackRes.on('data', function (chunk) { data += chunk; });
            paystackRes.on('end', function () {
                var responseData = JSON.parse(data);
