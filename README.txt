IT ELEMENTS — STORE QUANTITY + PAYFAST UPDATE

WHAT IS INCLUDED
- Product detail quantity input plus minus buttons, limited by available stock.
- Add to Cart uses the selected quantity.
- Buy Now opens the existing secure product checkout flow; the button is labelled simply Buy now.
- WhatsApp is retained for product questions only, not as a payment method.
- Product gallery next/previous controls advance from the currently selected image; touch swipe and thumbnails remain available.
- Existing product viewer, cart, checkout form and PayFast product checkout server endpoint are retained.
- Invoice Maker page is not included in this package.

FILES
This is a full project package. Extract the contents into the root of the GitHub repository connected to Render, preserving the public/ and views/ folders.

DEPLOY AND TEST
1. Back up your GitHub project first.
2. Extract this ZIP and replace the matching project files at the repository root.
3. Keep your existing MongoDB URI, session secret, email settings and other required environment variables.
4. In Render, verify PayFast merchant ID, merchant key, mode, optional passphrase, and PUBLIC_BASE_URL are correctly configured. Do not put secrets in GitHub or HTML.
5. Commit and push to GitHub and wait for Render deployment.
6. Test using PayFast sandbox/test mode first. Open a product with stock greater than one, change quantity, add it to cart, and test Buy Now.

VALIDATION
The inline JavaScript in views/store.html and server.js passed Node.js syntax checks. This is not a live PayFast payment test and does not prove production credentials or webhook delivery are configured.

IMPORTANT
This package does not directly update your GitHub repository or Render service. Existing MongoDB data is not deleted. Confirm the deployed version on the live site after Render finishes.
