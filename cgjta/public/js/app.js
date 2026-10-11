// Progressive enhancements. Every page works without this file.
document.addEventListener('DOMContentLoaded', () => {
  // Confirm destructive actions.
  document.addEventListener('submit', (e) => {
    const btn = e.submitter;
    const msg = btn && btn.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) e.preventDefault();
  });

  // Print buttons.
  document.querySelectorAll('[data-print]').forEach((el) => el.addEventListener('click', () => window.print()));

  // Submit small forms when their select changes (e.g. staff role).
  document.querySelectorAll('form[data-autosubmit] select').forEach((el) => {
    el.addEventListener('change', () => el.form.requestSubmit());
  });

  // Payment form: suggest the tier fee for the chosen type and only show the
  // subscription period for subscriptions.
  const form = document.querySelector('[data-payment-form]');
  if (form) {
    const fees = JSON.parse(form.dataset.fees || '{}');
    const type = form.querySelector('[data-type-select]');
    const amount = form.querySelector('[name="amount"]');
    const period = form.querySelector('[data-for-type="subscription"]');
    let touched = false;
    amount.addEventListener('input', () => { touched = true; });
    const sync = () => {
      period.hidden = type.value !== 'subscription';
      if (!touched) amount.value = fees[type.value] != null ? fees[type.value] : '';
    };
    type.addEventListener('change', sync);
    period.hidden = type.value !== 'subscription';
  }
});
