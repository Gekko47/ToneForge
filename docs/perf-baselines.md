# ToneForge Performance Baselines

Baseline values are intentionally recorded as measurements to collect on the
available Word hosts; release targets are not invented without host evidence.

| Scenario                     | Measurement                                  | Baseline status              | Collection method                                          |
| ---------------------------- | -------------------------------------------- | ---------------------------- | ---------------------------------------------------------- |
| Small edit to finding update | Time from Word change event to status update | Pending Desktop Word run     | Enable observer diagnostics and record timestamps          |
| 50k-word document            | Peak memory and scan duration                | Pending Desktop Word run     | Use a sanitized fixture; compare before/after batch review |
| Review batch construction    | Time to partition nodes                      | Unit-test baseline available | `performance.now()` around `partitionReviewBatches`        |
| Cancellation                 | Time from AbortSignal to stopped review      | Unit-test baseline available | Abort before the next batch and record completion          |
| Large finding list           | Task-pane render duration                    | Unit-test baseline available | Render paginated `FindingsList` with 500 findings          |

The current implementation uses a debounced observer, bounded AI batches,
AbortSignal propagation, and incremental finding-list rendering. The observer
still requires a live Word change-range source for precise dirty-node mapping;
until that host event is verified, it conservatively rescans the current
structured nodes rather than claiming a measured incremental latency.
