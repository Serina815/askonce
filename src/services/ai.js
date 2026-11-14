'use strict';

const config = require('../config');

/**
 * AI 草稿生成（OpenAI 兼容接口）。
 * 只做一件事：把「问题 + 报错」变成三问的草稿，供人修改。
 * 不做任何自动入库——避免 AI 的猜测被当成你的理解。
 */

const SYSTEM_PROMPT = [
  '你是技术学习助教，帮助学习者把一个具体的技术问题拆成可以理解的四块。',
  '只依据用户提供的报错与场景作答，不要编造不存在的命令、参数或文件名。',
  '信息不足时，用"可能是……"表述，并在 why 里说明不确定的地方。',
  '输出必须是 JSON 对象，字段如下：',
  '{"what":"问题的本质，一句话","how":"可执行步骤，用 1. 2. 3. 分行，最多 5 条",',
  ' "why":"背后的原理与权衡，3 句以内","plain":"讲给完全不懂的人听的比喻，一句话",',
  ' "tags":["最多3个技术标签"]}',
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
 * @returns {Promise<{ok:true, draft:object} | {ok:false, error:string}>}
 */
async function generateDraft({ title, errorText, context }) {
  if (!config.ai.enabled) {
    return { ok: false, error: '还没有配置 AI_API_KEY，先填 .env 再试' };
  }

  const user = [
    `问题：${str(title, 300)}`,
    errorText ? `报错原文：\n${str(errorText, 2000)}` : '（没有报错原文）',
    context ? `场景：${str(context, 500)}` : '',
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

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((t) => str(t, 20)).filter(Boolean).slice(0, 3)
    : [];

  return {
    ok: true,
    draft: {
      what: str(parsed.what, 800),
      how: str(parsed.how, 2000),
      why: str(parsed.why, 2000),
      plain: str(parsed.plain, 500),
      tags,
    },
  };
}

module.exports = { generateDraft, isEnabled: () => config.ai.enabled, endpoint };
