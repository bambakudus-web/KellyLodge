// routes/payouts.js — lets a hoster connect their own bank account so
// their share of future bookings pays out automatically via Paystack
// Subaccounts, instead of everything sitting in the platform's account.
const express = require('express');
const router = express.Router();
const pool = require('../db');
const { requireRole } = require('../middleware/auth');
const { listBanks, resolveAccountNumber, createSubaccount, PLATFORM_FEE_PERCENT } = require('../utils/paystack');

// GET /api/payouts/banks — every bank/mobile money network to populate the dropdown
router.get('/banks', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const banks = await listBanks();
    res.json(banks.map((b) => ({ name: b.name, code: b.code })));
  } catch (err) {
    console.error('Error fetching banks:', err);
    res.status(502).json({ error: 'Could not load the bank list right now. Please try again.' });
  }
});

// POST /api/payouts/resolve — confirms an account number is real before
// saving anything, and returns the actual account holder's name so the
// hoster can double check it's really theirs.
router.post('/resolve', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const { account_number, bank_code } = req.body;
    if (!account_number || !bank_code) {
      return res.status(400).json({ error: 'Account number and bank are both required.' });
    }

    const resolved = await resolveAccountNumber(account_number, bank_code);
    res.json({ accountName: resolved.account_name });
  } catch (err) {
    console.error('Error resolving account:', err);
    res.status(400).json({ error: err.message || "Could not verify that account number. Double-check it and try again." });
  }
});

// GET /api/payouts/status — whether this hoster has payouts set up yet, and
// a masked view of their saved details
router.get('/status', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const [[user]] = await pool.query(
      'SELECT paystack_subaccount_code, bank_name, bank_account_number, bank_account_name FROM users WHERE id = ?',
      [req.session.user.id]
    );

    const isSetUp = Boolean(user.paystack_subaccount_code);
    res.json({
      isSetUp,
      bankName: user.bank_name,
      accountNumberMasked: user.bank_account_number ? `••••${user.bank_account_number.slice(-4)}` : null,
      accountName: user.bank_account_name,
      platformFeePercent: PLATFORM_FEE_PERCENT,
    });
  } catch (err) {
    console.error('Error fetching payout status:', err);
    res.status(500).json({ error: 'Could not fetch payout status.' });
  }
});

// POST /api/payouts/setup — creates the Paystack Subaccount and saves it.
// The account number is re-verified server-side (never trust a client-sent
// account name), so what gets saved is only ever what Paystack itself
// confirms the account is actually named.
router.post('/setup', requireRole('hoster', 'admin'), async (req, res) => {
  try {
    const { account_number, bank_code, bank_name } = req.body;
    if (!account_number || !bank_code || !bank_name) {
      return res.status(400).json({ error: 'Bank, account number, and bank name are all required.' });
    }

    const resolved = await resolveAccountNumber(account_number, bank_code);

    const subaccount = await createSubaccount({
      businessName: `${req.session.user.name} (KellyLodge)`,
      bankCode: bank_code,
      accountNumber: account_number,
    });

    await pool.query(
      `UPDATE users
       SET paystack_subaccount_code = ?, bank_name = ?, bank_code = ?, bank_account_number = ?, bank_account_name = ?
       WHERE id = ?`,
      [subaccount.subaccount_code, bank_name, bank_code, account_number, resolved.account_name, req.session.user.id]
    );

    res.status(201).json({
      message: 'Payout details saved. Future bookings will pay out to this account automatically.',
      accountName: resolved.account_name,
    });
  } catch (err) {
    console.error('Error setting up payouts:', err);
    res.status(400).json({ error: err.message || 'Could not set up payouts. Please try again.' });
  }
});

module.exports = router;
