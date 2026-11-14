IT ELEMENTS — STORE + PAYFAST UPGRADE
=====================================

Files to replace in your existing project:
1. server.js                         -> project root/server.js
2. views/store.html                  -> views/store.html
3. views/index.html                  -> views/index.html
4. The other views/*.html files in this ZIP -> same paths in your project.
   These page updates remove the Invoice Maker navigation item while the feature is paused.

What changed:
- Product detail quantity selector uses a working minus / number / plus control.
- The selected quantity is passed into the cart; stock limits are checked.
- Product gallery supports thumbnail selection, swipe gestures on touch screens,
  and previous/next image arrows.
- Product images use contain sizing so the complete product image is visible.
- Store layout is responsive: four-column catalogue on wide screens and a compact
  two-column layout on phones, with a single-column product detail view on phones.
- Cart checkout collects customer name, email, phone, delivery/collection choice,
  and delivery address where applicable.
- Product checkout creates a server-side order using current MongoDB prices and stock,
  then sends the customer to PayFast.
- Only a verified PayFast COMPLETE notification marks the order paid and reduces stock.
- A payment return page checks the server-side payment status before clearing the cart.
- Invoice Maker navigation is hidden and its old URL temporarily redirects to /store.
  The invoice-maker.html file and existing invoice records are not deleted.
- Homepage text now makes it clear that IT Elements sells products as well as services.

IMPORTANT PAYFAST SETTINGS
The following Render environment variables must be configured correctly:
- PAYFAST_MERCHANT_ID
- PAYFAST_MERCHANT_KEY
- PAYFAST_MODE (live or test)
- PAYFAST_PASSPHRASE (if enabled in your PayFast account)
- PUBLIC_BASE_URL=https://www.itelements.help

Optional order notification email:
- SUPPORT_EMAIL or ADMIN_EMAIL
The customer's order confirmation uses the existing Resend settings:
- RESEND_API_KEY
- SUPPORT_EMAIL_FROM or RESET_EMAIL_FROM

Deploy steps:
1. Download and extract this ZIP.
2. Back up your current server.js and views folder.
3. Replace the files using the exact paths listed above. Do not replace package.json.
4. Commit/push the changed files to GitHub so Render deploys them.
5. In Render, confirm the PayFast environment variables and webhook URL:
   https://www.itelements.help/webhooks/payfast
6. Test first with PayFast test mode and a low-value product before switching to live.

Notes:
- No Shopify checkout or Shopify account is used.
- Delivery fees are not added automatically; IT Elements must confirm delivery costs
  before dispatch. The checkout currently charges the listed product total.
- Product orders are stored in the existing payfastpurchases MongoDB collection.
- The product order notification is sent to the customer; an admin copy is sent only
  if SUPPORT_EMAIL or ADMIN_EMAIL is configured.
- The code passed Node.js syntax checks. It has not been deployed or tested against
  your live PayFast merchant account from this workspace.
