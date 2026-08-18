import { test } from "node:test";
import assert from "node:assert/strict";
import { readSseStream, sseData, sseDone, sseEvent } from "../src/protocols/stream";

function streamOf(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
}

test("sseData / sseEvent / sseDone produce the documented frames", () => {
  assert.equal(sseData({ a: 1 }), 'data: {"a":1}\n\n');
  assert.equal(sseEvent("ping", { x: 2 }), 'event: ping\ndata: {"x":2}\n\n');
  assert.equal(sseDone(), "data: [DONE]\n\n");
});

test("readSseStream parses OpenAI-style data-only frames", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf('data: {"i":1}\n\ndata: [DONE]\n\n'))) {
    chunks.push(c);
  }
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.event, undefined);
  assert.equal(chunks[0]?.data, '{"i":1}');
  assert.equal(chunks[1]?.data, "[DONE]");
});

test("readSseStream parses Anthropic-style event + data frames", async () => {
  const chunks = [];
  for await (const c of readSseStream(
    streamOf('event: message_start\ndata: {"type":"message_start"}\n\nevent: ping\ndata: {"type":"ping"}\n\n'),
  )) {
    chunks.push(c);
  }
  assert.equal(chunks[0]?.event, "message_start");
  assert.equal(chunks[0]?.data, '{"type":"message_start"}');
  assert.equal(chunks[1]?.event, "ping");
});

test("readSseStream accumulates multi-line data values", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf("data: line1\ndata: line2\n\n"))) {
    chunks.push(c);
  }
  assert.equal(chunks[0]?.data, "line1\nline2");
});

test("readSseStream flushes a trailing frame without blank line", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf('data: {"done":true}\n'))) {
    chunks.push(c);
  }
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.data, '{"done":true}');
});

test("readSseStream handles CRLF and comment lines", async () => {
  const chunks = [];
  for await (const c of readSseStream(streamOf(': keepalive\r\ndata: {"ok":1}\r\n\r\n'))) {
    chunks.push(c);
  }
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]?.data, '{"ok":1}');
});
