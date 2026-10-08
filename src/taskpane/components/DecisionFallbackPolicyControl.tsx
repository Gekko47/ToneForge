import React from "react";
import { Dropdown, type IDropdownOption } from "@fluentui/react";
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

const OPTIONS: IDropdownOption[] = FALLBACK_POLICY_OPTIONS.map((option) => ({
  key: option.key,
  text: option.text,
  title: option.detail,
}));

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
    <Dropdown
      label="When the decision LLM is unavailable"
      selectedKey={value}
      options={OPTIONS}
      disabled={disabled ?? false}
      onChange={(_event, option) => {
        const parsed = DecisionFallbackPolicySchema.safeParse(option?.key);
        if (parsed.success) onChange(parsed.data);
      }}
    />
  );
}
