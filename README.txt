IT Elements Support Hub — Paystack edition
==========================================

PAYMENT FLOW
------------
The website now uses Paystack hosted checkout for the one-time quick-fix sessions and 30-day support plans. The server starts each checkout using PAYSTACK_SECRET_KEY, then verifies the transaction with Paystack before marking a plan active. The Paystack secret key is never sent to browser code.

Quick-fix prices remain R200 for 30 minutes, R350 for 1 hour, and R700 for 2 hours. Plans remain R299, R599, R2,499, and R4,999 for 30 days. Plan renewal is manual; this integration does not create recurring charges.

RENDER SETUP (TEST MODE)
------------------------
1. In Paystack, open Settings > API Keys & Webhooks and switch to Test Mode.
2. Copy the Test Secret Key. It begins with sk_test_. Do not send it in chat, put it in HTML, or commit it to GitHub.
3. In Render, open the itelements-support-hub web service, then Environment.
4. Add PAYSTACK_SECRET_KEY and paste the Paystack TEST secret key as its value.
5. Remove the old YOCO_SECRET_KEY and YOCO_WEBHOOK_SECRET environment variables from this Render service. This package no longer reads them.
6. Save the environment changes and let Render redeploy the service.

PAYSTACK TEST WEBHOOK
---------------------
In Paystack Test Mode > Settings > API Keys & Webhooks, set the Test Webhook URL to:
https://www.itelements.help/webhooks/paystack

Save the setting. Paystack signs webhooks using the same secret API key, so there is no separate PAYSTACK_WEBHOOK_SECRET to create or add. The application checks the webhook signature and then verifies each transaction directly with Paystack.

The callback URL is sent automatically when the server starts a checkout:
https://www.itelements.help/payment/paystack/callback
You do not need to set a callback URL in Render.

TESTING
-------
Use Paystack's own Test Mode card details from the Paystack dashboard. Make a small test payment and confirm that the customer returns to the website. For a plan, check the dashboard plan/status and the admin confirmed-payment figures. Test-mode payments do not move real money. Do not use a live key until you are intentionally ready to accept real payments.

OTHER REQUIRED RENDER SETTINGS
------------------------------
Keep the existing MONGODB_URI, SESSION_SECRET, ADMIN_PASSWORD, email settings, and PUBLIC_BASE_URL values. The complete variable template is in .env.example. Render supplies PORT automatically.

LOCAL DEVELOPMENT
-----------------
Copy .env.example to a file named .env, fill in your own values, and run npm install followed by npm start. Do not upload .env to GitHub. Use a Paystack test secret key locally.

PACKAGE CONTENTS
----------------
The app includes the public pages, client portal, admin tools, support and on-site request flows, payment verification, password-reset email flow, and required public assets. Legacy Yoco checkout endpoints and browser SDK usage have been removed.

Paystack documentation:
https://paystack.com/docs/payments/accept-payments/
https://paystack.com/docs/payments/webhooks/
