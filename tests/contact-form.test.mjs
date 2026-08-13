import assert from 'node:assert/strict';
import test from 'node:test';
import { Window } from 'happy-dom';

import { installCollaborationForm } from '../contact-form.mjs';

const FORM_HTML = `
  <form data-collaboration-form data-submit-url="https://worker.example/contact" novalidate>
    <input name="country" required maxlength="100">
    <select name="organizationType" required><option value=""></option><option value="enterprise">企业</option></select>
    <input name="givenName" required maxlength="100">
    <input name="familyName" required maxlength="100">
    <input name="workEmail" type="email" required maxlength="254">
    <input name="phone" maxlength="50">
    <input name="organizationName" maxlength="200">
    <input name="organizationWebsite" type="url" maxlength="500">
    <textarea name="requirements" required maxlength="5000"></textarea>
    <input name="fax">
    <button type="submit" data-collaboration-submit disabled><span data-submit-label>提交合作需求</span></button>
    <p data-form-status></p>
  </form>
`;

function mountForm(window) {
  window.document.body.innerHTML = FORM_HTML;
  globalThis.FormData = window.FormData;
  return { window, form: window.document.querySelector('form') };
}

function createForm() {
  return mountForm(new Window({ url: 'https://a5507203.github.io/melsy/' }));
}

function fillValidForm(form) {
  form.elements.country.value = '中国';
  form.elements.organizationType.value = 'enterprise';
  form.elements.givenName.value = '小明';
  form.elements.familyName.value = '王';
  form.elements.workEmail.value = 'visitor@example.com';
  form.elements.phone.value = '13800000000';
  form.elements.organizationName.value = '示例公司';
  form.elements.organizationWebsite.value = 'https://example.com';
  form.elements.requirements.value = '希望了解空间训练场。';
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('invalid input does not call fetch and focuses the first invalid field', async () => {
  const { form, window } = createForm();
  let calls = 0;
  installCollaborationForm(form, { fetchImpl: async () => { calls += 1; } });

  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls, 0);
  assert.equal(window.document.activeElement, form.elements.country);
  assert.equal(form.elements.country.getAttribute('aria-invalid'), 'true');
  assert.match(form.querySelector('[data-form-status]').textContent, /必填项/);
});

test('valid input posts once, disables during flight, and resets after acceptance', async () => {
  const { form, window } = createForm();
  fillValidForm(form);
  let release;
  const requestFinished = new Promise((resolve) => { release = resolve; });
  const calls = [];
  installCollaborationForm(form, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      await requestFinished;
      return jsonResponse({ ok: true, requestId: 'request-1' });
    },
  });

  const event = new window.Event('submit', { bubbles: true, cancelable: true });
  form.dispatchEvent(event);
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 1);
  assert.equal(form.getAttribute('aria-busy'), 'true');
  assert.equal(form.querySelector('button').disabled, true);
  assert.equal(calls[0].url, 'https://worker.example/contact');
  assert.equal(calls[0].options.method, 'POST');
  const body = JSON.parse(calls[0].options.body);
  assert.match(body.submissionId, /^[0-9a-f-]{36}$/i);
  assert.equal(body.workEmail, 'visitor@example.com');

  release();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(form.elements.country.value, '');
  assert.equal(form.querySelector('button').disabled, false);
  assert.equal(form.hasAttribute('aria-busy'), false);
  assert.match(form.querySelector('[data-form-status]').textContent, /合作需求已提交/);

  const { form: refreshedForm } = mountForm(window);
  installCollaborationForm(refreshedForm, { fetchImpl: async () => jsonResponse({ ok: true }) });
  assert.equal(refreshedForm.elements.workEmail.value, '');
  assert.equal(refreshedForm.elements.requirements.value, '');
});

test('provider failure preserves the draft and reuses the submission id after refresh', async () => {
  const { form, window } = createForm();
  fillValidForm(form);
  const ids = [];
  let attempt = 0;
  installCollaborationForm(form, {
    fetchImpl: async (_url, options) => {
      ids.push(JSON.parse(options.body).submissionId);
      attempt += 1;
      if (attempt === 1) return jsonResponse({ ok: false, error: { code: 'EMAIL_PROVIDER_ERROR' } }, 502);
      return jsonResponse({ ok: true, requestId: 'request-2' });
    },
  });

  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(form.elements.country.value, '中国');
  assert.match(form.querySelector('[data-form-status]').textContent, /内容已保留/);

  const { form: refreshedForm } = mountForm(window);
  installCollaborationForm(refreshedForm, {
    fetchImpl: async (_url, options) => {
      ids.push(JSON.parse(options.body).submissionId);
      return jsonResponse({ ok: true, requestId: 'request-2' });
    },
  });
  assert.equal(refreshedForm.elements.country.value, '中国');
  assert.equal(refreshedForm.elements.workEmail.value, 'visitor@example.com');

  refreshedForm.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(refreshedForm.elements.country.value, '');
});

test('refresh restores visible fields but never restores the honeypot', () => {
  const { form, window } = createForm();
  installCollaborationForm(form, { fetchImpl: async () => jsonResponse({ ok: true }) });
  fillValidForm(form);
  form.elements.fax.value = 'bot-only-value';
  form.elements.requirements.dispatchEvent(new window.Event('input', { bubbles: true }));

  const { form: refreshedForm } = mountForm(window);
  installCollaborationForm(refreshedForm, { fetchImpl: async () => jsonResponse({ ok: true }) });

  assert.deepEqual(
    {
      country: refreshedForm.elements.country.value,
      organizationType: refreshedForm.elements.organizationType.value,
      givenName: refreshedForm.elements.givenName.value,
      familyName: refreshedForm.elements.familyName.value,
      workEmail: refreshedForm.elements.workEmail.value,
      phone: refreshedForm.elements.phone.value,
      organizationName: refreshedForm.elements.organizationName.value,
      organizationWebsite: refreshedForm.elements.organizationWebsite.value,
      requirements: refreshedForm.elements.requirements.value,
    },
    {
      country: '中国',
      organizationType: 'enterprise',
      givenName: '小明',
      familyName: '王',
      workEmail: 'visitor@example.com',
      phone: '13800000000',
      organizationName: '示例公司',
      organizationWebsite: 'https://example.com',
      requirements: '希望了解空间训练场。',
    },
  );
  assert.equal(refreshedForm.elements.fax.value, '');
});

test('silent browser autofill rotates the restored submission id before submit', async () => {
  const { form, window } = createForm();
  installCollaborationForm(form, { fetchImpl: async () => jsonResponse({ ok: true }) });
  fillValidForm(form);
  form.elements.requirements.dispatchEvent(new window.Event('input', { bubbles: true }));

  const initialCalls = [];
  const { form: firstRefresh } = mountForm(window);
  installCollaborationForm(firstRefresh, {
    fetchImpl: async (_url, options) => {
      initialCalls.push(JSON.parse(options.body));
      return jsonResponse({ ok: false, error: { code: 'EMAIL_PROVIDER_ERROR' } }, 502);
    },
  });
  firstRefresh.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  const changedCalls = [];
  const { form: secondRefresh } = mountForm(window);
  installCollaborationForm(secondRefresh, {
    fetchImpl: async (_url, options) => {
      changedCalls.push(JSON.parse(options.body));
      return jsonResponse({ ok: true, requestId: 'request-autofill' });
    },
  });
  secondRefresh.elements.workEmail.value = 'autofill@example.com';
  secondRefresh.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(initialCalls.length, 1);
  assert.equal(changedCalls.length, 1);
  assert.notEqual(changedCalls[0].submissionId, initialCalls[0].submissionId);
  assert.equal(changedCalls[0].workEmail, 'autofill@example.com');
});

test('storage failure does not block form submission', async () => {
  const { form, window } = createForm();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    installCollaborationForm(form, {
      draftStorage: {
        getItem() {
          throw new Error('storage disabled');
        },
      },
      fetchImpl: async () => jsonResponse({ ok: true, requestId: 'request-storage' }),
    });
    fillValidForm(form);
    form.elements.requirements.dispatchEvent(new window.Event('input', { bubbles: true }));
    form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    console.warn = originalWarn;
  }

  assert(warnings.length >= 1);
  assert.equal(form.elements.country.value, '');
  assert.match(form.querySelector('[data-form-status]').textContent, /合作需求已提交/);
});

test('editing during flight preserves the newer draft after the accepted request', async () => {
  const { form, window } = createForm();
  fillValidForm(form);
  let release;
  const requestFinished = new Promise((resolve) => { release = resolve; });
  installCollaborationForm(form, {
    fetchImpl: async () => {
      await requestFinished;
      return jsonResponse({ ok: true, requestId: 'request-3' });
    },
  });

  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  form.elements.requirements.value = '提交期间补充的新内容';
  form.elements.requirements.dispatchEvent(new window.Event('input', { bubbles: true }));
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(form.elements.requirements.value, '提交期间补充的新内容');
  assert.match(form.querySelector('[data-form-status]').textContent, /修改已保留/);

  const { form: refreshedForm } = mountForm(window);
  installCollaborationForm(refreshedForm, { fetchImpl: async () => jsonResponse({ ok: true }) });
  assert.equal(refreshedForm.elements.requirements.value, '提交期间补充的新内容');
});
