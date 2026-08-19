import test from "node:test";
import assert from "node:assert/strict";
import { Readable, Transform } from "node:stream";
import { extractUsage, logUsageTransform } from "../src/daemon/server";
import type { Logger } from "../src/logger";

test("extractUsage returns input/output tokens from an openai usage object", () => {
  assert.deepEqual(
    extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }),
    { inputTokens: 10, outputTokens: 5 },
  );
});

test("extractUsage returns null when usage is missing or partial", () => {
  assert.equal(extractUsage({ choices: [] }), null);
  assert.equal(extractUsage({ usage: { prompt_tokens: 3 } }), null);
  assert.equal(extractUsage(null), null);
});

test("logUsageTransform reports usage from the final streamed chunk and passes bytes through", async () => {
  const calls: Array<{ msg: string; fields: Record<string, unknown> }> = [];
  const log = {
    info: (msg: string, fields?: Record<string, unknown>) =>
      calls.push({ msg, fields: fields ?? {} }),
    debug: () => {},
    warn: () => {},
    error: () => {},
    child: () => log,
  } as unknown as Logger;

  const source = Readable.from([
    Buffer.from('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'),
    Buffer.from(
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
    ),
    Buffer.from("data: [DONE]\n\n"),
  ]);

  const chunks: Buffer[] = [];
  const sink = new Transform({
    transform(chunk, _enc, cb) {
      chunks.push(chunk as Buffer);
      cb();
    },
  });

  await new Promise<void>((resolve, reject) => {
    source.pipe(logUsageTransform("deepseek-v4-flash-free", "zen", log)).pipe(sink);
    sink.on("error", reject);
    sink.on("finish", () => {
      try {
        const full = Buffer.concat(chunks).toString("utf8");
        assert.ok(full.includes('"content":"hi"'), "content chunk passed through");
        assert.ok(full.includes("[DONE]"), "done frame passed through");
        assert.equal(calls.length, 1, "usage logged exactly once");
        const call = calls[0]!;
        assert.equal(call.msg, "chat done");
        assert.deepEqual(call.fields, {
          model: "deepseek-v4-flash-free",
          upstream: "zen",
          inputTokens: 10,
          outputTokens: 5,
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    });
  });
});