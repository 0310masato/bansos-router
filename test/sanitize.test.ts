import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeChatBody } from "../src/protocols/openai-chat";

test("sanitizeChatBody rewrites developer role to system when unsupported", () => {
  const input = {
    model: "deepseek-v4-flash-free",
    messages: [
      { role: "developer", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ],
  };

  const output = sanitizeChatBody(input, false);
  assert.deepEqual(output.messages, [
    { role: "system", content: "You are helpful." },
    { role: "user", content: "Hello" },
  ]);
});

test("sanitizeChatBody leaves messages intact when developer role is supported", () => {
  const input = {
    model: "gpt-4o",
    messages: [
      { role: "developer", content: "You are helpful." },
      { role: "user", content: "Hello" },
    ],
  };

  const output = sanitizeChatBody(input, true);
  assert.equal(output, input);
});
