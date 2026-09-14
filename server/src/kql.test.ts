import { describe, expect, it } from "vitest";
import { applyFilterSelections, assertSafeKql, parseFilters } from "./kql.js";

describe("KQL filter parsing", () => {
  it("parses common where predicates joined by and", () => {
    const filters = parseFilters(
      "AppRequests | where TimeGenerated > ago(24h) and Success == false and ResultCode in ('500','503')"
    );

    expect(filters).toHaveLength(3);
    expect(filters.map((filter) => filter.operator)).toEqual([">", "==", "in"]);
    expect(filters[1]).toMatchObject({
      field: "Success",
      value: "false"
    });
  });

  it("keeps unsupported expressions out of the GUI filter list", () => {
    const filters = parseFilters(
      "AppRequests | where isempty(UserId) or Success == false | take 10"
    );

    expect(filters).toHaveLength(0);
  });

  it("removes only disabled parsed filters", () => {
    const query =
      "AppRequests | where TimeGenerated > ago(24h) and Success == false and ResultCode == '500' | take 10";
    const filters = parseFilters(query);
    const successFilter = filters.find((filter) => filter.field === "Success");

    const nextQuery = applyFilterSelections(query, [
      { id: successFilter!.id, enabled: false }
    ]);

    expect(nextQuery).toContain("TimeGenerated > ago(24h)");
    expect(nextQuery).not.toContain("Success == false");
    expect(nextQuery).toContain("ResultCode == '500'");
    expect(nextQuery).toContain("| take 10");
  });

  it("blocks operational commands", () => {
    expect(() => assertSafeKql(".drop table AppRequests", 1000)).toThrow(
      "Operational KQL commands"
    );
  });

  it("configures QUERY_MAX_ROWS up to 50000", async () => {
    const { config } = await import("./config.js");
    expect(config.QUERY_MAX_ROWS).toBe(50000);
  });

  it("parses multi-subscription workspace configurations", async () => {
    const { parseWorkspaceEntries } = await import("./workspaceConfig.js");
    const testConfig =
      "Production/Prod Logs:11111111-1111-1111-1111-111111111111, Staging:Stage Logs:22222222-2222-2222-2222-222222222222, Legacy Logs:33333333-3333-3333-3333-333333333333";
    const parsed = parseWorkspaceEntries(testConfig);

    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      name: "Prod Logs",
      customerId: "11111111-1111-1111-1111-111111111111",
      subscriptionName: "Production",
      subscriptionId: "Production"
    });
    expect(parsed[1]).toEqual({
      id: "22222222-2222-2222-2222-222222222222",
      name: "Stage Logs",
      customerId: "22222222-2222-2222-2222-222222222222",
      subscriptionName: "Staging",
      subscriptionId: "Staging"
    });
    expect(parsed[2]).toEqual({
      id: "33333333-3333-3333-3333-333333333333",
      name: "Legacy Logs",
      customerId: "33333333-3333-3333-3333-333333333333",
      subscriptionName: "Default Subscription",
      subscriptionId: undefined
    });
  });

  it("appends take clause when no row limit exists to allow up to 50000 rows in Azure Log Analytics", async () => {
    const { ensureQueryRowLimit } = await import("./kql.js");
    const query = "AzureDiagnostics\n| where Category == 'FrontDoorAccessLog'\n| order by TimeGenerated desc";
    
    // 10000 rows
    const query10k = ensureQueryRowLimit(query, 10000);
    expect(query10k).toBe("set truncationmaxrecords = 50000;\nset notruncation;\nAzureDiagnostics\n| where Category == 'FrontDoorAccessLog'\n| order by TimeGenerated desc\n| take 10000");

    // 50000 rows
    const query50k = ensureQueryRowLimit(query, 50000);
    expect(query50k).toBe("set truncationmaxrecords = 50000;\nset notruncation;\nAzureDiagnostics\n| where Category == 'FrontDoorAccessLog'\n| order by TimeGenerated desc\n| take 50000");
  });

  it("updates existing take/limit clause to the requested max rows", async () => {
    const { ensureQueryRowLimit } = await import("./kql.js");
    const query = "AzureDiagnostics\n| order by TimeGenerated desc\n| take 5000";
    const updated = ensureQueryRowLimit(query, 10000);
    expect(updated).toBe("set truncationmaxrecords = 50000;\nset notruncation;\nAzureDiagnostics\n| order by TimeGenerated desc\n| take 10000");
  });

  it("places take clause before render commands", async () => {
    const { ensureQueryRowLimit } = await import("./kql.js");
    const query = "AzureDiagnostics\n| summarize count() by bin(TimeGenerated, 1h)\n| render timechart";
    const updated = ensureQueryRowLimit(query, 10000);
    expect(updated).toBe("set truncationmaxrecords = 50000;\nset notruncation;\nAzureDiagnostics\n| summarize count() by bin(TimeGenerated, 1h)\n| take 10000\n| render timechart");
  });
});

