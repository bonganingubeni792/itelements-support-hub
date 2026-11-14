IT ELEMENTS — GLOBAL ONLINE STORE NAVIGATION UPDATE

WHAT THIS UPDATE DOES
- Makes Online Store a permanent navigation link on all website pages.
- Keeps the link visible and readable on laptop and phone layouts.
- Standardises the link label to "Online Store".
- Adds a shared navigation fallback script for pages with older/different headers.
- Removes the old quote/invoice maker page from this deployment package.
- Removes the invoice-maker promotion from the client login page.
- Preserves the existing store, PayFast integration, product manager, customer portal and support pages.

DEPLOY
1. Back up the current GitHub repository.
2. Extract this ZIP into the project root, preserving the public/ and views/ folders.
3. Commit and push the changed files to the GitHub repository connected to Render.
4. Wait for Render deployment to finish.
5. Open /services, /onsite-support, /faq, /about, /pricing and /contact. Confirm Online Store appears in each menu.
6. Hard refresh with Ctrl+F5. On phones, close and reopen the browser tab if an older cached page remains.

NOTE
This is a source-code update package; it does not directly modify the live GitHub repository or Render service. Existing MongoDB data is not deleted.
