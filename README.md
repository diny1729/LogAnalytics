# Azure Log Analytics KQL Explorer

A container-first application designed for querying Azure Log Analytics workspaces, constructing KQL queries, and analyzing log telemetry with interactive GUI controls.

## Key Features & Functionality

- **Interactive KQL Query Construction & Presets**:
  - Pre-built query templates for Application Gateway, Azure Firewall, Front Door, Storage Accounts, and Key Vault.
  - GUI condition controls with real-time `⚡ KQL Preview` bar.
  - Support for multiple filter operators: `==`, `!=`, `contains`, `!contains`, and `between` (e.g., `between (400 .. 599)`).
  - Dynamic resource selection with dependent child dropdowns (e.g., selecting a Resource updates available DNS hosts or container names).

- **Multi-Operator Primary Result Filtering**:
  - Filter output table rows directly using column-level operators (`==`, `!=`, `contains`, `!contains`).
  - Visual active filter pills with individual removal buttons and a **Clear All Filters** action.

- **Summarized Result Output & KQL Group By Breakdown**:
  - Analytical summary table displaying distinct value frequency counts (`Count`) and percentage share (`% Share`) with progress indicators.
  - **KQL Multi-Column Grouping (`| summarize count() by ...`)**: Select multiple columns (e.g., `requestUri_s` and `clientIP_s`) to execute AND tuple grouping, displaying exact combination counts for each URI per Client IP.
  - **Cascading Filter Dropdown**: 2-level menu allowing multi-column checking and specific sub-value selection per column.
  - **Interactive Column Header Sorting**: Click any header (`Column Name`, `Distinct Output Value`, `Count`, `% Share`, or dynamic column headers) to sort rows in Ascending (`↑`) or Descending (`↓`) order.
  - **Dynamic View Scope Toggle**: Switch between summarizing over active primary filtered results (`Filtered`) or the total dataset (`All Rows`).

- **Easy Access & Result Table Tools**:
  - Direct click-hold drag header reordering to customize column sequence.
  - Page size customization (`50`, `100`, `200`, `500`, `1000` rows per page).
  - Dynamic pagination, type-aware column sorting (numeric, ISO timestamp, string), CSV export, and Local/UTC timezone toggles.
  - Secure Azure AD authentication (MSAL SPA) with dynamic Azure Resource Graph workspace discovery and Service Principal (SPN) / Managed Identity support.

---

## Summarized Result Output & Breakdown

The application includes a dedicated **Summarized Telemetry** panel located below the primary result table:

1. **Multi-Column KQL Grouping**:
   - Selecting 1 column displays frequency breakdown for that field.
   - Selecting 2 or more columns performs multi-column tuple grouping (`| summarize count() by col1, col2`), rendering separate columns for each field and computing exact occurrence counts.

2. **Sub-Value Filtering & View Scope**:
   - Check specific sub-values per column to refine summary telemetry.
   - Toggle between **Filtered** (evaluates active primary table filters) and **All Rows** (evaluates raw query output).

3. **Column Header Sorting**:
   - Click any table header to toggle Ascending (`↑`) or Descending (`↓`) sort order.

---

## Application Architecture & Technical Design

### Technologies Used
- **Frontend**: React 19, TypeScript, Vite, Lucide Icons, `@azure/msal-react`, `@azure/msal-browser`.
- **Backend**: Node.js 22, Express, TypeScript, Zod, `@azure/monitor-query-logs`, `@azure/identity`, Helmet, Express-Rate-Limit.
- **Packaging & Monorepo**: Managed via npm workspaces (`client/` and `server/`).

### Frontend & Backend Communication
- Communication between the client and server occurs via a secure REST API over HTTP/HTTPS using JSON payloads.
- **Development Mode**: Vite dev server (`http://localhost:5173`) proxies `/api/*` requests to the Express backend (`http://localhost:8080`).
- **Production Mode**: The Express server directly serves both `/api/*` endpoints and the compiled single-page static React build (`client/dist`).
- **Security & Protection**: Backend endpoints are secured using Zod request body validation schemas, Helmet security headers, CORS origin restrictions, and sliding window rate limiting.

### Azure AD Authentication & Azure SDK Integration
- **User Authentication**: Frontend integrates `@azure/msal-react` for Single Sign-On (SSO) using Microsoft Entra ID (Azure AD). Users sign in using OAuth 2.0 Authorization Code Flow with PKCE.
- **Dynamic Workspace Discovery**: Upon login, the client uses the user's OAuth access token to query Azure Resource Graph (`microsoft.operationalinsights/workspaces`) and fetch all Log Analytics Workspaces the user has permissions to view.
- **Log Analytics Query Execution**: Backend executes KQL queries using `@azure/monitor-query-logs`. Authentication to Azure Log Analytics occurs securely via `@azure/identity` using `DefaultAzureCredential`, Service Principal (`AZURE_CLIENT_SECRET`), or container Managed Identity. Azure client secrets remain strictly isolated on the backend server.

---

## Azure Access & Configuration

Grant the application identity access to the Log Analytics workspace (e.g., `Log Analytics Reader` role).

Configurable via environment variables or Kubernetes secrets:
- Service Principal (SPN): `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`
- User Access: MSAL Azure AD login with dynamic workspace discovery

---

## Local Development & Execution

```powershell
npm run install:all
npm run dev
```

To run a production build locally:
```powershell
npm run production
```

---

## Container & AKS Production Deployment

### 1. Configure Cluster Credentials
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

### 2. Master All-in-One Production Deployment Script
Run the master deployment script from the project root:
```powershell
.\scripts\deploy-prod.ps1
```
The script builds the Docker image, pushes it to ACR, prompts for user confirmation (`Y/N`), connects to AKS, and applies Kubernetes manifests (`aks/secret.yaml`, `aks/deployment.yaml`, `aks/istio-ingress.yaml`).
