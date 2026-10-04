'use strict';
// Claude API access shared by the AI features (phone receptionist, website chat, inbox and daily summaries).
// Enabled when ANTHROPIC_API_KEY is set; tests inject a fake client with setClient().
const Anthropic = require('@anthropic-ai/sdk');

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
let client = null;
let injected = null;

const enabled = () => !!(injected || process.env.ANTHROPIC_API_KEY);

function getClient() {
  if (injected) return injected;
  if (!client) client = new Anthropic();
  return client;
}

/** For tests: replace the API client with a fake exposing beta.messages.create(). */
function setClient(fake) { injected = fake; }

/**
 * One Messages API call. Refusal fallbacks are enabled server-side ("default" routing),
 * so a declined request is retried on a suitable model within the same call.
 */
function createMessage({ system, messages, tools, effort = 'low', maxTokens = 2000 }) {
  return getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort },
    system,
    messages,
    ...(tools ? { tools } : {}),
  });
}

/** Plain-text answer from a single call (summaries, classification). */
async function complete({ system, prompt, effort = 'low', maxTokens = 2000 }) {
  const res = await createMessage({ system, messages: [{ role: 'user', content: prompt }], effort, maxTokens });
  if (res.stop_reason === 'refusal') return '';
  return res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
}

module.exports = { enabled, createMessage, complete, setClient, MODEL, Anthropic };
