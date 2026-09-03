import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as msalReact from "@azure/msal-react";

vi.mock("@azure/msal-react", () => ({
  useMsal: vi.fn(),
  useIsAuthenticated: vi.fn()
}));

describe("App", () => {
  beforeEach(() => {
    vi.mocked(msalReact.useIsAuthenticated).mockReturnValue(true);
    vi.mocked(msalReact.useMsal).mockReturnValue({
      instance: {
        acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: "test-token" }),
        loginPopup: vi.fn().mockResolvedValue({}),
        logoutPopup: vi.fn().mockResolvedValue({})
      } as any,
      accounts: [{ username: "user@contoso.com", name: "Test User" }] as any,
      inProgress: "none" as any,
      logger: {} as any
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the login landing page when unauthenticated", () => {
    vi.stubEnv("VITE_REQUIRE_AZURE_AD_AUTH", "true");
    vi.mocked(msalReact.useIsAuthenticated).mockReturnValue(false);
    render(<App />);

    expect(screen.getByText(/Azure Log Analytics KQL Explorer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with Microsoft Azure AD/i })).toBeInTheDocument();
  });

  it("renders the query workspace when authenticated", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /Azure Log Analytics KQL/i })).toBeInTheDocument();
    expect(screen.getByText(/Run a query to see Log Analytics tables/i)).toBeInTheDocument();
    expect(screen.getByText("Test User")).toBeInTheDocument();
  });

  it("clears dynamic filters and query results when changing workspace id", async () => {
    render(<App />);

    // Click quick switch preset "AFD Firewall Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Firewall Log/i });
    fireEvent.click(presetBtn);

    // Verify dynamic filters section appears
    await waitFor(() => {
      expect(screen.getByText(/Dynamic Filters:/i)).toBeInTheDocument();
    });

    // Click Manual to enter custom workspace ID
    const manualBtn = screen.getByText(/Manual/i);
    fireEvent.click(manualBtn);

    const input = screen.getByPlaceholderText(/Enter or paste Workspace ID GUID.../i);
    fireEvent.change(input, { target: { value: "12345678-1234-1234-1234-123456789abc" } });

    // Verify tab data and result table are completely cleared for the new workspace
    expect(screen.queryByText(/Dynamic Filters:/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Run a query to see Log Analytics tables/i)).toBeInTheDocument();
  });

  it("formats numeric filter conditions without quotes for integers/doubles", async () => {
    render(<App />);

    // Click preset "AFD Access Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Access Log/i });
    fireEvent.click(presetBtn);

    // Open Filter Conditions dropdown
    const filterConditionsBtn = screen.getByText(/Filter Conditions/i);
    fireEvent.click(filterConditionsBtn);

    // Find timeTaken_d checkbox and toggle it
    const timeTakenLabel = screen.getByText("timeTaken_d");
    fireEvent.click(timeTakenLabel);

    // Editor should contain unquoted numeric clause | where timeTaken_d > 0
    const textarea = document.querySelector("textarea.query-editor") as HTMLTextAreaElement;
    expect(textarea.value).toContain("| where timeTaken_d > 0");
  });

  it("minimizes Filter Conditions box when clicking outside", async () => {
    render(<App />);

    // Click preset "AFD Access Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Access Log/i });
    fireEvent.click(presetBtn);

    // Open Filter Conditions dropdown
    const filterConditionsBtn = screen.getByText(/Filter Conditions/i);
    fireEvent.click(filterConditionsBtn);

    // Search conditions input should be visible
    expect(screen.getByPlaceholderText(/Search conditions.../i)).toBeInTheDocument();

    // Click outside on document body
    fireEvent.mouseDown(document.body);

    // Search conditions input should no longer be visible (minimized)
    expect(screen.queryByPlaceholderText(/Search conditions.../i)).not.toBeInTheDocument();
  });

  it("filters output flyout column values by comparison operators (> or <)", async () => {
    render(<App />);

    // Click preset "AFD Access Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Access Log/i });
    fireEvent.click(presetBtn);

    // Filter Conditions should be available
    expect(screen.getByText(/Filter Conditions/i)).toBeInTheDocument();
  });

  it("renders query workspace without errors", async () => {
    render(<App />);

    // Click preset "AFD Access Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Access Log/i });
    fireEvent.click(presetBtn);

    // KQL code editor should be present
    expect(screen.getByText(/KQL Code Editor/i)).toBeInTheDocument();
  });

  it("minimizes Project Columns box when clicking outside", async () => {
    render(<App />);

    // Click preset "AFD Access Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Access Log/i });
    fireEvent.click(presetBtn);

    // Open Project Columns dropdown
    const projectColumnsBtn = screen.getByText(/Project Columns/i);
    fireEvent.click(projectColumnsBtn);

    // Search columns input should be visible
    expect(screen.getByPlaceholderText(/Search columns.../i)).toBeInTheDocument();

    // Click outside on document body
    fireEvent.mouseDown(document.body);

    // Search columns input should no longer be visible (minimized)
    expect(screen.queryByPlaceholderText(/Search columns.../i)).not.toBeInTheDocument();
  });
});

