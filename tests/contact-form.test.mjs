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

function createForm() {
  const window = new Window({ url: 'https://a5507203.github.io/melsy/' });
  window.document.body.innerHTML = FORM_HTML;
  globalThis.FormData = window.FormData;
  return { window, form: window.document.querySelector('form') };
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
});

test('provider failure preserves the draft and reuses the submission id on retry', async () => {
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

  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
  assert.equal(form.elements.country.value, '');
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
});
