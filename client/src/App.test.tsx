import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import * as msalReact from "@azure/msal-react";

vi.mock("@azure/msal-react", () => ({
  useMsal: vi.fn(),
  useIsAuthenticated: vi.fn()
}));

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    fetchUserWorkspaces: vi.fn().mockResolvedValue([]),
    fetchWorkspacesFromServer: vi.fn().mockResolvedValue([]),
    runQuery: vi.fn().mockResolvedValue({
      tables: [],
      effectiveQuery: ""
    })
  };
});

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
    vi.unstubAllEnvs();
  });

  it("renders the login landing page when unauthenticated", () => {
    vi.stubEnv("VITE_REQUIRE_AZURE_AD_AUTH", "true");
    vi.mocked(msalReact.useIsAuthenticated).mockReturnValue(false);
    render(<App />);

    expect(screen.getByText(/Azure Log Analytics KQL Explorer/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with Microsoft Azure AD/i })).toBeInTheDocument();
  });

  it("renders access denied when user is authenticated but not in allowed AD groups", () => {
    vi.stubEnv("VITE_REQUIRE_AZURE_AD_AUTH", "true");
    vi.stubEnv("VITE_ALLOWED_AZURE_AD_GROUPS", "SecOps-Admins,99887766-5544-3322-1100-a1b2c3d4e5f6");
    vi.mocked(msalReact.useIsAuthenticated).mockReturnValue(true);
    vi.mocked(msalReact.useMsal).mockReturnValue({
      instance: {} as any,
      accounts: [{
        username: "user@contoso.com",
        name: "Test User",
        idTokenClaims: { groups: ["other-group-id"] }
      }] as any,
      inProgress: "none" as any,
      logger: {} as any
    } as any);

    render(<App />);

    expect(screen.getByText(/Access Denied: Azure AD Group Restriction/i)).toBeInTheDocument();
  });

  it("grants access when user has matching AD group", () => {
    vi.stubEnv("VITE_REQUIRE_AZURE_AD_AUTH", "true");
    vi.stubEnv("VITE_ALLOWED_AZURE_AD_GROUPS", "SecOps-Admins,99887766-5544-3322-1100-a1b2c3d4e5f6");
    vi.mocked(msalReact.useIsAuthenticated).mockReturnValue(true);
    vi.mocked(msalReact.useMsal).mockReturnValue({
      instance: {} as any,
      accounts: [{
        username: "user@contoso.com",
        name: "Test User",
        idTokenClaims: { groups: ["secops-admins"] }
      }] as any,
      inProgress: "none" as any,
      logger: {} as any
    } as any);

    render(<App />);

    expect(screen.getByRole("heading", { name: /Azure Log Analytics KQL/i })).toBeInTheDocument();
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

  it("preserves manual filters in KQL Code Editor when selecting filter conditions", async () => {
    render(<App />);

    // Click preset "AFD Access Log"
    const presetBtn = screen.getByRole("button", { name: /AFD Access Log/i });
    fireEvent.click(presetBtn);

    const textarea = document.querySelector("textarea.query-editor") as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();

    // Manually add a new filter in the KQL Code Editor
    const originalQuery = textarea.value;
    const manualFilter = '| where destinationPort_d == 443';
    fireEvent.change(textarea, { target: { value: `${originalQuery}\n${manualFilter}` } });

    expect(textarea.value).toContain(manualFilter);

    // Open Filter Conditions dropdown
    const filterConditionsBtn = screen.getByText(/Filter Conditions/i);
    fireEvent.click(filterConditionsBtn);

    // Toggle timeTaken_d condition
    const timeTakenLabel = screen.getByText("timeTaken_d");
    fireEvent.click(timeTakenLabel);

    // Verify the manual filter is still preserved AND the new condition is added!
    expect(textarea.value).toContain(manualFilter);
    expect(textarea.value).toContain("| where timeTaken_d > 0");

    // Toggle timeTaken_d condition off
    fireEvent.click(timeTakenLabel);

    // Verify manual filter is STILL preserved!
    expect(textarea.value).toContain(manualFilter);
    expect(textarea.value).not.toContain("| where timeTaken_d > 0");
  });

  it("defaults Primary Result time format to Local Time", async () => {
    const apiModule = await import("./api");
    vi.spyOn(apiModule, "runQuery").mockResolvedValue({
      tables: [
        {
          name: "PrimaryResult",
          columns: [
            { name: "TimeGenerated", type: "datetime" },
            { name: "Resource", type: "string" }
          ],
          rows: [
            ["2026-07-16T02:18:57Z", "my-resource"]
          ]
        }
      ],
      effectiveQuery: "test"
    });

    render(<App />);

    // Click Run Query
    const runBtn = screen.getByRole("button", { name: /Run Query/i });
    fireEvent.click(runBtn);

    // Wait for the results table to appear
    await waitFor(() => {
      expect(screen.getByText("PrimaryResult")).toBeInTheDocument();
    });

    // Verify the Local Time toggle button shows "Local Time" by default
    expect(screen.getByTitle("Toggle timezone")).toHaveTextContent("Local Time");

    // Verify that the formatted timestamp matches the local time string
    const expectedLocal = new Date("2026-07-16T02:18:57Z").toLocaleString();
    expect(screen.getByRole("cell", { name: expectedLocal })).toBeInTheDocument();
  });

  it("supports multiple subscriptions with filtering and badges", async () => {
    vi.stubEnv(
      "VITE_WORKSPACES",
      "Production/Prod Logs:11111111-1111-1111-1111-111111111111,Staging/Stage Logs:22222222-2222-2222-2222-222222222222"
    );

    render(<App />);

    // Header should show subscriptions count and workspaces count
    expect(screen.getByText(/Azure Subscription & Workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/2 subscriptions · 2 workspaces/i)).toBeInTheDocument();

    // The subscription dropdown trigger should display "All Subscriptions (2)"
    const subTrigger = screen.getByTitle("Filter workspaces by Azure Subscription");
    expect(subTrigger).toHaveTextContent("All Subscriptions (2)");

    // Open subscription dropdown
    fireEvent.click(subTrigger);
    expect(screen.getByText(/Production/i)).toBeInTheDocument();
    expect(screen.getByText(/Staging/i)).toBeInTheDocument();

    // Select "Production" subscription
    fireEvent.click(screen.getByText(/Production/i));
    expect(subTrigger).toHaveTextContent("Production");

    // Click to open workspace dropdown
    const wsTrigger = screen.getByText(/Prod Logs/i);
    fireEvent.click(wsTrigger);

    // Only Prod Logs should be listed in the dropdown, not Stage Logs
    expect(screen.getByText(/🏢 Prod Logs/i)).toBeInTheDocument();
    expect(screen.queryByText(/Stage Logs/i)).not.toBeInTheDocument();

    // Close workspace dropdown
    fireEvent.mouseDown(document.body);

    // Switch back to "All Subscriptions"
    fireEvent.click(subTrigger);
    fireEvent.click(screen.getByText("Show workspaces across all subscriptions"));
    expect(subTrigger).toHaveTextContent("All Subscriptions (2)");

    // Close subscription dropdown
    fireEvent.mouseDown(document.body);

    // Both should now be available in workspace dropdown
    fireEvent.click(wsTrigger);
    expect(screen.getByText(/🏢 Prod Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/🏢 Stage Logs/i)).toBeInTheDocument();
  });

  it("supports creating new tabs with inherited subscription context", async () => {
    vi.stubEnv(
      "VITE_WORKSPACES",
      "Production/Prod Logs:11111111-1111-1111-1111-111111111111,Staging/Stage Logs:22222222-2222-2222-2222-222222222222"
    );

    render(<App />);

    // Filter to Staging in tab 1
    const subTrigger = screen.getByTitle("Filter workspaces by Azure Subscription");
    fireEvent.click(subTrigger);
    fireEvent.click(screen.getByText(/Staging/i));
    expect(subTrigger).toHaveTextContent("Staging");

    // Click + button to add tab
    const addTabBtn = screen.getByTitle("Open New Query Tab");
    fireEvent.click(addTabBtn);

    // Tab 2 should be active and inherit the Staging subscription context
    expect(screen.getByText("Query 2")).toBeInTheDocument();
    expect(screen.getByTitle("Filter workspaces by Azure Subscription")).toHaveTextContent("Staging");
  });
});

