const DRAFT_FIELD_NAMES = [
  'country',
  'organizationType',
  'givenName',
  'familyName',
  'workEmail',
  'phone',
  'organizationName',
  'organizationWebsite',
  'requirements',
];
const FIELD_NAMES = [...DRAFT_FIELD_NAMES, 'fax'];
const DRAFT_STORAGE_KEY = 'melsy.collaborationDraft.v1';
const STORED_DRAFT_VERSION = 1;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUS_MESSAGES = {
  INVALID_INPUT: '请填写所有必填项，并检查邮箱和网址格式。',
  RATE_LIMITED: '提交较为频繁，请稍后再试。你的填写内容已保留。',
  SERVICE_UNAVAILABLE: '暂时无法提交，你的填写内容已保留。请稍后重试或扫描上方二维码联系我们。',
  SUBMISSION_FAILED: '提交未完成，你的填写内容已保留。请重试或扫描上方二维码联系我们。',
};

function createSubmissionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error('A secure random UUID generator is required for contact submissions.');
}

function setStatus(statusElement, message, state = '') {
  if (!statusElement) return;
  statusElement.textContent = message;
  statusElement.classList.toggle('is-error', state === 'error');
  statusElement.classList.toggle('is-success', state === 'success');
}

function getInvalidFields(form) {
  return [...form.elements].filter(
    (field) => typeof field.checkValidity === 'function' && !field.checkValidity(),
  );
}

function getNamedField(form, name) {
  const field = form.elements.namedItem?.(name) ?? form.elements[name];
  return field && typeof field.value === 'string' ? field : null;
}

function getDraftValues(form) {
  const values = {};
  for (const name of DRAFT_FIELD_NAMES) {
    const field = getNamedField(form, name);
    if (field) values[name] = field.value;
  }
  return values;
}

function getDraftSignature(form) {
  return JSON.stringify(getDraftValues(form));
}

function resolveDraftStorage(form, providedStorage) {
  if (providedStorage !== undefined) return providedStorage;

  try {
    return form.ownerDocument?.defaultView?.sessionStorage ?? null;
  } catch (error) {
    console.warn('Contact form draft storage is unavailable.', error);
    return null;
  }
}

function createDraftStore(form, storage) {
  let activeStorage = storage;

  const disableStorage = (message, error) => {
    console.warn(message, error);
    activeStorage = null;
  };

  const clear = () => {
    if (!activeStorage) return;

    try {
      activeStorage.removeItem(DRAFT_STORAGE_KEY);
    } catch (error) {
      disableStorage('Contact form draft could not be cleared.', error);
    }
  };

  const restore = (fallbackSubmissionId) => {
    if (!activeStorage) return fallbackSubmissionId;

    let storedDraft;
    try {
      const serializedDraft = activeStorage.getItem(DRAFT_STORAGE_KEY);
      if (!serializedDraft) return fallbackSubmissionId;
      storedDraft = JSON.parse(serializedDraft);
    } catch (error) {
      console.warn('Contact form draft could not be restored and was cleared.', error);
      clear();
      return fallbackSubmissionId;
    }

    const isValidDraft = storedDraft
      && typeof storedDraft === 'object'
      && !Array.isArray(storedDraft)
      && storedDraft.version === STORED_DRAFT_VERSION
      && storedDraft.values
      && typeof storedDraft.values === 'object'
      && !Array.isArray(storedDraft.values);

    if (!isValidDraft) {
      console.warn('Contact form draft had an unexpected format and was cleared.');
      clear();
      return fallbackSubmissionId;
    }

    for (const name of DRAFT_FIELD_NAMES) {
      const value = storedDraft.values[name];
      const field = getNamedField(form, name);
      if (!field || typeof value !== 'string') continue;

      if (field.tagName === 'SELECT' && ![...field.options].some((option) => option.value === value)) {
        continue;
      }

      const maxLength = Number(field.maxLength);
      field.value = maxLength > 0 ? value.slice(0, maxLength) : value;
    }

    return UUID_PATTERN.test(storedDraft.submissionId)
      ? storedDraft.submissionId
      : fallbackSubmissionId;
  };

  const save = (submissionId) => {
    if (!activeStorage) return;

    const values = getDraftValues(form);
    if (Object.values(values).every((value) => value === '')) {
      clear();
      return;
    }

    try {
      activeStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({
        version: STORED_DRAFT_VERSION,
        submissionId,
        values,
      }));
    } catch (error) {
      disableStorage('Contact form draft could not be saved.', error);
    }
  };

  return { clear, restore, save };
}

function readPayload(form, submissionId) {
  const values = new FormData(form);
  const payload = { submissionId };
  for (const name of FIELD_NAMES) payload[name] = String(values.get(name) ?? '').trim();
  return payload;
}

async function readResponsePayload(response) {
  try {
    return await response.json();
  } catch (error) {
    console.warn('Contact form received a non-JSON response.', error);
    return null;
  }
}

function resolveErrorMessage(response, payload) {
  const code = payload?.error?.code;
  if (response.status === 422 || code === 'INVALID_INPUT') return STATUS_MESSAGES.INVALID_INPUT;
  if (response.status === 429 || code === 'RATE_LIMITED') return STATUS_MESSAGES.RATE_LIMITED;
  if (response.status === 503 || code === 'SERVICE_UNAVAILABLE') return STATUS_MESSAGES.SERVICE_UNAVAILABLE;
  return STATUS_MESSAGES.SUBMISSION_FAILED;
}

export function installCollaborationForm(
  form,
  { fetchImpl = globalThis.fetch, draftStorage } = {},
) {
  if (!form || typeof fetchImpl !== 'function') return null;

  const endpoint = form.dataset.submitUrl;
  const statusElement = form.querySelector('[data-form-status]');
  const submitButton = form.querySelector('[data-collaboration-submit]');
  const submitLabel = form.querySelector('[data-submit-label]');
  const draftStore = createDraftStore(form, resolveDraftStorage(form, draftStorage));
  let submitting = false;
  let submissionId = draftStore.restore(createSubmissionId());
  let savedDraftSignature = getDraftSignature(form);

  if (!endpoint) {
    console.error('Contact form submit URL is not configured.');
    setStatus(statusElement, STATUS_MESSAGES.SERVICE_UNAVAILABLE, 'error');
    return null;
  }

  if (submitButton) submitButton.disabled = false;

  for (const name of DRAFT_FIELD_NAMES) {
    const field = getNamedField(form, name);
    if (!field) continue;

    const markDraftChanged = () => {
      field.removeAttribute('aria-invalid');
      submissionId = createSubmissionId();
      draftStore.save(submissionId);
      savedDraftSignature = getDraftSignature(form);
    };
    field.addEventListener('input', markDraftChanged);
    field.addEventListener('change', markDraftChanged);
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const currentDraftSignature = getDraftSignature(form);
    if (currentDraftSignature !== savedDraftSignature) submissionId = createSubmissionId();
    draftStore.save(submissionId);
    savedDraftSignature = currentDraftSignature;

    for (const field of form.elements) {
      if (typeof field.removeAttribute === 'function') field.removeAttribute('aria-invalid');
    }

    const invalidFields = getInvalidFields(form);
    if (invalidFields.length > 0) {
      for (const field of invalidFields) field.setAttribute('aria-invalid', 'true');
      setStatus(statusElement, STATUS_MESSAGES.INVALID_INPUT, 'error');
      invalidFields[0].focus();
      return;
    }

    submitting = true;
    form.setAttribute('aria-busy', 'true');
    if (submitButton) submitButton.disabled = true;
    if (submitLabel) submitLabel.textContent = '正在提交';
    setStatus(statusElement, '正在安全提交合作需求，请稍候。');

    try {
      const activeSubmissionId = submissionId;
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(readPayload(form, activeSubmissionId)),
      });
      const responsePayload = await readResponsePayload(response);

      if (!response.ok || responsePayload?.ok !== true) {
        setStatus(statusElement, resolveErrorMessage(response, responsePayload), 'error');
        return;
      }

      if (submissionId === activeSubmissionId) {
        form.reset();
        draftStore.clear();
        submissionId = createSubmissionId();
        savedDraftSignature = getDraftSignature(form);
        setStatus(statusElement, '合作需求已提交，我们会尽快与你联系。', 'success');
      } else {
        setStatus(statusElement, '本次合作需求已提交；你在提交期间的修改已保留。', 'success');
      }
    } catch (error) {
      console.error('Contact form submission failed.', error);
      setStatus(statusElement, STATUS_MESSAGES.SUBMISSION_FAILED, 'error');
    } finally {
      submitting = false;
      form.removeAttribute('aria-busy');
      if (submitButton) submitButton.disabled = false;
      if (submitLabel) submitLabel.textContent = '提交合作需求';
    }
  };

  form.addEventListener('submit', handleSubmit);
  return { handleSubmit };
}

if (typeof document !== 'undefined') {
  for (const form of document.querySelectorAll('[data-collaboration-form]')) {
    installCollaborationForm(form);
  }
}
