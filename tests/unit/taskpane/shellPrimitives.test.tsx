import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PageContainer, PageHeader, Section } from "../../../src/taskpane/shell";
import { renderWithFluent, resetGriffelStyles } from "../../helpers/fluentV9";

/**
 * The shell primitives, asserted for structure and accessibility rather than
 * pixels. jsdom computes no styles, so what is checked is the contract a page
 * relies on: the landmark roles, the heading levels, and the pass-through of
 * the attributes the shell sets.
 */
describe("shell primitives", () => {
  it("renders PageContainer children and passes data attributes through", () => {
    renderWithFluent(
      <PageContainer data-page="home">
        <span>content</span>
      </PageContainer>,
    );
    expect(screen.getByText("content")).toBeInTheDocument();
    expect(document.querySelector('[data-page="home"]')).not.toBeNull();
    resetGriffelStyles();
  });

  it("gives PageHeader a level-one heading and its description", () => {
    renderWithFluent(<PageHeader title="Home" description="Your review command centre" />);
    expect(screen.getByRole("heading", { level: 1, name: "Home" })).toBeInTheDocument();
    expect(screen.getByText("Your review command centre")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("renders PageHeader actions and status when supplied", () => {
    renderWithFluent(
      <PageHeader
        title="Home"
        actions={<button type="button">Refresh</button>}
        status={<span>Ready</span>}
      />,
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
    expect(screen.getByText("Ready")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("gives Section a level-two heading and its body", () => {
    renderWithFluent(
      <Section title="Active styles">
        <span>body</span>
      </Section>,
    );
    expect(screen.getByRole("heading", { level: 2, name: "Active styles" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
    resetGriffelStyles();
  });

  it("omits the Section header entirely when it has no title, description or action", () => {
    renderWithFluent(
      <Section>
        <span>bare</span>
      </Section>,
    );
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getByText("bare")).toBeInTheDocument();
    resetGriffelStyles();
  });
});
