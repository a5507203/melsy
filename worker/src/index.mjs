const CONTACT_PATH = '/contact';
const HEALTH_PATH = '/health';
const MAX_BODY_BYTES = 16 * 1024;
const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const USER_AGENT = 'melsy-contact-worker/1.0';

const ORGANIZATION_TYPES = new Map([
  ['government', '政府 / 公共机构'],
  ['enterprise', '企业'],
  ['university', '高校 / 科研机构'],
  ['media', '媒体'],
  ['other', '其他'],
]);

const FIELD_RULES = {
  submissionId: { required: true, maxLength: 36 },
  country: { required: true, maxLength: 100 },
  organizationType: { required: true, maxLength: 30 },
  givenName: { required: true, maxLength: 100 },
  familyName: { required: true, maxLength: 100 },
  workEmail: { required: true, maxLength: 254 },
  phone: { required: false, maxLength: 50 },
  organizationName: { required: false, maxLength: 200 },
  organizationWebsite: { required: false, maxLength: 500 },
  requirements: { required: true, maxLength: 5000, multiline: true },
  fax: { required: false, maxLength: 200 },
};

class RequestError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function splitAllowedOrigins(value) {
  return new Set(
    String(value ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function createHeaders(allowedOrigin = null, extra = {}) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extra,
  });

  if (allowedOrigin) {
    headers.set('Access-Control-Allow-Origin', allowedOrigin);
    headers.set('Vary', 'Origin');
  }
  return headers;
}

function jsonResponse(status, payload, allowedOrigin = null, extra = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: createHeaders(allowedOrigin, extra),
  });
}

function errorResponse(error, requestId, allowedOrigin = null) {
  const status = error instanceof RequestError ? error.status : 500;
  const code = error instanceof RequestError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof RequestError
    ? error.message
    : '服务暂时不可用，请稍后重试。';
  const headers = error instanceof RequestError ? error.headers : {};
  return jsonResponse(status, { ok: false, error: { code, message }, requestId }, allowedOrigin, headers);
}

function logEvent({ requestId, event, outcome, status, startedAt }) {
  console.info(JSON.stringify({
    requestId,
    event,
    outcome,
    status,
    durationMs: Date.now() - startedAt,
  }));
}

function requireConfiguration(env) {
  const names = ['RESEND_API_KEY', 'CONTACT_FROM_EMAIL', 'CONTACT_TO_EMAIL', 'ALLOWED_ORIGINS'];
  if (names.some((name) => typeof env?.[name] !== 'string' || env[name].trim() === '')) {
    throw new RequestError(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试。');
  }
  if (!env.CONTACT_ACTOR_RATE_LIMITER?.limit || !env.CONTACT_GLOBAL_RATE_LIMITER?.limit) {
    throw new RequestError(503, 'SERVICE_UNAVAILABLE', '服务暂时不可用，请稍后重试。');
  }
}

async function readBodyWithLimit(request) {
  const declaredLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new RequestError(413, 'PAYLOAD_TOO_LARGE', '提交内容过大，请精简后重试。');
  }

  if (!request.body) throw new RequestError(400, 'INVALID_JSON', '请求内容不是有效的 JSON。');

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let totalBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel('payload too large');
        throw new RequestError(413, 'PAYLOAD_TOO_LARGE', '提交内容过大，请精简后重试。');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'INVALID_JSON', '请求内容不是有效的 JSON。');
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new RequestError(400, 'INVALID_JSON', '请求内容不是有效的 JSON。');
  }
}

function hasDisallowedControlCharacters(value, multiline = false) {
  const allowed = multiline ? value.replace(/[\n\r\t]/g, '') : value;
  return /[\u0000-\u001f\u007f]/.test(allowed);
}

function validateSubmission(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new RequestError(422, 'INVALID_INPUT', '请检查填写内容后重试。');
  }

  const allowedNames = new Set(Object.keys(FIELD_RULES));
  if (Object.keys(payload).some((name) => !allowedNames.has(name))) {
    throw new RequestError(422, 'INVALID_INPUT', '请检查填写内容后重试。');
  }

  const submission = {};
  for (const [name, rule] of Object.entries(FIELD_RULES)) {
    const rawValue = payload[name] ?? '';
    if (typeof rawValue !== 'string') {
      throw new RequestError(422, 'INVALID_INPUT', '请检查填写内容后重试。');
    }
    const value = rawValue.trim();
    if (rule.required && value.length === 0) {
      throw new RequestError(422, 'INVALID_INPUT', '请填写所有必填项。');
    }
    if (value.length > rule.maxLength || hasDisallowedControlCharacters(value, rule.multiline)) {
      throw new RequestError(422, 'INVALID_INPUT', '请检查填写内容的长度与格式。');
    }
    submission[name] = value;
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submission.submissionId)) {
    throw new RequestError(422, 'INVALID_INPUT', '提交标识无效，请刷新页面后重试。');
  }
  if (!ORGANIZATION_TYPES.has(submission.organizationType)) {
    throw new RequestError(422, 'INVALID_INPUT', '请选择有效的机构类型。');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(submission.workEmail)) {
    throw new RequestError(422, 'INVALID_INPUT', '请输入有效的工作邮箱。');
  }
  if (submission.organizationWebsite) {
    try {
      const website = new URL(submission.organizationWebsite);
      if (!['http:', 'https:'].includes(website.protocol)) throw new Error('unsupported protocol');
    } catch (error) {
      throw new RequestError(422, 'INVALID_INPUT', '请输入以 http:// 或 https:// 开头的有效网址。');
    }
  }

  return submission;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  })[character]);
}

function valueOrDash(value) {
  return value || '—';
}

export function createEmailMessage(submission, env) {
  const fields = [
    ['国家 / 地区', submission.country],
    ['机构类型', ORGANIZATION_TYPES.get(submission.organizationType)],
    ['姓名', `${submission.familyName} ${submission.givenName}`],
    ['工作邮箱', submission.workEmail],
    ['联系电话', valueOrDash(submission.phone)],
    ['公司 / 机构名称', valueOrDash(submission.organizationName)],
    ['公司 / 机构网站', valueOrDash(submission.organizationWebsite)],
    ['需求描述', submission.requirements],
  ];
  const text = [
    '收到一条来自墨悉官网的新合作需求。',
    '',
    ...fields.map(([label, value]) => `${label}：${value}`),
    '',
    `提交标识：${submission.submissionId}`,
  ].join('\n');
  const rows = fields.map(([label, value]) => (
    `<tr><th style="padding:10px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #dbe5eb;color:#355366;">${escapeHtml(label)}</th>`
    + `<td style="padding:10px 12px;border-bottom:1px solid #dbe5eb;white-space:pre-wrap;word-break:break-word;color:#0a1720;">${escapeHtml(value)}</td></tr>`
  )).join('');
  const html = `<!doctype html><html lang="zh-CN"><body style="margin:0;background:#f3f6f8;font-family:Arial,'Microsoft YaHei',sans-serif;color:#0a1720;"><main style="max-width:720px;margin:0 auto;padding:28px;"><h1 style="margin:0 0 8px;font-size:24px;">墨悉官网合作需求</h1><p style="margin:0 0 24px;color:#556772;">收到一条新的合作咨询。点击回复将直接回复访客的工作邮箱。</p><table style="width:100%;border-collapse:collapse;background:#fff;">${rows}</table><p style="margin:20px 0 0;color:#70848f;font-size:12px;">提交标识：${escapeHtml(submission.submissionId)}</p></main></body></html>`;

  return {
    from: env.CONTACT_FROM_EMAIL,
    to: [env.CONTACT_TO_EMAIL],
    reply_to: submission.workEmail,
    subject: '[墨悉官网] 新的合作需求',
    text,
    html,
  };
}

async function hashActor(value) {
  const bytes = new TextEncoder().encode(value.toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function enforceRateLimits(submission, env) {
  const actorKey = await hashActor(submission.workEmail);
  const [actorResult, globalResult] = await Promise.all([
    env.CONTACT_ACTOR_RATE_LIMITER.limit({ key: actorKey }),
    env.CONTACT_GLOBAL_RATE_LIMITER.limit({ key: 'contact' }),
  ]);
  if (!actorResult.success || !globalResult.success) {
    throw new RequestError(
      429,
      'RATE_LIMITED',
      '提交较为频繁，请稍后再试。',
      { 'Retry-After': '60' },
    );
  }
}

async function sendEmail(submission, env, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `melsy-contact/${submission.submissionId}`,
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(createEmailMessage(submission, env)),
    });
  } catch (error) {
    throw new RequestError(502, 'EMAIL_PROVIDER_ERROR', '暂时无法提交，请稍后重试。');
  }

  let result = null;
  try {
    result = await response.json();
  } catch {
    throw new RequestError(502, 'EMAIL_PROVIDER_ERROR', '暂时无法提交，请稍后重试。');
  }
  if (!response.ok || typeof result?.id !== 'string' || result.id.length === 0) {
    throw new RequestError(502, 'EMAIL_PROVIDER_ERROR', '暂时无法提交，请稍后重试。');
  }
}

async function processContactRequest(request, env, fetchImpl) {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new RequestError(415, 'UNSUPPORTED_MEDIA_TYPE', '请使用 JSON 格式提交。');
  }

  const payload = await readBodyWithLimit(request);
  const submission = validateSubmission(payload);

  if (submission.fax) return { honeypot: true };

  await enforceRateLimits(submission, env);
  await sendEmail(submission, env, fetchImpl);
  return { honeypot: false };
}

export async function handleRequest(request, env, { fetchImpl = globalThis.fetch } = {}) {
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const url = new URL(request.url);

  if (url.pathname === HEALTH_PATH && request.method === 'GET') {
    const response = jsonResponse(200, { ok: true, requestId });
    logEvent({ requestId, event: 'health_check', outcome: 'ok', status: response.status, startedAt });
    return response;
  }

  if (url.pathname !== CONTACT_PATH) {
    const response = jsonResponse(404, { ok: false, error: { code: 'NOT_FOUND', message: '未找到该接口。' }, requestId });
    logEvent({ requestId, event: 'contact_request', outcome: 'not_found', status: response.status, startedAt });
    return response;
  }

  let allowedOrigin = null;
  try {
    requireConfiguration(env);
    const origin = request.headers.get('Origin') ?? '';
    const allowedOrigins = splitAllowedOrigins(env.ALLOWED_ORIGINS);
    if (!allowedOrigins.has(origin)) {
      throw new RequestError(403, 'ORIGIN_NOT_ALLOWED', '该请求来源不受支持。');
    }
    allowedOrigin = origin;

    if (request.method === 'OPTIONS') {
      const response = new Response(null, {
        status: 204,
        headers: createHeaders(allowedOrigin, {
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Max-Age': '86400',
        }),
      });
      logEvent({ requestId, event: 'contact_preflight', outcome: 'ok', status: response.status, startedAt });
      return response;
    }

    if (request.method !== 'POST') {
      throw new RequestError(405, 'METHOD_NOT_ALLOWED', '该接口只接受 POST 请求。', { Allow: 'POST, OPTIONS' });
    }

    const { honeypot } = await processContactRequest(request, env, fetchImpl);
    const response = jsonResponse(200, { ok: true, requestId }, allowedOrigin);
    logEvent({
      requestId,
      event: 'contact_submission',
      outcome: honeypot ? 'honeypot_ignored' : 'accepted',
      status: response.status,
      startedAt,
    });
    return response;
  } catch (error) {
    if (!(error instanceof RequestError)) console.error('Unexpected contact worker failure.', error);
    const response = errorResponse(error, requestId, allowedOrigin);
    logEvent({
      requestId,
      event: 'contact_submission',
      outcome: error instanceof RequestError ? error.code.toLowerCase() : 'internal_error',
      status: response.status,
      startedAt,
    });
    return response;
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
