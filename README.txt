IT Elements website: current file set
====================================

Complete website package
-------------------------
This ZIP contains server.js, package.json, .env.example, .gitignore, README.txt, all current views, and all current public assets. Upload the contents into the root of your existing GitHub repository while keeping the views/ and public/ folder structure. Keep your existing Render environment variables; never upload a real .env file or paste secrets into GitHub.

Important flow
--------------
- Pricing buttons use /subscribe/:planId. The server validates the plan, saves it in the session, and sends signed-out customers to login.
- Successful login or registration returns the customer to the selected plan checkout.
- The plan amount comes from the server-side plan table, not from the browser.
- Yoco confirms the payment with the signed webhook before the plan becomes Active.
- Plans are one-time 30-day payments with manual renewal; they are not automatic recurring subscriptions.

Legacy files
------------
This complete package does not include legacy billing.html, billing.txt, login.html, package.txt, or yoco-sdk.js files. Leave any such existing repository files in place unless you have confirmed they are unused; they are not needed by the current server routes.

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
The public site now includes Services, On-site Support, About, FAQ, and Contact pages, linked from the site navigation. The Services page explains remote, plan, incident, and in-person help options. The on-site enquiry form records structured requests in the admin queue and links them to a customer portal by the email address entered; it does not confirm an appointment or promise coverage. Confirm location, availability, and any call-out or service cost before booking. Customers can follow their submitted on-site enquiries in their dashboard when they use the same email address as their account. The pages describe support options, payment behavior, contact details, support hours, and safe handling of remote session credentials.

Plan behavior
-------------
The server accepts only the four plan IDs and fixed prices in the dashboard. After a signed successful payment, it updates the matching customer's MongoDB profile to Active for 30 days. The dashboard shows the plan and expiry and waits for Yoco's confirmation after checkout. The old fake browser token and YocoSDK popup are removed.

Yoco Checkout API payments are one-time payments; Yoco's gateway does not automatically renew recurring subscriptions. These plans therefore require manual renewal every 30 days. The R299, R599, R2,499, and R4,999 prices are charged once per selected 30-day period.

This package requires Node.js 18 or newer. Its package.json includes express, mongoose, express-session, and cors. Register a test webhook and use Yoco test card details while testing.

Admin console
-------------
The admin page reads live ticket, on-site enquiry, subscriber, and confirmed Yoco plan-payment data from the protected server APIs. It includes search/status filtering, automatic refresh, configurable 5/10/20/30/all row limits for active and resolved tickets, Hold/Unhold/Resolve/Reopen actions, subscriber expiry, and reveal/copy controls for remote IDs and session keys. On-site requests appear in a dedicated queue with area, preferred date, service, issue, and tap-to-email/call links. The confirmed revenue card sums only Yoco plan payments saved as paid; it does not include hourly incident payments.

Password reset
--------------
The login page now links to a real reset flow. Add and verify your sending domain in Resend, create an API key, and set RESEND_API_KEY and RESET_EMAIL_FROM in Render. Resend requires a verified sender domain for production email. The reset URL is random, stored only as a hash, expires after 15 minutes, and works once. Passwords are stored with Node's scrypt hashing; existing plaintext-password accounts are upgraded automatically after their next successful login. Newly reset passwords must be at least 12 characters. No reset emails are sent until the Resend environment values are configured.

The reset email uses Resend's HTTPS email API; no additional Node package is needed. See https://resend.com/docs/api-reference/emails/send-email and https://resend.com/docs/dashboard/domains/introduction.

Registration form
-----------------
The registration form posts to /client/register, matching the server route. It checks the password confirmation in the browser and the server enforces the same 12-character minimum and validates name, phone, and email. New passwords are hashed with scrypt. The name-field example is “IT Elements Support” as requested.


Customer email updates and feedback
-----------------------------------
After a customer submits a support or on-site request, the site sends an acknowledgement when Resend is configured. When you update a request status in Admin, the customer receives an email with the new status. A successful plan payment confirmed by Yoco also triggers a plan confirmation email. The optional SUPPORT_EMAIL_FROM sender overrides RESET_EMAIL_FROM for these messages; both must use a sender identity verified with Resend. The home page accepts customer feedback, but new reviews are Pending and do not appear until an admin approves them. Only reviews with explicit publishing consent are shown publicly.

On-site request workflow
------------------------
On-site requests appear in their own Admin section and in the customer dashboard. Move requests through Open, Contacted, Visit Confirmed, and Completed (or On Hold / Resolved). A submitted enquiry is not a confirmed appointment: contact the customer to agree coverage, date, and any call-out/service charge before setting Visit Confirmed.

Remote session password protection
----------------------------------
Remote session passwords are encrypted in MongoDB and are cleared when a request is marked Completed or Resolved. Admin may reveal/copy a password only while a request is open. Keep SESSION_SECRET unchanged after this version first encrypts existing saved passwords; changing it makes previously encrypted passwords unreadable. The customer dashboard API never returns remote session passwords.
Appointment booking flow
------------------------
On the On-site Support page, customers can request a preferred date and time. This is only a request, not a booking. In Admin, contact the customer, check area coverage, then enter the agreed future visit date/time and call-out fee (enter 0 when no fee applies) and select Confirm visit. The customer receives an email with the confirmed appointment and fee, and the same details appear in their dashboard. If the appointment changes, confirm the new date/time and fee again to email the update. The customer must use the same email address as their account to see the request in the dashboard.
Remote support session booking
-----------------------------
The client dashboard remote ticket form includes optional preferred date and time. These are requests only. Admin can mark a ticket Contacted, then use Confirm session and enter the agreed future date/time. The server saves the confirmation and emails the customer; the confirmed session time appears with the ticket in the dashboard. On-site bookings use the separate date/time and call-out fee flow described above.
Ticket conversation replies
---------------------------
Customers signed in to the client portal can open a Conversation on any of their remote tickets or on-site enquiries and send a reply (maximum 2,000 characters). Admin can open the same thread on the ticket row and respond. Customer access is restricted to tickets matching the account email; Admin replies require an admin session. Conversation history is stored with the ticket and capped to the latest 100 messages. Email notifications do not include message text; they direct users back to the portal. Do not send account passwords, card details, or temporary remote passwords in conversation messages.
New ticket-reply notifications
-----------------------------
Customer and Admin replies are stored on the ticket. With the existing Resend API key and verified sender, the site emails the customer when Admin replies and sends an Admin notification when a customer replies. Notification messages do not quote the conversation text. By default, customer-reply notices go to bongani@itelements.co.za; set SUPPORT_NOTIFICATION_EMAIL in Render if you want another inbox. No additional package is required.

Dashboard request choices
--------------------------
The client portal separates online AnyDesk/TeamViewer support from an on-site visit enquiry. The two forms create remote and onsite requests respectively and return the customer to the matching status history after submission. On-site requests remain enquiries until Admin confirms the visit date, time, and any call-out fee.


In-app notifications
--------------------
New remote and on-site requests notify the Admin console; customer and admin ticket messages and status changes notify the other party. Notifications are stored in MongoDB and appear in each signed-in portal on all devices. The optional desktop alert permission works while that portal page is open. When the site is closed, email notifications require RESEND_API_KEY, a verified sender, and SUPPORT_NOTIFICATION_EMAIL. Browser alerts are not background push notifications and will not arrive after the browser is closed.
