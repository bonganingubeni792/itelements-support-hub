IT Elements Support Hub — PayFast
=================================

PAYMENT SETUP
-------------
The site uses PayFast hosted checkout for one-time remote support sessions and 30-day support plans. The server creates a unique pending purchase and posts the customer to PayFast. A customer return to the site does not count as proof of payment. The plan becomes active only after the server verifies PayFast's signed ITN, checks the sender and amount, and receives a VALID response from PayFast.

Quick-fix sessions: 30 minutes R200; 1 hour R350; 2 hours R700; 3 hours R1,050; 4 hours R1,400; 5 hours R1,750. Plans: R299, R599, R2,499, and R4,999 for 30 days. Plans renew manually; this package does not create recurring charges.

RENDER ENVIRONMENT VARIABLES
----------------------------
On the Render web service, open Environment and add:

PAYFAST_MERCHANT_ID = your PayFast Merchant ID
PAYFAST_MERCHANT_KEY = your PayFast Merchant Key
PAYFAST_MODE = live
PAYFAST_PASSPHRASE = only if you set one in PayFast

Keep your existing MONGODB_URI, SESSION_SECRET, ADMIN_PASSWORD, PUBLIC_BASE_URL, and email variables. Remove the old PAYSTACK_SECRET_KEY, YOCO_SECRET_KEY, and YOCO_WEBHOOK_SECRET variables after deploying this PayFast version. Never put merchant secrets in HTML or GitHub.

Set PUBLIC_BASE_URL to https://www.itelements.help. The checkout sends its ITN notification to:
https://www.itelements.help/webhooks/payfast

The notify URL is included in each hosted checkout. If PayFast asks you to set a URL in its merchant settings, use the same URL and enable ITN. Use PAYFAST_MODE=test and the PayFast sandbox merchant credentials to test first; switch to live credentials and PAYFAST_MODE=live only for real charges. The live PayFast process and ITN validation endpoints are selected automatically by mode.

IMPORTANT KEY SAFETY
--------------------
The PayFast Merchant Key was visible in a screenshot shared in this conversation. For safety, regenerate/replace it in PayFast before accepting real payments, then store the new key only in Render Environment. If you configured a PayFast passphrase, keep it private and rotate it too if it was exposed.

DEPLOY
------
Upload the ZIP contents to the root of the GitHub repository, commit the changes, then deploy the latest commit in Render. If auto-deploy is disabled, use Manual Deploy > Deploy latest commit. Confirm Render's web service logs show the server started successfully.

The package includes the existing customer pages, dashboard, admin console, remote/on-site support forms, payment receipts, ticket notifications, password reset flow, and site assets. Existing user accounts and support data remain in MongoDB; historical test payment records are not deleted.

OFFICIAL DOCUMENTATION
----------------------
PayFast hosted checkout and ITN: https://developers.payfast.co.za/docs/itn-instant-transaction-notification/
PayFast developer docs: https://developers.payfast.co.za/docs
