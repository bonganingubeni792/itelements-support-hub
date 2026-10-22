// =========================================================================
// IT ELEMENTS SUPPORT - DEFINITIVE PRODUCTION CONTROL CORE ENGINE (server.js)
// =========================================================================

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const session = require('express-session');
const cors = require('cors');
const https = require('https');
const app = express();

const PORT = process.env.PORT || 3000;
const dbURI = process.env.MONGODB_URI;

mongoose.connect(dbURI)
    .then(() => console.log('📁 IT Elements Production Database connection established successfully'))
    .catch(err => console.error('❌ Cloud Database communication failure:', err));

// 👤 USER ACCOUNT SCHEMATICS MODEL Configuration
const UserAccount = mongoose.model('UserAccount', new mongoose.Schema({
    fullName: { type: String, required: true },
    phone: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    subscriptionTier: { type: String, default: 'None (Unpaid)' },
    subscriptionStatus: { type: String, default: 'Inactive' }
}, { collection: 'useraccounts' }));

// 🎫 SUPPORT REQUEST TICKET SCHEMATICS MODEL Configuration
const SupportRequest = mongoose.model('SupportRequest', new mongoose.Schema({
    name: String,
    email: String,
    remoteId: String,
    remotePassword: String,
    issue: String,
    status: { type: String, default: 'Open' },
    date: { type: Date, default: Date.now }
}, { collection: 'supportrequests' }));

// ⏳ AD-HOC HOURLY BOOKING DATABASES MATRIX MODEL
const HourlyBooking = mongoose.model('HourlyBooking', new mongoose.Schema({
    email: { type: String, default: 'Guest / Anonymous' },
    hoursAllocated: { type: Number, required: true },
    amountPaid: { type: Number, required: true },
    paymentReference: { type: String, required: true },
    status: { type: String, default: 'Pending Verification' },
    date: { type: Date, default: Date.now }
}, { collection: 'hourlybookings' }));
