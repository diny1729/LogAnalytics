import type { PresetQuery } from "../types";
import { formatFilterClause } from "../utils/filterUtils";

export const starterQuery = `AppRequests
| where TimeGenerated > ago(24h) and Success == false
| summarize Failures=count() by Name, ResultCode
| order by Failures desc`;

export const CUSTOM_PRESET: PresetQuery = {
  id: "custom",
  name: "Custom Query",
  description: "Write your own custom KQL query directly",
  baseQuery: starterQuery,
  options: [],
  projectColumns: [],
  dynamicFilters: []
};

export const PRESETS: PresetQuery[] = [
  CUSTOM_PRESET,
  {
    id: "afd-access",
    name: "AFD Access Log",
    description: "FrontDoor access logs for request paths, client IPs, error details, and latencies",
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
    description: "Front Door Web Application Firewall (WAF) block rules and client telemetry",
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
    description: "Azure Firewall Network Rule telemetry with parsed AdditionalFields",
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
    description: "Azure Firewall Application Rule queries with TLS inspection & web category details",
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
    description: "Access logs, HTTP latency, routing rules and backends for Azure Application Gateway",
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
    description: "SMB operations, file share access, caller IPs and minor status codes",
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
    description: "Blob container operations, object key filters, and authentication methods",
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
    description: "Kubernetes events, cluster namespaces, and event types",
    baseQuery: 'KubeEvents\n| order by TimeGenerated desc',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "ClusterName", clause: '| where ClusterName == ""' },
      { label: "Namespace", clause: '| where Namespace == ""' },
      { label: "Name", clause: '| where Name contains ""' },
      { label: "ObjectKind", clause: '| where ObjectKind == ""' },
      { label: "KubeEventType", clause: '| where KubeEventType == ""' },
      { label: "Reason", clause: '| where Reason contains ""' },
      { label: "Message", clause: '| where Message contains ""' }
    ],
    projectColumns: ["TimeGenerated", "ClusterName", "Name", "Namespace", "ObjectKind", "KubeEventType", "Reason", "Message"],
    dynamicFilters: [
      { label: "Cluster Name (ClusterName)", field: "ClusterName", clauseTemplate: (val) => formatFilterClause("ClusterName", val) },
      { label: "Namespace", field: "Namespace", clauseTemplate: (val) => formatFilterClause("Namespace", val) }
    ]
  },
  {
    id: "email-delivery-status",
    name: "Email Delivery Status",
    description: "Azure Communication Services email delivery operations and recipient logs",
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
    description: "Key Vault secret/key operations, UPN identities, and audit records",
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
    description: "App Service IIS HTTP access logs, status codes, user agents, and stem URIs",
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
    description: "Azure Automation runbook jobs, execution status, and job logs",
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
    description: "Windows Virtual Desktop / Azure Virtual Desktop connection session logs",
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
    description: "Log Analytics volume consumption & billable GB breakdown per table data type",
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
    description: "Network Security Group rule evaluation, directional flows, and port ranges",
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
    description: "Azure Communication Services incoming SMS delivery, platform type, and status",
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
  },
  {
    id: "adf-pipeline-logs",
    name: "ADF Pipeline Logs",
    description: "Azure Data Factory pipeline & activity run failures and operational logs",
    baseQuery: 'AzureDiagnostics\n| where ResourceType == "FACTORIES"',
    options: [
      { label: "TimeGenerated", clause: '| where TimeGenerated > ago(24h)' },
      { label: "OperationName", clause: '| where OperationName == ""' },
      { label: "Level", clause: '| where Level == ""' },
      { label: "status_s", clause: '| where status_s == "Failed"' },
      { label: "pipelineName_s", clause: '| where pipelineName_s contains ""' },
      { label: "activityName_s", clause: '| where activityName_s contains ""' },
      { label: "activityType_s", clause: '| where activityType_s == ""' },
      { label: "Error_message_s", clause: '| where Error_message_s contains ""' },
      { label: "UserProperties_Group_s", clause: '| where UserProperties_Group_s contains ""' }
    ],
    projectColumns: [
      "TimeGenerated",
      "Resource",
      "Category",
      "OperationName",
      "Level",
      "status_s",
      "pipelineName_s",
      "Error_message_s",
      "UserProperties_Group_s",
      "activityName_s",
      "activityType_s"
    ],
    dynamicFilters: [
      { label: "ADF Resource Name", field: "Resource", clauseTemplate: (val) => formatFilterClause("Resource", val) },
      { label: "Log Category", field: "Category", clauseTemplate: (val) => formatFilterClause("Category", val) }
    ]
  }
];

export const presetColors: Record<string, { bg: string; text: string }> = {
  custom: { bg: "#4f46e5", text: "#FFFFFF" },
  "adf-pipeline-logs": { bg: "#0072C6", text: "#FFFFFF" },
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

export const timespans = [
  { label: "1h", value: "PT1H" },
  { label: "2h", value: "PT2H" },
  { label: "4h", value: "PT4H" },
  { label: "6h", value: "PT6H" },
  { label: "24h", value: "PT24H" },
  { label: "7d", value: "P7D" },
  { label: "Custom", value: "CUSTOM" }
];
