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
});

