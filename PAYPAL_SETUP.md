# PayPal Checkout Update

This package adds PayPal as a second payment option while keeping the existing Square card checkout.

## Files to replace

Copy these three files into the matching locations in your website project:

- `nodejs/server.js`
- `nodejs/public/index.html`
- `nodejs/public/js/main_three_stage.js`

Back up your current files before replacing them.

## PayPal sandbox credentials

Create a PayPal REST application in the PayPal Developer Dashboard, then add these values to your local `.env` file:

```env
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
```

Do not put the client secret in HTML, browser JavaScript, or GitHub.

Restart the Node.js server after changing `.env`.

## Local test

1. Start the website normally.
2. Add a print or calendar to the cart.
3. Complete all customer and shipping fields.
4. Confirm that the Square card form and a PayPal button both appear.
5. Select PayPal and sign in with a PayPal **personal sandbox account**.
6. Complete the payment.
7. Confirm:
   - the success page opens;
   - the cart clears;
   - the order is saved in the database;
   - order emails are sent;
   - print orders continue to WHCC;
   - calendar-only orders are marked for manual fulfillment.

You can check the public PayPal configuration route at:

```text
http://localhost:3000/api/config/paypal
```

It should report `"enabled": true` without exposing the client secret.

## Hostinger deployment

Add these environment variables in Hostinger:

```env
PAYPAL_ENVIRONMENT=sandbox
PAYPAL_CLIENT_ID=your_sandbox_client_id
PAYPAL_CLIENT_SECRET=your_sandbox_client_secret
```

Deploy the three updated files and restart/redeploy the Node.js application.

Test on the deployed site with sandbox credentials before switching to live mode.

## Switch to live PayPal

Create or select your live PayPal REST application, then replace the Hostinger environment variables with:

```env
PAYPAL_ENVIRONMENT=live
PAYPAL_CLIENT_ID=your_live_client_id
PAYPAL_CLIENT_SECRET=your_live_client_secret
```

Restart or redeploy the application.

## Database compatibility

No database migration is required for this version. To preserve compatibility with the existing admin and order code, PayPal IDs are stored in the current payment ID fields with a `paypal:` prefix.

Examples:

```text
square_payment_id: paypal:CAPTURE_ID
square_order_id:   paypal:ORDER_ID
```

They are PayPal IDs despite the older database column names. A later admin-page update can rename the labels to generic “Payment ID” and “Provider Order ID.”

## Security and pricing

- The browser never receives the PayPal client secret.
- The server recalculates order prices from the database and the secure calendar price constant.
- The server verifies print image files before creating or capturing the PayPal order.
- The server checks that the captured PayPal amount matches the server-calculated total.
