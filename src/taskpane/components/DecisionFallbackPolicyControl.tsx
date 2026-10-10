import React from "react";
import { Dropdown, Field, Option } from "@fluentui/react-components";
import {
  DecisionFallbackPolicySchema,
  type DecisionFallbackPolicy,
} from "../../core/domain/LlmRole";
import { FALLBACK_POLICY_OPTIONS } from "../settings/llmDashboardModel";

export interface DecisionFallbackPolicyControlProps {
  value: DecisionFallbackPolicy;
  onChange: (next: DecisionFallbackPolicy) => void;
  disabled?: boolean;
}

const OPTIONS = FALLBACK_POLICY_OPTIONS;

/**
 * Dropdown for the decision fallback policy.
 *
 * Controls what happens when the consistency decision LLM is unavailable:
 * either report ambiguous candidates as unresolved, or fall back to the
 * general model (degraded).
 */
export function DecisionFallbackPolicyControl({
  value,
  onChange,
  disabled,
}: DecisionFallbackPolicyControlProps): React.ReactNode {
  return (
    <Field label="When the decision LLM is unavailable">
      <Dropdown
        value={OPTIONS.find((option) => option.key === value)?.text ?? ""}
        selectedOptions={[value]}
        disabled={disabled ?? false}
        onOptionSelect={(_event, data) => {
          const parsed = DecisionFallbackPolicySchema.safeParse(data.optionValue);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        {OPTIONS.map((option) => (
          <Option key={option.key} value={option.key} title={option.detail}>
            {option.text}
          </Option>
        ))}
      </Dropdown>
    </Field>
  );
}
