IT Elements Support Hub — Yoco + Paystack
=========================================

PAYMENT FLOW
------------
Customers can choose Yoco or Paystack for one-time quick-fix sessions and 30-day plans. The server creates each hosted checkout. Paystack callbacks are verified against Paystack's transaction API and signed webhooks. Yoco payments are confirmed only from signature-verified, fresh Yoco payment webhooks. A verified plan payment activates the customer's account for 30 days. Plans renew manually; this integration does not create recurring charges.

Quick-fix choices: 30 minutes (R200), 1 hour (R350), 2 hours (R700), 3 hours (R1,050), 4 hours (R1,400), and 5 hours (R1,750). Each card describes the intended support scope. Customers can choose either Yoco or Paystack. Plan prices: R299, R599, R2,499, and R4,999 for 30 days.

The admin subscriber list includes a confirmed “Reset test plan” action. It returns the selected account to None (Unpaid) / Inactive but keeps payment records. The revenue summary counts only verified live-mode plan payments; test-mode and older unclassified records are excluded.

RENDER ENVIRONMENT
------------------
Set the payment secrets on the Render web service, never in browser files or GitHub:

PAYSTACK_SECRET_KEY=sk_live_... (or sk_test_... while testing)
YOCO_SECRET_KEY=sk_live_... (or sk_test_... while testing)
YOCO_WEBHOOK_SECRET=whsec_... (the matching Yoco webhook signing secret)

Set PUBLIC_BASE_URL=https://www.itelements.help and keep the existing MongoDB, session, admin, and mail settings. The Yoco public key is not required for this hosted-checkout integration. Paystack uses its secret key to sign webhooks; there is no separate Paystack webhook key.

LIVE WEBHOOK URLS
-----------------
Paystack Live Webhook URL: https://www.itelements.help/webhooks/paystack
Yoco Live Webhook URL:     https://www.itelements.help/webhooks/yoco

Yoco needs Payment notification events enabled and its one-time whsec_ secret saved in YOCO_WEBHOOK_SECRET. Configure the Paystack URL in Paystack Live mode and Yoco URL in Yoco Live mode.

LOCAL DEVELOPMENT
-----------------
Copy .env.example to .env and fill your own values. Never upload .env. Start with provider test keys until ready for actual customer charges. Run npm install and npm start.

DEPLOY
------
Upload the ZIP contents to the repository root, then deploy the latest commit from Render. The service may have auto-deploy disabled, so choose Manual Deploy > Deploy latest commit.

The app also includes public pages, client/admin portals, support and on-site request flows, notifications, verified payment records, password-reset email flow, and required assets.

BUSINESS TOOLS
--------------
The public Business tools page (/business-tools) contains a self-service quote and invoice maker. Drafts are saved in the visitor's browser and documents can be printed or saved as PDF. It does not send invoices, verify tax/VAT status, store drafts on the server, or collect the visitor's payments. Review applicable invoice and VAT requirements before issuing documents.

OFFICIAL PAYMENT DOCUMENTATION
------------------------------
Paystack API keys: https://paystack.com/docs/developer-tools/api-keys/
Paystack transactions: https://paystack.com/docs/api/transaction/
Paystack webhooks: https://paystack.com/docs/payments/webhooks/
Yoco create checkout: https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
Yoco payment notification: https://developer.yoco.com/api-reference/checkout-api/webhook-events/payment-notification
Yoco webhook verification: https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
