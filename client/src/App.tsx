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
  ArrowDown
} from "lucide-react";
import { runQuery, fetchUserWorkspaces, checkBackendHealth, type AzureWorkspace, type BackendHealthResponse } from "./api";
import type { QueryResponse, QueryTable } from "./types";
import { Chatbot } from "./Chatbot";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest } from "./authConfig";

const starterQuery = `AppRequests
| where TimeGenerated > ago(24h) and Success == false
| summarize Failures=count() by Name, ResultCode
| order by Failures desc`;

type PresetOption = { label: string; clause: string };

type PresetQuery = {
  id: string;
  name: string;
  baseQuery: string;
  options: PresetOption[];
  projectColumns: string[];
  dynamicFilters?: { label: string; field: string; clauseTemplate: (val: string) => string }[];
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
      { label: "timeTaken_d", clause: '| where timeTaken_d > ""' },
      { label: "clientCountry_s", clause: '| where clientCountry_s == ""' },
    ],
    projectColumns: ["TimeGenerated", "Resource", "hostName_s", "httpStatusDetails_s", "requestUri_s", "clientIp_s", "socketIp_s", "originName_s", "ErrorInfo_s", "originUrl_s", "routingRuleName_s", "timeTaken_d", "clientCountry_s"],
    dynamicFilters: [
      { label: "AFD Resource Name", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` },
      { label: "DNS Name (hostName_s)", field: "hostName_s", clauseTemplate: (val: string) => `| where hostName_s == "${val}"` }
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
      { label: "AFD Resource Name", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` },
      { label: "DNS Name (host_s)", field: "host_s", clauseTemplate: (val: string) => `| where host_s == "${val}"` }
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
      { label: "Firewall Resource Name", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` }
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
      { label: "Firewall Resource Name", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` }
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
      { label: "App Gateway Resource Name", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` },
      { label: "Original Host (originalHost_s)", field: "originalHost_s", clauseTemplate: (val: string) => `| where originalHost_s == "${val}"` }
    ]
  },
  {
    id: "storage-file",
    name: "Storage Fileshare Log",
    baseQuery: 'StorageFileLogs\n| extend FileShareName = case(Uri startswith "https://", extract(@"https://[^/]+/([^/?]+)", 1, Uri), Uri startswith "\\\\", extract(@"\\\\\\\\[^\\\\]+\\\\\\([^\\\\]+)", 1, Uri), "Unknown")\n| extend IPOnly = tostring(split(CallerIpAddress, ":")[0])\n| where (CallerIpAddress !contains "10.200" and FileShareName contains "raefordqa" and MetricResponseType !contains "Success") or (MetricResponseType contains "Success" and Uri contains "DHL-LMS" and MetricResponseType !contains "ClientOtherError")',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "AccountName", clause: '| where AccountName == ""' },
      { label: "FileShareName", clause: '| where FileShareName contains ""' },
      { label: "Uri", clause: '| where Uri contains ""' },
      { label: "CallerIpAddress", clause: '| where CallerIpAddress == ""' },
      { label: "IPOnly", clause: '| where IPOnly == ""' },
      { label: "ObjectKey", clause: '| where ObjectKey == ""' },
      { label: "Category", clause: '| where Category == ""' },
      { label: "MetricResponseType", clause: '| where MetricResponseType == ""' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "SmbCommandMinor", clause: '| where SmbCommandMinor == ""' }
    ],
    projectColumns: ["TimeGenerated", "AccountName", "FileShareName", "Uri", "CallerIpAddress", "IPOnly", "ObjectKey", "Category", "MetricResponseType", "OperationName", "SmbCommandMinor"],
    dynamicFilters: [
      { label: "Storage Account Name", field: "AccountName", clauseTemplate: (val: string) => `| where AccountName == "${val}"` },
      { label: "File Share Name", field: "FileShareName", clauseTemplate: (val: string) => `| where FileShareName == "${val}"` }
    ]
  },
  {
    id: "storage-blob",
    name: "Storage Blob Log",
    baseQuery: 'StorageBlobLogs\n| extend ContainerName = case(Uri startswith "https://", extract(@"https://[^/]+(:443)?/([^/?]+)", 2, Uri), Uri startswith "\\\\", extract(@"\\\\\\\\[^\\\\]+\\\\\\([^\\\\]+)", 1, Uri), "Unknown")\n| where CallerIpAddress !contains "10.50" and CallerIpAddress !contains "10.200"\n| where ObjectKey contains "Demand"\n| extend CallerIp = tostring(split(CallerIpAddress, ":")[0]), CallerPort = tostring(split(CallerIpAddress, ":")[1])',
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
      { label: "Storage Account Name", field: "AccountName", clauseTemplate: (val: string) => `| where AccountName == "${val}"` },
      { label: "Container Name", field: "ContainerName", clauseTemplate: (val: string) => `| where ContainerName == "${val}"` }
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
      { label: "Namespace", field: "Namespace", clauseTemplate: (val: string) => `| where Namespace == "${val}"` },
      { label: "Object Kind", field: "ObjectKind", clauseTemplate: (val: string) => `| where ObjectKind == "${val}"` }
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
      { label: "Delivery Status", field: "DeliveryStatus", clauseTemplate: (val: string) => `| where DeliveryStatus == "${val}"` },
      { label: "Sender Username", field: "SenderUsername", clauseTemplate: (val: string) => `| where SenderUsername == "${val}"` }
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
      { label: "Key Vault Resource", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` },
      { label: "Operation Name", field: "OperationName", clauseTemplate: (val: string) => `| where OperationName == "${val}"` }
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
      { label: "Host (CsHost)", field: "CsHost", clauseTemplate: (val: string) => `| where CsHost == "${val}"` },
      { label: "HTTP Method (CsMethod)", field: "CsMethod", clauseTemplate: (val: string) => `| where CsMethod == "${val}"` }
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
      { label: "Automation Account Resource", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` },
      { label: "Runbook Name (RunbookName_s)", field: "RunbookName_s", clauseTemplate: (val: string) => `| where RunbookName_s == "${val}"` }
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
      { label: "User Name (UserName)", field: "UserName", clauseTemplate: (val: string) => `| where UserName == "${val}"` },
      { label: "State", field: "State", clauseTemplate: (val: string) => `| where State == "${val}"` }
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
      { label: "Data Type", field: "DataType", clauseTemplate: (val: string) => `| where DataType == "${val}"` }
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
      { label: "Resource Group Name", field: "ResourceGroup", clauseTemplate: (val: string) => `| where ResourceGroup == "${val}"` },
      { label: "NSG Resource Name", field: "Resource", clauseTemplate: (val: string) => `| where Resource == "${val}"` }
    ]
  },
  {
    id: "sms-incoming-operations",
    name: "SMS Incoming Operations",
    baseQuery: 'ACSSMSIncomingOperations\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "PhoneNumber", clause: '| where PhoneNumber contains ""' },
      { label: "ResultType", clause: '| where ResultType == ""' },
      { label: "CallerIpAddress", clause: '| where CallerIpAddress == ""' },
      { label: "Country", clause: '| where Country == ""' },
      { label: "CorrelationId", clause: '| where CorrelationId == ""' },
      { label: "SdkType", clause: '| where SdkType == ""' },
      { label: "PlatformType", clause: '| where PlatformType == ""' },
      { label: "Method", clause: '| where Method == ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "OperationName",
      "CorrelationId",
      "ResultType",
      "ResultSignature",
      "ResultDescription",
      "CallerIpAddress",
      "URI",
      "PhoneNumber",
      "SdkType",
      "PlatformType",
      "Method",
      "Country"
    ],
    dynamicFilters: [
      { label: "Operation Name", field: "OperationName", clauseTemplate: (val: string) => `| where OperationName == "${val}"` },
      { label: "Phone Number", field: "PhoneNumber", clauseTemplate: (val: string) => `| where PhoneNumber == "${val}"` }
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
  const envWorkspaces = import.meta.env.VITE_WORKSPACES || "";
  const list: AzureWorkspace[] = [];
  
  if (envWorkspaces.trim()) {
    envWorkspaces.split(",").forEach((entry: string) => {
      const parts = entry.split(":");
      if (parts.length >= 2) {
        const name = parts[0].trim();
        const customerId = parts.slice(1).join(":").trim();
        if (name && customerId) {
          list.push({ id: customerId, name, customerId });
        }
      } else if (entry.trim()) {
        const val = entry.trim();
        list.push({ id: val, name: `Predefined (${val.substring(0, 8)}...)`, customerId: val });
      }
    });
  }

  const defaultWs = import.meta.env.VITE_LOG_ANALYTICS_WORKSPACE_ID;
  if (defaultWs && defaultWs.trim() && !list.some(w => w.customerId === defaultWs.trim())) {
    list.unshift({
      id: defaultWs.trim(),
      name: "Default Workspace (.env)",
      customerId: defaultWs.trim()
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
    }
  });

  return Array.from(map.values());
}

export function App() {
  const [query, setQuery] = useState(starterQuery);
  const [timespan, setTimespan] = useState("PT24H");
  const [maxRows, setMaxRows] = useState<number>(1000);

  const sortedPresets = useMemo(() => {
    return [...PRESETS].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, []);
  const [workspaceId, setWorkspaceId] = useState(() => {
    const initial = getPredefinedWorkspaces();
    return initial.length > 0 ? initial[0].customerId : "";
  });
  const [result, setResult] = useState<QueryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<PresetQuery | null>(null);
  const [presetOptions, setPresetOptions] = useState<Set<string>>(new Set());
  const [presetProjectColumns, setPresetProjectColumns] = useState<Set<string>>(new Set());
  const [dynamicFilterValues, setDynamicFilterValues] = useState<Record<string, string[]>>({});
  const [selectedDynamicFilters, setSelectedDynamicFilters] = useState<Record<string, string>>({});
  const [filterSearch, setFilterSearch] = useState<Record<string, string>>({});
  const [optionOperators, setOptionOperators] = useState<Record<string, string>>({});
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const [hoveredCondition, setHoveredCondition] = useState<PresetOption | null>(null);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"conditions" | "columns" | null>(null);
  const [dropdownSearch, setDropdownSearch] = useState("");
  const [isQueryEditorCollapsed, setIsQueryEditorCollapsed] = useState(false);
  const [healthStatus, setHealthStatus] = useState<BackendHealthResponse | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const dropdownContainerRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function togglePresetOption(opt: PresetOption) {
    setPresetOptions((current) => {
      const next = new Set(current);
      if (next.has(opt.label) || next.has(opt.clause)) {
        next.delete(opt.label);
        next.delete(opt.clause);
      } else {
        next.add(opt.label);
        next.add(opt.clause);
      }
      setQuery(generateQuery(activePreset!, next, presetProjectColumns, selectedDynamicFilters, optionOperators, optionValues));
      return next;
    });
  }

  function selectAllPresetOptions() {
    if (!activePreset) return;
    const allClauses = new Set(activePreset.options.map(o => o.clause));
    setPresetOptions(allClauses);
    setQuery(generateQuery(activePreset, allClauses, presetProjectColumns, selectedDynamicFilters));
  }

  function clearAllPresetOptions() {
    if (!activePreset) return;
    const empty = new Set<string>();
    setPresetOptions(empty);
    setQuery(generateQuery(activePreset, empty, presetProjectColumns, selectedDynamicFilters));
  }

  function selectAllProjectColumns() {
    if (!activePreset) return;
    const allCols = new Set(activePreset.projectColumns);
    setPresetProjectColumns(allCols);
    setQuery(generateQuery(activePreset, presetOptions, allCols, selectedDynamicFilters));
  }

  function clearAllProjectColumns() {
    if (!activePreset) return;
    const empty = new Set<string>();
    setPresetProjectColumns(empty);
    setQuery(generateQuery(activePreset, presetOptions, empty, selectedDynamicFilters));
  }

  const { instance, accounts } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [workspaces, setWorkspaces] = useState<AzureWorkspace[]>(() => getPredefinedWorkspaces());
  const [fetchingWorkspaces, setFetchingWorkspaces] = useState(false);
  const [isCustomInputMode, setIsCustomInputMode] = useState(false);

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
    if (isAuthenticated && accounts.length > 0) {
      loadWorkspaces();
    }
  }, [isAuthenticated, accounts]);

  function handleLogin() {
    instance.loginPopup(loginRequest).then(() => loadWorkspaces()).catch(e => console.error(e));
  }

  function handleLogout() {
    instance.logoutPopup().catch(e => console.error(e));
  }

  const clientIdConfigured = Boolean(
    import.meta.env.VITE_AZURE_CLIENT_ID &&
    !import.meta.env.VITE_AZURE_CLIENT_ID.includes("your_")
  );

  const authRequired = import.meta.env.VITE_REQUIRE_AZURE_AD_AUTH !== "false";

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

  function buildOptionClause(opt: PresetOption, customOp?: string, customVal?: string): string {
    let defaultValMatch = opt.clause.match(/"([^"]*)"/)?.[1];
    if (opt.clause.includes("between")) {
      const betweenMatch = opt.clause.match(/between\s*\(([^)]+)\)/i);
      if (betweenMatch) {
        defaultValMatch = betweenMatch[1];
      }
    }

    const defaultOp = opt.clause.includes("!contains")
      ? "!contains"
      : opt.clause.includes("contains")
      ? "contains"
      : opt.clause.includes("between")
      ? "between"
      : opt.clause.includes("!=")
      ? "!="
      : "==";

    const fieldMatch = opt.clause.match(/\|\s*where\s+([^\s=!<]+)/i);
    const field = fieldMatch ? fieldMatch[1] : opt.label;

    const op = customOp || defaultOp;
    const val = customVal !== undefined ? customVal : (defaultValMatch ?? "");

    if (op === "between") {
      const cleanedVal = val.replace(/^\(|\)$/g, "").trim();
      return `| where ${field} between (${cleanedVal || "400 .. 599"})`;
    }
    if (op === "!contains") {
      return `| where ${field} !contains "${val}"`;
    }
    if (op === "contains") {
      return `| where ${field} contains "${val}"`;
    }
    return `| where ${field} ${op} "${val}"`;
  }

  function handleOptionOperatorChange(opt: PresetOption, newOp: string) {
    const updatedOps = { ...optionOperators, [opt.label]: newOp };
    setOptionOperators(updatedOps);
    const updatedOptions = new Set(presetOptions);
    updatedOptions.add(opt.label);
    updatedOptions.add(opt.clause);
    setPresetOptions(updatedOptions);
    setQuery(generateQuery(activePreset!, updatedOptions, presetProjectColumns, selectedDynamicFilters, updatedOps, optionValues));
  }

  function handleOptionValueChange(opt: PresetOption, newVal: string) {
    const updatedVals = { ...optionValues, [opt.label]: newVal };
    setOptionValues(updatedVals);
    const updatedOptions = new Set(presetOptions);
    updatedOptions.add(opt.label);
    updatedOptions.add(opt.clause);
    setPresetOptions(updatedOptions);
    setQuery(generateQuery(activePreset!, updatedOptions, presetProjectColumns, selectedDynamicFilters, optionOperators, updatedVals));
  }

  function generateQuery(
    preset: PresetQuery,
    conditionOptions: Set<string>,
    projectCols: Set<string>,
    dynamicVals: Record<string, string>,
    ops: Record<string, string> = optionOperators,
    vals: Record<string, string> = optionValues
  ) {
    const activeProject = preset.projectColumns.filter((c) => projectCols.has(c));
    const projectLine = activeProject.length > 0 ? `| project ${activeProject.join(", ")}` : "";

    const dynamicClauses =
      preset.dynamicFilters
        ?.map((f) => (dynamicVals[f.field] ? f.clauseTemplate(dynamicVals[f.field]) : null))
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
    currentSelectedFilters: Record<string, string> = selectedDynamicFilters
  ) {
    if (!preset.dynamicFilters || preset.dynamicFilters.length === 0) return;
    
    const targetWs = (targetWorkspaceId || workspaceId).trim();
    const isPlaceholderGuid = /^(11111111|22222222|33333333|44444444|00000000|your_)/i.test(targetWs);
    if (!targetWs || isPlaceholderGuid) {
      console.warn("Skipping dynamic filter fetch: workspace ID is empty or set to dummy placeholder.");
      return;
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
        console.warn("Could not acquire token for dynamic filters", err);
      }
    }

    // Clean base query by removing post-aggregation operations (summarize, order, project, render)
    const cleanBase = preset.baseQuery
      .split(/\n\|\s*(summarize|order|project|render)\b/i)[0]
      .trim();

    for (let i = 0; i < preset.dynamicFilters.length; i++) {
      const filter = preset.dynamicFilters[i];
      try {
        let q = `${cleanBase}\n| where TimeGenerated > ago(24h)`;

        // Append clauses for any preceding filters that have a selection (e.g. Resource / AccountName filter first)
        for (let j = 0; j < i; j++) {
          const prevFilter = preset.dynamicFilters[j];
          const selectedVal = currentSelectedFilters[prevFilter.field];
          if (selectedVal) {
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
            if (selectedVal) {
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
    setFilterSearch({});
    setQuery(generateQuery(preset, new Set(), initialProjects, {}, {}, {}));
    fetchDynamicFilters(preset, workspaceId, {});
  }

  function handleWorkspaceSelect(newWsId: string) {
    setWorkspaceId(newWsId);
    if (activePreset) {
      fetchDynamicFilters(activePreset, newWsId, {});
    }
  }

  function handleDynamicFilterChange(field: string, value: string) {
    const nextFilters = { ...selectedDynamicFilters, [field]: value };
    setSelectedDynamicFilters(nextFilters);
    if (activePreset) {
      setQuery(generateQuery(activePreset, presetOptions, presetProjectColumns, nextFilters));
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }



  function toggleProjectColumn(column: string) {
    const next = new Set(presetProjectColumns);
    if (next.has(column)) next.delete(column);
    else next.add(column);
    setPresetProjectColumns(next);

    if (activePreset) {
      setQuery(generateQuery(activePreset, presetOptions, next, selectedDynamicFilters));
    }
  }

  async function handleRun() {
    setError(null);
    setLoading(true);
    setIsQueryEditorCollapsed(true);
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

      const response = await runQuery({
        query,
        timespan: finalTimespan,
        workspaceId: workspaceId.trim() || undefined,
        filters: [],
        maxRows,
        token
      });
      setResult(response);
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
        <div className="query-panel">
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <h2 style={{ color: "#38bdf8" }}>KQL Query</h2>
              <button
                type="button"
                className="icon-button"
                onClick={() => setIsQueryEditorCollapsed(!isQueryEditorCollapsed)}
                title={isQueryEditorCollapsed ? "Expand Query Editor" : "Minimize Query Editor"}
                style={{
                  width: "max-content",
                  minWidth: "max-content",
                  padding: "5px 14px",
                  height: "32px",
                  fontSize: "12px",
                  fontWeight: 600,
                  background: "rgba(45, 212, 191, 0.14)",
                  border: "1px solid rgba(45, 212, 191, 0.35)",
                  color: "#34d399",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  whiteSpace: "nowrap"
                }}
              >
                {isQueryEditorCollapsed ? (
                  <>
                    <ChevronDown size={14} />
                    <span>Expand Editor</span>
                  </>
                ) : (
                  <>
                    <ChevronUp size={14} />
                    <span>Minimize Editor</span>
                  </>
                )}
              </button>
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
                  onChange={(e) => setMaxRows(Number(e.target.value))}
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
              <button className="primary-button" onClick={handleRun} disabled={loading} style={{ alignSelf: "flex-start" }}>
                <Play size={17} />
                <span>{loading ? "Running" : "Run"}</span>
              </button>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", alignItems: "flex-start", marginBottom: "16px" }}>
            <div className="dynamic-filter-card" style={{ flex: "1 1 320px", maxWidth: "440px" }}>
              <div className="dynamic-filter-header">
                <span className="dynamic-filter-label" style={{ color: "#38bdf8" }}>🏢 Log Analytics Workspace</span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <span className="filter-count">
                    {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
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

              <div className="dynamic-filter-inputs">
                {isCustomInputMode ? (
                  <input
                    className="filter-search-field"
                    style={{ paddingLeft: "10px !important", height: "32px !important" }}
                    value={workspaceId}
                    onChange={(event) => handleWorkspaceSelect(event.target.value)}
                    placeholder="Enter or paste Workspace ID GUID..."
                  />
                ) : (
                  <select 
                    value={workspaceId}
                    onChange={(e) => {
                      if (e.target.value === "__MANUAL__") {
                        setIsCustomInputMode(true);
                      } else {
                        handleWorkspaceSelect(e.target.value);
                      }
                    }}
                    className="dynamic-filter-select"
                  >
                    <option value="">-- Select a Workspace ({workspaces.length}) --</option>
                    {workspaces.map((ws) => (
                      <option key={ws.customerId} value={ws.customerId}>
                        {ws.name} ({ws.customerId})
                      </option>
                    ))}
                    <option value="__MANUAL__">✏️ Enter Custom Workspace ID Manually...</option>
                  </select>
                )}
              </div>

              {workspaces.length === 0 && !fetchingWorkspaces && (
                <p style={{ color: "#94a3b8", fontSize: "11px", margin: "6px 0 0 0" }}>
                  Configure <code>VITE_WORKSPACES=Name:GUID</code> in <code>.env</code> or click "Manual" to enter a workspace ID directly.
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
                <select
                  value={activePreset?.id || ""}
                  onChange={(e) => {
                    const found = PRESETS.find((p) => p.id === e.target.value);
                    if (found) applyPreset(found);
                  }}
                  className="dynamic-filter-select"
                >
                  <option value="">-- Select a Log Preset ({sortedPresets.length}) --</option>
                  {sortedPresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.name}
                    </option>
                  ))}
                </select>
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

            {activePreset && (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "10px", backgroundColor: "rgba(0,0,0,0.03)", borderRadius: "6px" }}>
                {activePreset.dynamicFilters && activePreset.dynamicFilters.length > 0 && (
                  <div>
                    <span style={{ display: "block", marginBottom: "8px", fontSize: "0.9rem", fontWeight: 700, color: "#38bdf8" }}>
                      Dynamic Filters:
                    </span>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "12px" }}>
                      {activePreset.dynamicFilters.map((filter) => {
                        const rawValues = dynamicFilterValues[filter.field] || [];
                        const sortedValues = [...rawValues].sort((a, b) =>
                          a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
                        );
                        const searchTerm = (filterSearch[filter.field] || "").trim().toLowerCase();
                        const matchingValues = searchTerm
                          ? sortedValues.filter((val) => val.toLowerCase().includes(searchTerm))
                          : sortedValues;

                        return (
                          <div key={filter.field} className="dynamic-filter-card">
                            <div className="dynamic-filter-header">
                              <span className="dynamic-filter-label">{filter.label}</span>
                              <span className="filter-count">
                                {matchingValues.length} {matchingValues.length === 1 ? "option" : "options"}
                              </span>
                            </div>
                            <div className="dynamic-filter-inputs">
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
                                    title="Clear search"
                                  >
                                    ✕
                                  </button>
                                )}
                              </div>
                              <select
                                value={selectedDynamicFilters[filter.field] || ""}
                                onChange={(e) => handleDynamicFilterChange(filter.field, e.target.value)}
                                className="dynamic-filter-select"
                              >
                                <option value="">-- Any ({matchingValues.length}) --</option>
                                {matchingValues.map((val) => (
                                  <option key={val} value={val}>
                                    {val}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div ref={dropdownContainerRef} style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginTop: "12px", position: "relative", zIndex: 1000 }}>
                  {/* Conditions Multi-Select Dropdown */}
                  <div style={{ position: "relative" }}>
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
                  <div style={{ position: "relative" }}>
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleProjectColumn(col);
                                  }}
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
              </div>
            )}

          {!isQueryEditorCollapsed ? (
            <div style={{ position: "relative" }}>
              <div style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 12px",
                background: "rgba(4, 23, 32, 0.95)",
                border: "1px solid rgba(45, 212, 191, 0.28)",
                borderBottom: "none",
                borderTopLeftRadius: "8px",
                borderTopRightRadius: "8px",
                fontSize: "12px",
                color: "#94a3b8"
              }}>
                <span style={{ fontWeight: 700, color: "#38bdf8", display: "flex", alignItems: "center", gap: "6px" }}>
                  <span>KQL Code Editor</span>
                  <span style={{ fontSize: "11px", color: "#64748b" }}>({query.split("\n").length} lines)</span>
                </span>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setIsQueryEditorCollapsed(true)}
                  title="Minimize Query Editor"
                  style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    padding: "5px 14px",
                    height: "30px",
                    width: "max-content",
                    minWidth: "max-content",
                    background: "rgba(45, 212, 191, 0.14)",
                    border: "1px solid rgba(45, 212, 191, 0.35)",
                    color: "#34d399",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    whiteSpace: "nowrap"
                  }}
                >
                  <ChevronUp size={14} />
                  <span>Minimize Editor</span>
                </button>
              </div>
              <textarea
                className="query-editor"
                style={{ borderTopLeftRadius: 0, borderTopRightRadius: 0 }}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                spellCheck={false}
              />
            </div>
          ) : (
            <div 
              style={{
                padding: "10px 14px",
                background: "rgba(4, 23, 32, 0.88)",
                border: "1px solid rgba(45, 212, 191, 0.28)",
                borderRadius: "8px",
                fontSize: "13px",
                color: "#94a3b8",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                cursor: "pointer"
              }}
              onClick={() => setIsQueryEditorCollapsed(false)}
            >
              <span style={{ fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {query.split("\n")[0]} ... ({query.split("\n").length} lines)
              </span>
              <button 
                type="button"
                className="icon-button" 
                onClick={(e) => {
                  e.stopPropagation();
                  setIsQueryEditorCollapsed(false);
                }}
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "5px 14px",
                  height: "30px",
                  width: "max-content",
                  minWidth: "max-content",
                  background: "rgba(45, 212, 191, 0.14)",
                  border: "1px solid rgba(45, 212, 191, 0.35)",
                  color: "#34d399",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                  whiteSpace: "nowrap"
                }}
              >
                <ChevronDown size={14} />
                <span>Expand Editor</span>
              </button>
            </div>
          )}
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
            The frontend application is unable to reach the backend API at <code>http://127.0.0.1:8080/api/health</code> ({healthStatus.error || "Connection refused"}).
          </p>
          <div style={{ background: "rgba(0, 0, 0, 0.35)", padding: "10px 14px", borderRadius: "6px", fontSize: "13px" }}>
            <strong>Resolution:</strong> Run <code>npm run dev</code> in your terminal to launch both the backend server and frontend client.
          </div>
        </div>
      )}

      {error ? <div className="alert error">{error}</div> : null}
      {result?.partialError ? <div className="alert warning">{result.partialError}</div> : null}

      <section className="results">
        {!result && !loading ? (
          <div className="empty-results">Run a query to see Log Analytics tables here.</div>
        ) : null}
        {loading ? <div className="empty-results">Query is running...</div> : null}
        {result?.tables.map((table) => (
          <ResultTable key={table.name} table={table} presetProjectColumns={presetProjectColumns} />
        ))}
      </section>

      {isChatOpen && <Chatbot onClose={() => setIsChatOpen(false)} />}
    </main>
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

function ResultTable({ table, presetProjectColumns }: { table: QueryTable; presetProjectColumns?: Set<string> }) {
  const [search, setSearch] = useState("");
  const [sortColumnName, setSortColumnName] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc" | null>(null);
  const [useLocalTime, setUseLocalTime] = useState(false);
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

  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
    if (presetProjectColumns && presetProjectColumns.size > 0) {
      const active = table.columns.map((c) => c.name).filter((name) => presetProjectColumns.has(name));
      if (active.length > 0) return active;
    }
    return table.columns.map((c) => c.name);
  });

  useEffect(() => {
    if (presetProjectColumns && presetProjectColumns.size > 0) {
      const active = table.columns.map((c) => c.name).filter((name) => presetProjectColumns.has(name));
      if (active.length > 0) {
        setVisibleColumns(active);
        return;
      }
    }
    setVisibleColumns(table.columns.map((c) => c.name));
  }, [table, presetProjectColumns]);

  const [pageSize, setPageSize] = useState<number>(100);

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

  // Column filter operators state: ==, !=, contains, !contains
  const [columnFilterOperators, setColumnFilterOperators] = useState<Record<string, "==" | "!=" | "contains" | "!contains">>({});
  const [columnFilterTexts, setColumnFilterTexts] = useState<Record<string, string>>({});

  // Summary table states
  const [summaryScope, setSummaryScope] = useState<"filtered" | "all">("filtered");
  const [summarySelectedColumns, setSummarySelectedColumns] = useState<Set<string>>(new Set());
  const [summarySelectedSubValues, setSummarySelectedSubValues] = useState<Record<string, Set<string>>>({});
  const [summarySortColumn, setSummarySortColumn] = useState<string | null>(null);
  const [summarySortDirection, setSummarySortDirection] = useState<"asc" | "desc" | null>(null);
  const [isSummaryDropdownOpen, setIsSummaryDropdownOpen] = useState(false);
  const [summaryHoveredCol, setSummaryHoveredCol] = useState<string | null>(null);
  const summaryDropdownRef = useRef<HTMLDivElement | null>(null);

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

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (valueFilterRef.current && !valueFilterRef.current.contains(e.target as Node)) {
        setIsValueFilterOpen(false);
      }
      if (summaryDropdownRef.current && !summaryDropdownRef.current.contains(e.target as Node)) {
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
      const typedText = (columnFilterTexts[colName] || "").trim().toLowerCase();
      const op = columnFilterOperators[colName] || "==";

      if ((selectedSet && selectedSet.size > 0) || typedText) {
        filtered = filtered.filter((row) => {
          const rawVal = String(row[colIdx] ?? "");
          const lowerVal = rawVal.toLowerCase();

          if (typedText) {
            if (op === "==" && lowerVal !== typedText) return false;
            if (op === "!=" && lowerVal === typedText) return false;
            if (op === "contains" && !lowerVal.includes(typedText)) return false;
            if (op === "!contains" && lowerVal.includes(typedText)) return false;
          }

          if (selectedSet && selectedSet.size > 0) {
            const hasVal = selectedSet.has(rawVal);
            if (op === "==" || op === "contains") {
              if (!hasVal) return false;
            } else if (op === "!=" || op === "!contains") {
              if (hasVal) return false;
            }
          }

          return true;
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
  }, [search, selectedValueFilters, columnFilterOperators, columnFilterTexts, sortColumnName, sortDirection, table.rows, table.columns]);

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
                              const values = uniqueColumnValues[hoveredColumn] || [];
                              setSelectedValueFilters((prev) => ({
                                ...prev,
                                [hoveredColumn]: new Set(values)
                              }));
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
                            const newOp = e.target.value as "==" | "!=" | "contains" | "!contains";
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
                        </select>
                      </div>
                    </div>

                    <div className="flyout-search">
                      <Search size={13} className="search-icon" />
                      <input
                        type="text"
                        placeholder={`Filter ${hoveredColumn} values...`}
                        value={columnFilterTexts[hoveredColumn] || flyoutSearch}
                        onChange={(e) => {
                          setFlyoutSearch(e.target.value);
                          setColumnFilterTexts((prev) => ({ ...prev, [hoveredColumn]: e.target.value }));
                        }}
                      />
                      {(flyoutSearch || columnFilterTexts[hoveredColumn]) && (
                        <button
                          type="button"
                          className="clear-btn"
                          onClick={() => {
                            setFlyoutSearch("");
                            setColumnFilterTexts((prev) => ({ ...prev, [hoveredColumn]: "" }));
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="flyout-values-list">
                      {(uniqueColumnValues[hoveredColumn] || [])
                        .filter((val) => !flyoutSearch || val.toLowerCase().includes(flyoutSearch.toLowerCase()))
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
            <option value={50}>50</option>
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
                  setIsSummaryDropdownOpen(!isSummaryDropdownOpen);
                  setSummaryHoveredCol(null);
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
                  background: summarySelectedColumns.size > 0 ? "rgba(16, 185, 129, 0.25)" : "rgba(15, 23, 42, 0.6)",
                  border: `1px solid ${summarySelectedColumns.size > 0 ? "#10b981" : "rgba(16, 185, 129, 0.3)"}`,
                  color: summarySelectedColumns.size > 0 ? "#34d399" : "#94a3b8",
                  borderRadius: "6px"
                }}
              >
                <SlidersHorizontal size={14} color="#10b981" />
                <span>
                  Filter Columns & Values{" "}
                  {summarySelectedColumns.size > 0 ? `(${summarySelectedColumns.size})` : "(All)"}
                </span>
                {isSummaryDropdownOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>

              {isSummaryDropdownOpen && (
                <div className="cascading-menu-container left-aligned" onClick={(e) => e.stopPropagation()}>
                  {/* Level 1: Columns List */}
                  <div className="cascading-menu-left">
                    <div className="cascading-menu-title">
                      <span>Columns ({table.columns.length})</span>
                      <div style={{ display: "flex", gap: "6px" }}>
                        <button
                          type="button"
                          className="clear-all-link"
                          onClick={() => {
                            setSummarySelectedColumns(new Set(table.columns.map((c) => c.name)));
                          }}
                        >
                          Select All
                        </button>
                        <button
                          type="button"
                          className="clear-all-link"
                          onClick={() => {
                            setSummarySelectedColumns(new Set());
                            setSummarySelectedSubValues({});
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                    <div className="cascading-column-list">
                      {table.columns.map((col) => {
                        const isColChecked = summarySelectedColumns.has(col.name);
                        const subCount = summarySelectedSubValues[col.name]?.size || 0;
                        const isHovered = summaryHoveredCol === col.name;

                        return (
                          <div
                            key={col.name}
                            className={`cascading-column-item ${isHovered ? "is-hovered" : ""} ${isColChecked ? "has-active" : ""}`}
                            onMouseEnter={() => setSummaryHoveredCol(col.name)}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSummarySelectedColumns((prev) => {
                                const next = new Set(prev);
                                if (next.has(col.name)) next.delete(col.name);
                                else next.add(col.name);
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
                              setSummarySelectedSubValues((prev) => ({
                                ...prev,
                                [summaryHoveredCol]: new Set(values)
                              }));
                              setSummarySelectedColumns((prev) => new Set(prev).add(summaryHoveredCol));
                            }}
                          >
                            Select All
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSummarySelectedSubValues((prev) => ({
                                ...prev,
                                [summaryHoveredCol]: new Set()
                              }));
                            }}
                          >
                            Deselect All
                          </button>
                        </div>
                      </div>

                      <div className="flyout-values-list">
                        {(uniqueColumnValues[summaryHoveredCol] || []).map((val) => {
                          const currentSet = summarySelectedSubValues[summaryHoveredCol] || new Set();
                          const isChecked = currentSet.has(val);

                          return (
                            <div
                              key={val}
                              className={`flyout-value-item ${isChecked ? "is-selected" : ""}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSummarySelectedSubValues((prev) => {
                                  const nextSet = new Set(prev[summaryHoveredCol] || []);
                                  if (nextSet.has(val)) nextSet.delete(val);
                                  else nextSet.add(val);
                                  return { ...prev, [summaryHoveredCol]: nextSet };
                                });
                                setSummarySelectedColumns((prev) => new Set(prev).add(summaryHoveredCol));
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
                setColumnFilterTexts({});
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

function formatCell(value: unknown, useLocalTime: boolean = false): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  
  if (useLocalTime) {
    // Check if string looks like an ISO UTC timestamp (e.g., 2026-07-16T02:18:57Z or with milliseconds)
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(str)) {
      const d = new Date(str);
      if (!isNaN(d.getTime())) {
        return d.toLocaleString();
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
