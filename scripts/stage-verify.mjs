/** Run the canonical repository verification graph for stage verification. */
import { runVerificationGraph } from "./verification-graph.mjs";

try {
  runVerificationGraph();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
