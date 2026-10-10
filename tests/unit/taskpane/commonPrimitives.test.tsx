import React from "react";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  CoverageSummary,
  DiffCardList,
  DisclosurePanel,
  EmptyState,
  ErrorState,
  LoadingState,
  MetadataRow,
  ProfileIndicator,
  ReviewModeCard,
  StatusBadge,
  StickyActionBar,
  STATUS_VOCABULARY,
  statusTone,
  useConfirmDialog,
  useToaster,
} from "../../../src/taskpane/components/common";
import { renderWithFluent, resetGriffelStyles } from "../../helpers/fluentV9";

/**
 * The common primitives, asserted for structure and accessibility rather than
 * pixels. jsdom computes no styles, so what is checked is the contract a page
 * relies on: the roles, the labels, the one status vocabulary, and the two
 * promise-based interaction paths (confirm and toast).
 */
describe("common primitives", () => {
  it("maps every status in the vocabulary to a tone", () => {
    const tones = STATUS_VOCABULARY.map((status) => statusTone(status));
    expect(tones).toHaveLength(STATUS_VOCABULARY.length);
    expect(tones.every((tone) => ["neutral", "success", "warning", "danger"].includes(tone))).toBe(
      true,
    );
  });

  it("renders a StatusBadge with its label", () => {
    renderWithFluent(<StatusBadge status="Needs review" />);
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders a ReviewModeCard with its title, status and primary action", () => {
    renderWithFluent(
      <ReviewModeCard
        mode="Deterministic review"
        title="Deterministic review"
        description="Check the document against the active style."
        icon="deterministicReview"
        status="neutral"
        statusText="Not checked"
        primaryAction={<button type="button">Start review</button>}
      />,
    );
    expect(screen.getByText("Deterministic review")).toBeInTheDocument();
    expect(screen.getByText("Not checked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start review" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders a ProfileIndicator with its kind, label and manage action", () => {
    renderWithFluent(
      <ProfileIndicator kind="Active style" label="House style" onManage={() => {}} />,
    );
    expect(screen.getByText("Active style")).toBeInTheDocument();
    expect(screen.getByText("House style")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Manage" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("states coverage as a percentage of the requested scope", () => {
    renderWithFluent(<CoverageSummary checked={3} total={4} />);
    expect(screen.getByText("75% of requested scope checked")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("reads a zero total as 0% rather than dividing by zero", () => {
    renderWithFluent(<CoverageSummary checked={0} total={0} />);
    expect(screen.getByText("0% of requested scope checked")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders an EmptyState with its title and action", () => {
    renderWithFluent(
      <EmptyState
        icon="info"
        title="No findings"
        description="Nothing to review."
        action={<button type="button">Rescan</button>}
      />,
    );
    expect(screen.getByText("No findings")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Rescan" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("announces an ErrorState as an alert with a recovery action", () => {
    renderWithFluent(
      <ErrorState
        title="Scan failed"
        message="The document could not be read."
        primaryRecoveryAction={<button type="button">Try again</button>}
        diagnosticId="TF-123"
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Scan failed")).toBeInTheDocument();
    expect(screen.getByText("Diagnostic ID: TF-123")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("announces a LoadingState as a busy status", () => {
    renderWithFluent(<LoadingState label="Scanning the document…" />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Scanning the document…")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders a StickyActionBar with its summary and actions", () => {
    renderWithFluent(
      <StickyActionBar summary="3 changes ready">
        <button type="button">Apply</button>
      </StickyActionBar>,
    );
    expect(screen.getByText("3 changes ready")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders a MetadataRow with its label and value", () => {
    renderWithFluent(<MetadataRow label="Revision" value="12" />);
    expect(screen.getByText("Revision")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders a DiffCardList as cards, not a table", () => {
    renderWithFluent(
      <DiffCardList
        caption="1 field change(s)"
        leftLabel="v1"
        rightLabel="v2"
        changes={[{ field: "Profile name", from: "Org", to: "Org v2" }]}
      />,
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Profile name" })).toBeInTheDocument();
    expect(screen.getByText("Org v2")).toBeInTheDocument();
    resetGriffelStyles();
  });

  describe("DisclosurePanel primitive", () => {
    it("renders uncontrolled with its title and body when defaultOpen", () => {
      renderWithFluent(
        <DisclosurePanel title="Diagnostics" defaultOpen>
          <span>detail</span>
        </DisclosurePanel>,
      );
      expect(screen.getByText("Diagnostics")).toBeInTheDocument();
      expect(screen.getByText("detail")).toBeInTheDocument();
      resetGriffelStyles();
    });

    it("unmounts collapsed children, so they are absent from the DOM", () => {
      renderWithFluent(
        <DisclosurePanel title="Collapsed">
          <span>hidden body</span>
        </DisclosurePanel>,
      );
      const button = screen.getByRole("button", { name: "Collapsed" });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("hidden body")).not.toBeInTheDocument();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("hidden body")).toBeInTheDocument();
      resetGriffelStyles();
    });

    it("supports controlled open/onToggle round-trip", () => {
      function ControlledHost(): React.ReactNode {
        const [open, setOpen] = React.useState(false);
        return (
          <DisclosurePanel title="Controlled" open={open} onToggle={setOpen}>
            <span>controlled body</span>
          </DisclosurePanel>
        );
      }
      renderWithFluent(<ControlledHost />);
      const button = screen.getByRole("button", { name: "Controlled" });
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("controlled body")).not.toBeInTheDocument();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByText("controlled body")).toBeInTheDocument();
      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByText("controlled body")).not.toBeInTheDocument();
      resetGriffelStyles();
    });

    it("renders a headerSlot alongside the title", () => {
      renderWithFluent(
        <DisclosurePanel title="With slot" defaultOpen headerSlot={<span>extra</span>}>
          <span>body</span>
        </DisclosurePanel>,
      );
      expect(screen.getByText("With slot")).toBeInTheDocument();
      expect(screen.getByText("extra")).toBeInTheDocument();
      resetGriffelStyles();
    });

    it("keeps nested disclosures independent", () => {
      renderWithFluent(
        <>
          <DisclosurePanel title="First" defaultOpen>
            <span>first body</span>
          </DisclosurePanel>
          <DisclosurePanel title="Second">
            <span>second body</span>
          </DisclosurePanel>
        </>,
      );
      expect(screen.getByRole("button", { name: "First" })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByRole("button", { name: "Second" })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
      expect(screen.getByText("first body")).toBeInTheDocument();
      expect(screen.queryByText("second body")).not.toBeInTheDocument();
      resetGriffelStyles();
    });
  });

  it("resolves the confirm dialog true when the user confirms", async () => {
    function ConfirmHost(): React.ReactNode {
      const { confirm, dialog } = useConfirmDialog();
      const [result, setResult] = React.useState("pending");
      return (
        <>
          <button
            type="button"
            onClick={() => {
              void confirm({
                title: "Delete profile",
                message: "This cannot be undone.",
                danger: true,
              }).then((ok) => setResult(ok ? "confirmed" : "cancelled"));
            }}
          >
            Delete
          </button>
          <span>{result}</span>
          {dialog}
        </>
      );
    }

    renderWithFluent(<ConfirmHost />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Delete profile")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.getByText("confirmed")).toBeInTheDocument());
    resetGriffelStyles();
  });

  it("resolves the confirm dialog false when the user cancels", async () => {
    function ConfirmHost(): React.ReactNode {
      const { confirm, dialog } = useConfirmDialog();
      const [result, setResult] = React.useState("pending");
      return (
        <>
          <button
            type="button"
            onClick={() => {
              void confirm({ title: "Remove rule", message: "Remove it?" }).then((ok) =>
                setResult(ok ? "confirmed" : "cancelled"),
              );
            }}
          >
            Remove
          </button>
          <span>{result}</span>
          {dialog}
        </>
      );
    }

    renderWithFluent(<ConfirmHost />);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(await screen.findByText("Remove rule")).toBeInTheDocument();
    // Wait for the dialog to fully render before clicking Cancel — under parallel
    // load the button may not be in the DOM yet when fireEvent runs.
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.getByText("cancelled")).toBeInTheDocument());
    resetGriffelStyles();
  });

  it("announces a toast through the toaster", async () => {
    function ToastHost(): React.ReactNode {
      const { toaster, notify } = useToaster();
      return (
        <>
          <button type="button" onClick={() => notify("Saved", "success")}>
            Save
          </button>
          {toaster}
        </>
      );
    }

    renderWithFluent(<ToastHost />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    resetGriffelStyles();
  });
});
