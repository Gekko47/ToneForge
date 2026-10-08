/**
 * Live LLM connectivity smoke harness.
 *
 * Starts the development gateway, issues a connection, fetches the model
 * catalog, tests the connection, sends a chat completion, and disconnects —
 * proving the end-to-end path from the gateway client to a provider response
 * and back.
 *
 * The upstream provider is a mock fetch implementation, not a real API call.
 * The harness proves the gateway plumbing works; it does not prove a specific
 * provider accepts a specific credential. That requires a real key and a real
 * provider, which is a human step recorded in manual-verification.md.
 *
 * Usage:
 *   node scripts/llm-smoke.mjs [--port 3777] [--provider openrouter]
 *
 * Exit code 0 = all steps passed; 1 = at least one step failed.
 */
import http from "node:http";
import { createDevGatewayBroker, GATEWAY_PATH_PREFIX } from "./dev-gateway.mjs";

const args = process.argv.slice(2);
const portArg = args.indexOf("--port");
const port = portArg !== -1 ? Number(args[portArg + 1]) : 3777;
const providerArg = args.indexOf("--provider");
const provider = providerArg !== -1 ? args[providerArg + 1] : "openrouter";

const MOCK_KEY = "sk-test-smoke-key";
const results = [];

function pass(step, detail) {
  results.push({ step, ok: true, detail });
  console.log(`  PASS  ${step}: ${detail}`);
}

function fail(step, detail) {
  results.push({ step, ok: false, detail });
  console.error(`  FAIL  ${step}: ${detail}`);
}

/** A self-contained upstream that mimics a provider's API surface. */
function mockUpstreamFetch(url, init) {
  const parsed = new URL(url);
  const path = parsed.pathname;

  if (path.endsWith("/models")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "openai/gpt-4o-mini",
              name: "GPT-4o mini",
              description: "A small, fast model for testing.",
              context_length: 128000,
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              top_provider: { context_length: 128000 },
              supported_parameters: ["tools", "structured_outputs"],
            },
            {
              id: "anthropic/claude-3-haiku",
              name: "Claude 3 Haiku",
              description: "A compact model for testing.",
              context_length: 200000,
              architecture: { input_modalities: ["text"], output_modalities: ["text"] },
              top_provider: { context_length: 200000 },
              supported_parameters: ["tools"],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }

  if (path.endsWith("/chat/completions")) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: "chatcmpl-smoke",
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "openai/gpt-4o-mini",
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "smoke test passed" },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 15, completion_tokens: 3, total_tokens: 18 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
  }

  return Promise.resolve(new Response("Not found", { status: 404 }));
}

async function main() {
  console.log(`\n=== ToneForge LLM Smoke Harness ===\n`);
  console.log(`Provider: ${provider}`);
  console.log(`Port:     ${port}\n`);

  const broker = createDevGatewayBroker({
    fetchImpl: mockUpstreamFetch,
    deploymentManaged: {
      apiKey: MOCK_KEY,
      baseUrl: "https://openrouter.ai/api/v1",
    },
  });

  const server = http.createServer((req, res) => {
    broker(req, res, () => {
      res.statusCode = 404;
      res.end("Not found");
    });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  console.log(`Gateway listening on http://127.0.0.1:${port}\n`);

  const origin = `http://127.0.0.1:${port}`;
  const headers = {
    "Content-Type": "application/json",
    Origin: origin,
  };

  try {
    // Step 1: Issue a connection
    console.log("Step 1: Issue a connection");
    const connRes = await fetch(`${origin}${GATEWAY_PATH_PREFIX}/connections/deployment`, {
      method: "POST",
      headers,
      body: JSON.stringify({ provider }),
    });
    if (!connRes.ok) {
      fail("issue connection", `HTTP ${connRes.status}`);
      return;
    }
    const conn = await connRes.json();
    if (!conn.connectionId) {
      fail("issue connection", "No connectionId in response");
      return;
    }
    pass("issue connection", `connectionId=${conn.connectionId}`);

    // Step 2: Fetch model catalog
    console.log("\nStep 2: Fetch model catalog");
    const catalogRes = await fetch(
      `${origin}${GATEWAY_PATH_PREFIX}/connections/${conn.connectionId}/models`,
      { headers },
    );
    if (!catalogRes.ok) {
      fail("model catalog", `HTTP ${catalogRes.status}`);
      return;
    }
    const catalog = await catalogRes.json();
    if (!Array.isArray(catalog.models) || catalog.models.length === 0) {
      fail("model catalog", "No models returned");
      return;
    }
    pass("model catalog", `${catalog.models.length} models available`);

    // Step 3: Test connection
    console.log("\nStep 3: Test connection");
    const testRes = await fetch(
      `${origin}${GATEWAY_PATH_PREFIX}/connections/${conn.connectionId}/test`,
      { headers },
    );
    if (!testRes.ok) {
      fail("test connection", `HTTP ${testRes.status}`);
      return;
    }
    const testResult = await testRes.json();
    if (!testResult.ok) {
      fail("test connection", testResult.detail ?? "Connection test failed");
      return;
    }
    pass("test connection", testResult.detail ?? "Connection is reachable");

    // Step 4: Send a chat completion
    console.log("\nStep 4: Send a chat completion");
    const model = catalog.models[0]?.id ?? "openai/gpt-4o-mini";
    const chatRes = await fetch(
      `${origin}${GATEWAY_PATH_PREFIX}/connections/${conn.connectionId}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "Say 'smoke test passed' and nothing else." },
          ],
          max_tokens: 50,
        }),
      },
    );
    if (!chatRes.ok) {
      fail("chat completion", `HTTP ${chatRes.status}`);
      return;
    }
    const chatResult = await chatRes.json();
    const text = chatResult.choices?.[0]?.message?.content ?? "";
    if (text.length === 0) {
      fail("chat completion", "Empty response from provider");
      return;
    }
    pass("chat completion", `model=${model}, response="${text.slice(0, 60)}"`);

    // Step 5: Disconnect
    console.log("\nStep 5: Disconnect");
    const disconnectRes = await fetch(
      `${origin}${GATEWAY_PATH_PREFIX}/connections/${conn.connectionId}`,
      { method: "DELETE", headers },
    );
    if (disconnectRes.status !== 204) {
      fail("disconnect", `HTTP ${disconnectRes.status}`);
      return;
    }
    pass("disconnect", "Connection removed");
  } catch (err) {
    fail("unexpected error", err?.message ?? String(err));
  } finally {
    server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
