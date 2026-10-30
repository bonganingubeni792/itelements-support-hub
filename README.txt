IT Elements website: current file set
====================================

Files to replace/add in the GitHub repository
----------------------------------------------
Keep the existing folder structure. Replace or add these files from this package:
- Replace server.js with this server.js.
- In views/, replace admin.html, client-login.html, dashboard.html, index.html, and register.html.
- In views/, replace pricing.html with the supplied current pricing.html.
- Add or replace views/support.html with the supplied current support.html.
- Add views/forgot-password.html and views/reset-password.html if they are missing.
- Add views/services.html, views/about.html, views/faq.html, and views/contact.html.
- Add views/onsite-support.html for the on-site service page and enquiry form.
- Add public/itel-support-icon.png. The server exposes this folder at /assets/.
- The new pages and navigation links are served by the updated server.js routes.
- Keep package.json and package-lock.json from your working repository. Do not replace them with package.txt.
- Keep your existing Render environment variables; update only those listed below where applicable. Never paste secrets into GitHub or share them in screenshots.

Important flow
--------------
- Pricing buttons use /subscribe/:planId. The server validates the plan, saves it in the session, and sends signed-out customers to login.
- Successful login or registration returns the customer to the selected plan checkout.
- The plan amount comes from the server-side plan table, not from the browser.
- Yoco confirms the payment with the signed webhook before the plan becomes Active.
- Plans are one-time 30-day payments with manual renewal; they are not automatic recurring subscriptions.

Files to review before deleting from the old repository
--------------------------------------------------------
The screenshots show old-looking files such as billing.html, billing.txt, login.html, package.txt, and yoco-sdk.js. Do not delete them solely from their names. First search all repository files for references to each filename and check whether a page or script still uses it. Keep package.json, package-lock.json, server.js, and any assets under public/. The current server uses hosted Yoco Checkout and does not need a browser Yoco SDK script, but remove yoco-sdk.js only after confirming no HTML includes it.

The current deliverable does not include the source contents for billing.html, billing.txt, login.html, yoco-sdk.js, or files under public/, so those cannot be safely reconciled or deleted from screenshots alone.

Render environment variables
----------------------------
- YOCO_SECRET_KEY: use an sk_test_ key while testing, and change to your sk_live_ key only when ready to accept real payments.
- YOCO_WEBHOOK_SECRET: use the whsec_ secret from a webhook registered in the same Yoco mode as YOCO_SECRET_KEY (TEST with TEST, LIVE with LIVE).
- PUBLIC_BASE_URL: https://www.itelements.help
- SESSION_SECRET: a long random private value.
- ADMIN_PASSWORD: your new private admin password.
- MONGODB_URI: your existing MongoDB connection string.
- RESEND_API_KEY: an API key from Resend for transactional email.
- RESET_EMAIL_FROM: a sender address on the domain verified with Resend, for example IT Elements Support <support@itelements.help>.

Register the Yoco webhook
-------------------------
The plan becomes Active only after the server receives and verifies Yoco's signed payment.succeeded webhook. Register this HTTPS endpoint with Yoco in the same mode as the key in Render:

https://www.itelements.help/webhooks/yoco

Use the Checkout API webhook registration endpoint POST https://payments.yoco.com/api/webhooks with the matching TEST or LIVE secret key as the Bearer token and JSON body:

{"name":"IT Elements plan activation","url":"https://www.itelements.help/webhooks/yoco"}

Save the whsec_ secret returned by Yoco as YOCO_WEBHOOK_SECRET in Render. Yoco returns this secret only once. Then redeploy. Do not share the secret or a screenshot containing it. When switching between TEST and LIVE, replace both YOCO_SECRET_KEY and YOCO_WEBHOOK_SECRET with keys from the same mode.

LIVE payment caution
--------------------
An sk_live_ key creates real payment checkouts and charges real cards. Confirm your Yoco account is enabled for live payments, verify the LIVE webhook is configured, and only then replace the keys in Render. Do not test the LIVE flow with a customer's card; continue using TEST keys and Yoco test cards until ready.

Support hours
-------------
The home page displays Monday to Friday, 08:00–17:00 South African Standard Time (SAST).

Public information pages
------------------------
The public site now includes Services, On-site Support, About, FAQ, and Contact pages, linked from the site navigation. The on-site enquiry form records requests in the support queue for admin follow-up; it does not confirm an appointment or promise coverage. Confirm location, availability, and any call-out or service cost before booking. The pages describe support options, payment behavior, contact details, support hours, and safe handling of remote session credentials.

Plan behavior
-------------
The server accepts only the four plan IDs and fixed prices in the dashboard. After a signed successful payment, it updates the matching customer's MongoDB profile to Active for 30 days. The dashboard shows the plan and expiry and waits for Yoco's confirmation after checkout. The old fake browser token and YocoSDK popup are removed.

Yoco Checkout API payments are one-time payments; Yoco's gateway does not automatically renew recurring subscriptions. These plans therefore require manual renewal every 30 days. The R299, R599, R2,499, and R4,999 prices are charged once per selected 30-day period.

This code requires Node.js 18 or newer and the existing dependencies express, mongoose, express-session, and cors. Register a test webhook and use Yoco test card details while testing.

Admin console
-------------
The admin page now reads live ticket, subscriber, and confirmed Yoco plan-payment data from the protected server APIs. It includes search/status filtering, automatic refresh, ticket status actions, subscriber expiry, and reveal/copy controls for remote IDs and session keys. The confirmed revenue card sums only Yoco plan payments saved as paid; it does not include hourly incident payments.

Password reset
--------------
The login page now links to a real reset flow. Add and verify your sending domain in Resend, create an API key, and set RESEND_API_KEY and RESET_EMAIL_FROM in Render. Resend requires a verified sender domain for production email. The reset URL is random, stored only as a hash, expires after 15 minutes, and works once. Passwords are stored with Node's scrypt hashing; existing plaintext-password accounts are upgraded automatically after their next successful login. Newly reset passwords must be at least 12 characters. No reset emails are sent until the Resend environment values are configured.

The reset email uses Resend's HTTPS email API; no additional Node package is needed. See https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/domains/introduction.

Registration form
-----------------
The registration form posts to /client/register, matching the server route. It checks the password confirmation in the browser and the server enforces the same 12-character minimum and validates name, phone, and email. New passwords are hashed with scrypt. The name-field example is “IT Elements Support” as requested.
