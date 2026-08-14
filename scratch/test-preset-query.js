import "dotenv/config";
import { queryWorkspaceLogs } from "../server/dist/logAnalytics.js";

async function test() {
  try {
    const fullQuery = `AzureDiagnostics
| where Category contains "FrontDoorWebApplicationFirewallLog"
| where action_s contains "Block"
| project TimeGenerated, host_s, action_s, ruleName_s, requestUri_s, clientIP_s, trackingReference_s, socketIP_s
| where TimeGenerated > ago(24h)
| distinct host_s`;

    console.log("Testing EXACT query string...");
    const res = await queryWorkspaceLogs({
      workspaceId: "998edd10-05e8-4067-be07-36cc1f14c0d7",
      query: fullQuery,
      timespan: "PT24H"
    });
    console.log("SUCCESS! Tables:", res.tables.length, "Rows:", res.tables[0]?.rows?.length);
  } catch (err) {
    console.error("❌ KQL ERROR:", err.message);
  }
}

test();
