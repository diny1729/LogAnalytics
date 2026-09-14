import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Columns3,
  Download,
  Filter,
  Play,
  Search,
  ShieldCheck,
  MessageSquare,
  LogIn,
  LogOut,
  RefreshCw,
  SlidersHorizontal,
  User,
  X,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Plus
} from "lucide-react";
import { runQuery, fetchUserWorkspaces, fetchServerWorkspaces, checkBackendHealth, type AzureWorkspace, type BackendHealthResponse } from "./api";
import type { QueryResponse, QueryTable } from "./types";
import { Chatbot } from "./Chatbot";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "./authConfig";
import { getEnv } from "./env";

const starterQuery = `AppRequests
| where TimeGenerated > ago(24h) and Success == false
| summarize Failures=count() by Name, ResultCode
| order by Failures desc`;

function formatFilterClause(field: string, val: string | string[]): string {
  if (Array.isArray(val)) {
    if (val.length === 0) return "";
    if (val.length === 1) return `| where ${field} == "${val[0]}"`;
    return `| where ${field} in (${val.map((v) => `"${v}"`).join(", ")})`;
  }
  return val ? `| where ${field} == "${val}"` : "";
}

function getRelatedColumns(
  queryText: string,
  tableColumns: string[],
  presetProjectCols?: Set<string>
): string[] {
  if (!tableColumns || tableColumns.length === 0) return [];

  // Strip single-line KQL comments (lines starting with // or inline //)
  const activeCode = queryText
    .split("\n")
    .map((line) => {
      const commentIdx = line.indexOf("//");
      return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    })
    .join("\n");

  // 1. Check for | summarize clause
  const summarizeMatch = activeCode.match(/\|\s*summarize\s+([^|]+)/i);
  if (summarizeMatch) {
    return tableColumns;
  }

  // 2. Check for | project clause (take the last active | project clause)
  const projectMatches = [...activeCode.matchAll(/\|\s*project\s+([^|]+)/gi)];
  if (projectMatches.length > 0) {
    const lastProjectClause = projectMatches[projectMatches.length - 1][1].trim();
    const projectedNames = lastProjectClause
      .split(",")
      .map((item) => {
        const parts = item.trim().split("=");
        return parts[0].trim();
      })
      .filter(Boolean);

    const projectedSet = new Set(projectedNames.map((n) => n.toLowerCase()));
    const matched = tableColumns.filter((col) => projectedSet.has(col.toLowerCase()));
    if (matched.length > 0) {
      return matched;
    }
  }

  // 3. Check presetProjectCols if present
  if (presetProjectCols && presetProjectCols.size > 0) {
    const matched = tableColumns.filter((col) => presetProjectCols.has(col));
    if (matched.length > 0) {
      return matched;
    }
  }

  // 4. Default fallback: all columns returned
  return tableColumns;
}

export type FilterOperator = "==" | "!=" | "contains" | "!contains" | "<" | "<=" | ">" | ">=";

function matchesValueOperator(valStr: string, op: FilterOperator, searchStr: string): boolean {
  const searchTerm = searchStr.trim();
  if (!searchTerm) return true;

  const valLower = valStr.toLowerCase();
  const searchLower = searchTerm.toLowerCase();

  if (op === "contains") {
    return valLower.includes(searchLower);
  }
  if (op === "!contains") {
    return !valLower.includes(searchLower);
  }
  if (op === "==") {
    return valLower === searchLower;
  }
  if (op === "!=") {
    return valLower !== searchLower;
  }

  // Numeric or Date Comparison operators: <, <=, >, >=
  const numVal = Number(valStr);
  const numTarget = Number(searchTerm);
  const isValNum = valStr.trim() !== "" && !isNaN(numVal);
  const isTargetNum = !isNaN(numTarget);

  if (isValNum && isTargetNum) {
    if (op === "<") return numVal < numTarget;
    if (op === "<=") return numVal <= numTarget;
    if (op === ">") return numVal > numTarget;
    if (op === ">=") return numVal >= numTarget;
  }

  const dateVal = new Date(valStr).getTime();
  const dateTarget = new Date(searchTerm).getTime();
  const isValDate = !isNaN(dateVal) && (valStr.includes("-") || valStr.includes(":"));
  const isTargetDate = !isNaN(dateTarget);

  if (isValDate && isTargetDate) {
    if (op === "<") return dateVal < dateTarget;
    if (op === "<=") return dateVal <= dateTarget;
    if (op === ">") return dateVal > dateTarget;
    if (op === ">=") return dateVal >= dateTarget;
  }

  // Fallback to string locale comparison
  const cmp = valStr.localeCompare(searchTerm, undefined, { numeric: true, sensitivity: "base" });
  if (op === "<") return cmp < 0;
  if (op === "<=") return cmp <= 0;
  if (op === ">") return cmp > 0;
  if (op === ">=") return cmp >= 0;

  return false;
}

function evaluateFilterCondition(
  rawVal: unknown,
  selectedSet: Set<string>,
  op: FilterOperator
): boolean {
  if (!selectedSet || selectedSet.size === 0) return true;
  const strVal = rawVal === null || rawVal === undefined ? "" : String(rawVal);

  if (op === "==" || op === "contains") {
    return selectedSet.has(strVal);
  }
  if (op === "!=" || op === "!contains") {
    return !selectedSet.has(strVal);
  }

  // Comparison operators: <, <=, >, >=
  return Array.from(selectedSet).some((targetStr) =>
    matchesValueOperator(strVal, op, targetStr)
  );
}

type PresetOption = { label: string; clause: string };

type PresetQuery = {
  id: string;
  name: string;
  baseQuery: string;
  options: PresetOption[];
  projectColumns: string[];
  dynamicFilters?: { label: string; field: string; clauseTemplate: (val: string | string[]) => string }[];
};

const PRESETS: PresetQuery[] = [
  {
    id: "afd-access",
    name: "AFD Access Log",
    baseQuery: 'AzureDiagnostics\n| where Category contains "FrontDoorAccessLog"',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "httpStatusDetails_s", clause: '| where httpStatusDetails_s == ""' },
      { label: "requestUri_s", clause: '| where requestUri_s contains ""' },
      { label: "clientIp_s", clause: '| where clientIp_s == ""' },
      { label: "socketIp_s", clause: '| where socketIp_s == ""' },
      { label: "originName_s", clause: '| where originName_s == ""' },
      { label: "ErrorInfo_s", clause: '| where ErrorInfo_s == ""' },
      { label: "originUrl_s", clause: '| where originUrl_s == ""' },
      { label: "routingRuleName_s", clause: '| where routingRuleName_s == ""' },
      { label: "timeTaken_d", clause: '| where timeTaken_d > 0' },
      { label: "clientCountry_s", clause: '| where clientCountry_s == ""' },
    ],
    projectColumns: ["TimeGenerated", "Resource", "hostName_s", "httpStatusDetails_s", "requestUri_s", "clientIp_s", "socketIp_s", "originName_s", "ErrorInfo_s", "originUrl_s", "routingRuleName_s", "timeTaken_d", "clientCountry_s"],
    dynamicFilters: [
      { label: "AFD Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) },
      { label: "DNS Name (hostName_s)", field: "hostName_s", clauseTemplate: (val) => formatFilterClause("hostName_s", val) }
    ]
  },
  {
    id: "afd-firewall",
    name: "AFD Firewall Log",
    baseQuery: 'AzureDiagnostics\n| where Category contains "FrontDoorWebApplicationFirewallLog"\n| where action_s contains "Block"',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "action_s", clause: '| where action_s == ""' },
      { label: "ruleName_s", clause: '| where ruleName_s == ""' },
      { label: "requestUri_s", clause: '| where requestUri_s contains ""' },
      { label: "clientIP_s", clause: '| where clientIP_s == ""' },
      { label: "trackingReference_s", clause: '| where trackingReference_s == ""' },
      { label: "socketIP_s", clause: '| where socketIP_s == ""' },
    ],
    projectColumns: ["TimeGenerated", "Resource", "host_s", "action_s", "ruleName_s", "requestUri_s", "clientIP_s", "trackingReference_s", "socketIP_s"],
    dynamicFilters: [
      { label: "AFD Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) },
      { label: "DNS Name (host_s)", field: "host_s", clauseTemplate: (val) => formatFilterClause("host_s", val) }
    ]
  },
  {
    id: "azfw-network",
    name: "Azure Firewall Network Log",
    baseQuery: 'AzureDiagnostics\n| where Category contains "NetworkRule"\n| extend af = parse_json(AdditionalFields)\n| extend Protocol = tostring(af.Protocol), SourceIp = tostring(af.SourceIp), SourcePort = toint(af.SourcePort), DestinationIp = tostring(af.DestinationIp), DestinationPort = toint(af.DestinationPort), DestinationFqdn = tostring(af.DestinationFqdn), Action = tostring(af.Action), Policy = tostring(af.Policy), RuleCollectionGroup = tostring(af.RuleCollectionGroup), RuleCollection = tostring(af.RuleCollection), Rule = tostring(af.Rule), ActionReason = tostring(af.ActionReason)',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "Action", clause: '| where Action == ""' },
      { label: "SourceIp", clause: '| where SourceIp == ""' },
      { label: "SourcePort", clause: '| where SourcePort == ""' },
      { label: "DestinationIp", clause: '| where DestinationIp == ""' },
      { label: "DestinationPort", clause: '| where DestinationPort != 443' },
      { label: "DestinationFqdn (DNS Name)", clause: '| where DestinationFqdn contains ""' },
      { label: "Protocol", clause: '| where Protocol == ""' },
      { label: "RuleCollectionGroup", clause: '| where RuleCollectionGroup == ""' },
      { label: "RuleCollection", clause: '| where RuleCollection == ""' },
      { label: "Rule", clause: '| where Rule == ""' },
      { label: "ActionReason", clause: '| where ActionReason == ""' }
    ],
    projectColumns: ["TimeGenerated", "Resource", "Action", "SourceIp", "SourcePort", "DestinationIp", "DestinationPort", "DestinationFqdn", "Protocol", "RuleCollectionGroup", "RuleCollection", "Rule", "ActionReason"],
    dynamicFilters: [
      { label: "Firewall Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) }
    ]
  },
  {
    id: "azfw-application",
    name: "Azure Firewall Application Log",
    baseQuery: 'AzureDiagnostics\n| where Category == "AZFWApplicationRule"\n| extend parsedFields = parse_json(AdditionalFields)\n| extend Protocol = tostring(parsedFields.Protocol), SourceIp = tostring(parsedFields.SourceIp), SourcePort = toint(parsedFields.SourcePort), DestinationPort = toint(parsedFields.DestinationPort), Action = tostring(parsedFields.Action), Policy = tostring(parsedFields.Policy), RuleCollectionGroup = tostring(parsedFields.RuleCollectionGroup), RuleCollection = tostring(parsedFields.RuleCollection), Rule = tostring(parsedFields.Rule), ActionReason = tostring(parsedFields.ActionReason), Fqdn = tostring(parsedFields.Fqdn), TargetUrl = tostring(parsedFields.TargetUrl), IsTlsInspected = tobool(parsedFields.IsTlsInspected), WebCategory = tostring(parsedFields.WebCategory), IsExplicitProxyRequest = tobool(parsedFields.IsExplicitProxyRequest)',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "SourceIp", clause: '| where SourceIp == ""' },
      { label: "SourcePort", clause: '| where SourcePort == ""' },
      { label: "DestinationPort", clause: '| where DestinationPort == ""' },
      { label: "Protocol", clause: '| where Protocol == ""' },
      { label: "Action", clause: '| where Action == ""' },
      { label: "Policy", clause: '| where Policy == ""' },
      { label: "RuleCollectionGroup", clause: '| where RuleCollectionGroup == ""' },
      { label: "RuleCollection", clause: '| where RuleCollection == ""' },
      { label: "Rule", clause: '| where Rule == ""' },
      { label: "ActionReason", clause: '| where ActionReason == ""' },
      { label: "Fqdn (DNS Name)", clause: '| where Fqdn contains "chatgpt"' },
      { label: "TargetUrl", clause: '| where TargetUrl contains ""' },
      { label: "IsTlsInspected", clause: '| where IsTlsInspected == true' },
      { label: "WebCategory", clause: '| where WebCategory == ""' },
      { label: "IsExplicitProxyRequest", clause: '| where IsExplicitProxyRequest == true' }
    ],
    projectColumns: ["TimeGenerated", "Resource", "SourceIp", "SourcePort", "DestinationPort", "Protocol", "Action", "Policy", "RuleCollectionGroup", "RuleCollection", "Rule", "ActionReason", "Fqdn", "TargetUrl", "IsTlsInspected", "WebCategory", "IsExplicitProxyRequest"],
    dynamicFilters: [
      { label: "Firewall Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) }
    ]
  },
  {
    id: "app-gateway",
    name: "Application Gateway Log",
    baseQuery: "AzureDiagnostics\n| where Category == 'ApplicationGatewayAccessLog'",
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "serverStatus_s", clause: '| where serverStatus_s == "200"' },
      { label: "serverResponseLatency_s", clause: '| where serverResponseLatency_s == ""' },
      { label: "serverRouted_s", clause: '| where serverRouted_s == ""' },
      { label: "backendSettingName_s", clause: '| where backendSettingName_s == ""' },
      { label: "backendPoolName_s", clause: '| where backendPoolName_s == ""' },
      { label: "timeTaken_d", clause: '| where timeTaken_d == 0' },
      { label: "httpMethod_s", clause: '| where httpMethod_s == "GET"' },
      { label: "ruleName_s", clause: '| where ruleName_s == ""' },
      { label: "originalHost_s", clause: '| where originalHost_s contains "raefordprod"' },
      { label: "clientIP_s", clause: '| where clientIP_s contains "4.153.111.1"' },
      { label: "listenerName_s", clause: '| where listenerName_s contains "PontoonbeachListener"' },
      { label: "httpStatus_d", clause: '| where httpStatus_d between (400 .. 599)' },
      { label: "requestUri_s", clause: '| where requestUri_s contains "/ws/integration/api/traceability"' },
      { label: "host_s (DNS Name)", clause: '| where host_s contains ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "Resource",
      "httpMethod_s",
      "httpStatus_d",
      "host_s",
      "clientIP_s",
      "requestUri_s",
      "originalHost_s",
      "serverStatus_s",
      "serverResponseLatency_s",
      "serverRouted_s",
      "backendSettingName_s",
      "backendPoolName_s",
      "timeTaken_d",
      "ruleName_s"
    ],
    dynamicFilters: [
      { label: "App Gateway Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) },
      { label: "Original Host (originalHost_s)", field: "originalHost_s", clauseTemplate: (val) => formatFilterClause("originalHost_s", val) }
    ]
  },
  {
    id: "storage-file",
    name: "Storage Fileshare Log",
    baseQuery: 'StorageFileLogs\n| extend FileShareName = case(\n    tostring(Uri) startswith "http://" or tostring(Uri) startswith "https://",\n    extract(@"https?://[^/]+/([^/?#]+)", 1, tostring(Uri)),\n    tostring(Uri) startswith @"\\\\",\n    extract(@"\\\\[^\\\\]+\\\\([^\\\\]+)", 1, tostring(Uri)),\n    coalesce(tostring(split(ObjectKey, "/")[0]), "Unknown")\n)\n| extend IPOnly = tostring(split(CallerIpAddress, ":")[0])',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "AccountName", clause: '| where AccountName == ""' },
      { label: "FileShareName", clause: '| where FileShareName contains ""' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "StatusCode", clause: '| where StatusCode == ""' },
      { label: "Protocol", clause: '| where Protocol == ""' },
      { label: "Uri", clause: '| where Uri contains ""' },
      { label: "CallerIpAddress", clause: '| where CallerIpAddress == ""' },
      { label: "IPOnly", clause: '| where IPOnly == ""' },
      { label: "ObjectKey", clause: '| where ObjectKey == ""' },
      { label: "Category", clause: '| where Category == ""' },
      { label: "MetricResponseType", clause: '| where MetricResponseType == ""' },
      { label: "SmbCommandMinor", clause: '| where SmbCommandMinor == ""' },
      { label: "AuthenticationType", clause: '| where AuthenticationType == ""' },
      { label: "UserAgentHeader", clause: '| where UserAgentHeader == ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "AccountName",
      "FileShareName",
      "OperationName",
      "StatusCode",
      "Protocol",
      "Uri",
      "CallerIpAddress",
      "IPOnly",
      "ObjectKey",
      "Category",
      "MetricResponseType",
      "SmbCommandMinor",
      "AuthenticationType",
      "UserAgentHeader"
    ],
    dynamicFilters: [
      { label: "Storage Account Name", field: "AccountName", clauseTemplate: (val) => formatFilterClause("AccountName", val) },
      { label: "File Share Name", field: "FileShareName", clauseTemplate: (val) => formatFilterClause("FileShareName", val) }
    ]
  },
  {
    id: "storage-blob",
    name: "Storage Blob Log",
    baseQuery: 'StorageBlobLogs\n| extend ContainerName = case(\n    tostring(Uri) startswith "http://" or tostring(Uri) startswith "https://",\n    extract(@"https?://[^/]+/([^/?#]+)", 1, tostring(Uri)),\n    tostring(Uri) startswith @"\\\\",\n    extract(@"\\\\[^\\\\]+\\\\([^\\\\]+)", 1, tostring(Uri)),\n    coalesce(tostring(split(ObjectKey, "/")[0]), "Unknown")\n)\n| where CallerIpAddress !contains "10.50" and CallerIpAddress !contains "10.200"\n| where ObjectKey contains "Demand"\n| extend CallerIp = tostring(split(CallerIpAddress, ":")[0]), CallerPort = tostring(split(CallerIpAddress, ":")[1])',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "ContainerName", clause: '| where ContainerName contains ""' },
      { label: "Category", clause: '| where Category == ""' },
      { label: "StatusCode", clause: '| where StatusCode == ""' },
      { label: "CallerIpAddress", clause: '| where CallerIpAddress == ""' },
      { label: "CallerIp", clause: '| where CallerIp == ""' },
      { label: "CallerPort", clause: '| where CallerPort == ""' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "StatusText", clause: '| where StatusText == ""' },
      { label: "ObjectKey", clause: '| where ObjectKey contains ""' },
      { label: "AuthenticationType", clause: '| where AuthenticationType == ""' },
      { label: "Uri", clause: '| where Uri contains ""' }
    ],
    projectColumns: ["TimeGenerated", "AccountName", "ContainerName", "Category", "StatusCode", "CallerIpAddress", "CallerIp", "CallerPort", "OperationName", "StatusText", "ObjectKey", "AuthenticationType", "Uri"],
    dynamicFilters: [
      { label: "Storage Account Name", field: "AccountName", clauseTemplate: (val) => formatFilterClause("AccountName", val) },
      { label: "Container Name", field: "ContainerName", clauseTemplate: (val) => formatFilterClause("ContainerName", val) }
    ]
  },
  {
    id: "kube-events",
    name: "Kube Events",
    baseQuery: 'KubeEvents\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "KubeEventType", clause: '| where KubeEventType == ""' },
      { label: "ObjectKind", clause: '| where ObjectKind == ""' },
      { label: "Reason", clause: '| where Reason contains ""' },
      { label: "Namespace", clause: '| where Namespace == ""' },
      { label: "Name", clause: '| where Name contains ""' },
      { label: "Message", clause: '| where Message contains ""' }
    ],
    projectColumns: ["TimeGenerated", "Name", "ObjectKind", "KubeEventType", "Reason", "Message", "Namespace"],
    dynamicFilters: [
      { label: "Namespace", field: "Namespace", clauseTemplate: (val) => formatFilterClause("Namespace", val) },
      { label: "Object Kind", field: "ObjectKind", clauseTemplate: (val) => formatFilterClause("ObjectKind", val) }
    ]
  },
  {
    id: "email-delivery-status",
    name: "Email Delivery Status",
    baseQuery: 'ACSEmailStatusUpdateOperational\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "DeliveryStatus", clause: '| where DeliveryStatus == ""' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "SenderUsername", clause: '| where SenderUsername contains ""' },
      { label: "RecipientId", clause: '| where RecipientId contains ""' }
    ],
    projectColumns: ["TimeGenerated", "OperationName", "SenderUsername", "DeliveryStatus", "RecipientId"],
    dynamicFilters: [
      { label: "Delivery Status", field: "DeliveryStatus", clauseTemplate: (val) => formatFilterClause("DeliveryStatus", val) },
      { label: "Sender Username", field: "SenderUsername", clauseTemplate: (val) => formatFilterClause("SenderUsername", val) }
    ]
  },
  {
    id: "keyvault-audit-log",
    name: "Key Vault Audit Log",
    baseQuery: 'AzureDiagnostics\n| where Category == "AuditEvent"\n| where ResourceProvider == "MICROSOFT.KEYVAULT"',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "ResultType", clause: '| where ResultType == "Success"' },
      { label: "identity_claim_upn_s", clause: '| where identity_claim_upn_s contains ""' },
      { label: "id_s", clause: '| where id_s contains ""' },
      { label: "Resource", clause: '| where Resource == ""' }
    ],
    projectColumns: ["TimeGenerated", "id_s", "Category", "OperationName", "Resource", "identity_claim_upn_s", "ResultType"],
    dynamicFilters: [
      { label: "Key Vault Resource", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) },
      { label: "Operation Name", field: "OperationName", clauseTemplate: (val) => formatFilterClause("OperationName", val) }
    ]
  },
  {
    id: "appservice-http-logs",
    name: "App Service HTTP Logs",
    baseQuery: 'AppServiceHTTPLogs\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "CsMethod", clause: '| where CsMethod == "GET"' },
      { label: "ScStatus", clause: '| where ScStatus between (400 .. 599)' },
      { label: "CsHost", clause: '| where CsHost contains ""' },
      { label: "CsUriStem", clause: '| where CsUriStem contains ""' },
      { label: "CIp", clause: '| where CIp == ""' },
      { label: "SPort", clause: '| where SPort == 443' },
      { label: "TimeTaken", clause: '| where TimeTaken > 1000' },
      { label: "Result", clause: '| where Result == ""' },
      { label: "Referer", clause: '| where Referer contains ""' }
    ],
    projectColumns: ["TimeGenerated", "CsMethod", "CsUriStem", "SPort", "CIp", "CsHost", "ScStatus", "TimeTaken", "Result", "Referer"],
    dynamicFilters: [
      { label: "Host (CsHost)", field: "CsHost", clauseTemplate: (val) => formatFilterClause("CsHost", val) },
      { label: "HTTP Method (CsMethod)", field: "CsMethod", clauseTemplate: (val) => formatFilterClause("CsMethod", val) }
    ]
  },
  {
    id: "automation-job-logs",
    name: "Automation Job Logs",
    baseQuery: 'AzureDiagnostics\n| where ResourceProvider == "MICROSOFT.AUTOMATION"\n| where Category == "JobLogs"',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "Resource", clause: '| where Resource == ""' },
      { label: "RunbookName_s", clause: '| where RunbookName_s contains ""' },
      { label: "ResultType", clause: '| where ResultType == "Completed"' },
      { label: "ResultDescription", clause: '| where ResultDescription contains ""' }
    ],
    projectColumns: ["TimeGenerated", "Resource", "ResultType", "ResultDescription", "RunbookName_s"],
    dynamicFilters: [
      { label: "Automation Account Resource", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) },
      { label: "Runbook Name (RunbookName_s)", field: "RunbookName_s", clauseTemplate: (val) => formatFilterClause("RunbookName_s", val) }
    ]
  },
  {
    id: "wvd-connections",
    name: "WVD Connections",
    baseQuery: 'WVDConnections\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "UserName", clause: '| where UserName contains ""' },
      { label: "State", clause: '| where State == "Connected"' },
      { label: "ClientOS", clause: '| where ClientOS == ""' },
      { label: "ClientSideIPAddress", clause: '| where ClientSideIPAddress == ""' },
      { label: "ConnectionType", clause: '| where ConnectionType == ""' },
      { label: "ResourceAlias", clause: '| where ResourceAlias contains ""' },
      { label: "SessionHostName", clause: '| where SessionHostName contains ""' },
      { label: "SessionHostPoolType", clause: '| where SessionHostPoolType == ""' },
      { label: "SessionHostIPAddress", clause: '| where SessionHostIPAddress == ""' },
      { label: "GatewayRegion", clause: '| where GatewayRegion == ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "UserName",
      "State",
      "ClientOS",
      "ClientSideIPAddress",
      "ConnectionType",
      "ResourceAlias",
      "SessionHostName",
      "SessionHostPoolType",
      "SessionHostIPAddress",
      "GatewayRegion"
    ],
    dynamicFilters: [
      { label: "User Name (UserName)", field: "UserName", clauseTemplate: (val) => formatFilterClause("UserName", val) },
      { label: "State", field: "State", clauseTemplate: (val) => formatFilterClause("State", val) }
    ]
  },
  {
    id: "datatype-log-usage",
    name: "Log Usage by DataType",
    baseQuery: 'Usage\n| where IsBillable == true\n| summarize VolumeGB = sum(Quantity) / 1000 by DataType, bin(TimeGenerated, 1d)\n| order by TimeGenerated desc, VolumeGB desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(7d)' },
      { label: "DataType", clause: '| where DataType contains ""' }
    ],
    projectColumns: ["TimeGenerated", "DataType", "VolumeGB"],
    dynamicFilters: [
      { label: "Data Type", field: "DataType", clauseTemplate: (val) => formatFilterClause("DataType", val) }
    ]
  },
  {
    id: "nsg-logs",
    name: "Network Security Group Logs",
    baseQuery: 'AzureDiagnostics\n| where Category contains "NetworkSecurity"',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "Resource", clause: '| where Resource == ""' },
      { label: "ResourceGroup", clause: '| where ResourceGroup == ""' },
      { label: "ruleName_s", clause: '| where ruleName_s contains ""' },
      { label: "direction_s", clause: '| where direction_s == "Inbound"' },
      { label: "priority_d", clause: '| where priority_d == 100' },
      { label: "type_s", clause: '| where type_s == ""' },
      { label: "primaryIPv4Address_s", clause: '| where primaryIPv4Address_s == ""' },
      { label: "conditions_destinationPortRange_s", clause: '| where conditions_destinationPortRange_s contains ""' },
      { label: "conditions_destinationIP_s", clause: '| where conditions_destinationIP_s contains ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "type_s",
      "Resource",
      "ResourceGroup",
      "ruleName_s",
      "priority_d",
      "direction_s",
      "primaryIPv4Address_s",
      "conditions_destinationPortRange_s",
      "conditions_destinationIP_s"
    ],
    dynamicFilters: [
      { label: "Resource Group Name", field: "ResourceGroup", clauseTemplate: (val) => formatFilterClause("ResourceGroup", val) },
      { label: "NSG Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) }
    ]
  },
  {
    id: "sms-incoming-operations",
    name: "SMS Incoming Operations",
    baseQuery: 'ACSSMSIncomingOperations\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "MessageId", clause: '| where MessageId contains ""' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "ResultDescription", clause: '| where ResultDescription contains ""' },
      { label: "PhoneNumber", clause: '| where PhoneNumber contains ""' },
      { label: "PlatformType", clause: '| where PlatformType == ""' },
      { label: "SdkType", clause: '| where SdkType == ""' },
      { label: "ResultType", clause: '| where ResultType == ""' },
      { label: "CallerIpAddress", clause: '| where CallerIpAddress == ""' },
      { label: "Country", clause: '| where Country == ""' },
      { label: "CorrelationId", clause: '| where CorrelationId == ""' },
      { label: "Method", clause: '| where Method == ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "MessageId",
      "OperationName",
      "ResultDescription",
      "PhoneNumber",
      "PlatformType",
      "SdkType",
      "CallerIpAddress",
      "ResultType",
      "ResultSignature",
      "URI",
      "CorrelationId",
      "Method",
      "Country"
    ],
    dynamicFilters: [
      { label: "Operation Name", field: "OperationName", clauseTemplate: (val) => formatFilterClause("OperationName", val) },
      { label: "Phone Number", field: "PhoneNumber", clauseTemplate: (val) => formatFilterClause("PhoneNumber", val) }
    ]
  }
];

const presetColors: Record<string, { bg: string, text: string }> = {
  "afd-access": { bg: "#0078D4", text: "#FFFFFF" },
  "afd-firewall": { bg: "#D13438", text: "#FFFFFF" },
  "azfw-network": { bg: "#107C10", text: "#FFFFFF" },
  "azfw-application": { bg: "#D83B01", text: "#FFFFFF" },
  "app-gateway": { bg: "#7A2EAB", text: "#FFFFFF" },
  "storage-file": { bg: "#008272", text: "#FFFFFF" },
  "storage-blob": { bg: "#005a9e", text: "#FFFFFF" },
  "kube-events": { bg: "#326ce5", text: "#FFFFFF" },
  "email-delivery-status": { bg: "#c678dd", text: "#FFFFFF" },
  "keyvault-audit-log": { bg: "#ff8c00", text: "#FFFFFF" },
  "appservice-http-logs": { bg: "#00bcf2", text: "#000000" },
  "automation-job-logs": { bg: "#008080", text: "#FFFFFF" },
  "wvd-connections": { bg: "#5c2d91", text: "#FFFFFF" },
  "datatype-log-usage": { bg: "#e5c07b", text: "#000000" },
  "nsg-logs": { bg: "#00b0f0", text: "#000000" },
  "sms-incoming-operations": { bg: "#84cc16", text: "#000000" }
};

const timespans = [
  { label: "1h", value: "PT1H" },
  { label: "6h", value: "PT6H" },
  { label: "24h", value: "PT24H" },
  { label: "7d", value: "P7D" },
  { label: "Custom", value: "CUSTOM" }
];

function getTimespanKql(value: string, start?: string, end?: string): string {
  switch (value) {
    case "PT1H": return "| where TimeGenerated > ago(1h)";
    case "PT6H": return "| where TimeGenerated > ago(6h)";
    case "PT24H": return "| where TimeGenerated > ago(24h)";
    case "P7D": return "| where TimeGenerated > ago(7d)";
    case "CUSTOM": 
      if (start && end) {
        return `| where TimeGenerated between (datetime(${start}) .. datetime(${end}))`;
      }
      return "| where TimeGenerated > ago(24h)"; // fallback
    default: return "| where TimeGenerated > ago(24h)";
  }
}

function getPredefinedWorkspaces(): AzureWorkspace[] {
  const envWorkspaces = getEnv("VITE_WORKSPACES");
  const list: AzureWorkspace[] = [];
  
  if (envWorkspaces.trim()) {
    envWorkspaces.split(",").forEach((entry: string) => {
      const trimmed = entry.trim();
      if (!trimmed) return;

      let subName: string | undefined;
      let wsName = "";
      let customerId = "";

      // Check format: SubscriptionName/WorkspaceName:CustomerId
      if (trimmed.includes("/") && trimmed.includes(":")) {
        const slashIdx = trimmed.indexOf("/");
        subName = trimmed.substring(0, slashIdx).trim();
        const remainder = trimmed.substring(slashIdx + 1).trim();
        const colonIdx = remainder.lastIndexOf(":");
        if (colonIdx !== -1) {
          wsName = remainder.substring(0, colonIdx).trim();
          customerId = remainder.substring(colonIdx + 1).trim();
        }
      } else {
        const parts = trimmed.split(":");
        if (parts.length >= 3) {
          // Format: SubscriptionName:WorkspaceName:CustomerId
          subName = parts[0].trim();
          wsName = parts[1].trim();
          customerId = parts.slice(2).join(":").trim();
        } else if (parts.length === 2) {
          // Format: WorkspaceName:CustomerId
          wsName = parts[0].trim();
          customerId = parts[1].trim();
        } else {
          // Format: CustomerId
          customerId = trimmed;
          wsName = `Predefined (${customerId.substring(0, 8)}...)`;
        }
      }

      if (customerId) {
        list.push({
          id: customerId,
          name: wsName || customerId,
          customerId,
          subscriptionName: subName || "Default Subscription",
          subscriptionId: subName || undefined
        });
      }
    });
  }

  const defaultWs = getEnv("VITE_LOG_ANALYTICS_WORKSPACE_ID");
  if (defaultWs && defaultWs.trim() && !list.some(w => w.customerId === defaultWs.trim())) {
    list.unshift({
      id: defaultWs.trim(),
      name: "Default Workspace (.env)",
      customerId: defaultWs.trim(),
      subscriptionName: "Default Subscription"
    });
  }

  return list;
}

function combineWorkspaces(fetched: AzureWorkspace[]): AzureWorkspace[] {
  const predefined = getPredefinedWorkspaces();
  const map = new Map<string, AzureWorkspace>();

  fetched.forEach(w => {
    if (w.customerId) map.set(w.customerId, w);
  });
  predefined.forEach(w => {
    if (w.customerId && !map.has(w.customerId)) {
      map.set(w.customerId, w);
    } else if (w.customerId && map.has(w.customerId)) {
      const existing = map.get(w.customerId)!;
      if (!existing.subscriptionName && w.subscriptionName) {
        existing.subscriptionName = w.subscriptionName;
        existing.subscriptionId = w.subscriptionId;
      }
    }
  });

  return Array.from(map.values());
}

interface TabState {
  id: string;
  title: string;
  query: string;
  timespan: string;
  maxRows: number;
  workspaceId: string;
  selectedSubscription?: string;
  result: QueryResponse | null;
  loading: boolean;
  error: string | null;
  activePreset: PresetQuery | null;
  presetOptions: Set<string>;
  presetProjectColumns: Set<string>;
  dynamicFilterValues: Record<string, string[]>;
  selectedDynamicFilters: Record<string, string[]>;
  filterSearch: Record<string, string>;
  optionOperators: Record<string, string>;
  optionValues: Record<string, string>;
  customStart: string;
  customEnd: string;
  isCustomInputMode: boolean;
}

function createInitialTab(id: string, title?: string, initialWsId: string = "", initialSub: string = "ALL"): TabState {
  return {
    id,
    title: title || "Query 1",
    query: starterQuery,
    timespan: "PT24H",
    maxRows: 1000,
    workspaceId: initialWsId,
    selectedSubscription: initialSub,
    result: null,
    loading: false,
    error: null,
    activePreset: null,
    presetOptions: new Set(),
    presetProjectColumns: new Set(),
    dynamicFilterValues: {},
    selectedDynamicFilters: {},
    filterSearch: {},
    optionOperators: {},
    optionValues: {},
    customStart: "",
    customEnd: "",
    isCustomInputMode: false
  };
}

interface KqlSyntaxError {
  line: number;
  message: string;
}

const VALID_KQL_OPERATORS = new Set([
  "where", "project", "extend", "summarize", "order", "sort", "take", "limit",
  "count", "distinct", "render", "top", "join", "lookup", "union", "parse",
  "evaluate", "mv-expand", "facet", "reduce", "sample", "serialize"
]);

function validateKql(query: string): KqlSyntaxError[] {
  const errors: KqlSyntaxError[] = [];

  // Bypass syntax validation on multi-line extend ... = case(...) blocks (e.g. FileShareName / ContainerName regex extraction)
  const queryWithoutCaseBlocks = query.replace(/extend\s+[a-zA-Z0-9_]+\s*=\s*case\s*\([\s\S]*?\n\)/gi, (match) => {
    const lineCount = match.split("\n").length - 1;
    return "extend _skipped = 1" + "\n".repeat(lineCount);
  });

  const lines = queryWithoutCaseBlocks.split("\n");
  let totalOpenParen = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let rawLine = lines[i];

    const commentIdx = rawLine.indexOf("//");
    if (commentIdx >= 0) {
      rawLine = rawLine.slice(0, commentIdx);
    }
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Strip verbatim double-quoted strings: @"..."
    let sanitized = rawLine.replace(/@"(?:[^"])*"/g, '');
    // Strip verbatim single-quoted strings: @'...'
    sanitized = sanitized.replace(/@'(?:[^'])*'/g, '');
    // Strip normal double-quoted strings: "..."
    sanitized = sanitized.replace(/"(?:[^"\\]|\\.)*"/g, '');
    // Strip normal single-quoted strings: '...'
    sanitized = sanitized.replace(/'(?:[^'\\]|\\.)*'/g, '');

    if (sanitized.includes('"')) {
      errors.push({ line: lineNum, message: `Unclosed double quote (") on line ${lineNum}` });
    }
    if (sanitized.includes("'")) {
      errors.push({ line: lineNum, message: `Unclosed single quote (') on line ${lineNum}` });
    }

    for (let j = 0; j < sanitized.length; j++) {
      if (sanitized[j] === "(") totalOpenParen++;
      if (sanitized[j] === ")") totalOpenParen--;
    }

    if (trimmed.startsWith("|")) {
      const pipeContent = trimmed.slice(1).trim();
      if (!pipeContent) {
        errors.push({ line: lineNum, message: `Empty pipe operator '|' on line ${lineNum}` });
      } else {
        const firstWord = pipeContent.split(/\s+/)[0].toLowerCase();
        if (!VALID_KQL_OPERATORS.has(firstWord) && !pipeContent.startsWith("//")) {
          errors.push({ line: lineNum, message: `Unknown KQL operator '${firstWord}' on line ${lineNum}` });
        }
        if (firstWord === "where" && pipeContent.split(/\s+/).length === 1) {
          errors.push({ line: lineNum, message: `'where' clause requires a condition on line ${lineNum}` });
        }
        if (firstWord === "project" && pipeContent.split(/\s+/).length === 1) {
          errors.push({ line: lineNum, message: `'project' clause requires column names on line ${lineNum}` });
        }
        if (firstWord === "extend" && pipeContent.split(/\s+/).length === 1) {
          errors.push({ line: lineNum, message: `'extend' clause requires an assignment on line ${lineNum}` });
        }
      }
    }

    if (trimmed.endsWith("|")) {
      errors.push({ line: lineNum, message: `Trailing pipe operator '|' on line ${lineNum}` });
    }
  }

  if (totalOpenParen > 0) {
    errors.push({ line: lines.length, message: `Unbalanced parenthesis: Missing closing ')'` });
  } else if (totalOpenParen < 0) {
    errors.push({ line: 1, message: `Unbalanced parenthesis: Extra closing ')'` });
  }

  return errors;
}

const BASE_KQL_SUGGESTIONS: { label: string; detail: string; type: "command" | "function" | "operator" | "keyword" | "table" }[] = [
  { label: "where", detail: "Filter rows by predicate condition", type: "command" },
  { label: "project", detail: "Select columns to include in result", type: "command" },
  { label: "extend", detail: "Create calculated columns", type: "command" },
  { label: "summarize", detail: "Aggregate data by group columns", type: "command" },
  { label: "order by", detail: "Sort rows by column(s)", type: "command" },
  { label: "sort by", detail: "Sort rows by column(s)", type: "command" },
  { label: "take 100", detail: "Return first 100 rows", type: "command" },
  { label: "limit 100", detail: "Limit result to 100 rows", type: "command" },
  { label: "distinct", detail: "Select distinct values of column", type: "command" },
  { label: "count()", detail: "Count total row count", type: "function" },
  { label: "case()", detail: "case(cond1, val1, cond2, val2, defaultVal)", type: "function" },
  { label: "extract()", detail: "extract(regexPattern, group, stringField)", type: "function" },
  { label: "tostring()", detail: "Convert expression to string", type: "function" },
  { label: "split()", detail: "Split string into dynamic array by delimiter", type: "function" },
  { label: "ago()", detail: "Subtract relative timespan ago(24h)", type: "function" },
  { label: "between()", detail: "Range check between(val1 .. val2)", type: "operator" },
  { label: "contains", detail: "Case-insensitive string substring match", type: "operator" },
  { label: "startswith", detail: "String prefix match", type: "operator" },
  { label: "endswith", detail: "String suffix match", type: "operator" },
  { label: "has", detail: "Indexed term / word match", type: "operator" },
  { label: "and", detail: "Logical AND operator", type: "operator" },
  { label: "or", detail: "Logical OR operator", type: "operator" },
  { label: "desc", detail: "Descending sort order", type: "keyword" },
  { label: "asc", detail: "Ascending sort order", type: "keyword" },
  { label: "StorageFileLogs", detail: "Azure Storage File shares log table", type: "table" },
  { label: "StorageBlobLogs", detail: "Azure Storage Blob log table", type: "table" },
  { label: "AzureDiagnostics", detail: "Azure Diagnostics log table", type: "table" },
  { label: "KubeEvents", detail: "Kubernetes cluster events table", type: "table" },
  { label: "AppRequests", detail: "Application Insights requests log", type: "table" },
  { label: "AppTraces", detail: "Application Insights traces log", type: "table" }
];

interface KqlCodeEditorProps {
  query: string;
  onChange: (newQuery: string) => void;
  onRun: (e?: number | React.MouseEvent) => void;
  loading: boolean;
  isRunDisabled?: boolean;
  activePreset?: PresetQuery | null;
  tableColumns?: string[];
  dynamicFilterValues?: Record<string, string[]>;
}

function KqlCodeEditor({
  query,
  onChange,
  onRun,
  loading,
  isRunDisabled = false,
  activePreset,
  tableColumns = [],
  dynamicFilterValues = {}
}: KqlCodeEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [cursorPos, setCursorPos] = useState<number>(0);
  const [showSuggestions, setShowSuggestions] = useState<boolean>(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [searchPrefix, setSearchPrefix] = useState<string>("");
  const [prefixStart, setPrefixStart] = useState<number>(0);

  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartPos = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number } | null>(null);

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    const currentX = dragOffset?.x ?? 0;
    const currentY = dragOffset?.y ?? 0;
    dragStartPos.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      startX: currentX,
      startY: currentY
    };
  };

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isDragging || !dragStartPos.current) return;
      const dx = e.clientX - dragStartPos.current.mouseX;
      const dy = e.clientY - dragStartPos.current.mouseY;
      setDragOffset({
        x: dragStartPos.current.startX + dx,
        y: dragStartPos.current.startY + dy
      });
    }

    function handleMouseUp() {
      setIsDragging(false);
      dragStartPos.current = null;
    }

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  const syntaxErrors = useMemo(() => validateKql(query), [query]);

  const availableColumns = useMemo(() => {
    const set = new Set<string>();

    // 1. Collect columns strictly belonging to the currently active preset
    if (activePreset) {
      if (activePreset.projectColumns) {
        activePreset.projectColumns.forEach((c) => set.add(c));
      }
      if (activePreset.options) {
        activePreset.options.forEach((opt) => {
          const fieldMatch = opt.clause.match(/\|\s*where\s+([^\s=!<]+)/i);
          if (fieldMatch) set.add(fieldMatch[1]);
        });
      }
      if (activePreset.dynamicFilters) {
        activePreset.dynamicFilters.forEach((df) => set.add(df.field));
      }
    }

    // 2. Collect from currently active result table
    tableColumns.forEach((c) => set.add(c));

    // 3. Parse columns from active code in editor (| project, | extend, | summarize)
    const activeCode = query
      .split("\n")
      .map((line) => line.split("//")[0])
      .join("\n");

    const projectMatches = [...activeCode.matchAll(/\|\s*project\s+([^|]+)/gi)];
    projectMatches.forEach((m) => {
      m[1].split(",").forEach((col) => {
        const name = col.trim().split("=")[0].trim();
        if (name) set.add(name);
      });
    });

    const extendMatches = [...activeCode.matchAll(/\|\s*extend\s+([a-zA-Z0-9_]+)\s*=/gi)];
    extendMatches.forEach((m) => {
      if (m[1]) set.add(m[1].trim());
    });

    const summarizeMatches = [...activeCode.matchAll(/\|\s*summarize\s+([^|]+)/gi)];
    summarizeMatches.forEach((m) => {
      const clause = m[1];
      const bySplit = clause.split(/\bby\b/i);
      bySplit.forEach((part) => {
        part.split(",").forEach((col) => {
          const name = col.trim().split("=")[0].trim();
          if (name && !name.includes("(")) set.add(name);
        });
      });
    });

    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [activePreset, tableColumns, query]);

  const allSuggestions = useMemo(() => {
    const list: { label: string; detail: string; type: "command" | "function" | "operator" | "keyword" | "table" | "column" }[] = [];

    availableColumns.forEach((col) => {
      list.push({
        label: col,
        detail: `Column name (${activePreset?.name || "Query"})`,
        type: "column"
      });
    });

    BASE_KQL_SUGGESTIONS.forEach((item) => list.push(item));

    return list;
  }, [availableColumns, activePreset]);

  const operatorContextSuggestions = useMemo(() => {
    const textBeforeCursor = query.slice(0, cursorPos);
    const opMatch = textBeforeCursor.match(/\|\s*where\s+([a-zA-Z0-9_]+)\s*(==|!=|contains|!contains|between|>|<|>=|<=|has|startswith|endswith|in)\s*([a-zA-Z0-9_"]*)$/i);
    const targetCol = opMatch ? opMatch[1] : null;
    const operator = opMatch ? opMatch[2].toLowerCase() : null;

    const list: { label: string; detail: string; type: "command" | "function" | "operator" | "keyword" | "table" | "column" }[] = [];

    // 1. If target column has fetched dynamic values, suggest top distinct values!
    if (targetCol && dynamicFilterValues && dynamicFilterValues[targetCol]) {
      dynamicFilterValues[targetCol].slice(0, 15).forEach((val) => {
        const formattedVal = /^\d+$/.test(val) ? val : `"${val}"`;
        list.push({
          label: formattedVal,
          detail: `Value for ${targetCol}`,
          type: "keyword"
        });
      });
    }

    // 2. Add Microsoft KQL standard operator value suggestions
    if (operator === "between") {
      list.push(
        { label: "ago(24h) .. ago(1h)", detail: "Time range last 24h to 1h ago", type: "function" },
        { label: "ago(7d) .. ago(24h)", detail: "Time range 7 days to 24h ago", type: "function" },
        { label: "400 .. 599", detail: "HTTP Error status range", type: "keyword" },
        { label: "200 .. 299", detail: "HTTP Success status range", type: "keyword" }
      );
    } else {
      list.push(
        { label: "ago(15m)", detail: "15 minutes ago relative timestamp", type: "function" },
        { label: "ago(1h)", detail: "1 hour ago relative timestamp", type: "function" },
        { label: "ago(24h)", detail: "24 hours ago relative timestamp", type: "function" },
        { label: "ago(7d)", detail: "7 days ago relative timestamp", type: "function" },
        { label: "ago(30d)", detail: "30 days ago relative timestamp", type: "function" },
        { label: "true", detail: "Boolean true", type: "keyword" },
        { label: "false", detail: "Boolean false", type: "keyword" },
        { label: "null", detail: "Null value check", type: "keyword" },
        { label: "tostring()", detail: "Convert expression to string", type: "function" },
        { label: "toint()", detail: "Convert expression to integer", type: "function" }
      );
    }

    return list;
  }, [query, cursorPos, dynamicFilterValues]);

  const columnContextSuggestions = useMemo(() => {
    const textBeforeCursor = query.slice(0, cursorPos);
    const colMatch = textBeforeCursor.match(/(?:\|\s*where|\bwhere)\s+([a-zA-Z0-9_]+)\s*$/i);
    if (colMatch) {
      const colName = colMatch[1];
      return [
        { label: "==", detail: `Equals condition for ${colName}`, type: "operator" as const },
        { label: "!=", detail: `Not equals condition for ${colName}`, type: "operator" as const },
        { label: "contains", detail: `Substring match for ${colName}`, type: "operator" as const },
        { label: "!contains", detail: `Does not contain match for ${colName}`, type: "operator" as const },
        { label: ">", detail: `Greater than condition for ${colName}`, type: "operator" as const },
        { label: "<", detail: `Less than condition for ${colName}`, type: "operator" as const },
        { label: ">=", detail: `Greater than or equal for ${colName}`, type: "operator" as const },
        { label: "<=", detail: `Less than or equal for ${colName}`, type: "operator" as const },
        { label: "between", detail: `Range condition for ${colName}`, type: "operator" as const },
        { label: "has", detail: `Term match for ${colName}`, type: "operator" as const },
        { label: "startswith", detail: `Prefix match for ${colName}`, type: "operator" as const },
        { label: "endswith", detail: `Suffix match for ${colName}`, type: "operator" as const },
        { label: "in", detail: `In set condition for ${colName}`, type: "operator" as const }
      ];
    }
    return [];
  }, [query, cursorPos]);

  const matchingSuggestions = useMemo(() => {
    const combined = [...columnContextSuggestions, ...operatorContextSuggestions, ...allSuggestions];
    
    const map = new Map<string, typeof combined[0]>();
    combined.forEach(item => {
      if (!map.has(item.label)) {
        map.set(item.label, item);
      }
    });
    const uniqueList = Array.from(map.values());

    if (!searchPrefix || searchPrefix.length < 1) {
      return uniqueList.slice(0, 30);
    }
    const term = searchPrefix.toLowerCase();
    return uniqueList.filter((item) => item.label.toLowerCase().includes(term));
  }, [searchPrefix, allSuggestions, operatorContextSuggestions, columnContextSuggestions]);

  function updatePrefix(newQuery: string, pos: number) {
    const textBeforeCursor = newQuery.slice(0, pos);

    // 1. Check for typed word or quoted string
    const match = textBeforeCursor.match(/([a-zA-Z0-9_"]+)$/);
    if (match) {
      setSearchPrefix(match[1]);
      setPrefixStart(pos - match[1].length);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    // 2. Check for operator followed by spaces e.g. "where Column contains " or "where Column == " or "where Column > "
    const opMatch = textBeforeCursor.match(/(==|!=|contains|!contains|between|>|<|>=|<=|has|startswith|endswith|in)\s*$/i);
    if (opMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    // 3. Check for column name followed by spaces e.g. "where StatusCode " or "where TimeGenerated "
    const colSpaceMatch = textBeforeCursor.match(/(?:\|\s*where|\bwhere)\s+([a-zA-Z0-9_]+)\s*$/i);
    if (colSpaceMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    // 4. Check for pipe followed by spaces e.g. "| "
    const pipeMatch = textBeforeCursor.match(/\|\s*$/);
    if (pipeMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    // 5. Check for 'where ' e.g. "| where "
    const whereMatch = textBeforeCursor.match(/\bwhere\s+$/i);
    if (whereMatch) {
      setSearchPrefix("");
      setPrefixStart(pos);
      setShowSuggestions(true);
      setSelectedIndex(0);
      return;
    }

    setShowSuggestions(false);
  }

  function handleSelectSuggestion(suggestion: { label: string }) {
    const insertion = suggestion.label;
    const before = query.slice(0, prefixStart);
    const after = query.slice(cursorPos);
    const updated = before + insertion + " " + after;
    onChange(updated);
    setShowSuggestions(false);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const newPos = prefixStart + insertion.length + 1;
        textareaRef.current.setSelectionRange(newPos, newPos);
      }
    }, 0);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSuggestions && matchingSuggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % matchingSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + matchingSuggestions.length) % matchingSuggestions.length);
        return;
      }
      if (e.key === "Tab" || e.key === "Enter") {
        e.preventDefault();
        handleSelectSuggestion(matchingSuggestions[selectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        setShowSuggestions(false);
        return;
      }
    }
    if (e.ctrlKey && e.key === " ") {
      e.preventDefault();
      const pos = textareaRef.current?.selectionStart || 0;
      updatePrefix(query, pos);
      setShowSuggestions(true);
    }
  }

  const [editorSize, setEditorSize] = useState<"normal" | "minimized" | "expanded">("normal");

  useEffect(() => {
    if (loading) {
      setEditorSize("minimized");
    }
  }, [loading]);

  const handleRunClick = (e?: React.MouseEvent) => {
    setEditorSize("minimized");
    onRun(e);
  };
  const lines = query.split("\n");

  return (
    <div style={{ position: "relative" }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "6px 12px",
        background: syntaxErrors.length > 0 ? "rgba(35, 10, 18, 0.95)" : "rgba(4, 23, 32, 0.95)",
        border: `1px solid ${syntaxErrors.length > 0 ? "rgba(244, 63, 94, 0.5)" : "rgba(45, 212, 191, 0.28)"}`,
        borderBottom: editorSize === "minimized" ? undefined : "none",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomLeftRadius: editorSize === "minimized" ? "8px" : 0,
        borderBottomRightRadius: editorSize === "minimized" ? "8px" : 0,
        fontSize: "12px",
        color: "#94a3b8"
      }}>
        <span style={{ fontWeight: 700, color: syntaxErrors.length > 0 ? "#fda4af" : "#38bdf8", display: "flex", alignItems: "center", gap: "6px" }}>
          <span>KQL Code Editor</span>
          <span style={{ fontSize: "11px", color: "#64748b" }}>({lines.length} lines)</span>
          {syntaxErrors.length > 0 && (
            <span style={{ color: "#f43f5e", fontSize: "11px", fontWeight: 700, background: "rgba(244,63,94,0.15)", padding: "2px 6px", borderRadius: "4px" }}>
              ⚠️ {syntaxErrors.length} Syntax {syntaxErrors.length === 1 ? "Error" : "Errors"}
            </span>
          )}
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            type="button"
            onClick={() => setEditorSize(editorSize === "minimized" ? "normal" : "minimized")}
            style={{
              background: editorSize === "minimized" ? "rgba(16, 185, 129, 0.2)" : "rgba(15, 23, 42, 0.6)",
              border: `1px solid ${editorSize === "minimized" ? "#10b981" : "rgba(56, 189, 248, 0.3)"}`,
              color: editorSize === "minimized" ? "#34d399" : "#94a3b8",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            title={editorSize === "minimized" ? "Expand KQL Editor" : "Minimize KQL Editor"}
          >
            {editorSize === "minimized" ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
            <span>{editorSize === "minimized" ? "Expand" : "Minimize"}</span>
          </button>
          <button
            type="button"
            onClick={() => setEditorSize(editorSize === "expanded" ? "normal" : "expanded")}
            style={{
              background: editorSize === "expanded" ? "rgba(56, 189, 248, 0.2)" : "rgba(15, 23, 42, 0.6)",
              border: `1px solid ${editorSize === "expanded" ? "#38bdf8" : "rgba(56, 189, 248, 0.3)"}`,
              color: editorSize === "expanded" ? "#38bdf8" : "#94a3b8",
              borderRadius: "6px",
              padding: "4px 8px",
              fontSize: "11px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              transition: "all 0.2s"
            }}
            title={editorSize === "expanded" ? "Standard Height" : "Full Height Editor"}
          >
            <span>{editorSize === "expanded" ? "Standard Height" : "Full Height"}</span>
          </button>
          <span style={{ fontSize: "11px", color: "#64748b" }}>💡 Type for suggestions or Ctrl+Space</span>
          <button
            type="button"
            className="primary-button"
            onClick={handleRunClick}
            disabled={loading || isRunDisabled}
            title={isRunDisabled ? "Please select at least 1 Dynamic Filter option to run query" : "Run Query"}
            style={{
              fontSize: "12px",
              fontWeight: 700,
              padding: "4px 12px",
              height: "28px",
              minWidth: "max-content",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: isRunDisabled ? "rgba(71, 85, 105, 0.4)" : undefined,
              color: isRunDisabled ? "#94a3b8" : undefined,
              borderColor: isRunDisabled ? "rgba(148, 163, 184, 0.3)" : undefined,
              cursor: isRunDisabled ? "not-allowed" : "pointer",
              opacity: isRunDisabled ? 0.6 : 1
            }}
          >
            <Play size={14} />
            <span>{loading ? "Running..." : "Run Query"}</span>
          </button>
        </div>
      </div>

      {editorSize === "minimized" ? (
        <div
          onClick={() => setEditorSize("normal")}
          style={{
            padding: "10px 14px",
            background: "rgba(4, 20, 28, 0.95)",
            border: "1px solid rgba(45, 212, 191, 0.3)",
            borderBottomLeftRadius: "8px",
            borderBottomRightRadius: "8px",
            fontSize: "12px",
            color: "#94a3b8",
            fontFamily: "monospace",
            cursor: "pointer",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between"
          }}
          title="Click to expand editor"
        >
          <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            <span style={{ color: "#34d399", fontWeight: 700 }}>Minimized Editor: </span>
            <span>{query.replace(/\n/g, " | ")}</span>
          </div>
          <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 600, marginLeft: "12px", flexShrink: 0 }}>
            Click to expand ▾
          </span>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <textarea
            ref={textareaRef}
            className="query-editor"
            style={{
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderColor: syntaxErrors.length > 0 ? "rgba(244, 63, 94, 0.5)" : undefined,
              boxShadow: syntaxErrors.length > 0 ? "0 0 10px rgba(244, 63, 94, 0.2)" : undefined,
              height: editorSize === "expanded" ? "420px" : "140px"
            }}
            value={query}
            onChange={(e) => {
              const val = e.target.value;
              const pos = e.target.selectionStart;
              setCursorPos(pos);
              onChange(val);
              updatePrefix(val, pos);
            }}
            onClick={(e) => {
              const pos = (e.target as HTMLTextAreaElement).selectionStart;
              setCursorPos(pos);
              updatePrefix(query, pos);
            }}
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                const pos = (e.target as HTMLTextAreaElement).selectionStart;
                setCursorPos(pos);
                updatePrefix(query, pos);
              }
            }}
            onKeyDown={handleKeyDown}
            spellCheck={false}
            placeholder="Enter KQL query here..."
          />

          {showSuggestions && matchingSuggestions.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: dragOffset ? undefined : "10px",
                right: dragOffset ? undefined : "16px",
                transform: dragOffset ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
                width: "360px",
                maxWidth: "calc(100% - 32px)",
                maxHeight: "260px",
                background: "rgba(4, 20, 28, 0.98)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(16, 185, 129, 0.6)",
                borderRadius: "8px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.85)",
                zIndex: 3000,
                padding: "4px",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column"
              }}
            >
            <div
              onMouseDown={handleHeaderMouseDown}
              style={{
                padding: "6px 10px",
                fontSize: "11px",
                color: "#34d399",
                background: "rgba(16, 185, 129, 0.2)",
                borderBottom: "1px solid rgba(16, 185, 129, 0.3)",
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: isDragging ? "grabbing" : "grab",
                userSelect: "none"
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span>⋮⋮ KQL Suggestions ({matchingSuggestions.length})</span>
                <span style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 400 }}>(Drag to move anywhere)</span>
              </span>
              <span style={{ fontSize: "10px", color: "#94a3b8" }}>Tab / Enter to select</span>
            </div>
            <div style={{ maxHeight: "200px", overflowY: "auto", padding: "4px" }}>
              {matchingSuggestions.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                const typeIcon =
                  item.type === "column" ? "📊" :
                  item.type === "command" ? "🔑" :
                  item.type === "function" ? "⚡" :
                  item.type === "table" ? "📋" : "⚙️";

                const typeColor =
                  item.type === "column" ? "#34d399" :
                  item.type === "command" ? "#38bdf8" :
                  item.type === "function" ? "#fbbf24" :
                  item.type === "table" ? "#a78bfa" : "#94a3b8";

                return (
                  <div
                    key={`${item.label}-${idx}`}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "4px",
                      background: isSelected ? "rgba(16, 185, 129, 0.25)" : "transparent",
                      color: isSelected ? "#ffffff" : "#f8fafc",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      fontSize: "12px",
                      margin: "2px 0"
                    }}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectSuggestion(item);
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
                      <span style={{ fontSize: "12px" }}>{typeIcon}</span>
                      <span style={{ fontWeight: 700, color: typeColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.label}
                      </span>
                    </div>
                    <span style={{ fontSize: "10px", color: "#94a3b8", marginLeft: "10px", whiteSpace: "nowrap" }}>
                      {item.detail}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      )}

      {syntaxErrors.length > 0 && (
        <div style={{
          marginTop: "6px",
          padding: "8px 12px",
          background: "rgba(244, 63, 94, 0.12)",
          border: "1px solid rgba(244, 63, 94, 0.4)",
          borderRadius: "6px",
          display: "flex",
          flexDirection: "column",
          gap: "4px"
        }}>
          {syntaxErrors.map((err, idx) => (
            <div key={idx} style={{ fontSize: "12px", color: "#fecdd3", display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ color: "#f43f5e", fontWeight: 700, minWidth: "max-content" }}>⚠️ Line {err.line}:</span>
              <span>{err.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GraphicalSubscriptionSelect({
  subscriptions,
  selectedSubscription,
  totalWorkspacesCount,
  onSelect
}: {
  subscriptions: Array<{ id?: string; name: string; count: number }>;
  selectedSubscription: string;
  totalWorkspacesCount: number;
  onSelect: (sub: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentSub = subscriptions.find((s) => s.name === selectedSubscription || s.id === selectedSubscription);
  const displayText = selectedSubscription === "ALL" || !currentSub
    ? `All Subscriptions (${subscriptions.length})`
    : currentSub.name;

  const filtered = useMemo(() => {
    if (!search.trim()) return subscriptions;
    const q = search.toLowerCase();
    return subscriptions.filter(
      (s) => s.name.toLowerCase().includes(q) || (s.id && s.id.toLowerCase().includes(q))
    );
  }, [subscriptions, search]);

  return (
    <div ref={containerRef} style={{ position: "relative", minWidth: "160px", flex: "1 1 180px" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="Filter workspaces by Azure Subscription"
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(4, 20, 28, 0.98))",
          border: `1px solid ${isOpen ? "#38bdf8" : "rgba(56, 189, 248, 0.35)"}`,
          borderRadius: "8px",
          color: selectedSubscription !== "ALL" ? "#38bdf8" : "#94a3b8",
          fontSize: "13px",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          boxShadow: isOpen ? "0 0 15px rgba(56, 189, 248, 0.25)" : "none",
          transition: "all 0.2s ease"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
          <span style={{ fontSize: "14px" }}>💳</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>
            {displayText}
          </span>
        </div>
        <ChevronDown
          size={14}
          color="#38bdf8"
          style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }}
        />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            minWidth: "260px",
            zIndex: 9999,
            background: "rgba(4, 18, 27, 0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            borderRadius: "10px",
            boxShadow: "0 20px 45px rgba(0, 0, 0, 0.85), 0 0 20px rgba(56, 189, 248, 0.15)",
            padding: "8px",
            maxHeight: "320px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          {subscriptions.length > 4 && (
            <div style={{ padding: "2px 4px" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search subscriptions..."
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: "12px",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  borderRadius: "6px",
                  color: "#f8fafc",
                  outline: "none"
                }}
              />
            </div>
          )}

          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
            {/* All Subscriptions Option */}
            <div
              onClick={() => {
                onSelect("ALL");
                setIsOpen(false);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: selectedSubscription === "ALL"
                  ? "linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(16, 185, 129, 0.15))"
                  : "rgba(15, 23, 42, 0.4)",
                border: `1px solid ${selectedSubscription === "ALL" ? "rgba(56, 189, 248, 0.6)" : "transparent"}`,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                transition: "all 0.15s ease"
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontSize: "13px" }}>🌐</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: selectedSubscription === "ALL" ? "#38bdf8" : "#f8fafc" }}>
                    All Subscriptions
                  </span>
                  <span style={{ fontSize: "10px", color: "#64748b" }}>
                    Show workspaces across all subscriptions
                  </span>
                </div>
              </div>
              <span style={{ fontSize: "11px", color: "#38bdf8", fontWeight: 700, background: "rgba(56,189,248,0.2)", padding: "2px 6px", borderRadius: "4px" }}>
                {totalWorkspacesCount} ws
              </span>
            </div>

            {/* Individual Subscriptions */}
            {filtered.map((sub) => {
              const isSelected = selectedSubscription === sub.name || (sub.id && selectedSubscription === sub.id);
              return (
                <div
                  key={sub.name}
                  onClick={() => {
                    onSelect(sub.name);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: isSelected
                      ? "linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(16, 185, 129, 0.15))"
                      : "rgba(15, 23, 42, 0.4)",
                    border: `1px solid ${isSelected ? "rgba(56, 189, 248, 0.6)" : "transparent"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                    <span style={{ fontSize: "12px", fontWeight: 700, color: isSelected ? "#38bdf8" : "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      📁 {sub.name}
                    </span>
                    {sub.id && sub.id !== sub.name && (
                      <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "monospace" }}>
                        Sub ID: {sub.id.substring(0, 13)}...
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "11px", color: isSelected ? "#34d399" : "#94a3b8", fontWeight: 600, background: "rgba(15,23,42,0.6)", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
                    {sub.count} {sub.count === 1 ? "ws" : "ws"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function GraphicalWorkspaceSelect({
  workspaces,
  workspaceId,
  selectedSubscription = "ALL",
  onSelect,
  onManualClick
}: {
  workspaces: AzureWorkspace[];
  workspaceId: string;
  selectedSubscription?: string;
  onSelect: (id: string) => void;
  onManualClick: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedWs = workspaces.find((w) => w.customerId === workspaceId);

  // Filter workspaces by selectedSubscription
  const subscriptionWorkspaces = useMemo(() => {
    if (!selectedSubscription || selectedSubscription === "ALL") return workspaces;
    return workspaces.filter(
      (w) => w.subscriptionName === selectedSubscription || w.subscriptionId === selectedSubscription
    );
  }, [workspaces, selectedSubscription]);

  const filteredWorkspaces = useMemo(() => {
    if (!search.trim()) return subscriptionWorkspaces;
    const term = search.toLowerCase();
    return subscriptionWorkspaces.filter(
      (w) =>
        w.name.toLowerCase().includes(term) ||
        w.customerId.toLowerCase().includes(term) ||
        (w.subscriptionName && w.subscriptionName.toLowerCase().includes(term))
    );
  }, [subscriptionWorkspaces, search]);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(4, 20, 28, 0.98))",
          border: `1px solid ${isOpen ? "#34d399" : "rgba(45, 212, 191, 0.35)"}`,
          borderRadius: "8px",
          color: selectedWs ? "#34d399" : "#94a3b8",
          fontSize: "13px",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          boxShadow: isOpen ? "0 0 15px rgba(52, 211, 153, 0.25)" : "none",
          transition: "all 0.2s ease"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
          <span style={{ fontSize: "14px" }}>🏢</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 700 }}>
            {selectedWs ? `${selectedWs.name} (${selectedWs.customerId.slice(0, 8)}...)` : `-- Select a Workspace (${subscriptionWorkspaces.length}) --`}
          </span>
        </div>
        <ChevronDown size={14} color="#38bdf8" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "rgba(4, 18, 27, 0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(52, 211, 153, 0.4)",
            borderRadius: "10px",
            boxShadow: "0 20px 45px rgba(0, 0, 0, 0.85), 0 0 20px rgba(52, 211, 153, 0.15)",
            padding: "8px",
            maxHeight: "300px",
            display: "flex",
            flexDirection: "column",
            gap: "6px"
          }}
        >
          {subscriptionWorkspaces.length > 5 && (
            <div style={{ padding: "2px 4px" }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="🔍 Search workspaces..."
                style={{
                  width: "100%",
                  padding: "6px 10px",
                  fontSize: "12px",
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(56, 189, 248, 0.3)",
                  borderRadius: "6px",
                  color: "#f8fafc",
                  outline: "none"
                }}
              />
            </div>
          )}

          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "4px" }}>
            {filteredWorkspaces.map((ws) => {
              const isSelected = ws.customerId === workspaceId;
              return (
                <div
                  key={ws.customerId}
                  onClick={() => {
                    onSelect(ws.customerId);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "8px 10px",
                    borderRadius: "6px",
                    background: isSelected
                      ? "linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(56, 189, 248, 0.15))"
                      : "rgba(15, 23, 42, 0.4)",
                    border: `1px solid ${isSelected ? "rgba(52, 211, 153, 0.6)" : "transparent"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease"
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px", overflow: "hidden" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                      <span style={{ fontSize: "12px", fontWeight: 700, color: isSelected ? "#34d399" : "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        🏢 {ws.name}
                      </span>
                      {ws.subscriptionName && (
                        <span style={{ fontSize: "10px", color: "#38bdf8", background: "rgba(56, 189, 248, 0.15)", border: "1px solid rgba(56, 189, 248, 0.25)", padding: "1px 5px", borderRadius: "4px", whiteSpace: "nowrap" }}>
                          {ws.subscriptionName}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: "10px", color: "#64748b", fontFamily: "monospace" }}>
                      {ws.customerId}
                    </span>
                  </div>
                  {isSelected && (
                    <span style={{ fontSize: "11px", color: "#34d399", fontWeight: 700, background: "rgba(16,185,129,0.2)", padding: "2px 6px", borderRadius: "4px", flexShrink: 0 }}>
                      ✓ Selected
                    </span>
                  )}
                </div>
              );
            })}

            {filteredWorkspaces.length === 0 && (
              <div style={{ padding: "12px", textAlign: "center", color: "#94a3b8", fontSize: "12px" }}>
                No workspaces found matching filter.
              </div>
            )}

            <div
              onClick={() => {
                onManualClick();
                setIsOpen(false);
              }}
              style={{
                padding: "8px 10px",
                borderRadius: "6px",
                background: "rgba(56, 189, 248, 0.1)",
                border: "1px dashed rgba(56, 189, 248, 0.4)",
                cursor: "pointer",
                fontSize: "12px",
                color: "#38bdf8",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "6px"
              }}
            >
              <span>✏️</span>
              <span>Enter Custom Workspace ID Manually...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getPresetTable(preset: PresetQuery): string {
  const line = preset.baseQuery.split("\n")[0].trim();
  return line.split("|")[0].trim() || "LogTable";
}

function getPresetDesc(preset: PresetQuery): string {
  return `${preset.projectColumns.length} projected columns · ${preset.options.length} filter options`;
}

function GraphicalPresetSelect({
  presets,
  activePreset,
  presetColors,
  onSelect
}: {
  presets: PresetQuery[];
  activePreset: PresetQuery | null;
  presetColors: Record<string, { bg: string; text: string }>;
  onSelect: (preset: PresetQuery) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredPresets = useMemo(() => {
    if (!search.trim()) return presets;
    const term = search.toLowerCase();
    return presets.filter(
      (p) => p.name.toLowerCase().includes(term)
    );
  }, [presets, search]);

  const activeColor = activePreset ? presetColors[activePreset.id]?.bg || "#38bdf8" : "#38bdf8";

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%" }}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: "100%",
          padding: "8px 12px",
          background: "linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(4, 20, 28, 0.98))",
          border: `1px solid ${isOpen ? activeColor : "rgba(45, 212, 191, 0.35)"}`,
          borderRadius: "8px",
          color: activePreset ? "#f8fafc" : "#94a3b8",
          fontSize: "13px",
          fontWeight: 600,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          boxShadow: isOpen ? `0 0 15px ${activeColor}44` : "none",
          transition: "all 0.2s ease"
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden" }}>
          <span style={{ fontSize: "14px" }}>⚡</span>
          <span style={{ fontWeight: 700, color: activePreset ? activeColor : "#94a3b8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {activePreset ? activePreset.name : `-- Select a Log Preset (${presets.length}) --`}
          </span>
        </div>
        <ChevronDown size={14} color="#38bdf8" style={{ transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
      </button>

      {isOpen && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "rgba(4, 18, 27, 0.96)",
            backdropFilter: "blur(16px)",
            WebkitBackdropFilter: "blur(16px)",
            border: "1px solid rgba(56, 189, 248, 0.4)",
            borderRadius: "10px",
            boxShadow: "0 20px 45px rgba(0, 0, 0, 0.85), 0 0 20px rgba(56, 189, 248, 0.15)",
            padding: "8px",
            maxHeight: "340px",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div style={{ padding: "2px 4px" }}>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Search preset name..."
              style={{
                width: "100%",
                padding: "7px 10px",
                fontSize: "12px",
                background: "rgba(15, 23, 42, 0.6)",
                border: "1px solid rgba(56, 189, 248, 0.3)",
                borderRadius: "6px",
                color: "#f8fafc",
                outline: "none"
              }}
            />
          </div>

          <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
            {filteredPresets.map((preset) => {
              const isSelected = activePreset?.id === preset.id;
              const colorInfo = presetColors[preset.id] || { bg: "#38bdf8", text: "#ffffff" };

              return (
                <div
                  key={preset.id}
                  onClick={() => {
                    onSelect(preset);
                    setIsOpen(false);
                  }}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "8px",
                    background: isSelected
                      ? `linear-gradient(135deg, ${colorInfo.bg}33, rgba(15, 23, 42, 0.8))`
                      : "rgba(15, 23, 42, 0.4)",
                    border: `1px solid ${isSelected ? colorInfo.bg : "rgba(45, 212, 191, 0.15)"}`,
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    transition: "all 0.15s ease"
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = colorInfo.bg;
                      e.currentTarget.style.background = "rgba(15, 23, 42, 0.75)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = "rgba(45, 212, 191, 0.15)";
                      e.currentTarget.style.background = "rgba(15, 23, 42, 0.4)";
                    }
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", overflow: "hidden" }}>
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: colorInfo.bg,
                        boxShadow: `0 0 8px ${colorInfo.bg}`,
                        flexShrink: 0
                      }}
                    />
                    <span style={{ fontSize: "13px", fontWeight: 700, color: isSelected ? colorInfo.bg : "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {preset.name}
                    </span>
                  </div>

                  {isSelected && (
                    <span style={{ fontSize: "11px", color: colorInfo.bg, fontWeight: 700, background: `${colorInfo.bg}22`, padding: "3px 8px", borderRadius: "4px", flexShrink: 0 }}>
                      ✓ Active
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function isNumericFieldOrOp(field: string, op: string, val: string): boolean {
  if (["<", "<=", ">", ">="].includes(op)) return true;
  const isNumericName = /(_d|_i|_long|_real|_b|_count|_port|Port|Latency|Status|Size|Length|Duration|TimeTaken)$/i.test(field) || /^timeTaken/i.test(field);
  if (isNumericName) return true;
  const trimmed = val.trim();
  if (trimmed !== "" && !isNaN(Number(trimmed)) && !trimmed.startsWith("0x")) return true;
  return false;
}

function buildOptionClause(opt: PresetOption, customOp?: string, customVal?: string): string {
  let defaultValMatch = opt.clause.match(/"([^"]*)"/)?.[1];
  if (opt.clause.includes("between")) {
    const betweenMatch = opt.clause.match(/between\s*\(([^)]+)\)/i);
    if (betweenMatch) {
      defaultValMatch = betweenMatch[1];
    }
  } else {
    const unquotedNumMatch = opt.clause.match(/(==|!=|>=|>|<=|<)\s*([0-9.]+)/);
    if (unquotedNumMatch) {
      defaultValMatch = unquotedNumMatch[2];
    }
  }

  const defaultOp = opt.clause.includes("!contains")
    ? "!contains"
    : opt.clause.includes("contains")
    ? "contains"
    : opt.clause.includes("between")
    ? "between"
    : opt.clause.includes(">=")
    ? ">="
    : opt.clause.includes(">")
    ? ">"
    : opt.clause.includes("<=")
    ? "<="
    : opt.clause.includes("<")
    ? "<"
    : opt.clause.includes("!=")
    ? "!="
    : "==";

  const fieldMatch = opt.clause.match(/\|\s*where\s+([^\s=!<]+)/i);
  const field = fieldMatch ? fieldMatch[1].trim() : opt.label.split(" ")[0].trim();

  const op = customOp || defaultOp;
  const rawVal = customVal !== undefined ? customVal : (defaultValMatch ?? "");

  if (op === "between") {
    const cleanedVal = rawVal.replace(/^\(|\)$/g, "").trim();
    return `| where ${field} between (${cleanedVal || "400 .. 599"})`;
  }
  if (op === "!contains") {
    return `| where ${field} !contains "${rawVal}"`;
  }
  if (op === "contains") {
    return `| where ${field} contains "${rawVal}"`;
  }

  const isNumeric = isNumericFieldOrOp(field, op, rawVal);
  if (isNumeric) {
    const numericVal = rawVal.trim() !== "" ? rawVal.trim() : "0";
    return `| where ${field} ${op} ${numericVal}`;
  }

  return `| where ${field} ${op} "${rawVal}"`;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function updateQueryConditionOption(
  query: string,
  opt: PresetOption,
  enabled: boolean,
  currentOp?: string,
  currentVal?: string,
  previousOp?: string,
  previousVal?: string
): string {
  const currentClause = buildOptionClause(opt, currentOp, currentVal);
  const previousClause =
    previousOp !== undefined || previousVal !== undefined
      ? buildOptionClause(opt, previousOp, previousVal)
      : currentClause;

  const lines = query.split("\n");
  const fieldMatch = opt.clause.match(/\|\s*where\s+([^\s=!<]+)/i);
  const field = fieldMatch ? fieldMatch[1].trim() : opt.label.split(" ")[0].trim();

  const isMatch = (line: string) => {
    const trimmed = line.trim();
    if (trimmed === currentClause.trim() || trimmed === previousClause.trim() || trimmed === opt.clause.trim()) {
      return true;
    }
    if (field && new RegExp(`^\\|\\s*where\\s+${escapeRegex(field)}(\\s|$|\\(|==|!=|>=|>|<=|<|contains|between)`, "i").test(trimmed)) {
      return true;
    }
    return false;
  };

  if (!enabled) {
    const filtered = lines.filter((l) => !isMatch(l));
    return filtered.join("\n");
  }

  const matchIdx = lines.findIndex((l) => isMatch(l));
  if (matchIdx !== -1) {
    lines[matchIdx] = currentClause;
    return lines.join("\n");
  }

  const insertIdx = lines.findIndex((l) =>
    /^\s*\|\s*(project|summarize|order\s+by|sort\s+by|take|limit|render|top)\b/i.test(l)
  );

  if (insertIdx !== -1) {
    lines.splice(insertIdx, 0, currentClause);
  } else {
    lines.push(currentClause);
  }

  return lines.join("\n");
}

function selectAllPresetOptionsInQuery(
  query: string,
  preset: PresetQuery,
  ops: Record<string, string>,
  vals: Record<string, string>
): string {
  let updatedQuery = query;
  for (const opt of preset.options) {
    updatedQuery = updateQueryConditionOption(updatedQuery, opt, true, ops[opt.label], vals[opt.label]);
  }
  return updatedQuery;
}

function clearAllPresetOptionsInQuery(
  query: string,
  preset: PresetQuery,
  ops: Record<string, string>,
  vals: Record<string, string>
): string {
  let updatedQuery = query;
  for (const opt of preset.options) {
    updatedQuery = updateQueryConditionOption(updatedQuery, opt, false, ops[opt.label], vals[opt.label]);
  }
  return updatedQuery;
}

function updateQueryDynamicFilter(
  query: string,
  field: string,
  filterObj: { field: string; clauseTemplate: (val: string | string[]) => string } | undefined,
  prevSelected: string[] | undefined,
  nextSelected: string[] | undefined
): string {
  const prevClause = prevSelected && prevSelected.length > 0 && filterObj ? filterObj.clauseTemplate(prevSelected).trim() : "";
  const nextClause = nextSelected && nextSelected.length > 0 && filterObj ? filterObj.clauseTemplate(nextSelected).trim() : "";

  const lines = query.split("\n");
  const isMatch = (line: string) => {
    const trimmed = line.trim();
    if (prevClause && trimmed === prevClause) return true;
    if (new RegExp(`^\\|\\s*where\\s+${escapeRegex(field)}\\s+in\\s*\\(`, "i").test(trimmed)) return true;
    if (new RegExp(`^\\|\\s*where\\s+${escapeRegex(field)}\\s*==\\s*`, "i").test(trimmed)) return true;
    return false;
  };

  if (!nextClause) {
    return lines.filter((l) => !isMatch(l)).join("\n");
  }

  const matchIdx = lines.findIndex((l) => isMatch(l));
  if (matchIdx !== -1) {
    lines[matchIdx] = nextClause;
    return lines.join("\n");
  }

  const terminalIdx = lines.findIndex((l) =>
    /^\s*\|\s*(project|summarize|order\s+by|sort\s+by|take|limit|render|top)\b/i.test(l)
  );
  if (terminalIdx !== -1) {
    lines.splice(terminalIdx, 0, nextClause);
  } else {
    lines.push(nextClause);
  }
  return lines.join("\n");
}

function updateQueryProjectColumns(
  query: string,
  preset: PresetQuery,
  selectedCols: Set<string>
): string {
  const activeProject = preset.projectColumns.filter((c) => selectedCols.has(c));
  const newProjectLine = activeProject.length > 0 ? `| project ${activeProject.join(", ")}` : "";

  const lines = query.split("\n");
  const projectIdx = lines.findIndex((l) => /^\s*\|\s*project\b/i.test(l));

  if (projectIdx !== -1) {
    if (newProjectLine) {
      lines[projectIdx] = newProjectLine;
    } else {
      lines.splice(projectIdx, 1);
    }
    return lines.join("\n");
  }

  if (newProjectLine) {
    lines.push(newProjectLine);
  }
  return lines.join("\n");
}

export function App() {
  const sortedPresets = useMemo(() => {
    return [...PRESETS].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, []);

  const [tabs, setTabs] = useState<TabState[]>(() => {
    const initial = getPredefinedWorkspaces();
    const defaultWs = initial.length > 0 ? initial[0].customerId : "";
    return [createInitialTab("tab-1", "Query 1", defaultWs)];
  });
  const [activeTabId, setActiveTabId] = useState<string>("tab-1");

  const activeTab = useMemo(() => {
    return tabs.find((t) => t.id === activeTabId) || tabs[0];
  }, [tabs, activeTabId]);

  function updateActiveTab(updater: Partial<TabState> | ((prev: TabState) => Partial<TabState>)) {
    setTabs((prevTabs) =>
      prevTabs.map((t) => {
        if (t.id === activeTabId) {
          const changes = typeof updater === "function" ? updater(t) : updater;
          return { ...t, ...changes };
        }
        return t;
      })
    );
  }

  function createNewTab() {
    const newId = `tab-${Date.now()}`;
    const newNum = tabs.length + 1;
    const initialWs = activeTab ? activeTab.workspaceId : "";
    const initialSub = activeTab ? (activeTab.selectedSubscription || "ALL") : "ALL";
    const newTab = createInitialTab(newId, `Query ${newNum}`, initialWs, initialSub);
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newId);
  }

  function closeTab(tabId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (tabs.length <= 1) return;
    const nextTabs = tabs.filter((t) => t.id !== tabId);
    setTabs(nextTabs);
    if (activeTabId === tabId) {
      setActiveTabId(nextTabs[nextTabs.length - 1].id);
    }
  }

  const {
    query,
    timespan,
    maxRows,
    workspaceId,
    selectedSubscription = "ALL",
    result,
    loading,
    error,
    activePreset,
    presetOptions,
    presetProjectColumns,
    dynamicFilterValues,
    selectedDynamicFilters,
    filterSearch,
    optionOperators,
    optionValues,
    customStart,
    customEnd,
    isCustomInputMode
  } = activeTab;

  function setQuery(q: string | ((prev: string) => string)) {
    updateActiveTab((t) => ({ query: typeof q === "function" ? q(t.query) : q }));
  }
  function setTimespan(ts: string) {
    updateActiveTab({ timespan: ts });
  }
  function setMaxRows(rows: number) {
    updateActiveTab({ maxRows: rows });
  }
  function setWorkspaceId(wsId: string) {
    handleWorkspaceSelect(wsId);
  }
  function setSelectedSubscription(sub: string) {
    updateActiveTab({ selectedSubscription: sub });
  }
  function setResult(res: QueryResponse | null) {
    updateActiveTab({ result: res });
  }
  function setLoading(load: boolean) {
    updateActiveTab({ loading: load });
  }
  function setError(err: string | null) {
    updateActiveTab({ error: err });
  }
  function setActivePreset(preset: PresetQuery | null) {
    updateActiveTab({ activePreset: preset, title: preset ? preset.name : activeTab.title });
  }
  function setPresetOptions(opts: Set<string> | ((prev: Set<string>) => Set<string>)) {
    updateActiveTab((t) => ({ presetOptions: typeof opts === "function" ? opts(t.presetOptions) : opts }));
  }
  function setPresetProjectColumns(cols: Set<string> | ((prev: Set<string>) => Set<string>)) {
    updateActiveTab((t) => ({ presetProjectColumns: typeof cols === "function" ? cols(t.presetProjectColumns) : cols }));
  }
  function setDynamicFilterValues(vals: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>)) {
    updateActiveTab((t) => ({ dynamicFilterValues: typeof vals === "function" ? vals(t.dynamicFilterValues) : vals }));
  }
  function setSelectedDynamicFilters(filters: Record<string, string[]> | ((prev: Record<string, string[]>) => Record<string, string[]>)) {
    updateActiveTab((t) => ({ selectedDynamicFilters: typeof filters === "function" ? filters(t.selectedDynamicFilters) : filters }));
  }
  function setFilterSearch(search: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) {
    updateActiveTab((t) => ({ filterSearch: typeof search === "function" ? search(t.filterSearch) : search }));
  }
  function setOptionOperators(ops: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) {
    updateActiveTab((t) => ({ optionOperators: typeof ops === "function" ? ops(t.optionOperators) : ops }));
  }
  function setOptionValues(vals: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>)) {
    updateActiveTab((t) => ({ optionValues: typeof vals === "function" ? vals(t.optionValues) : vals }));
  }
  function setCustomStart(cs: string) {
    updateActiveTab({ customStart: cs });
  }
  function setCustomEnd(ce: string) {
    updateActiveTab({ customEnd: ce });
  }
  function setIsCustomInputMode(mode: boolean | ((prev: boolean) => boolean)) {
    updateActiveTab((t) => ({ isCustomInputMode: typeof mode === "function" ? mode(t.isCustomInputMode) : mode }));
  }

  const [hoveredCondition, setHoveredCondition] = useState<PresetOption | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"conditions" | "columns" | null>(null);
  const [openDynamicField, setOpenDynamicField] = useState<string | null>(null);
  const dropdownContainerRef = useRef<HTMLDivElement | null>(null);
  const dynamicFieldsRef = useRef<HTMLDivElement | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState("");
  
  const totalActiveDynamicFilters = useMemo(() => {
    return Object.values(selectedDynamicFilters).reduce((acc, list) => acc + (list ? list.length : 0), 0);
  }, [selectedDynamicFilters]);

  const isRunDisabled = useMemo(() => {
    if (!activePreset || !activePreset.dynamicFilters || activePreset.dynamicFilters.length === 0) {
      return false;
    }
    return totalActiveDynamicFilters === 0;
  }, [activePreset, totalActiveDynamicFilters]);
  const [healthStatus, setHealthStatus] = useState<BackendHealthResponse | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const refreshBackendHealth = async () => {
    setCheckingHealth(true);
    const res = await checkBackendHealth();
    setHealthStatus(res);
    setCheckingHealth(false);
    return res;
  };

  useEffect(() => {
    refreshBackendHealth();
  }, []);

  const activeDynamicFieldRef = useRef<HTMLDivElement | null>(null);
  const filterConditionsRef = useRef<HTMLDivElement | null>(null);
  const projectColumnsRef = useRef<HTMLDivElement | null>(null);
  const dynamicFilterSeqRef = useRef<number>(0);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (filterConditionsRef.current && !filterConditionsRef.current.contains(event.target as Node)) {
        setOpenDropdown((current) => (current === "conditions" ? null : current));
      }
      if (projectColumnsRef.current && !projectColumnsRef.current.contains(event.target as Node)) {
        setOpenDropdown((current) => (current === "columns" ? null : current));
      }
      if (activeDynamicFieldRef.current && !activeDynamicFieldRef.current.contains(event.target as Node)) {
        setOpenDynamicField(null);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpenDropdown(null);
        setOpenDynamicField(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("pointerdown", handleClickOutside);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("pointerdown", handleClickOutside);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function togglePresetOption(opt: PresetOption) {
    setPresetOptions((current) => {
      const next = new Set(current);
      const isRemoving = next.has(opt.label) || next.has(opt.clause);
      if (isRemoving) {
        next.delete(opt.label);
        next.delete(opt.clause);
      } else {
        next.add(opt.label);
        next.add(opt.clause);
      }
      setQuery((currentQuery) =>
        updateQueryConditionOption(
          currentQuery,
          opt,
          !isRemoving,
          optionOperators[opt.label],
          optionValues[opt.label]
        )
      );
      return next;
    });
  }

  function selectAllPresetOptions() {
    if (!activePreset) return;
    const allClauses = new Set(activePreset.options.map(o => o.clause));
    setPresetOptions(allClauses);
    setQuery((currentQuery) => selectAllPresetOptionsInQuery(currentQuery, activePreset, optionOperators, optionValues));
  }

  function clearAllPresetOptions() {
    if (!activePreset) return;
    const empty = new Set<string>();
    setPresetOptions(empty);
    setQuery((currentQuery) => clearAllPresetOptionsInQuery(currentQuery, activePreset, optionOperators, optionValues));
  }

  function selectAllProjectColumns() {
    if (!activePreset) return;
    const allCols = new Set(activePreset.projectColumns);
    setPresetProjectColumns(allCols);
    setQuery((currentQuery) => updateQueryProjectColumns(currentQuery, activePreset, allCols));
  }

  function clearAllProjectColumns() {
    if (!activePreset) return;
    const empty = new Set<string>();
    setPresetProjectColumns(empty);
    setQuery((currentQuery) => updateQueryProjectColumns(currentQuery, activePreset, empty));
  }

  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [workspaces, setWorkspaces] = useState<AzureWorkspace[]>(() => getPredefinedWorkspaces());
  const [fetchingWorkspaces, setFetchingWorkspaces] = useState(false);

  const uniqueSubscriptions = useMemo(() => {
    const map = new Map<string, { id?: string; name: string; count: number }>();
    workspaces.forEach((ws) => {
      const subName = ws.subscriptionName || ws.subscriptionId || "Default Subscription";
      const existing = map.get(subName);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(subName, {
          id: ws.subscriptionId,
          name: subName,
          count: 1
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [workspaces]);

  async function loadWorkspaces() {
    if (!isAuthenticated || accounts.length === 0) return;
    setFetchingWorkspaces(true);
    try {
      const response = await instance.acquireTokenSilent({
        ...loginRequest,
        account: accounts[0]
      });
      const wsList = await fetchUserWorkspaces(response.accessToken);
      const combined = combineWorkspaces(wsList);
      setWorkspaces(combined);
      if (combined.length > 0 && !workspaceId) {
        setWorkspaceId(combined[0].customerId);
      }
    } catch (err) {
      console.error("Failed to fetch workspaces from Azure ARM:", err);
      const fallback = combineWorkspaces([]);
      setWorkspaces(fallback);
      if (fallback.length > 0 && !workspaceId) {
        setWorkspaceId(fallback[0].customerId);
      }
      // Fallback to interactive if silent fails
      if (err instanceof Error && err.message.includes("interaction_required")) {
         instance.acquireTokenPopup(loginRequest).then(response => {
            fetchUserWorkspaces(response.accessToken).then(wsList => {
              const combined = combineWorkspaces(wsList);
              setWorkspaces(combined);
              if (combined.length > 0 && !workspaceId) {
                setWorkspaceId(combined[0].customerId);
              }
            });
         }).catch(popErr => console.warn("Popup interactive login skipped or failed:", popErr));
      }
    } finally {
      setFetchingWorkspaces(false);
    }
  }

  useEffect(() => {
    async function initWorkspaces() {
      if (isAuthenticated && accounts.length > 0) {
        loadWorkspaces();
      } else {
        const serverWs = await fetchServerWorkspaces();
        const predefined = getPredefinedWorkspaces();
        const combined = combineWorkspaces([...serverWs, ...predefined]);
        setWorkspaces(combined);
        if (combined.length > 0 && !workspaceId) {
          setWorkspaceId(combined[0].customerId);
        }
      }
    }
    initWorkspaces();
  }, [isAuthenticated, accounts]);

  function handleLogin() {
    instance.loginPopup(loginRequest).then(() => loadWorkspaces()).catch(e => console.error(e));
  }

  function handleLogout() {
    instance.logoutPopup().catch(e => console.error(e));
  }

  const clientIdConfigured = Boolean(
    getEnv("VITE_AZURE_CLIENT_ID") &&
    !getEnv("VITE_AZURE_CLIENT_ID").includes("your_")
  );

  const authRequired = getEnv("VITE_REQUIRE_AZURE_AD_AUTH") === "true";

  const allowedGroupsConfig = getEnv("VITE_ALLOWED_AZURE_AD_GROUPS").trim();
  const allowedGroupsList = useMemo(() => {
    return allowedGroupsConfig
      ? allowedGroupsConfig.split(",").map((g) => g.trim().toLowerCase()).filter(Boolean)
      : [];
  }, [allowedGroupsConfig]);

  const userGroups: string[] = useMemo(() => {
    if (!isAuthenticated || accounts.length === 0) return [];
    const claims = (accounts[0]?.idTokenClaims || {}) as Record<string, any>;
    const groups = claims.groups || claims.roles || claims.wids || [];
    return Array.isArray(groups) ? groups.map((g: any) => String(g).toLowerCase()) : [];
  }, [isAuthenticated, accounts]);

  const isGroupAuthorized = useMemo(() => {
    if (allowedGroupsList.length === 0) return true; // Allow all AD users if no group restriction configured
    if (!isAuthenticated || accounts.length === 0) return false;
    return userGroups.some((g) => allowedGroupsList.includes(g));
  }, [allowedGroupsList, isAuthenticated, accounts, userGroups]);

  // Require Azure AD login first before accessing the query workspace (unless disabled via VITE_REQUIRE_AZURE_AD_AUTH=false)
  if (authRequired && !isAuthenticated) {
    return (
      <main className="login-landing">
        <div className="login-hero-card">
          <div className="login-brand-icon">
            <ShieldCheck size={36} />
          </div>
          <h2 style={{ fontSize: "28px", fontWeight: "800", color: "#f8fafc", marginBottom: "12px" }}>
            Azure Log Analytics KQL Explorer
          </h2>
          <p style={{ fontSize: "15px", color: "#94a3b8", marginBottom: "32px", lineHeight: "1.6" }}>
            Please sign in with your Microsoft Azure AD account to discover accessible Log Analytics Workspaces, execute KQL queries, and analyze network and security telemetry.
          </p>

          {!clientIdConfigured && (
            <div style={{
              marginBottom: "24px",
              padding: "12px 16px",
              background: "rgba(244, 63, 94, 0.15)",
              border: "1px solid rgba(244, 63, 94, 0.4)",
              borderRadius: "8px",
              color: "#fecdd3",
              fontSize: "13px",
              textAlign: "left"
            }}>
              <strong>Configuration Alert:</strong> <code>VITE_AZURE_CLIENT_ID</code> is missing or set to default placeholder in <code>.env</code>. Set your Azure AD SPA Client ID GUID in root <code>.env</code> and restart dev server.
            </div>
          )}

          <button className="login-btn-primary" onClick={handleLogin}>
            <LogIn size={22} />
            <span>Sign in with Microsoft Azure AD</span>
          </button>

          <div style={{ marginTop: "28px", paddingTop: "20px", borderTop: "1px solid rgba(255, 255, 255, 0.1)", display: "flex", justifyContent: "center", gap: "20px", color: "#64748b", fontSize: "13px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <ShieldCheck size={16} color="#34d399" /> Enterprise MSAL / Azure AD OAuth 2.0
            </span>
          </div>
        </div>

        <div className="features-grid">
          <div className="feature-card">
            <h3>🔍 Dynamic Workspace Selection</h3>
            <p>Automatically discover and switch between accessible Log Analytics Workspaces from your Azure subscriptions after authentication.</p>
          </div>
          <div className="feature-card">
            <h3>⚡ Pre-configured Log Presets</h3>
            <p>Instant visual filters for Azure Front Door, Azure Firewall Network/Application logs, App Gateway, and Storage Fileshare/Blob logs.</p>
          </div>
          <div className="feature-card">
            <h3>🤖 AI Query Assistant</h3>
            <p>Generate, optimize, and debug complex KQL queries using the built-in AI Assistant.</p>
          </div>
        </div>
      </main>
    );
  }

  // Access Denied Screen if user is authenticated but not in any configured AD group
  if (isAuthenticated && !isGroupAuthorized) {
    const userUpn = accounts[0]?.username || accounts[0]?.name || "Authenticated User";
    return (
      <main className="login-landing">
        <div className="login-hero-card" style={{ border: "1px solid rgba(244, 63, 94, 0.45)" }}>
          <div className="login-brand-icon" style={{ background: "rgba(244, 63, 94, 0.2)", borderColor: "#f43f5e", color: "#f43f5e" }}>
            <ShieldCheck size={36} />
          </div>
          <h2 style={{ fontSize: "26px", fontWeight: "800", color: "#fda4af", marginBottom: "12px" }}>
            🚫 Access Denied: Azure AD Group Restriction
          </h2>
          <p style={{ fontSize: "15px", color: "#fecdd3", marginBottom: "20px", lineHeight: "1.6" }}>
            Signed in as <strong>{userUpn}</strong>. Your account authenticated successfully with Microsoft Entra ID, but you are not a member of an authorized Azure AD Security Group required to access this application.
          </p>

          <div style={{
            background: "rgba(4, 20, 28, 0.85)",
            border: "1px solid rgba(244, 63, 94, 0.3)",
            borderRadius: "8px",
            padding: "16px",
            textAlign: "left",
            marginBottom: "24px",
            fontSize: "13px"
          }}>
            <div style={{ fontWeight: 700, color: "#f43f5e", marginBottom: "6px" }}>Security Authorization Details:</div>
            <div style={{ color: "#94a3b8", marginBottom: "8px" }}>
              Authorized AD Groups: <code style={{ color: "#34d399" }}>{allowedGroupsConfig}</code>
            </div>
            <div style={{ color: "#94a3b8" }}>
              Your Group Memberships: <code style={{ color: userGroups.length > 0 ? "#38bdf8" : "#f43f5e" }}>{userGroups.length > 0 ? userGroups.join(", ") : "None emitted (Group claims missing)"}</code>
            </div>
          </div>

          <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "24px", textAlign: "left", background: "rgba(255, 255, 255, 0.03)", padding: "12px", borderRadius: "6px" }}>
            💡 <strong>Troubleshooting:</strong>
            <ul style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: "1.6" }}>
              <li>Ask your Azure AD administrator to assign your account to an authorized Security Group.</li>
              <li>Ensure <code>groupMembershipClaims</code> (SecurityGroup / All) is enabled in your Azure AD App Registration manifest.</li>
            </ul>
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button className="login-btn-primary" style={{ background: "linear-gradient(90deg, #f43f5e 0%, #e11d48 100%)" }} onClick={handleLogout}>
              <LogOut size={20} />
              <span>Sign Out / Switch Account</span>
            </button>
          </div>
        </div>
      </main>
    );
  }


  function updateQueryTimespan(newQuery: string, tsValue: string, start: string, end: string) {
    const kqlClause = getTimespanKql(tsValue, start, end);
    // Regex to match existing TimeGenerated where clause
    const regex = /\|\s*where\s+TimeGenerated\s+(>|between)[^\n]+/i;
    if (regex.test(newQuery)) {
      return newQuery.replace(regex, kqlClause);
    }
    // If not found, just return as is (or could prepend, but user might not want it)
    return newQuery;
  }

  function handleTimespanChange(newVal: string) {
    setTimespan(newVal);
    setQuery(current => updateQueryTimespan(current, newVal, customStart, customEnd));
  }

  function handleCustomTimeChange(start: string, end: string) {
    setCustomStart(start);
    setCustomEnd(end);
    if (timespan === "CUSTOM") {
      setQuery(current => updateQueryTimespan(current, "CUSTOM", start, end));
    }
  }

  function handleOptionOperatorChange(opt: PresetOption, newOp: string) {
    const prevOp = optionOperators[opt.label];
    const prevVal = optionValues[opt.label];
    const updatedOps = { ...optionOperators, [opt.label]: newOp };
    setOptionOperators(updatedOps);
    const updatedOptions = new Set(presetOptions);
    updatedOptions.add(opt.label);
    updatedOptions.add(opt.clause);
    setPresetOptions(updatedOptions);
    setQuery((currentQuery) =>
      updateQueryConditionOption(
        currentQuery,
        opt,
        true,
        newOp,
        prevVal,
        prevOp,
        prevVal
      )
    );
  }

  function handleOptionValueChange(opt: PresetOption, newVal: string) {
    const prevOp = optionOperators[opt.label];
    const prevVal = optionValues[opt.label];
    const updatedVals = { ...optionValues, [opt.label]: newVal };
    setOptionValues(updatedVals);
    const updatedOptions = new Set(presetOptions);
    updatedOptions.add(opt.label);
    updatedOptions.add(opt.clause);
    setPresetOptions(updatedOptions);
    setQuery((currentQuery) =>
      updateQueryConditionOption(
        currentQuery,
        opt,
        true,
        prevOp,
        newVal,
        prevOp,
        prevVal
      )
    );
  }

  function generateQuery(
    preset: PresetQuery,
    conditionOptions: Set<string>,
    projectCols: Set<string>,
    dynamicVals: Record<string, string[]>,
    ops: Record<string, string> = optionOperators,
    vals: Record<string, string> = optionValues
  ) {
    const activeProject = preset.projectColumns.filter((c) => projectCols.has(c));
    const projectLine = activeProject.length > 0 ? `| project ${activeProject.join(", ")}` : "";

    const dynamicClauses =
      preset.dynamicFilters
        ?.map((f) => {
          const selected = dynamicVals[f.field];
          if (!selected || selected.length === 0) return null;
          return f.clauseTemplate(selected);
        })
        .filter(Boolean) || [];

    const conditionClauses = preset.options
      .filter((o) => conditionOptions.has(o.label) || conditionOptions.has(o.clause))
      .map((o) => buildOptionClause(o, ops[o.label], vals[o.label]));

    return [
      preset.baseQuery,
      ...dynamicClauses,
      ...conditionClauses,
      projectLine
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function fetchDynamicFilters(
    preset: PresetQuery,
    targetWorkspaceId?: string,
    currentSelectedFilters: Record<string, string[]> = selectedDynamicFilters
  ) {
    if (!preset.dynamicFilters || preset.dynamicFilters.length === 0) return;
    
    const targetWs = (targetWorkspaceId || workspaceId).trim();
    const isPlaceholderGuid = /^(11111111|22222222|33333333|44444444|00000000|your_)/i.test(targetWs);
    if (!targetWs || isPlaceholderGuid || targetWs.length < 5) {
      console.warn("Skipping dynamic filter fetch: workspace ID is empty, placeholder, or too short.");
      return;
    }

    const currentSeq = ++dynamicFilterSeqRef.current;

    let token: string | undefined;
    if (isAuthenticated && accounts.length > 0) {
      try {
        const tokenResponse = await instance.acquireTokenSilent({
          scopes: ["https://api.loganalytics.io/.default"],
          account: accounts[0]
        });
        token = tokenResponse.accessToken;
      } catch (err) {
        console.warn("Could not acquire token for dynamic filters", err);
      }
    }

    // Clean base query by removing post-aggregation operations (summarize, order, project, render)
    const cleanBase = preset.baseQuery
      .split(/\n\|\s*(summarize|order|project|render)\b/i)[0]
      .trim();

    for (let i = 0; i < preset.dynamicFilters.length; i++) {
      if (dynamicFilterSeqRef.current !== currentSeq) return;
      const filter = preset.dynamicFilters[i];
      try {
        let q = `${cleanBase}\n| where TimeGenerated > ago(24h)`;

        // Append clauses for any preceding filters that have a selection (e.g. Resource / AccountName filter first)
        for (let j = 0; j < i; j++) {
          const prevFilter = preset.dynamicFilters[j];
          const selectedVal = currentSelectedFilters[prevFilter.field];
          if (selectedVal && selectedVal.length > 0) {
            q += `\n${prevFilter.clauseTemplate(selectedVal)}`;
          }
        }

        q += `\n| distinct ${filter.field}`;

        let res;
        try {
          res = await runQuery({
            query: q,
            timespan: "PT24H",
            workspaceId: targetWs,
            filters: [],
            token
          });
        } catch {
          // Fallback without TimeGenerated clause in case the table does not contain a TimeGenerated column
          let fallbackQ = `${cleanBase}`;
          for (let j = 0; j < i; j++) {
            const prevFilter = preset.dynamicFilters[j];
            const selectedVal = currentSelectedFilters[prevFilter.field];
            if (selectedVal && selectedVal.length > 0) {
              fallbackQ += `\n${prevFilter.clauseTemplate(selectedVal)}`;
            }
          }
          fallbackQ += `\n| distinct ${filter.field}`;

          res = await runQuery({
            query: fallbackQ,
            timespan: "PT24H",
            workspaceId: targetWs,
            filters: [],
            token
          });
        }

        if (dynamicFilterSeqRef.current !== currentSeq) return;

        const rawValues = res.tables[0]?.rows.map(r => r[0] as string).filter(Boolean) || [];
        const values = rawValues.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
        setDynamicFilterValues(prev => ({ ...prev, [filter.field]: values }));
      } catch (e) {
        console.error("Failed to fetch dynamic filter", filter.field, e);
      }
    }
  }

  function applyPreset(preset: PresetQuery) {
    setActivePreset(preset);
    setPresetOptions(new Set());
    setOptionOperators({});
    setOptionValues({});
    const initialProjects = new Set(preset.projectColumns);
    setPresetProjectColumns(initialProjects);
    setSelectedDynamicFilters({});
    setDynamicFilterValues({});
    setFilterSearch({});
    setOpenDynamicField(null);
    setQuery(generateQuery(preset, new Set(), initialProjects, {}, {}, {}));
    fetchDynamicFilters(preset, workspaceId, {});
  }

  function handleWorkspaceSelect(newWsId: string) {
    if (newWsId === workspaceId) return;

    const matchingWs = workspaces.find((w) => w.customerId === newWsId);
    const wsSub = matchingWs?.subscriptionName || matchingWs?.subscriptionId;

    // Clear all tab data (results, active presets, filter conditions, project columns, dynamic filters, errors) for the active tab when selecting a different workspace
    updateActiveTab({
      workspaceId: newWsId,
      selectedSubscription: wsSub || selectedSubscription,
      result: null,
      error: null,
      loading: false,
      activePreset: null,
      presetOptions: new Set(),
      presetProjectColumns: new Set(),
      selectedDynamicFilters: {},
      dynamicFilterValues: {},
      filterSearch: {},
      optionOperators: {},
      optionValues: {},
      customStart: "",
      customEnd: "",
      isCustomInputMode: false,
      query: starterQuery
    });
    setOpenDynamicField(null);
    setOpenDropdown(null);
  }

  function toggleDynamicFilterValue(field: string, val: string) {
    const current = selectedDynamicFilters[field] || [];
    const exists = current.includes(val);
    const updated = exists ? current.filter((v) => v !== val) : [...current, val];
    const nextFilters = { ...selectedDynamicFilters, [field]: updated };
    setSelectedDynamicFilters(nextFilters);
    if (activePreset) {
      const filterObj = activePreset.dynamicFilters?.find((f) => f.field === field);
      setQuery((currentQuery) =>
        updateQueryDynamicFilter(currentQuery, field, filterObj, current, updated)
      );
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }

  function selectAllDynamicFilterValues(field: string, values: string[]) {
    const current = selectedDynamicFilters[field] || [];
    const nextFilters = { ...selectedDynamicFilters, [field]: [...values] };
    setSelectedDynamicFilters(nextFilters);
    if (activePreset) {
      const filterObj = activePreset.dynamicFilters?.find((f) => f.field === field);
      setQuery((currentQuery) =>
        updateQueryDynamicFilter(currentQuery, field, filterObj, current, [...values])
      );
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }

  function clearDynamicFilterValues(field: string) {
    const current = selectedDynamicFilters[field] || [];
    const nextFilters = { ...selectedDynamicFilters, [field]: [] };
    setSelectedDynamicFilters(nextFilters);
    if (activePreset) {
      const filterObj = activePreset.dynamicFilters?.find((f) => f.field === field);
      setQuery((currentQuery) =>
        updateQueryDynamicFilter(currentQuery, field, filterObj, current, [])
      );
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }

  function toggleProjectColumn(column: string) {
    const next = new Set(presetProjectColumns);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    setPresetProjectColumns(next);

    if (activePreset) {
      setQuery((currentQuery) => updateQueryProjectColumns(currentQuery, activePreset, next));
    }
  }

  async function handleRun(overrideMaxRows?: number | React.MouseEvent) {
    const targetMaxRows = typeof overrideMaxRows === "number" ? overrideMaxRows : maxRows;
    setError(null);
    if (!isGroupAuthorized) {
      setError("Access Denied: Your Azure AD account is not a member of an authorized AD Security Group.");
      setLoading(false);
      return;
    }
    setHealthStatus((prev) => (prev && !prev.ok ? null : prev));
    setLoading(true);
    try {
      let finalTimespan = timespan;
      if (timespan === "CUSTOM") {
        if (customStart && customEnd) {
          finalTimespan = `${new Date(customStart).toISOString()}/${new Date(customEnd).toISOString()}`;
        } else {
          setError("Please select both custom start and end date/time before running query.");
          setLoading(false);
          return;
        }
      }

      let token: string | undefined;
      if (isAuthenticated && accounts.length > 0) {
        try {
          const tokenResponse = await instance.acquireTokenSilent({
            scopes: ["https://api.loganalytics.io/.default"],
            account: accounts[0]
          });
          token = tokenResponse.accessToken;
        } catch (err) {
          console.warn("Could not acquire log analytics token silently. Falling back to server credential if permitted.", err);
        }
      }

      // Sync presetProjectColumns if user typed a custom | project clause in editor
      const activeCode = query
        .split("\n")
        .map((line) => {
          const commentIdx = line.indexOf("//");
          return commentIdx >= 0 ? line.slice(0, commentIdx) : line;
        })
        .join("\n");
      const projectMatches = [...activeCode.matchAll(/\|\s*project\s+([^|]+)/gi)];
      if (projectMatches.length > 0) {
        const lastProjectClause = projectMatches[projectMatches.length - 1][1].trim();
        const projectedNames = lastProjectClause
          .split(",")
          .map((item) => {
            const parts = item.trim().split("=");
            return parts[0].trim();
          })
          .filter(Boolean);
        if (projectedNames.length > 0) {
          setPresetProjectColumns(new Set(projectedNames));
        }
      }

      const response = await runQuery({
        query,
        timespan: finalTimespan,
        workspaceId: workspaceId.trim() || undefined,
        filters: [],
        maxRows: targetMaxRows,
        token
      });
      setResult(response);
      setHealthStatus({ ok: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run query.");
      refreshBackendHealth();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Application status">
        <div>
          <h1 style={{
            fontSize: "1.75rem",
            fontWeight: 800,
            margin: 0,
            background: "linear-gradient(90deg, #38bdf8 0%, #2dd4bf 50%, #34d399 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            letterSpacing: "-0.5px"
          }}>
            Azure Log Analytics KQL
          </h1>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>

          {isAuthenticated && accounts.length > 0 && (
            <div className="user-badge" title={`Signed in as ${accounts[0].username}`}>
              <User size={15} />
              <span>{accounts[0].name || accounts[0].username}</span>
            </div>
          )}
          <button 
            className="primary-button" 
            style={{ background: "linear-gradient(90deg, #3b82f6 0%, #8b5cf6 100%)" }}
            onClick={() => setIsChatOpen(!isChatOpen)}
          >
            <MessageSquare size={17} />
            <span>Ask AI</span>
          </button>
          {isAuthenticated && (
            <button className="primary-button" style={{ background: "transparent", border: "1px solid rgba(255,255,255,0.2)" }} onClick={handleLogout}>
              <LogOut size={17} />
              <span>Sign Out</span>
            </button>
          )}
          <div className="security-badge" title="Credentials and tokens are validated securely">
            <ShieldCheck size={18} />
            <span>Azure AD Auth</span>
          </div>
        </div>
      </section>

      <section className="workspace">
        <div className="tab-bar-container">
          <div className="tab-bar-list">
            {tabs.map((tab) => {
              const isActive = tab.id === activeTabId;
              return (
                <div
                  key={tab.id}
                  className={`query-tab ${isActive ? "active" : ""}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <span className="tab-icon">⚡</span>
                  <span className="tab-title" title={tab.title}>{tab.title}</span>
                  {tabs.length > 1 && (
                    <button
                      type="button"
                      className="tab-close-btn"
                      onClick={(e) => closeTab(tab.id, e)}
                      title="Close Tab"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className="add-tab-btn"
            onClick={createNewTab}
            title="Open New Query Tab"
          >
            <Plus size={15} />
            <span>New Tab</span>
          </button>
        </div>

        <div className="query-panel">
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <h2 style={{ color: "#38bdf8" }}>KQL Query</h2>
            </div>
            <div className="toolbar" style={{ display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <SegmentedControl
                  value={timespan}
                  options={timespans}
                  onChange={handleTimespanChange}
                />
                {timespan === "CUSTOM" && (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "0.85rem" }}>
                    <input 
                      type="datetime-local" 
                      value={customStart}
                      onChange={e => handleCustomTimeChange(e.target.value, customEnd)}
                    />
                    <span>to</span>
                    <input 
                      type="datetime-local" 
                      value={customEnd}
                      onChange={e => handleCustomTimeChange(customStart, e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "rgba(10, 44, 58, 0.9)", padding: "4px 10px", borderRadius: "8px", border: "1px solid rgba(45, 212, 191, 0.28)", height: "36px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#38bdf8", whiteSpace: "nowrap" }}>Max Rows:</span>
                <select
                  value={maxRows}
                  onChange={(e) => {
                    const newRows = Number(e.target.value);
                    setMaxRows(newRows);
                    handleRun(newRows);
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#34d399",
                    fontSize: "13px",
                    fontWeight: 700,
                    outline: "none",
                    cursor: "pointer"
                  }}
                  aria-label="Max rows"
                >
                  <option value={100} style={{ background: "#06202c", color: "#f8fafc" }}>100 rows</option>
                  <option value={500} style={{ background: "#06202c", color: "#f8fafc" }}>500 rows</option>
                  <option value={1000} style={{ background: "#06202c", color: "#f8fafc" }}>1,000 rows (Default)</option>
                  <option value={2500} style={{ background: "#06202c", color: "#f8fafc" }}>2,500 rows</option>
                  <option value={5000} style={{ background: "#06202c", color: "#f8fafc" }}>5,000 rows</option>
                  <option value={10000} style={{ background: "#06202c", color: "#f8fafc" }}>10,000 rows</option>
                  <option value={50000} style={{ background: "#06202c", color: "#f8fafc" }}>50,000 rows</option>
                </select>
              </div>
              <button
                className="primary-button"
                onClick={handleRun}
                disabled={loading || isRunDisabled}
                title={isRunDisabled ? "Please select at least 1 Dynamic Filter option to run query" : "Run Query"}
                style={{
                  alignSelf: "flex-start",
                  background: isRunDisabled ? "rgba(71, 85, 105, 0.4)" : undefined,
                  color: isRunDisabled ? "#94a3b8" : undefined,
                  borderColor: isRunDisabled ? "rgba(148, 163, 184, 0.3)" : undefined,
                  cursor: isRunDisabled ? "not-allowed" : "pointer",
                  opacity: isRunDisabled ? 0.6 : 1
                }}
              >
                <Play size={17} />
                <span>{loading ? "Running" : "Run"}</span>
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-start", marginBottom: "16px" }}>
            <div className="dynamic-filter-card" style={{ flex: "1 1 540px", maxWidth: "620px" }}>
              <div className="dynamic-filter-header">
                <span className="dynamic-filter-label" style={{ color: "#38bdf8" }}>🏢 Azure Subscription & Workspace</span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span className="filter-count">
                    {uniqueSubscriptions.length} {uniqueSubscriptions.length === 1 ? "subscription" : "subscriptions"} · {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
                  </span>
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => setIsCustomInputMode(!isCustomInputMode)}
                    style={{ width: "auto", padding: "2px 8px", height: "24px", fontSize: "11px", border: "1px solid rgba(45, 212, 191, 0.3)" }}
                    title="Toggle manual workspace ID input"
                  >
                    {isCustomInputMode ? "📋 Dropdown" : "✏️ Manual"}
                  </button>
                  {isAuthenticated && (
                    <button 
                      type="button"
                      className="icon-button" 
                      onClick={loadWorkspaces} 
                      disabled={fetchingWorkspaces}
                      style={{ width: "auto", padding: "2px 6px", height: "24px", fontSize: "11px" }}
                      title="Refresh workspaces"
                    >
                      <RefreshCw size={12} className={fetchingWorkspaces ? "spinning" : ""} />
                    </button>
                  )}
                </div>
              </div>

              <div className="dynamic-filter-inputs" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {isCustomInputMode ? (
                  <input
                    className="filter-search-field"
                    style={{ paddingLeft: "10px !important", height: "32px !important", width: "100%" }}
                    value={workspaceId}
                    onChange={(event) => handleWorkspaceSelect(event.target.value)}
                    placeholder="Enter or paste Workspace ID GUID..."
                  />
                ) : (
                  <>
                    <GraphicalSubscriptionSelect
                      subscriptions={uniqueSubscriptions}
                      selectedSubscription={selectedSubscription}
                      totalWorkspacesCount={workspaces.length}
                      onSelect={(sub) => {
                        setSelectedSubscription(sub);
                        if (sub !== "ALL") {
                          const matches = workspaces.filter(w => w.subscriptionName === sub || w.subscriptionId === sub);
                          if (matches.length > 0 && !matches.some(w => w.customerId === workspaceId)) {
                            handleWorkspaceSelect(matches[0].customerId);
                          }
                        }
                      }}
                    />
                    <div style={{ flex: "2 1 240px", minWidth: "220px" }}>
                      <GraphicalWorkspaceSelect
                        workspaces={workspaces}
                        workspaceId={workspaceId}
                        selectedSubscription={selectedSubscription}
                        onSelect={(id) => handleWorkspaceSelect(id)}
                        onManualClick={() => setIsCustomInputMode(true)}
                      />
                    </div>
                  </>
                )}
              </div>

              {workspaces.length === 0 && !fetchingWorkspaces && (
                <p style={{ color: "#94a3b8", fontSize: "11px", margin: "6px 0 0 0" }}>
                  Configure <code>VITE_WORKSPACES=Subscription/Workspace:GUID</code> in <code>.env</code> or click "Manual" to enter a workspace ID directly.
                </p>
              )}
            </div>

            <div className="dynamic-filter-card" style={{ flex: "1 1 320px", maxWidth: "440px" }}>
              <div className="dynamic-filter-header">
                <span className="dynamic-filter-label" style={{ color: "#38bdf8" }}>⚡ Log Presets</span>
                <span className="filter-count">
                  {sortedPresets.length} presets
                </span>
              </div>
              <div className="dynamic-filter-inputs">
                <GraphicalPresetSelect
                  presets={sortedPresets}
                  activePreset={activePreset}
                  presetColors={presetColors}
                  onSelect={(preset) => applyPreset(preset)}
                />
              </div>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "16px" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "#38bdf8" }}>Quick Switch:</span>
            {sortedPresets.map((preset) => {
              const isActive = activePreset?.id === preset.id;
              const colors = presetColors[preset.id] || { bg: "#ccc", text: "#000" };
              return (
                <button
                  key={preset.id}
                  className={`filter-chip ${isActive ? "enabled" : ""}`}
                  style={{
                    backgroundColor: isActive ? colors.bg : "#f3f2f1",
                    color: isActive ? colors.text : "#323130",
                    borderColor: colors.bg,
                    fontWeight: isActive ? "bold" : "normal",
                    whiteSpace: "nowrap",
                    padding: "4px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.2s ease-in-out",
                    boxShadow: isActive ? `0 0 10px ${colors.bg}66` : "none"
                  }}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>

            {/* Main Dynamic Filters Section (Dropdown Style) */}
            {activePreset && activePreset.dynamicFilters && activePreset.dynamicFilters.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "14px", backgroundColor: "rgba(15, 23, 42, 0.4)", borderRadius: "8px", border: "1px solid rgba(45, 212, 191, 0.2)", marginBottom: "16px", position: "relative", zIndex: openDynamicField ? 9999 : 5 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "#38bdf8", display: "flex", alignItems: "center", gap: "6px" }}>
                    <SlidersHorizontal size={16} color="#38bdf8" />
                    <span>Dynamic Filters:</span>
                  </span>
                  {totalActiveDynamicFilters > 0 ? (
                    <span style={{ fontSize: "12px", color: "#34d399", fontWeight: 600 }}>
                      ✓ {totalActiveDynamicFilters} filter {totalActiveDynamicFilters === 1 ? "value" : "values"} selected
                    </span>
                  ) : (
                    <span style={{ fontSize: "12px", color: "#fda4af", fontWeight: 600 }}>
                      ⚠️ Selection Required (Select at least 1 filter option to run query)
                    </span>
                  )}
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", position: "relative", zIndex: openDynamicField ? 9999 : 5 }}>
                  {activePreset.dynamicFilters.map((filter) => {
                    const rawValues = dynamicFilterValues[filter.field] || [];
                    const sortedValues = [...rawValues].sort((a, b) =>
                      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
                    );
                    const searchTerm = (filterSearch[filter.field] || "").trim().toLowerCase();
                    const matchingValues = searchTerm
                      ? sortedValues.filter((val) => val.toLowerCase().includes(searchTerm))
                      : sortedValues;
                    const selectedVals = selectedDynamicFilters[filter.field] || [];
                    const isOpen = openDynamicField === filter.field;
                    const hasSelection = selectedVals.length > 0;

                    return (
                      <div
                        key={filter.field}
                        ref={isOpen ? activeDynamicFieldRef : null}
                        style={{ position: "relative", zIndex: isOpen ? 10000 : 1 }}
                      >
                        {/* Dropdown Trigger Button per Dynamic Filter field */}
                        <button
                          type="button"
                          className="modal-trigger-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenDynamicField(isOpen ? null : filter.field);
                          }}
                          style={{
                            background: hasSelection ? "rgba(16, 185, 129, 0.2)" : "rgba(15, 23, 42, 0.7)",
                            border: `1px solid ${hasSelection ? "#10b981" : "rgba(56, 189, 248, 0.3)"}`,
                            color: hasSelection ? "#34d399" : "#f8fafc",
                            padding: "8px 14px",
                            borderRadius: "8px",
                            fontSize: "13px",
                            fontWeight: 600,
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "8px",
                            cursor: "pointer",
                            transition: "all 0.2s"
                          }}
                        >
                          <SlidersHorizontal size={15} color={hasSelection ? "#10b981" : "#38bdf8"} />
                          <span>
                            {filter.label}{" "}
                            {hasSelection ? (
                              <strong style={{ color: "#34d399" }}>({selectedVals.length} selected)</strong>
                            ) : (
                              <span style={{ color: "#94a3b8" }}>(0 selected)</span>
                            )}
                          </span>
                          {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {/* Dropdown Menu for this Dynamic Filter field */}
                        {isOpen && (
                          <div
                            className="multiselect-dropdown-menu wide-dropdown"
                            style={{
                              width: "420px",
                              maxWidth: "90vw",
                              left: 0,
                              top: "calc(100% + 8px)",
                              zIndex: 10001,
                              background: "rgba(4, 18, 27, 0.94)",
                              backdropFilter: "blur(16px)",
                              WebkitBackdropFilter: "blur(16px)",
                              border: "1px solid rgba(16, 185, 129, 0.5)",
                              borderRadius: "10px",
                              boxShadow: "0 20px 45px rgba(0, 0, 0, 0.85), 0 0 15px rgba(16, 185, 129, 0.2)"
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(16, 185, 129, 0.2)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span style={{ fontWeight: 700, fontSize: "13px", color: "#38bdf8" }}>
                                {filter.label}
                              </span>
                              <button
                                type="button"
                                className="clear-btn"
                                onClick={() => setOpenDynamicField(null)}
                                style={{ fontSize: "14px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}
                              >
                                ✕
                              </button>
                            </div>

                            <div className="dynamic-filter-inputs" style={{ padding: "12px" }}>
                              <div className="filter-search-box">
                                <Search size={14} className="filter-search-icon" />
                                <input
                                  type="text"
                                  className="filter-search-field"
                                  placeholder={`Search ${filter.label}...`}
                                  value={filterSearch[filter.field] || ""}
                                  onChange={(e) =>
                                    setFilterSearch((prev) => ({
                                      ...prev,
                                      [filter.field]: e.target.value
                                    }))
                                  }
                                />
                                {filterSearch[filter.field] && (
                                  <button
                                    type="button"
                                    className="clear-search-btn"
                                    onClick={() =>
                                      setFilterSearch((prev) => ({
                                        ...prev,
                                        [filter.field]: ""
                                      }))
                                    }
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>

                              <div className="dynamic-filter-actions" style={{ margin: "8px 0" }}>
                                <button
                                  type="button"
                                  className="filter-action-btn"
                                  onClick={() => selectAllDynamicFilterValues(filter.field, matchingValues)}
                                  disabled={matchingValues.length === 0}
                                >
                                  Select All ({matchingValues.length})
                                </button>
                                <button
                                  type="button"
                                  className="filter-action-btn clear"
                                  onClick={() => clearDynamicFilterValues(filter.field)}
                                  disabled={selectedVals.length === 0}
                                >
                                  Deselect All
                                </button>
                              </div>

                              <div className="dynamic-filter-options-list" style={{ maxHeight: "180px" }}>
                                {matchingValues.length === 0 ? (
                                  <div className="dynamic-filter-empty">No matching values found</div>
                                ) : (
                                  matchingValues.map((val) => {
                                    const isSelected = selectedVals.includes(val);
                                    return (
                                      <label
                                        key={val}
                                        className={`dynamic-filter-option-item ${isSelected ? "selected" : ""}`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => toggleDynamicFilterValue(filter.field, val)}
                                        />
                                        <span className="option-text" title={val}>{val}</span>
                                      </label>
                                    );
                                  })
                                )}
                              </div>

                              {selectedVals.length > 0 && (
                                <div className="selected-chips-container" style={{ marginTop: "10px" }}>
                                  {selectedVals.map((val) => (
                                    <span key={val} className="selected-chip" title={val}>
                                      <span className="chip-text">{val}</span>
                                      <button
                                        type="button"
                                        className="chip-remove"
                                        onClick={() => toggleDynamicFilterValue(filter.field, val)}
                                      >
                                        ✕
                                      </button>
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Filter Condition & Project Column dropdown bar positioned above KQL Code Editor */}
            {activePreset && (
              <div ref={dropdownContainerRef} style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px", position: "relative", zIndex: 1000 }}>
                {/* Filter Conditions Multi-Select Dropdown */}
                <div ref={filterConditionsRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="modal-trigger-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === "conditions" ? null : "conditions");
                      setDropdownSearch("");
                    }}
                    style={{
                      background: presetOptions.size > 0 ? "rgba(16, 185, 129, 0.2)" : "rgba(15, 23, 42, 0.6)",
                      border: `1px solid ${presetOptions.size > 0 ? "#10b981" : "rgba(16, 185, 129, 0.3)"}`,
                      color: presetOptions.size > 0 ? "#34d399" : "#94a3b8",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    <SlidersHorizontal size={15} color="#10b981" />
                    <span>Filter Conditions ({presetOptions.size} / {activePreset.options.length})</span>
                    {openDropdown === "conditions" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {openDropdown === "conditions" && (
                    <div className="multiselect-dropdown-menu wide-dropdown" onClick={(e) => e.stopPropagation()}>
                      <div className="dropdown-search-box">
                        <Search size={14} className="search-icon" />
                        <input
                          type="text"
                          placeholder="Search conditions..."
                          value={dropdownSearch}
                          onChange={(e) => setDropdownSearch(e.target.value)}
                        />
                        {dropdownSearch && (
                          <button type="button" className="clear-btn" onClick={() => setDropdownSearch("")}>✕</button>
                        )}
                      </div>
                      <div className="dropdown-actions" style={{ justifyContent: "space-between", gap: "8px" }}>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button type="button" onClick={selectAllPresetOptions}>Select All</button>
                          <button type="button" onClick={clearAllPresetOptions}>Deselect All</button>
                        </div>
                        <span style={{ fontSize: "11px", color: "#94a3b8" }}>Operators: ==, !=, contains, !contains, between</span>
                      </div>
                      <div className="dropdown-list" style={{ maxHeight: "280px" }}>
                        {activePreset.options
                          .filter(opt => !dropdownSearch || opt.label.toLowerCase().includes(dropdownSearch.toLowerCase()))
                          .map((opt) => {
                            const checked = presetOptions.has(opt.label) || presetOptions.has(opt.clause);
                            const defaultOp = opt.clause.includes("!contains")
                              ? "!contains"
                              : opt.clause.includes("contains")
                              ? "contains"
                              : opt.clause.includes("between")
                              ? "between"
                              : opt.clause.includes("!=")
                              ? "!="
                              : "==";
                            const currentOp = optionOperators[opt.label] || defaultOp;
                            const defaultVal = opt.clause.includes("between")
                              ? (opt.clause.match(/between\s*\(([^)]+)\)/i)?.[1] ?? "400 .. 599")
                              : (opt.clause.match(/"([^"]*)"/)?.[1] ?? "");
                            const currentVal = optionValues[opt.label] !== undefined ? optionValues[opt.label] : defaultVal;

                            return (
                              <div
                                key={opt.label}
                                className={`dropdown-item ${checked ? "is-selected" : ""}`}
                                onMouseEnter={() => setHoveredCondition(opt)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  togglePresetOption(opt);
                                }}
                                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: 0 }}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => {}}
                                  />
                                  <span style={{ fontWeight: 600, fontSize: "12px", color: "#f8fafc", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {opt.label}
                                  </span>
                                </div>

                                <div
                                  style={{ display: "flex", alignItems: "center", gap: "8px" }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <select
                                    value={currentOp}
                                    onChange={(e) => handleOptionOperatorChange(opt, e.target.value)}
                                    style={{
                                      background: "rgba(4, 20, 28, 0.95)",
                                      border: "1px solid rgba(16, 185, 129, 0.4)",
                                      borderRadius: "4px",
                                      color: "#34d399",
                                      fontSize: "11px",
                                      fontWeight: 700,
                                      padding: "3px 6px",
                                      outline: "none",
                                      cursor: "pointer"
                                    }}
                                  >
                                    <option value="==">==</option>
                                    <option value="!=">!=</option>
                                    <option value="contains">contains</option>
                                    <option value="!contains">!contains</option>
                                    <option value="<">&lt;</option>
                                    <option value="<=">&lt;=</option>
                                    <option value=">">&gt;</option>
                                    <option value=">=">&gt;=</option>
                                    <option value="between">between</option>
                                  </select>

                                  <input
                                    type="text"
                                    value={currentVal}
                                    onChange={(e) => handleOptionValueChange(opt, e.target.value)}
                                    placeholder={currentOp === "between" ? "400 .. 599" : "value..."}
                                    style={{
                                      width: "160px",
                                      background: "rgba(4, 20, 28, 0.95)",
                                      border: "1px solid rgba(16, 185, 129, 0.3)",
                                      borderRadius: "4px",
                                      color: "#f8fafc",
                                      fontSize: "11px",
                                      padding: "3px 8px",
                                      outline: "none"
                                    }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                      </div>

                      {hoveredCondition && (
                        <div style={{
                          padding: "6px 12px",
                          background: "rgba(4, 23, 32, 0.95)",
                          borderTop: "1px solid rgba(16, 185, 129, 0.3)",
                          fontSize: "11px",
                          color: "#38bdf8",
                          fontFamily: "monospace",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis"
                        }}>
                          <span>⚡ KQL Preview: </span>
                          <span style={{ color: "#34d399" }}>
                            {buildOptionClause(hoveredCondition, optionOperators[hoveredCondition.label], optionValues[hoveredCondition.label])}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Project Columns Multi-Select Dropdown */}
                <div ref={projectColumnsRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    className="modal-trigger-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdown(openDropdown === "columns" ? null : "columns");
                      setDropdownSearch("");
                    }}
                    style={{
                      background: presetProjectColumns.size > 0 ? "rgba(16, 185, 129, 0.2)" : "rgba(15, 23, 42, 0.6)",
                      border: `1px solid ${presetProjectColumns.size > 0 ? "#10b981" : "rgba(16, 185, 129, 0.3)"}`,
                      color: presetProjectColumns.size > 0 ? "#34d399" : "#94a3b8",
                      padding: "8px 14px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: 600,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                      transition: "all 0.2s"
                    }}
                  >
                    <Columns3 size={15} color="#10b981" />
                    <span>Project Columns ({presetProjectColumns.size} / {activePreset.projectColumns.length})</span>
                    {openDropdown === "columns" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </button>

                  {openDropdown === "columns" && (
                    <div className="multiselect-dropdown-menu" onClick={(e) => e.stopPropagation()}>
                      <div className="dropdown-search-box">
                        <Search size={14} className="search-icon" />
                        <input
                          type="text"
                          placeholder="Search columns..."
                          value={dropdownSearch}
                          onChange={(e) => setDropdownSearch(e.target.value)}
                        />
                        {dropdownSearch && (
                          <button type="button" className="clear-btn" onClick={() => setDropdownSearch("")}>✕</button>
                        )}
                      </div>
                      <div className="dropdown-actions">
                        <button type="button" onClick={selectAllProjectColumns}>Select All</button>
                        <button type="button" onClick={clearAllProjectColumns}>Deselect All</button>
                      </div>
                      <div className="dropdown-list">
                        {activePreset.projectColumns
                          .filter(col => !dropdownSearch || col.toLowerCase().includes(dropdownSearch.toLowerCase()))
                          .map((col) => {
                            const checked = presetProjectColumns.has(col);
                            return (
                              <div
                                key={col}
                                className={`dropdown-item ${checked ? "is-selected" : ""}`}
                                onClick={() => toggleProjectColumn(col)}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => {}}
                                />
                                <span>{col}</span>
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {isRunDisabled && (
              <div style={{
                marginBottom: "12px",
                padding: "8px 14px",
                background: "rgba(244, 63, 94, 0.12)",
                border: "1px solid rgba(244, 63, 94, 0.4)",
                borderRadius: "8px",
                color: "#fda4af",
                fontSize: "12px",
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                <span>⚠️ Mandatory: Please select at least 1 Dynamic Filter option above to enable running the query.</span>
              </div>
            )}

            <KqlCodeEditor
              query={query}
              onChange={(newQuery) => setQuery(newQuery)}
              onRun={handleRun}
              loading={loading}
              isRunDisabled={isRunDisabled}
              activePreset={activePreset}
              tableColumns={result?.tables?.[0]?.columns?.map((c) => c.name) || []}
              dynamicFilterValues={dynamicFilterValues}
            />
        </div>
      </section>

      {healthStatus && !healthStatus.ok && (
        <div style={{
          margin: "16px 0",
          padding: "16px 20px",
          background: "rgba(244, 63, 94, 0.12)",
          border: "1px solid rgba(244, 63, 94, 0.4)",
          borderRadius: "10px",
          color: "#fecdd3",
          fontSize: "14px"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
            <strong style={{ color: "#fda4af", fontSize: "15px", display: "flex", alignItems: "center", gap: "8px" }}>
              ⚠️ Backend Application Offline / Unreachable
            </strong>
            <button
              type="button"
              className="icon-button"
              onClick={refreshBackendHealth}
              disabled={checkingHealth}
              style={{ fontSize: "12px", padding: "5px 12px", background: "rgba(255,255,255,0.12)", color: "#fff", cursor: "pointer" }}
            >
              {checkingHealth ? "Checking..." : "🔄 Re-check Backend Health"}
            </button>
          </div>
          <p style={{ margin: "0 0 10px 0", lineHeight: "1.5" }}>
            The frontend application is unable to reach the backend API at <code>/api/health</code> ({healthStatus.error || "Connection refused"}).
          </p>
          <div style={{ background: "rgba(0, 0, 0, 0.35)", padding: "10px 14px", borderRadius: "6px", fontSize: "13px" }}>
            <strong>Resolution:</strong> Ensure the backend service container is running and healthy.
          </div>
        </div>
      )}

      {error ? <div className="alert error">{error}</div> : null}
      {result?.partialError ? (
        <QueryWarningAlert
          partialError={result.partialError}
          query={query}
          timespan={timespan}
          maxRows={maxRows}
          workspaceId={workspaceId}
        />
      ) : null}

      <section className="results">
        {!result && !loading ? (
          <div className="empty-results">Run a query to see Log Analytics tables here.</div>
        ) : null}
        {loading ? <div className="empty-results">Query is running...</div> : null}
        {result?.tables.map((table) => (
          <ResultTable
            key={`${workspaceId}-${table.name}`}
            table={table}
            query={query}
            presetProjectColumns={presetProjectColumns}
            workspaceId={workspaceId}
          />
        ))}
      </section>

      {isChatOpen && <Chatbot onClose={() => setIsChatOpen(false)} />}
    </main>
  );
}

function QueryWarningAlert({
  partialError,
  query,
  timespan,
  maxRows,
  workspaceId
}: {
  partialError: string;
  query: string;
  timespan: string;
  maxRows: number;
  workspaceId: string;
}) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="alert warning" style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
          <span style={{ fontSize: "16px", marginTop: "2px" }}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: "14px", color: "#fde68a" }}>
              Query Execution Warning / Truncation
            </div>
            <div style={{ fontSize: "13px", color: "#fef3c7", marginTop: "2px" }}>
              {partialError || "There were some errors or partial data truncation when processing your query."}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowDetails(!showDetails)}
          style={{
            background: "rgba(217, 119, 6, 0.3)",
            border: "1px solid rgba(251, 191, 36, 0.4)",
            color: "#fde68a",
            borderRadius: "6px",
            padding: "4px 10px",
            fontSize: "11px",
            fontWeight: 700,
            cursor: "pointer",
            whiteSpace: "nowrap",
            flexShrink: 0
          }}
        >
          {showDetails ? "Hide Error Details ▲" : "View Error Details ▾"}
        </button>
      </div>

      {showDetails && (
        <div
          style={{
            background: "rgba(0, 0, 0, 0.45)",
            border: "1px solid rgba(251, 191, 36, 0.3)",
            borderRadius: "6px",
            padding: "12px",
            fontSize: "12px",
            color: "#cbd5e1",
            fontFamily: "monospace",
            display: "flex",
            flexDirection: "column",
            gap: "8px"
          }}
        >
          <div><strong style={{ color: "#fde68a" }}>Workspace ID:</strong> {workspaceId || "Default Workspace"}</div>
          <div><strong style={{ color: "#fde68a" }}>Timespan Requested:</strong> {timespan}</div>
          <div><strong style={{ color: "#fde68a" }}>Max Rows:</strong> {maxRows}</div>
          <div>
            <strong style={{ color: "#fde68a" }}>Executed KQL Query:</strong>
            <pre style={{ margin: "4px 0 0 0", padding: "8px", background: "rgba(15, 23, 42, 0.8)", borderRadius: "4px", color: "#38bdf8", overflowX: "auto" }}>
              {query}
            </pre>
          </div>
          <div>
            <strong style={{ color: "#fde68a" }}>Azure Warning Details:</strong>
            <div style={{ color: "#fda4af", marginTop: "2px" }}>{partialError}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function SegmentedControl({
  value,
  options,
  onChange
}: {
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Timespan">
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? "active" : ""}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ResultTable({
  table,
  query = "",
  presetProjectColumns,
  workspaceId
}: {
  table: QueryTable;
  query?: string;
  presetProjectColumns?: Set<string>;
  workspaceId?: string;
}) {
  const [search, setSearch] = useState("");
  const [sortColumnName, setSortColumnName] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const [useLocalTime, setUseLocalTime] = useState(true);
  const [page, setPage] = useState(0);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [resizingCol, setResizingCol] = useState<{ name: string; startX: number; startWidth: number } | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  const [globalWrapText, setGlobalWrapText] = useState(false);
  const [wrappedColumns, setWrappedColumns] = useState<Set<string>>(new Set());
  const [wrappedRows, setWrappedRows] = useState<Set<number>>(new Set());

  function toggleColumnWrap(colName: string) {
    setWrappedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(colName)) next.delete(colName);
      else next.add(colName);
      return next;
    });
  }

  function toggleRowWrap(rowIndex: number) {
    setWrappedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowIndex)) next.delete(rowIndex);
      else next.add(rowIndex);
      return next;
    });
  }

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const headerScrollRef = useRef<HTMLDivElement | null>(null);
  const topScrollRef = useRef<HTMLDivElement | null>(null);

  function syncTableScroll() {
    if (tableScrollRef.current) {
      const scrollLeft = tableScrollRef.current.scrollLeft;
      if (topScrollRef.current) topScrollRef.current.scrollLeft = scrollLeft;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = scrollLeft;
    }
  }

  function syncHeaderScroll() {
    if (headerScrollRef.current && tableScrollRef.current) {
      const scrollLeft = headerScrollRef.current.scrollLeft;
      tableScrollRef.current.scrollLeft = scrollLeft;
      if (topScrollRef.current) topScrollRef.current.scrollLeft = scrollLeft;
    }
  }

  function syncTopScroll() {
    if (topScrollRef.current && tableScrollRef.current) {
      const scrollLeft = topScrollRef.current.scrollLeft;
      tableScrollRef.current.scrollLeft = scrollLeft;
      if (headerScrollRef.current) headerScrollRef.current.scrollLeft = scrollLeft;
    }
  }

  // Custom column order state (allows moving columns left/right & drag/drop)
  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    table.columns.map((c) => c.name)
  );

  // Sync state when table schema changes
  useEffect(() => {
    setColumnOrder(table.columns.map((c) => c.name));
    setSortColumnName(null);
    setSortDirection(null);
    setPage(0);
  }, [table]);

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() =>
    getRelatedColumns(query, table.columns.map((c) => c.name), presetProjectColumns)
  );

  useEffect(() => {
    const related = getRelatedColumns(query, table.columns.map((c) => c.name), presetProjectColumns);
    setVisibleColumns(related);
  }, [table, query, presetProjectColumns]);

  const [pageSize, setPageSize] = useState<number>(50);

  // Filtered and ordered visible columns
  const orderedVisibleColumns = useMemo(() => {
    return columnOrder.filter((colName) => visibleColumns.includes(colName));
  }, [columnOrder, visibleColumns]);

  function handleDragEnd() {
    setDraggedColumn(null);
  }

  function getDefaultColumnWidth(colName: string): number {
    if (/requesturi/i.test(colName)) {
      return 450; // 3x standard default width (150px * 3)
    }
    return 150;
  }

  // Column resizing
  function handleResizeStart(e: React.MouseEvent, columnName: string, currentWidth: number) {
    e.stopPropagation();
    e.preventDefault();
    setResizingCol({ name: columnName, startX: e.clientX, startWidth: currentWidth || getDefaultColumnWidth(columnName) });
  }

  useEffect(() => {
    if (!resizingCol) return;

    function handleMouseMove(e: MouseEvent) {
      if (!resizingCol) return;
      const { startX, startWidth, name } = resizingCol;
      const diff = e.clientX - startX;
      const newWidth = Math.max(70, startWidth + diff);
      setColumnWidths((prev) => ({ ...prev, [name]: newWidth }));
    }

    function handleMouseUp() {
      setResizingCol(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingCol]);

  // Drag and drop reordering
  function handleDragStart(e: React.DragEvent, colName: string) {
    setDraggedColumn(colName);
    e.dataTransfer.effectAllowed = "move";
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, targetColName: string) {
    e.preventDefault();
    if (!draggedColumn || draggedColumn === targetColName) return;

    setColumnOrder((prev) => {
      const fromIdx = prev.indexOf(draggedColumn);
      const toIdx = prev.indexOf(targetColName);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const updated = [...prev];
      const [removed] = updated.splice(fromIdx, 1);
      updated.splice(toIdx, 0, removed);
      return updated;
    });
    setDraggedColumn(null);
  }

  // Column header sorting
  function handleSort(colName: string) {
    if (sortColumnName === colName) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else if (sortDirection === "desc") {
        setSortColumnName(null);
        setSortDirection(null);
      }
    } else {
      setSortColumnName(colName);
      setSortDirection("asc");
    }
  }

  // Output Value Filters State
  const [selectedValueFilters, setSelectedValueFilters] = useState<Record<string, Set<string>>>({});
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);
  const [flyoutSearch, setFlyoutSearch] = useState("");
  const [isValueFilterOpen, setIsValueFilterOpen] = useState(false);
  const valueFilterRef = useRef<HTMLDivElement | null>(null);

  // Column filter operators state: ==, !=, contains, !contains, <, <=, >, >=
  const [columnFilterOperators, setColumnFilterOperators] = useState<Record<string, FilterOperator>>({});

  // Summary table states
  const [summaryScope, setSummaryScope] = useState<"filtered" | "all">("filtered");
  const [summarySelectedColumns, setSummarySelectedColumns] = useState<Set<string>>(new Set());
  const [summarySelectedSubValues, setSummarySelectedSubValues] = useState<Record<string, Set<string>>>({});
  const [draftSummaryColumns, setDraftSummaryColumns] = useState<Set<string>>(new Set());
  const [draftSummarySubValues, setDraftSummarySubValues] = useState<Record<string, Set<string>>>({});

  const [summarySortColumn, setSummarySortColumn] = useState<string | null>(null);
  const [summarySortDirection, setSummarySortDirection] = useState<"asc" | "desc" | null>(null);
  const [isSummaryDropdownOpen, setIsSummaryDropdownOpen] = useState(false);
  const [summaryHoveredCol, setSummaryHoveredCol] = useState<string | null>(null);
  const summaryDropdownRef = useRef<HTMLDivElement | null>(null);

  const draftColsRef = useRef(draftSummaryColumns);
  draftColsRef.current = draftSummaryColumns;
  const draftSubRef = useRef(draftSummarySubValues);
  draftSubRef.current = draftSummarySubValues;

  const commitSummaryDraft = () => {
    setSummarySelectedColumns(new Set(draftColsRef.current));
    setSummarySelectedSubValues(draftSubRef.current);
  };

  function handleSummaryHeaderClick(colKey: string) {
    if (summarySortColumn === colKey) {
      if (summarySortDirection === "desc") setSummarySortDirection("asc");
      else if (summarySortDirection === "asc") {
        setSummarySortColumn(null);
        setSummarySortDirection(null);
      } else setSummarySortDirection("desc");
    } else {
      setSummarySortColumn(colKey);
      setSummarySortDirection("desc");
    }
  }

  // Reset table filters and Summarized Column Telemetry when table or workspace changes
  useEffect(() => {
    setSearch("");
    setSelectedValueFilters({});
    setColumnFilterOperators({});
    setSummarySelectedColumns(new Set());
    setSummarySelectedSubValues({});
    setDraftSummaryColumns(new Set());
    setDraftSummarySubValues({});
    setSummarySortColumn(null);
    setSummarySortDirection(null);
    setSummaryScope("filtered");
  }, [table, workspaceId]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (valueFilterRef.current && !valueFilterRef.current.contains(e.target as Node)) {
        setIsValueFilterOpen(false);
      }
      if (summaryDropdownRef.current && !summaryDropdownRef.current.contains(e.target as Node)) {
        commitSummaryDraft();
        setIsSummaryDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  // Compute unique values per column
  const uniqueColumnValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    table.columns.forEach((col, idx) => {
      const rawSet = new Set<string>();
      table.rows.forEach((row) => {
        const val = row[idx];
        if (val !== null && val !== undefined && val !== "") {
          rawSet.add(String(val));
        }
      });
      map[col.name] = Array.from(rawSet).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
      );
    });
    return map;
  }, [table.columns, table.rows]);

  const activeValueFiltersCount = useMemo(() => {
    return Object.values(selectedValueFilters).reduce((acc, set) => acc + (set ? set.size : 0), 0);
  }, [selectedValueFilters]);

  // Data-type sensitive sorting & value filtering with operators ==, !=, contains, !contains
  const rows = useMemo(() => {
    let filtered = table.rows;

    table.columns.forEach((col) => {
      const colName = col.name;
      const colIdx = table.columns.findIndex((c) => c.name === colName);
      if (colIdx < 0) return;

      const selectedSet = selectedValueFilters[colName];
      const op = columnFilterOperators[colName] || "==";

      if (selectedSet && selectedSet.size > 0) {
        filtered = filtered.filter((row) => {
          const rawVal = row[colIdx];
          return evaluateFilterCondition(rawVal, selectedSet, op);
        });
      }
    });

    // Filter by search box
    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      filtered = filtered.filter((row) =>
        row.some((value) => String(value ?? "").toLowerCase().includes(normalizedSearch))
      );
    }

    if (!sortColumnName || !sortDirection) return filtered;

    const colIndex = table.columns.findIndex((c) => c.name === sortColumnName);
    if (colIndex < 0) return filtered;

    return [...filtered].sort((a, b) => {
      const valA = a[colIndex];
      const valB = b[colIndex];

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      // Numeric comparison
      if (typeof valA === "number" && typeof valB === "number") {
        return sortDirection === "asc" ? valA - valB : valB - valA;
      }

      // Date / ISO timestamp comparison
      const strA = String(valA);
      const strB = String(valB);
      const isIsoA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(strA);
      const isIsoB = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(strB);

      if (isIsoA && isIsoB) {
        const timeA = new Date(strA).getTime();
        const timeB = new Date(strB).getTime();
        if (!isNaN(timeA) && !isNaN(timeB)) {
          return sortDirection === "asc" ? timeA - timeB : timeB - timeA;
        }
      }

      // String locale comparison
      const comparison = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [search, selectedValueFilters, columnFilterOperators, sortColumnName, sortDirection, table.rows, table.columns]);

  const selectedColsList = useMemo(() => {
    return Array.from(summarySelectedColumns);
  }, [summarySelectedColumns]);

  // Summarized list / Multi-Column AND tuple grouping calculation
  const summarizedData = useMemo(() => {
    const sourceRows = summaryScope === "filtered" ? rows : table.rows;
    if (sourceRows.length === 0) return [];

    // Mode A: Single Column or All Columns independent (when 0 or 1 selected column)
    if (selectedColsList.length <= 1) {
      const targetCols = selectedColsList.length === 1
        ? table.columns.filter((c) => c.name === selectedColsList[0])
        : table.columns;

      const list: { valuesMap: Record<string, string>; count: number; primaryCol?: string; primaryVal?: string }[] = [];

      targetCols.forEach((col) => {
        const cIdx = table.columns.findIndex((c) => c.name === col.name);
        if (cIdx < 0) return;

        const countsMap = new Map<string, number>();
        sourceRows.forEach((row) => {
          const raw = row[cIdx];
          if (raw !== null && raw !== undefined && raw !== "") {
            const sVal = String(raw);
            countsMap.set(sVal, (countsMap.get(sVal) || 0) + 1);
          }
        });

        const sortedEntries = Array.from(countsMap.entries()).sort((a, b) => b[1] - a[1]);
        sortedEntries.forEach(([val, count]) => {
          const subValSet = summarySelectedSubValues[col.name];
          if (!subValSet || subValSet.size === 0 || subValSet.has(val)) {
            list.push({
              primaryCol: col.name,
              primaryVal: val,
              valuesMap: { [col.name]: val },
              count
            });
          }
        });
      });

      return list;
    }

    // Mode B: Multi-Column KQL Summarize Grouping (| summarize count() by col1, col2, ...)
    const colIndices = selectedColsList.map((colName) => ({
      name: colName,
      idx: table.columns.findIndex((c) => c.name === colName)
    })).filter((item) => item.idx >= 0);

    const tupleMap = new Map<string, { valuesMap: Record<string, string>; count: number; primaryCol?: string; primaryVal?: string }>();

    sourceRows.forEach((row) => {
      // 1. Check sub-value constraints for each selected column
      for (const { name, idx } of colIndices) {
        const rawVal = row[idx];
        const val = rawVal === null || rawVal === undefined ? "" : String(rawVal);
        const subSet = summarySelectedSubValues[name];
        if (subSet && subSet.size > 0 && !subSet.has(val)) {
          return;
        }
      }

      // 2. Build key and values map matching KQL summarize by
      const valuesMap: Record<string, string> = {};
      const keyParts: string[] = [];

      colIndices.forEach(({ name, idx }) => {
        const rawVal = row[idx];
        const val = rawVal === null || rawVal === undefined ? "" : String(rawVal);
        valuesMap[name] = val;
        keyParts.push(`${name}:::${val}`);
      });

      const key = keyParts.join("|||");
      const existing = tupleMap.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        tupleMap.set(key, { valuesMap, count: 1 });
      }
    });

    return Array.from(tupleMap.values()).sort((a, b) => b.count - a.count);
  }, [table.columns, table.rows, rows, summaryScope, selectedColsList, summarySelectedSubValues]);

  const sortedSummarizedData = useMemo(() => {
    if (!summarySortColumn || !summarySortDirection) return summarizedData;

    return [...summarizedData].sort((a, b) => {
      let valA: unknown;
      let valB: unknown;

      if (summarySortColumn === "Count" || summarySortColumn === "% Share") {
        valA = a.count;
        valB = b.count;
      } else if (summarySortColumn === "Column Name") {
        valA = a.primaryCol || "";
        valB = b.primaryCol || "";
      } else if (summarySortColumn === "Distinct Output Value") {
        valA = a.primaryVal || "";
        valB = b.primaryVal || "";
      } else {
        valA = a.valuesMap[summarySortColumn] || "";
        valB = b.valuesMap[summarySortColumn] || "";
      }

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      if (typeof valA === "number" && typeof valB === "number") {
        return summarySortDirection === "asc" ? (valA as number) - (valB as number) : (valB as number) - (valA as number);
      }

      const strA = String(valA);
      const strB = String(valB);
      const comparison = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: "base" });
      return summarySortDirection === "asc" ? comparison : -comparison;
    });
  }, [summarizedData, summarySortColumn, summarySortDirection]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice(page * pageSize, page * pageSize + pageSize);

  function toggleColumn(columnName: string) {
    setVisibleColumns((current) =>
      current.includes(columnName)
        ? current.filter((name) => name !== columnName)
        : [...current, columnName]
    );
  }

  function downloadCsv() {
    const orderedCols = table.columns
      .filter((c) => visibleColumns.includes(c.name))
      .sort((a, b) => orderedVisibleColumns.indexOf(a.name) - orderedVisibleColumns.indexOf(b.name));

    const csv = toCsv(orderedCols, rows, useLocalTime);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${table.name || "query-results"}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const colIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    table.columns.forEach((col, idx) => map.set(col.name, idx));
    return map;
  }, [table.columns]);

  return (
    <article className="table-section">
      <div className="panel-header" style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h2>{table.name || "Results"}</h2>
            <p>{rows.length} rows, {table.columns.length} columns</p>
          </div>

          {/* Output Value Filter Cascading Flyout Dropdown - Positioned near PrimaryResult title on the left */}
          <div ref={valueFilterRef} style={{ position: "relative" }}>
            <button
              type="button"
              className="icon-button"
              onClick={(e) => {
                e.stopPropagation();
                setIsValueFilterOpen(!isValueFilterOpen);
                setHoveredColumn(null);
                setFlyoutSearch("");
              }}
              style={{
                width: "auto",
                padding: "6px 12px",
                height: "36px",
                fontSize: "12px",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                background: activeValueFiltersCount > 0 ? "rgba(16, 185, 129, 0.25)" : "rgba(15, 23, 42, 0.6)",
                border: `1px solid ${activeValueFiltersCount > 0 ? "#10b981" : "rgba(16, 185, 129, 0.3)"}`,
                color: activeValueFiltersCount > 0 ? "#34d399" : "#94a3b8",
                borderRadius: "6px"
              }}
            >
              <Filter size={15} color="#10b981" />
              <span>Filter Values {activeValueFiltersCount > 0 ? `(${activeValueFiltersCount})` : ""}</span>
              <ChevronRight size={14} />
            </button>

            {isValueFilterOpen && (
              <div className="cascading-menu-container left-aligned" onClick={(e) => e.stopPropagation()}>
                {/* Level 1: Columns List */}
                <div className="cascading-menu-left">
                  <div className="cascading-menu-title">
                    <span>Columns</span>
                    {activeValueFiltersCount > 0 && (
                      <button
                        type="button"
                        className="clear-all-link"
                        onClick={() => setSelectedValueFilters({})}
                      >
                        Reset All
                      </button>
                    )}
                  </div>
                  <div className="cascading-column-list">
                    {table.columns.map((col) => {
                      const count = selectedValueFilters[col.name]?.size || 0;
                      const isHovered = hoveredColumn === col.name;

                      return (
                        <div
                          key={col.name}
                          className={`cascading-column-item ${isHovered ? "is-hovered" : ""} ${count > 0 ? "has-active" : ""}`}
                          onMouseEnter={() => {
                            setHoveredColumn(col.name);
                            setFlyoutSearch("");
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                            <span className="col-name" title={col.name}>{col.name}</span>
                            {count > 0 && <span className="active-badge">{count}</span>}
                          </div>
                          <ChevronRight size={14} className="arrow-icon" />
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Level 2: Sub-menu Flyout for Hovered Column Values */}
                {hoveredColumn && (
                  <div className="cascading-menu-right">
                    <div className="flyout-header" style={{ flexDirection: "column", gap: "8px", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                        <span className="flyout-title" title={hoveredColumn}>{hoveredColumn}</span>
                        <div className="flyout-actions">
                          <button
                            type="button"
                            onClick={() => {
                              const currentOp = columnFilterOperators[hoveredColumn] || "==";
                              const visibleValues = (uniqueColumnValues[hoveredColumn] || []).filter(
                                (val) => matchesValueOperator(val, currentOp, flyoutSearch)
                              );
                              setSelectedValueFilters((prev) => {
                                const nextSet = new Set(prev[hoveredColumn] || []);
                                visibleValues.forEach((v) => nextSet.add(v));
                                return { ...prev, [hoveredColumn]: nextSet };
                              });
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedValueFilters((prev) => ({
                                ...prev,
                                [hoveredColumn]: new Set()
                              }));
                            }}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      {/* Operator selector dropdown for Primary Result filter */}
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", width: "100%" }}>
                        <span style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>Operator:</span>
                        <select
                          value={columnFilterOperators[hoveredColumn] || "=="}
                          onChange={(e) => {
                            const newOp = e.target.value as FilterOperator;
                            setColumnFilterOperators((prev) => ({ ...prev, [hoveredColumn]: newOp }));
                          }}
                          style={{
                            background: "rgba(4, 20, 28, 0.95)",
                            border: "1px solid rgba(16, 185, 129, 0.4)",
                            borderRadius: "4px",
                            color: "#34d399",
                            fontSize: "11px",
                            fontWeight: 700,
                            padding: "3px 6px",
                            outline: "none",
                            cursor: "pointer",
                            flex: 1
                          }}
                        >
                          <option value="==">== (Equals)</option>
                          <option value="!=">!= (Not Equals)</option>
                          <option value="contains">contains (Contains)</option>
                          <option value="!contains">!contains (Does Not Contain)</option>
                          <option value="<">&lt; (Less Than)</option>
                          <option value="<=">&lt;= (Less Than or Equal To)</option>
                          <option value=">">&gt; (Greater Than)</option>
                          <option value=">=">&gt;= (Greater Than or Equal To)</option>
                        </select>
                      </div>
                    </div>

                    <div className="flyout-search">
                      <Search size={13} className="search-icon" />
                      <input
                        type="text"
                        placeholder={`Filter ${hoveredColumn} values...`}
                        value={flyoutSearch}
                        onChange={(e) => setFlyoutSearch(e.target.value)}
                      />
                      {flyoutSearch && (
                        <button
                          type="button"
                          className="clear-btn"
                          onClick={() => setFlyoutSearch("")}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flyout-values-list">
                      {(uniqueColumnValues[hoveredColumn] || [])
                        .filter((val) => {
                          const currentOp = columnFilterOperators[hoveredColumn] || "==";
                          return matchesValueOperator(val, currentOp, flyoutSearch);
                        })
                        .map((val) => {
                          const currentSet = selectedValueFilters[hoveredColumn] || new Set();
                          const isChecked = currentSet.has(val);

                          return (
                            <div
                              key={val}
                              className={`flyout-value-item ${isChecked ? "is-selected" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedValueFilters((prev) => {
                                  const nextSet = new Set(prev[hoveredColumn] || []);
                                  if (nextSet.has(val)) nextSet.delete(val);
                                  else nextSet.add(val);
                                  return { ...prev, [hoveredColumn]: nextSet };
                                });
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                              />
                              <span title={val}>{val}</span>
                            </div>
                          );
                        })}
                      {(uniqueColumnValues[hoveredColumn] || []).length === 0 && (
                        <div className="empty-flyout">No values found</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="toolbar" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "10px" }}>
          <label className="search">
            <Search size={15} />
            <input
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(0);
              }}
              placeholder="Search rows..."
            />
          </label>
          <button
            className="icon-button"
            onClick={() => setUseLocalTime(!useLocalTime)}
            title="Toggle timezone"
            style={{ width: "auto", padding: "6px 12px", height: "36px", fontSize: "12px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Clock size={15} />
            <span>{useLocalTime ? "Local Time" : "UTC Time"}</span>
          </button>
          <button
            className="icon-button"
            onClick={() => setGlobalWrapText(!globalWrapText)}
            title="Toggle single line vs wrapped text for all cells (or double-click vertical/horizontal grid lines)"
            style={{
              width: "auto",
              padding: "6px 12px",
              height: "36px",
              fontSize: "12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              background: globalWrapText ? "rgba(45, 212, 191, 0.25)" : "rgba(45, 212, 191, 0.12)",
              borderColor: globalWrapText ? "#2dd4bf" : "rgba(45, 212, 191, 0.22)",
              color: globalWrapText ? "#34d399" : "#f8fafc"
            }}
          >
            <SlidersHorizontal size={15} />
            <span>{globalWrapText ? "Wrapped Text" : "Single Line (No Wrap)"}</span>
          </button>
          <button 
            className="icon-button" 
            onClick={downloadCsv} 
            title="Download CSV"
            style={{ width: "auto", padding: "6px 12px", height: "36px", fontSize: "12px", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: "6px" }}
          >
            <Download size={15} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <details className="columns-control">
        <summary>
          <Columns3 size={16} />
          Columns ({visibleColumns.length} / {table.columns.length} visible)
        </summary>
        <div className="column-list">
          {table.columns.map((column) => (
            <label key={column.name}>
              <input
                type="checkbox"
                checked={visibleColumns.includes(column.name)}
                onChange={() => toggleColumn(column.name)}
              />
              <span>{column.name}</span>
            </label>
          ))}
        </div>
      </details>

      <div className="table-container-outer">
        <div
          ref={headerScrollRef}
          onScroll={syncHeaderScroll}
          className="table-header-wrap"
        >
          <table className="header-table">
            <thead>
              <tr>
                {orderedVisibleColumns.map((colName) => {
                  const width = columnWidths[colName] ?? getDefaultColumnWidth(colName);
                  const isSortActive = sortColumnName === colName;
                  return (
                    <th
                      key={colName}
                      draggable
                      onDragStart={(e) => handleDragStart(e, colName)}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleDrop(e, colName)}
                      className={`th-reorderable ${draggedColumn === colName ? "is-dragging" : ""}`}
                      title="Click & drag to reorder, or click to sort"
                      style={{
                        width: `${width}px`,
                        minWidth: `${width}px`,
                        maxWidth: `${width}px`,
                        cursor: draggedColumn === colName ? "grabbing" : "grab"
                      }}
                    >
                      <div className="th-container">
                        <button
                          type="button"
                          className="th-sort-btn"
                          onClick={() => handleSort(colName)}
                          title={`Click to sort by ${colName}`}
                        >
                          <span>{colName}</span>
                          {isSortActive ? (
                            <span className="sort-arrow">{sortDirection === "asc" ? " ▲" : " ▼"}</span>
                          ) : (
                            <span className="sort-arrow-idle"> ↕</span>
                          )}
                        </button>
                      </div>

                      <div
                        className="col-resize-handle"
                        onMouseDown={(e) => handleResizeStart(e, colName, width)}
                        onDoubleClick={(e) => {
                          e.stopPropagation();
                          toggleColumnWrap(colName);
                        }}
                        title="Drag to resize, or double-click vertical line to toggle text wrap for this column"
                      />
                    </th>
                  );
                })}
              </tr>
            </thead>
          </table>
        </div>

        <div
          ref={tableScrollRef}
          onScroll={syncTableScroll}
          className="table-body-wrap"
        >
          <table className="body-table">
            <tbody>
              {pageRows.length === 0 ? (
                <tr>
                  <td colSpan={Math.max(1, orderedVisibleColumns.length)}>No rows match the current view.</td>
                </tr>
              ) : (
                pageRows.map((row, rowIndex) => {
                  const isRowWrapped = wrappedRows.has(rowIndex);
                  return (
                    <tr
                      key={`${page}-${rowIndex}`}
                      className="table-row-item"
                      onDoubleClick={() => toggleRowWrap(rowIndex)}
                      title="Double-click row/horizontal line to toggle text wrap for this row"
                    >
                      {orderedVisibleColumns.map((colName) => {
                        const dataIdx = colIndexMap.get(colName);
                        const cellVal = dataIdx !== undefined ? row[dataIdx] : "";
                        const width = columnWidths[colName] ?? getDefaultColumnWidth(colName);
                        const isColWrapped = wrappedColumns.has(colName);
                        const isCellWrapped = globalWrapText || isColWrapped || isRowWrapped;
                        const formattedText = formatCell(cellVal, useLocalTime);

                        return (
                          <td
                            key={colName}
                            style={{
                              width: `${width}px`,
                              minWidth: `${width}px`,
                              maxWidth: `${width}px`
                            }}
                          >
                            <span
                              className={isCellWrapped ? "cell-content-wrap" : "cell-content-nowrap"}
                              title={formattedText}
                            >
                              {formattedText}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pager">
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0}>
            Previous
          </button>
          <span>Page {page + 1} of {pageCount} ({rows.length} rows)</span>
          <button
            onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
            disabled={page >= pageCount - 1}
          >
            Next
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <label htmlFor="rows-per-page-select" style={{ fontSize: "12px", fontWeight: 600, color: "#99f6e4" }}>
            Rows per page:
          </label>
          <select
            id="rows-per-page-select"
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            style={{
              background: "rgba(6, 32, 44, 0.9)",
              border: "1px solid rgba(45, 212, 191, 0.3)",
              borderRadius: "6px",
              padding: "4px 8px",
              color: "#f8fafc",
              fontSize: "12px",
              fontWeight: 600,
              outline: "none",
              cursor: "pointer"
            }}
          >
            <option value={25}>25</option>
            <option value={50}>50 (Default)</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>
      </div>

      {/* Bottom Summarized Telemetry Table */}
      <article className="table-section summary-telemetry-section" style={{ marginTop: "24px", paddingTop: "16px" }}>
        <div className="panel-header" style={{ alignItems: "center", marginBottom: "14px", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
            <div>
              <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#38bdf8", margin: 0, display: "flex", alignItems: "center", gap: "8px" }}>
                <BarChart3 size={18} color="#2dd4bf" />
                <span>Summarized Column Telemetry</span>
              </h3>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0 0" }}>
                {selectedColsList.length >= 2
                  ? `KQL Group By: | summarize count() by ${selectedColsList.join(", ")}`
                  : "Frequency count & percentage share per column value."}
              </p>
            </div>

            {/* Multi-Select Columns & Values Cascading Dropdown - Placed right next to title */}
            <div ref={summaryDropdownRef} style={{ position: "relative" }}>
              <button
                type="button"
                className="icon-button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isSummaryDropdownOpen) {
                    setDraftSummaryColumns(new Set(summarySelectedColumns));
                    setDraftSummarySubValues(summarySelectedSubValues);
                    setIsSummaryDropdownOpen(true);
                    setSummaryHoveredCol(null);
                  } else {
                    commitSummaryDraft();
                    setIsSummaryDropdownOpen(false);
                  }
                }}
                style={{
                  width: "auto",
                  padding: "6px 12px",
                  height: "34px",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  background: (isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0 ? "rgba(16, 185, 129, 0.25)" : "rgba(15, 23, 42, 0.6)",
                  border: `1px solid ${(isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0 ? "#10b981" : "rgba(16, 185, 129, 0.3)"}`,
                  color: (isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0 ? "#34d399" : "#94a3b8",
                  borderRadius: "6px"
                }}
              >
                <SlidersHorizontal size={14} color="#10b981" />
                <span>
                  Filter Columns & Values{" "}
                  {(isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size) > 0
                    ? `(${isSummaryDropdownOpen ? draftSummaryColumns.size : summarySelectedColumns.size})`
                    : "(All)"}
                </span>
                {isSummaryDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isSummaryDropdownOpen && (
                <div
                  className="cascading-menu-container left-aligned"
                  onClick={(e) => e.stopPropagation()}
                  onMouseLeave={() => commitSummaryDraft()}
                >
                  {/* Level 1: Columns List */}
                  <div className="cascading-menu-left">
                    <div className="cascading-menu-title">
                      <span>Columns ({table.columns.length})</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="clear-all-link"
                          onClick={() => {
                            setDraftSummaryColumns(new Set(table.columns.map((c) => c.name)));
                          }}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="clear-all-link"
                          onClick={() => {
                            setDraftSummaryColumns(new Set());
                            setDraftSummarySubValues({});
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="cascading-column-list">
                      {table.columns.map((col) => {
                        const isColChecked = draftSummaryColumns.has(col.name);
                        const subCount = draftSummarySubValues[col.name]?.size || 0;
                        const isHovered = summaryHoveredCol === col.name;

                        return (
                          <div
                            key={col.name}
                            className={`cascading-column-item ${isHovered ? "is-hovered" : ""} ${isColChecked ? "has-active" : ""}`}
                            onMouseEnter={() => setSummaryHoveredCol(col.name)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setDraftSummaryColumns((prev) => {
                                const next = new Set(prev);
                                if (next.has(col.name)) {
                                  next.delete(col.name);
                                  setDraftSummarySubValues((subPrev) => ({ ...subPrev, [col.name]: new Set() }));
                                } else {
                                  next.add(col.name);
                                }
                                return next;
                              });
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", overflow: "hidden" }}>
                              <input
                                type="checkbox"
                                checked={isColChecked}
                                onChange={() => {}}
                              />
                              <span className="col-name" title={col.name}>{col.name}</span>
                              {subCount > 0 && <span className="active-badge">{subCount}</span>}
                            </div>
                            <ChevronRight size={14} className="arrow-icon" />
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Level 2: Sub-values Flyout */}
                  {summaryHoveredCol && (
                    <div className="cascading-menu-right">
                      <div className="flyout-header">
                        <span className="flyout-title" title={summaryHoveredCol}>{summaryHoveredCol}</span>
                        <div className="flyout-actions">
                          <button
                            type="button"
                            onClick={() => {
                              const values = uniqueColumnValues[summaryHoveredCol] || [];
                              setDraftSummarySubValues((prev) => ({
                                ...prev,
                                [summaryHoveredCol]: new Set(values)
                              }));
                              if (values.length > 0) {
                                setDraftSummaryColumns((prev) => new Set(prev).add(summaryHoveredCol));
                              }
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDraftSummarySubValues((prev) => ({
                                ...prev,
                                [summaryHoveredCol]: new Set()
                              }));
                              setDraftSummaryColumns((prev) => {
                                const next = new Set(prev);
                                next.delete(summaryHoveredCol);
                                return next;
                              });
                            }}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      <div className="flyout-values-list">
                        {(uniqueColumnValues[summaryHoveredCol] || []).map((val) => {
                          const currentSet = draftSummarySubValues[summaryHoveredCol] || new Set();
                          const isChecked = currentSet.has(val);

                          return (
                            <div
                              key={val}
                              className={`flyout-value-item ${isChecked ? "is-selected" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                const nextSet = new Set(draftSummarySubValues[summaryHoveredCol] || []);
                                if (nextSet.has(val)) nextSet.delete(val);
                                else nextSet.add(val);

                                setDraftSummarySubValues((prev) => ({
                                  ...prev,
                                  [summaryHoveredCol]: nextSet
                                }));

                                setDraftSummaryColumns((prev) => {
                                  const nextCols = new Set(prev);
                                  if (nextSet.size > 0) {
                                    nextCols.add(summaryHoveredCol);
                                  } else {
                                    nextCols.delete(summaryHoveredCol);
                                  }
                                  return nextCols;
                                });
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {}}
                              />
                              <span title={val}>{val}</span>
                            </div>
                          );
                        })}
                        {(uniqueColumnValues[summaryHoveredCol] || []).length === 0 && (
                          <div className="empty-flyout">No distinct values</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginLeft: "auto" }}>
            {/* View Scope Toggle */}
            <div style={{ display: "inline-flex", background: "rgba(4, 20, 28, 0.8)", border: "1px solid rgba(45, 212, 191, 0.3)", borderRadius: "6px", padding: "2px" }}>
              <button
                type="button"
                onClick={() => setSummaryScope("filtered")}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "4px",
                  border: "none",
                  background: summaryScope === "filtered" ? "#10b981" : "transparent",
                  color: summaryScope === "filtered" ? "#04141c" : "#94a3b8",
                  cursor: "pointer"
                }}
                title="Summarize frequencies based on active filtered rows"
              >
                Filtered ({rows.length})
              </button>
              <button
                type="button"
                onClick={() => setSummaryScope("all")}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "4px",
                  border: "none",
                  background: summaryScope === "all" ? "#10b981" : "transparent",
                  color: summaryScope === "all" ? "#04141c" : "#94a3b8",
                  cursor: "pointer"
                }}
                title="Summarize frequencies based on total un-filtered rows"
              >
                All Rows ({table.rows.length})
              </button>
            </div>
          </div>
        </div>

        {/* Active Multi-Column Filters Bar */}
        {activeValueFiltersCount > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "14px", padding: "8px 12px", background: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16, 185, 129, 0.3)", borderRadius: "8px" }}>
            <span style={{ fontSize: "12px", color: "#34d399", fontWeight: 700, display: "flex", alignItems: "center", gap: "6px" }}>
              <Filter size={14} /> Active Primary Filters ({activeValueFiltersCount}):
            </span>
            {Object.entries(selectedValueFilters).map(([colName, set]) => {
              if (!set || set.size === 0) return null;
              const op = columnFilterOperators[colName] || "==";
              return Array.from(set).map((val) => (
                <span
                  key={`${colName}-${val}`}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "rgba(6, 32, 44, 0.9)",
                    border: "1px solid rgba(45, 212, 191, 0.4)",
                    borderRadius: "6px",
                    padding: "3px 8px",
                    fontSize: "11px",
                    color: "#f8fafc"
                  }}
                >
                  <strong style={{ color: "#38bdf8" }}>{colName}</strong>
                  <span style={{ color: "#34d399", fontWeight: 700 }}>{op}</span>
                  <span style={{ fontFamily: "monospace", color: "#a7f3d0" }}>"{val}"</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedValueFilters((prev) => {
                        const nextSet = new Set(prev[colName]);
                        nextSet.delete(val);
                        return { ...prev, [colName]: nextSet };
                      });
                    }}
                    style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "11px", padding: 0 }}
                    title="Remove filter condition"
                  >
                    ✕
                  </button>
                </span>
              ));
            })}
            <button
              type="button"
              onClick={() => {
                setSelectedValueFilters({});
              }}
              style={{
                background: "rgba(244, 63, 94, 0.2)",
                border: "1px solid rgba(244, 63, 94, 0.4)",
                color: "#fecdd3",
                fontSize: "11px",
                fontWeight: 600,
                padding: "3px 8px",
                borderRadius: "6px",
                cursor: "pointer",
                marginLeft: "auto"
              }}
            >
              Clear All Filters
            </button>
          </div>
        )}

        <div className="table-wrap" style={{ maxHeight: "380px", overflowY: "auto", overflowX: "hidden" }}>
          <table style={{ width: "100%", tableLayout: "fixed" }}>
            <thead>
              <tr>
                {selectedColsList.length >= 2 ? (
                  selectedColsList.map((colName) => (
                    <th
                      key={colName}
                      onClick={() => handleSummaryHeaderClick(colName)}
                      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
                      title={`Click to sort by ${colName}`}
                    >
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>{colName}</span>
                        {summarySortColumn === colName && (
                          summarySortDirection === "asc" ? <ArrowUp size={13} color="#34d399" /> : <ArrowDown size={13} color="#34d399" />
                        )}
                      </div>
                    </th>
                  ))
                ) : (
                  <>
                    <th
                      onClick={() => handleSummaryHeaderClick("Column Name")}
                      style={{ width: "22%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}
                      title="Click to sort by Column Name"
                    >
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>Column Name</span>
                        {summarySortColumn === "Column Name" && (
                          summarySortDirection === "asc" ? <ArrowUp size={13} color="#34d399" /> : <ArrowDown size={13} color="#34d399" />
                        )}
                      </div>
                    </th>
                    <th
                      onClick={() => handleSummaryHeaderClick("Distinct Output Value")}
                      style={{ width: "53%", cursor: "pointer", userSelect: "none" }}
                      title="Click to sort by Distinct Output Value"
                    >
                      <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                        <span>Distinct Output Value</span>
                        {summarySortColumn === "Distinct Output Value" && (
                          summarySortDirection === "asc" ? <ArrowUp size={13} color="#34d399" /> : <ArrowDown size={13} color="#34d399" />
                        )}
                      </div>
                    </th>
                  </>
                )}
                <th
                  onClick={() => handleSummaryHeaderClick("Count")}
                  style={{ width: "110px", textAlign: "right", cursor: "pointer", userSelect: "none" }}
                  title="Click to sort by Count"
                >
                  <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", width: "100%", gap: "4px" }}>
                    <span>Count</span>
                    {summarySortColumn === "Count" && (
                      summarySortDirection === "asc" ? <ArrowUp size={13} color="#34d399" /> : <ArrowDown size={13} color="#34d399" />
                    )}
                  </div>
                </th>
                <th
                  onClick={() => handleSummaryHeaderClick("% Share")}
                  style={{ width: "140px", cursor: "pointer", userSelect: "none" }}
                  title="Click to sort by % Share"
                >
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                    <span>% Share</span>
                    {summarySortColumn === "% Share" && (
                      summarySortDirection === "asc" ? <ArrowUp size={13} color="#34d399" /> : <ArrowDown size={13} color="#34d399" />
                    )}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedSummarizedData.length === 0 ? (
                <tr>
                  <td colSpan={selectedColsList.length >= 2 ? selectedColsList.length + 2 : 4} style={{ textAlign: "center", color: "#64748b", padding: "20px" }}>
                    No summarized data matches selection.
                  </td>
                </tr>
              ) : (
                sortedSummarizedData.map((item, idx) => {
                  const totalRefRows = summaryScope === "filtered" ? rows.length : table.rows.length;
                  const pct = totalRefRows > 0 ? ((item.count / totalRefRows) * 100).toFixed(1) : "0.0";

                  return (
                    <tr key={idx}>
                      {selectedColsList.length >= 2 ? (
                        selectedColsList.map((colName) => (
                          <td key={colName} style={{ wordBreak: "break-all", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            <span style={{ fontFamily: "monospace", color: "#f8fafc", fontSize: "12px", wordBreak: "break-all", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                              {item.valuesMap[colName] || ""}
                            </span>
                          </td>
                        ))
                      ) : (
                        <>
                          <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            <span style={{ fontWeight: 600, color: "#38bdf8", fontSize: "12px" }}>{item.primaryCol}</span>
                          </td>
                          <td style={{ wordBreak: "break-all", whiteSpace: "normal", overflowWrap: "anywhere" }}>
                            <span style={{ fontFamily: "monospace", color: "#f8fafc", fontSize: "12px", wordBreak: "break-all", whiteSpace: "normal", overflowWrap: "anywhere" }} title={item.primaryVal}>
                              {item.primaryVal}
                            </span>
                          </td>
                        </>
                      )}
                      <td style={{ textAlign: "right", fontWeight: 700, color: "#34d399" }}>
                        {item.count.toLocaleString()}
                      </td>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ flex: 1, height: "6px", background: "rgba(255,255,255,0.08)", borderRadius: "3px", overflow: "hidden" }}>
                            <div style={{ width: `${pct}%`, height: "100%", background: "linear-gradient(90deg, #2dd4bf, #38bdf8)", borderRadius: "3px" }} />
                          </div>
                          <span style={{ fontSize: "11px", color: "#94a3b8", width: "42px", textAlign: "right" }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </article>
    </article>
  );
}

function formatCell(value: unknown, useLocalTime: boolean = true): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value).trim();
  
  // Check if string looks like an ISO date/timestamp (e.g., 2026-07-16T02:18:57Z or with milliseconds/offsets)
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/i.test(str)) {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      if (useLocalTime) {
        return d.toLocaleString();
      } else {
        return d.toLocaleString(undefined, { timeZone: "UTC" });
      }
    }
  }
  return str;
}

function toCsv(columns: QueryTable["columns"], rows: unknown[][], useLocalTime: boolean): string {
  const header = columns.map((column) => csvEscape(column.name)).join(",");
  const body = rows
    .map((row) => row.map((cell) => csvEscape(formatCell(cell, useLocalTime))).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

function csvEscape(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
