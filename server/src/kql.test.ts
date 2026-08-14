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
});
