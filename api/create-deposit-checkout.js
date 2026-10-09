// Creates a Stripe-hosted Checkout page for the $50 refundable reservation deposit.
// Runs as a Vercel serverless function at /api/create-deposit-checkout.
//
// Needs one environment variable in Vercel (Settings -> Environment Variables):
//   STRIPE_SECRET_KEY  your Stripe secret or restricted key (sk_test_... or rk_test_... while testing)
// Optional:
//   SITE_URL           where customers return after paying (defaults to the live site)

const Stripe = require('stripe');

const DEPOSIT_CENTS = 5000; // fixed on the server so the page can't change it
const SITE_URL = (process.env.SITE_URL || 'https://www.milwaukeebinco.com').replace(/\/$/, '');

// Stripe metadata values are capped at 500 characters.
function clean(value, max = 500) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().slice(0, max);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(500).json({ error: 'Payments are not set up yet.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = null; }
  }
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Missing reservation details.' });
  }

  const name = clean(body.name, 100);
  const email = clean(body.email, 200);
  const dropDate = clean(body.drop_off_date, 100);
  if (!name || !dropDate) {
    return res.status(400).json({ error: 'Missing name or drop-off date.' });
  }

  const order = clean(body.order, 200);
  const metadata = {
    name,
    phone: clean(body.phone, 50),
    order,
    drop_off_date: dropDate,
    drop_off_address: clean(body.drop_off_address),
    pick_up_address: clean(body.pick_up_address),
    getting_bins: clean(body.getting_bins, 100),
    returning_bins: clean(body.returning_bins, 100),
    rental_total: clean(body.rental_total, 20)
  };

  // Send customers back to the site they came from (the live domain or a Vercel preview).
  const origin = String(req.headers.origin || '');
  const returnTo = /^https:\/\/([a-z0-9-]+\.)*(milwaukeebinco\.com|vercel\.app)$/i.test(origin) ? origin : SITE_URL;

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: DEPOSIT_CENTS,
          product_data: {
            name: 'Refundable reservation deposit',
            description: (order ? order + ', ' : '') + 'drop-off ' + dropDate
          }
        }
      }],
      // Saves the customer in Stripe so the rental balance invoice can go to the same record.
      customer_creation: 'always',
      customer_email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : undefined,
      billing_address_collection: 'required',
      metadata,
      payment_intent_data: {
        description: 'Reservation deposit: ' + name + ', ' + dropDate,
        metadata
      },
      success_url: returnTo + '/?deposit=paid',
      cancel_url: returnTo + '/?deposit=cancelled'
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout error:', err && err.message);
    return res.status(500).json({ error: 'Could not start checkout.' });
  }
};
