// payout-settings.js: lets a hoster connect their bank/mobile money account
// for automatic split payouts on future bookings

const container = document.getElementById('payout-container');
let resolvedAccountName = null;

function gate(message, customHeading) {
  let heading = customHeading;
  let shownMessage = message;
  let isLoginIssue = !customHeading;

  if (isLoginIssue) {
    const expired = window.wasRecentlyLoggedIn && window.wasRecentlyLoggedIn();
    heading = expired ? 'Your session has expired' : 'Please log in';
    if (expired) {
      shownMessage = "For your security, you're logged out after a period of inactivity. Please log in again to continue.";
      if (window.clearLoggedInFlag) window.clearLoggedInFlag();
    }
  }

  container.innerHTML = `
    <div class="gate-message">
      <div class="icon-lock">🔑</div>
      <h2>${heading}</h2>
      <p>${shownMessage}</p>
      <a href="/login.html" class="btn btn-gold">Log in</a>
    </div>
  `;
}

function formHTML(status) {
  return `
    <div class="form-wrap">
      ${status.isSetUp ? `
        <div class="form-success" style="display:block;">
          Payouts are set up. ${status.accountName} at ${status.bankName} (${status.accountNumberMasked}).
          Every booking payment now automatically sends you ${100 - status.platformFeePercent}% directly, KellyLodge keeps ${status.platformFeePercent}% as a platform fee.
        </div>
        <p class="form-note" style="margin-top:1rem;">Want to change your payout account? Fill in new details below to replace it.</p>
      ` : `
        <p class="form-note">You haven't set up payouts yet. Until you do, your share of any booking payment stays with KellyLodge, add your account below to start receiving it automatically.</p>
      `}

      <div class="form-error" id="form-error"></div>
      <div class="form-success" id="form-success" style="display:none;"></div>

      <form id="payout-form">
        <div class="form-group">
          <label for="bank">Bank or mobile money network</label>
          <select id="bank" name="bank" required>
            <option value="">Loading banks…</option>
          </select>
        </div>
        <div class="form-group">
          <label for="account_number">Account number</label>
          <input type="text" id="account_number" name="account_number" inputmode="numeric" required />
        </div>
        <button type="button" class="btn btn-outline btn-block" id="verify-btn">Verify account</button>

        <div id="verified-name-box" style="display:none; margin-top:1rem;">
          <p class="form-note">Account holder name (confirm this is you before saving):</p>
          <p style="font-weight:700; font-family:var(--font-display); font-size:1.05rem;" id="verified-name-text"></p>
        </div>

        <button type="submit" class="btn btn-gold btn-block" id="save-btn" style="margin-top:1rem;" disabled>Save payout details</button>
      </form>
    </div>
  `;
}

async function loadBanks() {
  const select = document.getElementById('bank');
  try {
    const res = await fetch('/api/payouts/banks', { credentials: 'include' });
    const banks = await res.json();
    if (!res.ok) throw new Error(banks.error || 'Could not load banks.');

    select.innerHTML = '<option value="">Select your bank or mobile money network</option>' +
      banks.map((b) => `<option value="${b.code}" data-name="${b.name}">${b.name}</option>`).join('');
  } catch (err) {
    select.innerHTML = '<option value="">Could not load banks, please refresh</option>';
  }
}

function attachForm() {
  const form = document.getElementById('payout-form');
  const errorBox = document.getElementById('form-error');
  const successBox = document.getElementById('form-success');
  const verifyBtn = document.getElementById('verify-btn');
  const saveBtn = document.getElementById('save-btn');
  const nameBox = document.getElementById('verified-name-box');
  const nameText = document.getElementById('verified-name-text');

  // Any change to bank/account number invalidates a previous verification,
  // since we should never save an account name that doesn't match what was
  // actually typed.
  ['bank', 'account_number'].forEach((id) => {
    document.getElementById(id).addEventListener('input', () => {
      resolvedAccountName = null;
      nameBox.style.display = 'none';
      saveBtn.disabled = true;
    });
  });

  verifyBtn.addEventListener('click', async () => {
    errorBox.style.display = 'none';
    const bankCode = document.getElementById('bank').value;
    const accountNumber = document.getElementById('account_number').value.trim();

    if (!bankCode || !accountNumber) {
      errorBox.textContent = 'Select a bank and enter your account number first.';
      errorBox.style.display = 'block';
      return;
    }

    verifyBtn.disabled = true;
    verifyBtn.textContent = 'Verifying…';

    try {
      const res = await secureFetch('/api/payouts/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: accountNumber, bank_code: bankCode }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorBox.textContent = data.error || 'Could not verify that account.';
        errorBox.style.display = 'block';
        verifyBtn.disabled = false;
        verifyBtn.textContent = 'Verify account';
        return;
      }

      resolvedAccountName = data.accountName;
      nameText.textContent = data.accountName;
      nameBox.style.display = 'block';
      saveBtn.disabled = false;
    } catch (err) {
      errorBox.textContent = 'Could not reach the server. Please try again.';
      errorBox.style.display = 'block';
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.textContent = 'Verify account';
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorBox.style.display = 'none';

    if (!resolvedAccountName) {
      errorBox.textContent = 'Verify your account first, so we can confirm the name matches.';
      errorBox.style.display = 'block';
      return;
    }

    const bankSelect = document.getElementById('bank');
    const bankCode = bankSelect.value;
    const bankName = bankSelect.selectedOptions[0]?.dataset.name || bankSelect.selectedOptions[0]?.textContent;
    const accountNumber = document.getElementById('account_number').value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    try {
      const res = await secureFetch('/api/payouts/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_number: accountNumber, bank_code: bankCode, bank_name: bankName }),
      });
      const data = await res.json();

      if (!res.ok) {
        errorBox.textContent = data.error || 'Could not save payout details.';
        errorBox.style.display = 'block';
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save payout details';
        return;
      }

      successBox.textContent = data.message;
      successBox.style.display = 'block';
      form.reset();
      document.getElementById('verified-name-box').style.display = 'none';
    } catch (err) {
      errorBox.textContent = 'Could not reach the server. Please try again.';
      errorBox.style.display = 'block';
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save payout details';
    }
  });
}

async function init() {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  const { user } = await res.json();

  if (!user) return gate('You need to log in to manage payout settings.');
  if (user.role === 'student') return gate('Only hostel owners have payout settings.', 'Not for this account');

  try {
    const statusRes = await fetch('/api/payouts/status', { credentials: 'include' });
    const status = await statusRes.json();
    if (!statusRes.ok) throw new Error(status.error);

    container.innerHTML = formHTML(status);
    await loadBanks();
    attachForm();
  } catch (err) {
    console.error(err);
    container.innerHTML = '<p class="state-message">Could not load payout settings.</p>';
  }
}

init();
