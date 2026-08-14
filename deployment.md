# Azure Log Analytics KQL App - Deployment & Operations Guide

This document describes how to set up, deploy, and maintain the application in local development (Windows 11) and production (Docker, Azure hosting) environments.

---

## 1. Environment Variable Reference

Create a `.env` file in the root workspace folder. The application loads this file automatically in development and when run via Docker container.

| Variable Name | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `NODE_ENV` | String | `development` | Set to `production` in containerized/production setups. |
| `PORT` | Number | `8080` | Port the API server listens on. |
| `CORS_ORIGIN` | String | `http://localhost:5010` | Allowed CORS origins (comma-separated list for multiples). |
| `LOG_ANALYTICS_WORKSPACE_ID` | String | *Required (UUID)* | Default Azure Log Analytics Workspace ID fallback. |
| `ALLOW_WORKSPACE_OVERRIDE` | Boolean | `false` | If `true`, clients can supply custom workspace IDs via API request body. |
| `QUERY_TIMEOUT_MS` | Number | `30000` | Query execution timeout in milliseconds. |
| `QUERY_MAX_ROWS` | Number | `5000` | Maximum rows returned per query (capped at `50000`). |
| `QUERY_MAX_LENGTH` | Number | `20000` | Maximum KQL query character length limit. |
| `RATE_LIMIT_WINDOW_MS` | Number | `60000` | Rate limiting sliding window size in milliseconds. |
| `RATE_LIMIT_MAX` | Number | `60` | Max API requests allowed per client IP per window. |
| `AZURE_TENANT_ID` | String | *Required for SPN* | Azure AD Directory (Tenant) ID for Service Principal. |
| `AZURE_CLIENT_ID` | String | *Required for SPN* | Azure AD Application (Client) ID for Service Principal / Managed Identity. |
| `AZURE_CLIENT_SECRET` | String | *Required for SPN* | Azure AD Client Secret for Service Principal. |
| `VITE_AZURE_CLIENT_ID` | String | *Required for Login*| Frontend SPA Client ID for Microsoft Azure AD MSAL Login. |
| `VITE_AZURE_TENANT_ID` | String | *Required for Login*| Frontend SPA Tenant ID for Microsoft Azure AD MSAL Login. |
| `VITE_REQUIRE_AZURE_AD_AUTH` | Boolean | `true` | Set to `false` to bypass Azure AD login landing page and use backend credentials. |
| `VITE_WORKSPACES` | String | *Optional* | Comma-separated `Name:GUID` list of predefined Log Analytics Workspaces. |

---

## 2. Where to Set Azure AD SPN Authentication & Workspace ID

### A. Configuring Azure AD Service Principal (SPN) Authentication

To authenticate with Azure AD, define your Service Principal credentials and Single Page Application (SPA) IDs in `.env`:

#### 1. In Root `.env` File (Local Dev & Docker):
```env
# Backend Service Principal (SPN) Credentials
AZURE_TENANT_ID=your-tenant-id-guid
AZURE_CLIENT_ID=your-spn-client-id-guid
AZURE_CLIENT_SECRET=your-spn-client-secret-value

# Frontend Azure AD MSAL Single Page App (SPA) Login
VITE_AZURE_CLIENT_ID=your-spa-client-id-guid
VITE_AZURE_TENANT_ID=your-tenant-id-guid
```

#### 2. In Containerized / Azure Hosting Environments (AKS / Container Apps):
- Add `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, and `AZURE_CLIENT_SECRET` as environment variables or Kubernetes secret keys in `aks/secret.yaml`.
- Set `VITE_AZURE_CLIENT_ID` and `VITE_AZURE_TENANT_ID` during the client build step or in `aks/secret.yaml`.

#### 3. Azure Portal App Registration Setup Instructions:
1. Navigate to **Microsoft Entra ID > App Registrations > New registration**.
2. Name: `LogAnalytics-KQL-App`.
3. Supported Account Types: `Accounts in this organizational directory only (Single tenant)`.
4. Redirect URI (Single-page application - SPA): `http://localhost:5010/` (for local dev) and `http://localhost:8080/` (for production).
5. Click **Register**.
6. Copy **Application (client) ID** into `VITE_AZURE_CLIENT_ID` and `AZURE_CLIENT_ID`.
7. Copy **Directory (tenant) ID** into `VITE_AZURE_TENANT_ID` and `AZURE_TENANT_ID`.
8. Go to **Certificates & secrets > New client secret** to generate a secret, and copy its value into `AZURE_CLIENT_SECRET`.
9. Go to **API permissions > Add a permission**:
   - Select **Log Analytics API** -> Delegated permissions -> `Data.Read`.
   - Select **Azure Service Management** -> Delegated permissions -> `user_impersonation` (enables dynamic workspace discovery).
10. Click **Grant admin consent for [Your Organization]**.

---

### B. Configuring Log Analytics Workspace ID

Workspace IDs can be set via two methods:

#### Method 1: Environment Variable Default (Server Fallback)
Set `LOG_ANALYTICS_WORKSPACE_ID` in `.env`:
```env
LOG_ANALYTICS_WORKSPACE_ID=11111111-1111-1111-1111-111111111111
```
This ID serves as the default workspace when queries are executed without specifying a workspace ID.

#### Method 2: Dynamic UI Selection via Azure AD Login (Recommended)
1. Launch the application. Users land on the **Microsoft Azure AD Login Page**.
2. Click **Sign in with Microsoft Azure AD**.
3. Upon authentication, the application automatically queries Azure Resource Graph (`microsoft.operationalinsights/workspaces`) using the logged-in user's token.
4. Select any accessible Log Analytics Workspace directly from the **Log Analytics Workspace** dropdown selector in the top bar.

---

## 3. Local Development (Windows 11)

### Prerequisites
* Node.js v20 or v22 (recommended).
* Azure CLI (`az`) installed and logged in (required for local token capture if using `DefaultAzureCredential`).

### Configuration & Dev Execution

1. **Log in to Azure CLI**:
   Open PowerShell or CMD:
   ```powershell
   az login
   ```
   Set active subscription:
   ```powershell
   az account set --subscription "<your-subscription-id>"
   ```

2. **Initialize Environment**:
   Copy `.env.example` to `.env`:
   ```powershell
   copy .env.example .env
   ```
   Configure `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, and `LOG_ANALYTICS_WORKSPACE_ID`.

3. **Install Dependencies**:
   ```powershell
   npm run install:all
   ```

4. **Start Dev Servers**:
   ```powershell
   npm run dev
   ```
   * Frontend (Vite SPA): `http://localhost:5010`
   * Backend (Express API): `http://localhost:8080`

---

---

## 4. Container & AKS Production Deployment

### A. Dockerfile & Context Isolation (`.dockerignore`)
The application includes an optimized multi-stage `Dockerfile` (`node:22-alpine`) that isolates the build context via `.dockerignore` (excluding `node_modules`, `.git`, `scratch`, `brain`, `.system_generated`, logs, PDFs, and build clutter).

The container runs securely as a non-root user (`USER node`) and exposes port `8080`.

### B. Configuring Deployment Parameters (`aks/deploy-config.json`)
Copy `aks/deploy-config.example.json` to `aks/deploy-config.json` and set your Azure Subscription ID, Resource Group, AKS Cluster Name, and ACR Registry:

```json
{
  "SubscriptionId": "00000000-0000-0000-0000-000000000000",
  "ResourceGroup": "rg-loganalytics-prod",
  "ClusterName": "aks-cluster-prod",
  "AcrName": "myacrregistry",
  "ImageName": "loganalytics-app",
  "ImageTag": "latest"
}
```

### C. Master All-in-One Production Deployment Pipeline (`scripts/deploy-prod.ps1`)
To execute the complete production build, ACR push, and AKS deployment in a single command, run:

```powershell
.\scripts\deploy-prod.ps1
```

#### What the Master Script Automates:
1. **Reads Cluster Configuration**: Parses `aks/deploy-config.json`.
2. **Sets Active Azure Subscription**: Executes `az account set --subscription <ID>`.
3. **Builds Production Docker Image**: Runs `docker build` using the multi-stage `Dockerfile`.
4. **Pushes Image to ACR**: Authenticates via `az acr login` and pushes `$AcrName.azurecr.io/$ImageName:$ImageTag`.
5. **Interactive User Confirmation Prompt**: Displays target details and pauses for explicit user confirmation (`Y/N`) before touching the AKS cluster:
   ```text
   =================================================================
                   AKS DEPLOYMENT CONFIRMATION                      
   =================================================================
     Target Subscription : 00000000-0000-0000-0000-000000000000
     Resource Group      : rg-loganalytics-prod
     AKS Cluster Name    : aks-cluster-prod
     Pushed Image Tag    : myacrregistry.azurecr.io/loganalytics-app:latest
   =================================================================
   Do you want to proceed with deploying to AKS cluster 'aks-cluster-prod'? (Y/N):
   ```
6. **Connects & Deploys to AKS**: Connects via `az aks get-credentials` and applies Kubernetes secrets (`aks/secret.yaml`), deployments (`aks/deployment.yaml`), and Istio ingress (`aks/istio-ingress.yaml`).
7. **Monitors Rollout**: Tracks `kubectl rollout status deployment/loganalytics-app`.

---

## 5. Local Production Execution

To run a production build and launch the application locally without Docker:

```powershell
npm run production
# OR
npm run prod
```

This script:
1. Compiles both TypeScript server (`tsc`) and React Vite frontend (`tsc && vite build`).
2. Starts the production Express server (`node server/dist/index.js`), which automatically serves static single-page frontend assets from `client/dist`.

---

## 6. Custom DNS Domain Setup Guide

When configuring the application to run under a custom DNS domain (e.g., `https://loganalytics.yourcompany.com` or `http://kql-app.local:5010`), follow these configuration steps:

### 1. Update Environment Variables (`.env`)
Update `CORS_ORIGIN` to include your custom domain:
```env
CORS_ORIGIN=https://loganalytics.yourcompany.com,http://localhost:5010,http://localhost:8080
```

### 2. Add Redirect URI in Azure AD Portal (Microsoft Entra ID)
1. Go to **Azure Portal > Microsoft Entra ID > App Registrations > [Your App Registration]**.
2. Click **Authentication** in the left sidebar.
3. Under **Single-page application (SPA)**, add your custom domain redirect URI:
   - `https://loganalytics.yourcompany.com/` (or `http://kql-app.local:5010/`)
4. Click **Save**.

### 3. Client MSAL Redirect Configuration (`client/src/authConfig.ts`)
The client app uses `redirectUri: "/"` by default, which automatically uses your current browser origin (`window.location.origin`). No code changes are required unless you wish to specify an explicit environment override.

### 4. Local Vite Dev Server Host Binding (`client/vite.config.ts`)
If mapping a custom local domain via your `hosts` file (e.g., `127.0.0.1 loganalytics.local`), enable host binding in `client/vite.config.ts`:
```ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5010,
    host: true,
    allowedHosts: ["loganalytics.local", "loganalytics.yourcompany.com"],
    proxy: {
      "/api": "http://127.0.0.1:8080"
    }
  }
});
```

### 5. AKS / Kubernetes Ingress Configuration (`aks/istio-ingress.yaml` & `aks/secret.yaml`)
- In `aks/istio-ingress.yaml`, set the `hosts` entry to match your custom DNS domain:
  ```yaml
  hosts:
    - "loganalytics.yourcompany.com"
  ```
- In `aks/secret.yaml`, update the `CORS_ORIGIN` secret string to `https://loganalytics.yourcompany.com`.

---

## 7. Production Deployment Setup Guide

For containerized production deployments (Docker, Azure Container Apps, or Azure Kubernetes Service - AKS):

### A. Kubernetes Secret Configuration (`aks/secret.yaml`)
Set the following keys in your production environment or Kubernetes secret:

```yaml
stringData:
  NODE_ENV: "production"
  PORT: "8080"
  CORS_ORIGIN: "https://loganalytics.yourcompany.com"

  # Log Analytics Workspace Settings
  LOG_ANALYTICS_WORKSPACE_ID: "11111111-1111-1111-1111-111111111111"
  ALLOW_WORKSPACE_OVERRIDE: "true"
  VITE_WORKSPACES: "Prod-App-Logs:11111111-1111-1111-1111-111111111111,Prod-Security-Logs:22222222-2222-2222-2222-222222222222"

  # Authentication Mode Switch ("false" to bypass login landing screen in production)
  VITE_REQUIRE_AZURE_AD_AUTH: "false"

  # Azure Backend Authentication (Service Principal or Managed Identity)
  AZURE_TENANT_ID: "<production-tenant-id>"
  AZURE_CLIENT_ID: "<production-spn-client-id>"
  AZURE_CLIENT_SECRET: "<production-spn-client-secret>"
```

### B. Choosing Production Authentication Mode

* **Mode 1: Internal Portal / SPN Mode (`VITE_REQUIRE_AZURE_AD_AUTH=false`)**:
  - Set `VITE_REQUIRE_AZURE_AD_AUTH=false`.
  - Users enter the query workspace immediately without seeing an Azure AD login landing screen.
  - Queries execute via the backend Service Principal (`AZURE_CLIENT_SECRET`) or container Managed Identity against the production Log Analytics Workspaces listed in `VITE_WORKSPACES`.

* **Mode 2: User Single Sign-On (`VITE_REQUIRE_AZURE_AD_AUTH=true`)**:
  - Set `VITE_REQUIRE_AZURE_AD_AUTH=true`.
  - Set `VITE_AZURE_CLIENT_ID` & `VITE_AZURE_TENANT_ID`.
  - Ensure `https://loganalytics.yourcompany.com/` is added under **Microsoft Entra ID > App Registrations > Authentication > SPA Redirect URIs**, and click **Grant Admin Consent** in Azure Portal.

---

## 8. Summary of UI & System Features

1. **🌊 Bluish-Green Dark Gradient Design System**:
   - Theme: Deep Slate background (`#04141c`), Teal accents (`#2dd4bf`), Sky Blue headers (`#38bdf8`), and Emerald indicators (`#34d399`).

2. **📊 Summarized Column Telemetry & KQL Group By Engine**:
   - **KQL Group By Engine (`| summarize count() by ...`)**: Multi-selecting 2 or 3+ columns dynamically groups output rows by composite tuples (e.g. `| summarize count() by requestUri_s, clientIP_s`), displaying exact combination counts for each distinct URI per Client IP.
   - **Multi-Select Cascading Dropdown (`Filter Columns & Values`)**: 2-level popover menu for selecting multiple columns and checking specific sub-values per column. Positioned left-aligned next to the title for zero screen overflow.
   - **Interactive Column Header Sorting**: Clickable table headers (`Column Name`, `Distinct Output Value`, `Count`, `% Share`, and dynamic grouped column headers) with visual sort indicators (`ArrowUp` / `ArrowDown`).
   - **Dynamic View Scope Toggle**: Seamlessly switch between **`Filtered (X)`** (summarizes frequencies across active primary table filter results) and **`All Rows (Y)`** (summarizes over the total dataset).
   - **Wrapped Column Values & Fixed Layout**: Zero horizontal scrolling (`table-layout: fixed; width: 100%`) with automatic word wrapping for long URLs and strings.

3. **🎯 Multi-Operator Primary Result Filtering**:
   - Filter primary result table rows using interactive operators (`==`, `!=`, `contains`, `!contains`).
   - **Active Multi-Column Filters Bar**: Visual filter condition pills displaying active filters with individual `✕` removal buttons and a **Clear All Filters** action.

4. **🖐️ Direct Click-Hold Cursor Column Movement**:
   - Output table columns are reordered directly by clicking, holding, and dragging headers (`cursor: grab` / `cursor: grabbing`) without requiring manual arrow buttons.

5. **🚀 Production Master Automation Script**:
   - Single master script `scripts/deploy-prod.ps1` that orchestrates Docker build, ACR push, interactive `Y/N` confirmation prompt, and AKS deployment.
