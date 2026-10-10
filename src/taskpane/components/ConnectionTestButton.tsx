import React from "react";
import { Button, MessageBar } from "@fluentui/react-components";
import {
  createProviderGatewayClient,
  describeGatewayError,
  GatewayError,
  SessionTokenStore,
  type ConnectionTestResult,
} from "../../ai/gateway";
import type { ProviderConnection } from "../../core/domain/ProviderConnection";

export interface ConnectionTestButtonProps {
  connection: ProviderConnection | undefined;
  gatewayOrigin: string;
}

/**
 * Test-connection button for a role's LLM connection.
 *
 * Creates its own `ProviderGatewayClient` (with a fresh `SessionTokenStore`)
 * so the token store is discarded on unmount. The test is a lightweight probe:
 * it never sends document text and never mutates the connection.
 */
export function ConnectionTestButton({
  connection,
  gatewayOrigin,
}: ConnectionTestButtonProps): React.ReactNode {
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<ConnectionTestResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const session = React.useRef<{
    client: ReturnType<typeof createProviderGatewayClient>;
  } | null>(null);

  React.useEffect(
    () => () => {
      session.current = null;
    },
    [],
  );

  if (!connection) return null;
  // Capture in a local so the narrowing persists into the async closure.
  const activeConnection = connection;

  function client(): ReturnType<typeof createProviderGatewayClient> {
    if (session.current === null) {
      session.current = {
        client: createProviderGatewayClient({
          origin: gatewayOrigin,
          tokenStore: new SessionTokenStore(),
        }),
      };
    }
    return session.current.client;
  }

  async function test(): Promise<void> {
    setTesting(true);
    setResult(null);
    setError(null);
    try {
      setResult(await client().testConnection(activeConnection));
    } catch (caught: unknown) {
      setError(
        caught instanceof GatewayError
          ? describeGatewayError(caught.kind)
          : "Connection test failed.",
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="tf-connection-test">
      <Button
        onClick={() => {
          void test();
        }}
        disabled={testing}
      >
        Test connection
      </Button>
      {testing ? <span className="tf-settings-note">Testing…</span> : null}
      {result ? (
        <MessageBar intent={result.ok ? "success" : "error"}>
          {result.ok ? `Connected — ${result.detail}` : `Failed — ${result.detail}`}
        </MessageBar>
      ) : null}
      {error ? <MessageBar intent="error">{error}</MessageBar> : null}
    </div>
  );
}
