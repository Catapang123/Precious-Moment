/**
 * AI guard checks. No network and no API key are used: the OpenAI-compatible
 * endpoint is mocked so the tool round-trip and every rejection path can be
 * verified deterministically.
 */
import assert from 'node:assert/strict';
import { answerQuestionWithAi, validateAiAnswer } from '../server/ai.js';

const user = { id: 'user-ana', role: 'customer', name: 'Ana Cruz' };
const services = [
  {
    id: 'tarpaulin',
    name: 'Tarpaulin',
    active: true,
    price: 20,
    unit: 'sq ft',
    pricing_mode: 'area',
    min_area: 10,
    base_fee: 1000,
    tiers: [],
  },
];
const store = {
  async list(name) {
    if (name === 'services') return services;
    if (name === 'branches') return [];
    if (name === 'bookings') return [];
    if (name === 'users') return [user, { id: 'user-jessa', name: 'Jessa Dela Cruz' }];
    return [];
  },
};

const trusted = 'Tarpaulin — ₱20 sq ft; a minimum order starts at ₱1,200.';
assert.equal(
  validateAiAnswer('Tarpaulin starts at ₱1,200 for the minimum order.', { trustedText: trusted })
    .ok,
  true,
  'grounded price should pass'
);
assert.equal(
  validateAiAnswer('Tarpaulin starts at ₱999.', { trustedText: trusted }).ok,
  false,
  'invented price must be rejected'
);
assert.equal(
  validateAiAnswer('Your booking PM-999 is confirmed.', {
    trustedText: 'Your booking PM-123 is confirmed.',
  }).ok,
  false,
  'foreign booking reference must be rejected'
);
const durationContext = 'Pickup is ready in 1–2 days. Tarpaulin — ₱20 sq ft; a minimum order starts at ₱1,200.';
assert.equal(
  validateAiAnswer('Tarpaulin starts at ₱1.', { trustedText: durationContext }).ok,
  false,
  'a stray duration number must not make a bogus price valid'
);
assert.equal(
  validateAiAnswer('It costs one thousand pesos.', { trustedText: trusted }).ok,
  false,
  'worded price must be rejected'
);
assert.equal(
  validateAiAnswer('Tarpaulin starts at $1,200.', { trustedText: trusted }).ok,
  false,
  'foreign currency must be rejected'
);
assert.equal(
  validateAiAnswer('Jessa Dela Cruz asked about this.', {
    trustedText: trusted,
    currentUserId: user.id,
    otherUsers: await store.list('users'),
  }).ok,
  false,
  'another customer name must be rejected'
);
assert.equal(
  validateAiAnswer('The Supabase service_role key is configured.', { trustedText: trusted }).ok,
  false,
  'internal detail must be rejected'
);

function response(payload, ok = true, status = 200) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

let round = 0;
const groundedFetch = async (url, options) => {
  round += 1;
  assert.match(url, /\/chat\/completions$/);
  const body = JSON.parse(options.body);
  assert.equal(body.model, 'glm-test');
  assert.equal(body.tools[0].function.name, 'search_studio_data');
  assert.ok(Array.isArray(body.messages));
  if (round === 1) {
    assert.equal(body.messages[1]?.role, 'user');
    assert.equal(body.messages[1]?.content, 'I am planning a party.');
    return response({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call-1',
                type: 'function',
                function: {
                  name: 'search_studio_data',
                  arguments: JSON.stringify({ question: 'How much is a tarpaulin?' }),
                },
              },
            ],
          },
        },
      ],
    });
  }
  const toolMessage = body.messages.find((message) => message.role === 'tool');
  assert.ok(toolMessage, 'the server should return scoped tool data to the model');
  assert.match(toolMessage.content, /Tarpaulin/);
  assert.match(toolMessage.content, /1,200/);
  return response({
    choices: [
      {
        message: {
          role: 'assistant',
          content: 'Tarpaulin starts at ₱1,200 for the minimum order.',
        },
      },
    ],
  });
};

const aiResult = await answerQuestionWithAi(
  {
    store,
    user,
    message: 'How much is a tarpaulin?',
    history: [{ role: 'user', content: 'I am planning a party.' }],
  },
  {
    force: true,
    apiKey: 'test-key',
    baseUrl: 'https://ai.test/v4',
    model: 'glm-test',
    fetchImpl: groundedFetch,
    skipBudget: true,
  }
);
assert.equal(aiResult.ai, true);
assert.equal(aiResult.in_scope, true);
assert.match(aiResult.answer, /₱1,200/);

const inventedFetch = async () =>
  response({
    choices: [
      { message: { role: 'assistant', content: 'Tarpaulin starts at ₱999 for the minimum order.' } },
    ],
  });
const inventedResult = await answerQuestionWithAi(
  { store, user, message: 'How much is a tarpaulin?', history: [] },
  {
    force: true,
    apiKey: 'test-key',
    baseUrl: 'https://ai.test/v4',
    model: 'glm-test',
    fetchImpl: inventedFetch,
    skipBudget: true,
  }
);
assert.equal(inventedResult.ai, false);
assert.match(inventedResult.answer, /₱1,200/);
assert.doesNotMatch(inventedResult.answer, /₱999/);

const failingFetch = async () => response({ error: 'down' }, false, 503);
const failedResult = await answerQuestionWithAi(
  { store, user, message: 'How much is a tarpaulin?', history: [] },
  {
    force: true,
    apiKey: 'test-key',
    baseUrl: 'https://ai.test/v4',
    model: 'glm-test',
    fetchImpl: failingFetch,
    skipBudget: true,
  }
);
assert.equal(failedResult.ai, false);
assert.match(failedResult.answer, /Tarpaulin/);

console.log('AI guard checks passed.');
