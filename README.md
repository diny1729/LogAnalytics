# Azure Log Analytics KQL App

A container-first Node.js TypeScript application that runs KQL queries against Azure Log Analytics and turns common `where` filters into GUI controls. Azure credentials stay on the server; the browser only talks to the local API.

## Features

- **Bluish-Green Dark Gradient Design System**: Premium dark UI theme (`#04141c` deep dark background, `#2dd4bf` teal accents, `#38bdf8` sky blue title highlights, and `#34d399` emerald success indicators).
- **Summarized Column Telemetry & KQL Grouping**:
  - Analytical breakdown table at the bottom of result tables displaying distinct value frequency counts (`Count`) and percentage share (`% Share`) with visual progress bars.
  - **KQL Group By Engine (`| summarize count() by ...`)**: Multi-selecting 2 or 3+ columns in the telemetry filter dropdown dynamically groups output rows by composite tuples (e.g. `| summarize count() by requestUri_s, clientIP_s`), displaying exact combination counts for each distinct URI per Client IP.
  - **Multi-Select Cascading Dropdown (`Filter Columns & Values`)**: 2-level popover menu for selecting multiple columns and checking specific sub-values per column. Positioned left-aligned next to the title for zero screen overflow.
  - **Interactive Column Header Sorting**: Clickable table headers (`Column Name`, `Distinct Output Value`, `Count`, `% Share`, and dynamic grouped column headers) with visual sort indicators (`ArrowUp` / `ArrowDown`).
  - **Dynamic View Scope Toggle**: Seamlessly switch between **`Filtered (X)`** (summarizes frequencies across active primary table filter results) and **`All Rows (Y)`** (summarizes over the total dataset).
  - **Wrapped Column Values & Fixed Layout**: Zero horizontal scrolling (`table-layout: fixed; width: 100%`) with automatic word wrapping for long URLs and strings.
- **Multi-Operator Primary Result Filtering**:
  - Filter primary result table rows using interactive operators (`==`, `!=`, `contains`, `!contains`).
  - **Active Multi-Column Filters Bar**: Visual filter condition pills displaying active filters with individual `✕` removal buttons and a **Clear All Filters** action.
- **Interactive KQL Preset & Condition Filters**:
  - Quick-switch preset cards for Application Gateway, Azure Firewall, Front Door, Storage, and Key Vault.
  - Filter condition controls with operator selection (`==`, `!=`, `contains`, `!contains`, `between`), custom value input boxes, popover selection menus, and real-time `⚡ KQL Preview` bar.
- **Direct Click-Hold Column Movement**: Reorder output table columns smoothly by clicking, holding, and dragging headers (`cursor: grab` / `cursor: grabbing`).
- **Secure Azure Authentication**: Server-side credentials with `DefaultAzureCredential` / Service Principal (SPN) and frontend MSAL Azure AD login with dynamic Azure Resource Graph workspace discovery.
- **Enterprise Result Tables**: Page size selector (`50`, `100`, `200`, `500`, `1000`), resizable columns, type-aware sorting (numeric, ISO timestamp, string), pagination, CSV download, and local/UTC timezone toggling.

## Azure Access

Grant the application identity least-privilege access to the Log Analytics workspace, typically the `Log Analytics Reader` role at workspace scope.

For Managed Identity in Azure-hosted containers, assign the identity to the runtime and set `LOG_ANALYTICS_WORKSPACE_ID`. For a user-assigned identity, also set `AZURE_CLIENT_ID`.

For SPN auth, set either:

- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SERVICE_PRINCIPAL_CERTIFICATE_PATH`

## Local Development

```powershell
npm run install:all
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API calls to the server on `http://localhost:8080`.

## Container & AKS Production Deployment

### 1. Dockerfile & Context Optimization
The application uses a lightweight multi-stage Docker build (`node:22-alpine`) that omits dev dependencies, source caches, `.git`, `scratch`, `brain`, and temporary files via `.dockerignore`.

### 2. Configure Cluster Credentials
Copy `aks/deploy-config.example.json` to `aks/deploy-config.json` and configure your Azure Subscription, Resource Group, Cluster Name, and ACR Registry:
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

### 3. Master All-in-One Production Deployment Script
Run the master PowerShell deployment script from the project root:
```powershell
.\scripts\deploy-prod.ps1
```
What this master script automatically performs:
1. **Reads Cluster Configuration**: Parses `aks/deploy-config.json`.
2. **Docker Build**: Builds local production image using multi-stage `Dockerfile`.
3. **ACR Push**: Authenticates (`az acr login`) and pushes the image to Azure Container Registry.
4. **Interactive User Confirmation**: Prompts `Do you want to proceed with deploying to AKS cluster '...'? (Y/N)` before modifying the AKS cluster.
5. **AKS Authentication & Deployment**: Connects (`az aks get-credentials`) and applies secrets (`aks/secret.yaml`), deployments (`aks/deployment.yaml`), and Istio ingress (`aks/istio-ingress.yaml`).

---

## API

- `GET /api/health`
- `POST /api/parse` with `{ "query": "..." }`
- `POST /api/query` with `{ "query": "...", "timespan": "PT24H", "filters": [{ "id": "...", "enabled": true }] }`

`workspaceId` can be included in `/api/query` only when `ALLOW_WORKSPACE_OVERRIDE=true`.
