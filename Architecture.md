# Azure Log Analytics KQL App - System Architecture & Design

This document details the technical design, component structure, authentication flow, query execution pipeline, and local/pod container deployment architectures.

---

## 1. High-Level Application & Component Architecture

The system uses a container-first, decoupled client-server architecture built with a React 18 Single Page Application (Vite, Port 5010) and a Node.js Express API (Port 8080).

```mermaid
graph TD
    subgraph ClientLayer ["Frontend SPA (Port 5010 / Production Static Bundle)"]
        UI["React 18 SPA (Pistachio Green Theme)"]
        AuthUI["MSAL OAuth 2.0 Auth Component"]
        FilterEngine["Hierarchical Dependent Filter Engine"]
        ResultGrid["Interactive Data Table (Click-Hold Drag Reorder)"]
    end

    subgraph BackendLayer ["Backend API Service (Express - Port 8080)"]
        Router["Express Router (/api)"]
        ZodVal["Zod Payload & Query Validator"]
        KqlGuard["KQL Parser & Command Guard"]
        AzureSDK["Azure Log Analytics SDK (logAnalytics.ts)"]
    end

    subgraph AzureServices ["Azure Cloud Platform"]
        Entra["Microsoft Entra ID (Azure AD)"]
        ARG["Azure Resource Graph API"]
        LA["Azure Log Analytics Workspace"]
    end

    %% Interactions
    UI -->|1. Sign in & Fetch Token| Entra
    UI -->|2. Discover User Workspaces| ARG
    UI -->|3. Query API Request| Router
    Router --> ZodVal
    ZodVal --> KqlGuard
    KqlGuard --> AzureSDK
    AzureSDK -->|4. Authenticated KQL Execution| LA
```

---

## 2. Authentication Architecture & Configuration

The application implements dual-mode authentication supporting both client-side OAuth 2.0 (MSAL) and server-side Azure credentials (SPN / Managed Identity):

```mermaid
graph LR
    subgraph ClientAuth ["Client Auth (SPA)"]
        MSAL["@azure/msal-react"]
        TokenStore["Browser Session Storage"]
    end

    subgraph ServerAuth ["Server Auth (API)"]
        DefaultCred["DefaultAzureCredential"]
        SPN["Service Principal (AZURE_CLIENT_SECRET)"]
        MI["Managed Identity (User/System Assigned)"]
    end

    subgraph IdentityProvider ["Identity Provider"]
        EntraID["Microsoft Entra ID"]
    end

    MSAL -->|Interactive Popup Login| EntraID
    EntraID -->|Bearer Token| TokenStore
    DefaultCred -->|Token Acquisition| EntraID
    SPN -->|Client Credentials Flow| EntraID
    MI -->|IMDS Identity Endpoint| EntraID
```

### Authentication Modes & Configuration
- **User Single Sign-On (MSAL SPA)**:
  - `VITE_AZURE_CLIENT_ID`: Entra ID Application (Client) ID.
  - `VITE_AZURE_TENANT_ID`: Directory (Tenant) ID.
  - `VITE_REQUIRE_AZURE_AD_AUTH`: Controls interactive landing page (`true`/`false`).
  - **Dynamic Workspace Discovery**: Authenticated users query `microsoft.operationalinsights/workspaces` via Azure Resource Graph to populate the workspace dropdown selector.
- **Server-Side Authorization (SPN / Managed Identity)**:
  - `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`: For Service Principal auth.
  - `DefaultAzureCredential`: Falls back automatically to Managed Identity in AKS / Container Apps or Azure CLI credentials during local development.

---

## 3. Query Execution Pipeline & KQL Engine Design

How KQL queries, dynamic predicate substitution, safety sanitization, and time-range filtering execute end-to-end:

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React Frontend (SPA)
    participant API as Express API Server
    participant KQL as KQL Parsing Engine
    participant Azure as Azure Log Analytics API

    User->>UI: Select Workspace & Click Preset / Enter KQL
    UI->>UI: Evaluate Dependent Dynamic Filters (e.g. Resource -> originalHost_s)
    UI->>API: POST /api/parse { query }
    API->>KQL: assertSafeKql(query) & parseFilters(query)
    Note over KQL: Validate blacklisted administrative commands (.drop, .create, etc.)<br/>Isolate top-level where clauses & generate stable hashes
    KQL-->>API: Filter objects [{ id, enabled, rawText }]
    API-->>UI: JSON { filters }
    UI-->>User: Render toggleable Filter Chips & Dynamic Selectors

    User->>UI: Adjust filters / time range & click "Run"
    UI->>API: POST /api/query { query, timespan, filters, workspaceId }
    API->>KQL: Construct effective KQL (strip disabled clauses, inject time filter)
    API->>Azure: logsQueryClient.queryWorkspace(workspaceId, effectiveQuery, timespan)
    Azure-->>API: LogsQueryResult (Raw Tables & Columns)
    API->>API: Format rows & slice results to QUERY_MAX_ROWS (5000)
    API-->>UI: JSON { tables, statistics }
    UI->>User: Display in Interactive Result Grid (Drag Reorder, Sorting, CSV)
```

---

## 4. Frontend & Backend Technical Architecture

### A. Frontend Single Page Application Architecture (Client)
- **Framework & Component Model**: Built on React 18 with TypeScript strict mode, bundled via Vite for optimized ESM module splitting.
- **State Management & Data Flow**:
  - Unidirectional state flow managing active query predicates, dynamic filters, workspace selections, and execution telemetry.
  - Asynchronous filter cache state mapping stable SHA-256 filter identifiers to active boolean toggles.
  - Multi-tenant MSAL authentication context managing OAuth 2.0 bearer token acquisition and automatic silent renewal (`acquireTokenSilent`).
- **Resource Graph Integration**: Executes KQL queries against Azure Resource Graph (`microsoft.operationalinsights/workspaces`) via standard fetch abstractions to dynamically discover Log Analytics workspaces under user RBAC scope.
- **Data Grid & Memory Performance**:
  - In-memory Virtualized Result Table handling tabular data payloads up to 50,000 rows without UI main-thread blocking.
  - Data-type aware sorting algorithms (`localeCompare` with numeric sensitivity, ISO-8601 timestamp parsing, numeric comparison).
  - Native HTML5 Drag-and-Drop column reordering maintaining immutable column ordinal index arrays in React state.
- **CSV Serialization**: Client-side streaming RFC-4180 compliant CSV string generation and browser Blob URL instantiation.

### B. Backend API Service Architecture (Server)
- **Runtime & Network Protocol**: Node.js runtime executing Express server listening on dual IPv4/IPv6 socket bindings (`0.0.0.0:8080`).
- **Environment Schema & Configuration**: Immutable environment validation at process startup using `zod` (`server/src/config.ts`), with strict root `.env` path resolution across npm workspace monorepo roots.
- **Security & Middleware Pipeline**:
  - `helmet`: Enforces strict HTTP security headers (HSTS, CSP, X-Content-Type-Options, X-Frame-Options).
  - `cors`: Evaluates incoming `Origin` headers against allowed domain lists configured in `CORS_ORIGIN`.
  - `express-rate-limit`: Memory-backed sliding window rate limiter restricting API request frequencies per IP.
  - `assertSafeKql`: AST/Regex security guard sanitizing incoming KQL strings against administrative mutations (`.create`, `.drop`, `.alter`, `.ingest`).
- **Azure SDK Execution Engine**:
  - Uses `@azure/identity` (`DefaultAzureCredential`, `ClientSecretCredential`) and `@azure/monitor-query` (`LogsQueryClient`).
  - Request forwarding supporting client-provided Azure AD bearer tokens via Authorization header or fallback to server SPN / Managed Identity.
  - Result serialization converting Azure Log Analytics `LogsQueryResult` tables and columns into normalized JSON response structures.

---

## 5. Deployment Structures & Diagrams (Local & Kubernetes / Pod)

### A. Local Development Deployment Structure
In local development, Vite proxies API calls from port `5010` to Express on port `8080`:

```mermaid
graph LR
    subgraph DeveloperMachine ["Local Developer Workstation (Windows 11)"]
        Browser["Browser (http://localhost:5010)"]
        ViteDev["Vite Dev Server (Port 5010)"]
        ExpressDev["Express API Server (Port 8080)"]
        AzCLI["Azure CLI Auth (az login)"]
    end

    subgraph AzureCloud ["Azure Cloud"]
        EntraID["Entra ID (MSAL Login)"]
        LogAnalytics["Log Analytics Workspace"]
    end

    Browser -->|Access UI| ViteDev
    ViteDev -->|Proxy /api requests| ExpressDev
    Browser -->|MSAL Auth| EntraID
    ExpressDev -->|DefaultAzureCredential| AzCLI
    ExpressDev -->|Execute KQL| LogAnalytics
```

### B. Pod & Kubernetes (AKS) Deployment Structure
In containerized production (Docker / AKS), single or multi-replica pod containers serve the production SPA bundle and Express API:

```mermaid
graph TD
    subgraph AKSCluster ["Azure Kubernetes Service (AKS) Cluster"]
        subgraph IngressLayer ["Ingress Layer"]
            IstioGw["Istio Ingress Gateway (HTTPS:443)"]
            VirtualService["VirtualService Routing Rules"]
        end

        subgraph PodReplicas ["Pod Replicas (Deployment)"]
            Pod1["Pod 1: App Container (Node.js Express :8080)"]
            Pod2["Pod 2: App Container (Node.js Express :8080)"]
        end

        subgraph ClusterConfig ["Cluster Configuration"]
            K8sSecret["Opaque Secret (aks/secret.yaml)"]
            ManagedID["User-Assigned Managed Identity"]
        end
    end

    subgraph External ["External Clients & Azure Services"]
        Users["End Users (HTTPS)"]
        ACR["Azure Container Registry (ACR)"]
        AzureLA["Log Analytics Workspace"]
    end

    Users -->|HTTPS Requests| IstioGw
    IstioGw --> VirtualService
    VirtualService -->|Load Balance| Pod1
    VirtualService -->|Load Balance| Pod2
    ACR -->|Pull Image| PodReplicas
    K8sSecret -.->|Inject Env Vars| PodReplicas
    ManagedID -.->|Assign Identity| PodReplicas
    PodReplicas -->|Query Logs API| AzureLA
```
