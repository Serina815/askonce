'use strict';

const config = require('../config');

/**
 * AI 参考答案（OpenAI 兼容接口）。
 * 只做一件事：针对「问题 + 报错 + 场景」给一份 what / why / how 的独立参考，
 * 用来跟学习者自己写的三问对照。绝不写回 q_* 字段。
 */

const SYSTEM_PROMPT = [
  '你是技术学习助教。学习者已经自己写过「是什么 / 为什么 / 怎么做」，现在需要一份独立参考答案用来对照。',
  '只依据用户提供的问题、报错与场景作答，不要编造不存在的命令、参数或文件名。',
  '信息不足时用"可能是……"表述，并在 why 里说明不确定的地方。',
  '输出必须是 JSON 对象，字段顺序如下：',
  '{"what":"问题的本质，一句话",',
  ' "why":"背后的原因与权衡，3 句以内，讲清为什么会这样",',
  ' "how":"可执行步骤，用 1. 2. 3. 分行，最多 5 条"}',
  '全部使用简体中文。不要输出 Markdown 代码块，不要输出 JSON 以外的任何文字。',
].join('\n');

function endpoint(baseUrl) {
  return /\/v\d+$/i.test(baseUrl) ? `${baseUrl}/chat/completions` : `${baseUrl}/v1/chat/completions`;
}

function parseLooseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    /* 继续 */
  }
  const fenced = String(text).match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]);
    } catch (_) {
      /* 继续 */
    }
  }
  const braces = String(text).match(/\{[\s\S]*\}/);
  if (braces) {
    try {
      return JSON.parse(braces[0]);
    } catch (_) {
      /* 继续 */
    }
  }
  return null;
}

function str(value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

async function callApi(messages, { withJsonMode = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);

  const body = {
    model: config.ai.model,
    messages,
    temperature: 0.2,
    max_tokens: 900,
  };
  if (withJsonMode) body.response_format = { type: 'json_object' };

  try {
    const res = await fetch(endpoint(config.ai.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const text = await res.text();

    if (!res.ok) {
      const err = new Error(`AI 接口返回 ${res.status}：${text.slice(0, 200)}`);
      err.statusCode = res.status;
      err.body = text;
      throw err;
    }

    const data = JSON.parse(text);
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 返回为空');
    return content;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @returns {Promise<{ok:true, ref:{what:string,why:string,how:string}, model:string} | {ok:false, error:string}>}
 */
async function generateReference({ title, errorText, context, myWhat, myWhy, myHow }) {
  if (!config.ai.enabled) {
    return { ok: false, error: '还没有配置 AI_API_KEY，先填 .env 再试' };
  }

  const user = [
    `问题：${str(title, 300)}`,
    errorText ? `报错原文：\n${str(errorText, 2000)}` : '（没有报错原文）',
    context ? `场景：${str(context, 500)}` : '',
    myWhat ? `我自己写的「是什么」：${str(myWhat, 800)}` : '',
    myWhy ? `我自己写的「为什么」：${str(myWhy, 800)}` : '',
    myHow ? `我自己写的「怎么做」：${str(myHow, 1200)}` : '',
    '（上面是我自己的理解，请给出一份独立的参考答案用于对照，不要复述我的原话。）',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];

  let content;
  try {
    content = await callApi(messages, { withJsonMode: true });
  } catch (err) {
    // 部分兼容接口不支持 response_format，退回普通模式再试一次
    if (err.statusCode === 400) {
      try {
        content = await callApi(messages, { withJsonMode: false });
      } catch (err2) {
        return { ok: false, error: err2.name === 'AbortError' ? 'AI 超时了，稍后再试' : err2.message };
      }
    } else {
      return { ok: false, error: err.name === 'AbortError' ? 'AI 超时了，稍后再试' : err.message };
    }
  }

  const parsed = parseLooseJson(content);
  if (!parsed) {
    return { ok: false, error: 'AI 返回的不是合法 JSON，换个模型或再试一次' };
  }

  const ref = {
    what: str(parsed.what, 800),
    why: str(parsed.why, 2000),
    how: str(parsed.how, 2000),
  };
  if (!ref.what && !ref.why && !ref.how) {
    return { ok: false, error: 'AI 返回为空，稍后再试' };
  }

  return { ok: true, ref, model: config.ai.model };
}

module.exports = { generateReference, isEnabled: () => config.ai.enabled, endpoint };
