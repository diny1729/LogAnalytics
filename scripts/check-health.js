import http from "node:http";

const HEALTH_URL = "http://127.0.0.1:8080/api/health";
const MAX_ATTEMPTS = 15;
const DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function checkOnce() {
  return new Promise((resolve, reject) => {
    const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const json = JSON.parse(data);
            resolve(json);
          } catch {
            resolve({ ok: true, raw: data });
          }
        } else {
          reject(new Error(`HTTP ${res.statusCode} ${res.statusMessage}`));
        }
      });
    });

    req.on("error", (err) => reject(err));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Request timed out"));
    });
  });
}

async function runHealthCheck() {
  console.log(`\n⏳ Checking backend application health status at ${HEALTH_URL}...`);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const health = await checkOnce();
      console.log(`\n============================================================`);
      console.log(`✅ BACKEND APPLICATION HEALTH STATUS: ONLINE`);
      console.log(`------------------------------------------------------------`);
      console.log(` URL:                       ${HEALTH_URL}`);
      console.log(` Status:                    200 OK`);
      console.log(` Azure Workspace Configured: ${health.azureWorkspaceConfigured ? "YES ✅" : "NO ⚠️ (LOG_ANALYTICS_WORKSPACE_ID missing in .env)"}`);
      console.log(` Workspace Override:        ${health.workspaceOverrideEnabled ? "ENABLED" : "DISABLED"}`);
      console.log(` Timestamp:                 ${health.timestamp || new Date().toISOString()}`);
      console.log(`============================================================\n`);
      return;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS) {
        await sleep(DELAY_MS);
      } else {
        console.log(`\n============================================================`);
        console.log(`❌ BACKEND APPLICATION HEALTH STATUS: OFFLINE / UNREACHABLE`);
        console.log(`------------------------------------------------------------`);
        console.log(` URL:    ${HEALTH_URL}`);
        console.log(` Error:  ${err.message}`);
        console.log(` Detail: Backend server on port 8080 did not respond within ${MAX_ATTEMPTS}s.`);
        console.log(` Action: Check if port 8080 is blocked or server failed to boot.`);
        console.log(`============================================================\n`);
      }
    }
  }
}

runHealthCheck();
