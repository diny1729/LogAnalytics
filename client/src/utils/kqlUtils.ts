import type { PresetOption, PresetQuery, KqlSyntaxError } from "../types";
import { PRESETS, CUSTOM_PRESET } from "../constants/presets";
import { VALID_KQL_OPERATORS } from "../constants/kql";
import { buildOptionClause } from "./filterUtils";

export function findMatchingPreset(queryText: string): PresetQuery {
  const clean = queryText.trim();
  if (!clean) return CUSTOM_PRESET;

  for (const preset of PRESETS) {
    if (preset.id === "custom") continue;

    if (preset.id === "afd-access" && /AzureDiagnostics/i.test(clean) && /FrontDoorAccessLog/i.test(clean)) {
      return preset;
    }
    if (preset.id === "afd-firewall" && /AzureDiagnostics/i.test(clean) && /FrontDoorWebApplicationFirewallLog/i.test(clean)) {
      return preset;
    }
    if (preset.id === "azfw-network" && /AzureDiagnostics/i.test(clean) && /NetworkRule/i.test(clean)) {
      return preset;
    }
    if (preset.id === "azfw-application" && /AzureDiagnostics/i.test(clean) && /AZFWApplicationRule/i.test(clean)) {
      return preset;
    }
    if (preset.id === "app-gateway" && /AzureDiagnostics/i.test(clean) && /ApplicationGatewayAccessLog/i.test(clean)) {
      return preset;
    }
    if (preset.id === "keyvault-audit-log" && /AzureDiagnostics/i.test(clean) && /AuditEvent/i.test(clean)) {
      return preset;
    }
    if (preset.id === "automation-job-logs" && /AzureDiagnostics/i.test(clean) && /JobLogs/i.test(clean)) {
      return preset;
    }
    if (preset.id === "nsg-logs" && /AzureDiagnostics/i.test(clean) && /NetworkSecurity/i.test(clean)) {
      return preset;
    }
    if (preset.id === "storage-file" && /^StorageFileLogs\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "storage-blob" && /^StorageBlobLogs\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "kube-events" && /^KubeEvents\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "email-delivery-status" && /^ACSEmailDeliveryStatusOperations\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "appservice-http-logs" && /^AppServiceHTTPLogs\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "wvd-connections" && /^WVDConnections\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "datatype-log-usage" && /^Usage\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "sms-incoming-operations" && /^ACSSMSIncomingOperations\b/im.test(clean)) {
      return preset;
    }
    if (preset.id === "adf-pipeline-logs" && /AzureDiagnostics/i.test(clean) && /FACTORIES/i.test(clean)) {
      return preset;
    }
  }

  return CUSTOM_PRESET;
}

export function getTimespanKql(value: string, start?: string, end?: string): string {
  switch (value) {
    case "PT1H": return "| where TimeGenerated > ago(1h)";
    case "PT2H": return "| where TimeGenerated > ago(2h)";
    case "PT4H": return "| where TimeGenerated > ago(4h)";
    case "PT6H": return "| where TimeGenerated > ago(6h)";
    case "PT24H": return "| where TimeGenerated > ago(24h)";
    case "P7D": return "| where TimeGenerated > ago(7d)";
    case "CUSTOM": 
      if (start && end) {
        return `| where TimeGenerated between (datetime(${start}) .. datetime(${end}))`;
      }
      return "| where TimeGenerated > ago(24h)";
    default: return "| where TimeGenerated > ago(24h)";
  }
}

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateKql(query: string): KqlSyntaxError[] {
  const errors: KqlSyntaxError[] = [];

  const queryWithoutVerbatimDouble = query.replace(/@"(?:[^"])*"/g, '"__STR__"');
  const queryWithoutVerbatimSingle = queryWithoutVerbatimDouble.replace(/@'(?:[^'])*'/g, "'__STR__'");
  const queryWithPlaceholderStrings = queryWithoutVerbatimSingle
    .replace(/"(?:[^"\\]|\\.)*"/g, '"__STR__"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'__STR__'");

  const queryWithoutCaseBlocks = queryWithPlaceholderStrings.replace(/extend\s+[a-zA-Z0-9_]+\s*=\s*case\s*\([\s\S]*?\n\)/gi, (match) => {
    const lineCount = match.split("\n").length - 1;
    return "extend _skipped = 1" + "\n".repeat(lineCount);
  });

  const rawLines = query.split("\n");
  const processedLines = queryWithoutCaseBlocks.split("\n");
  let totalOpenParen = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const lineNum = i + 1;
    const originalLine = rawLines[i];
    let rawLine = processedLines[i];

    const commentIdx = originalLine.indexOf("//");
    if (commentIdx >= 0) {
      rawLine = rawLine.slice(0, commentIdx);
    }
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const withoutValidPlaceholders = rawLine.replace(/"__STR__"/g, "").replace(/'__STR__'/g, "");
    if (withoutValidPlaceholders.includes('"')) {
      errors.push({ line: lineNum, message: `Unclosed double quote (") on line ${lineNum}` });
    }
    if (withoutValidPlaceholders.includes("'")) {
      errors.push({ line: lineNum, message: `Unclosed single quote (') on line ${lineNum}` });
    }

    for (let j = 0; j < withoutValidPlaceholders.length; j++) {
      if (withoutValidPlaceholders[j] === "(") totalOpenParen++;
      if (withoutValidPlaceholders[j] === ")") totalOpenParen--;
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
        if (firstWord === "where") {
          const restOfWhere = pipeContent.slice(5).trim();
          if (!restOfWhere) {
            errors.push({ line: lineNum, message: `'where' clause requires a condition on line ${lineNum}` });
          } else {
            if (/\b[a-zA-Z0-9_]+\s*=(?!=)\s*[^=]/.test(rawLine)) {
              errors.push({ line: lineNum, message: `Invalid assignment '=' in 'where' clause on line ${lineNum}. Use '==' for equality comparison.` });
            }

            if (/\b(?:!?in~?)\s*\(\s*\)/i.test(rawLine)) {
              errors.push({ line: lineNum, message: `Empty set 'in ()' on line ${lineNum}: specify at least one value` });
            } else if (/\b(?:!?in~?)\s*$/i.test(rawLine)) {
              errors.push({ line: lineNum, message: `'in' operator requires value set '(val1, val2)' on line ${lineNum}` });
            }

            if (/\b(?:!?has(?:_any|_all|_cs)?)\s*\(\s*\)/i.test(rawLine)) {
              errors.push({ line: lineNum, message: `Empty arguments in 'has ()' on line ${lineNum}` });
            } else if (/\b(?:!?has(?:_any|_all|_cs)?)\s*$/i.test(rawLine)) {
              errors.push({ line: lineNum, message: `'has' operator requires search term or set on line ${lineNum}` });
            }
          }
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

  const whereClauses = queryWithPlaceholderStrings.split(/\n\|\s*/);
  for (const clause of whereClauses) {
    if (/^\s*where\b/i.test(clause)) {
      const betweenMatches = [...clause.matchAll(/\b(!?between)\b/gi)];
      for (const m of betweenMatches) {
        const afterBetween = clause.slice((m.index ?? 0) + m[0].length).trim();
        if (!afterBetween || afterBetween === "(") {
          errors.push({ line: 1, message: `'between' operator requires range '(min .. max)'` });
        } else if (!afterBetween.includes("..")) {
          errors.push({ line: 1, message: `Invalid 'between' range syntax. Expected: between (min .. max)` });
        }
      }
    }
  }

  if (totalOpenParen > 0) {
    errors.push({ line: rawLines.length, message: `Unbalanced parenthesis: Missing closing ')'` });
  } else if (totalOpenParen < 0) {
    errors.push({ line: 1, message: `Unbalanced parenthesis: Extra closing ')'` });
  }

  return errors;
}

export function updateQueryConditionOption(
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
    if (field && new RegExp(`^\\|\\s*where\\s+${escapeRegex(field)}(\\s|$|\\(|==|!=|>=|>|<=|<|contains|!contains|between|!between|in|!in|has|!has)`, "i").test(trimmed)) {
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

export function selectAllPresetOptionsInQuery(
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

export function clearAllPresetOptionsInQuery(
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

export function updateQueryDynamicFilter(
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

export function updateQueryProjectColumns(
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

export function getPresetTable(preset: PresetQuery): string {
  const line = preset.baseQuery.split("\n")[0].trim();
  return line.split("|")[0].trim() || "LogTable";
}

export function getPresetDesc(preset: PresetQuery): string {
  return `${preset.projectColumns.length} projected columns · ${preset.options.length} filter options`;
}

export function generateQuery(
  preset: PresetQuery,
  conditionOptions: Set<string>,
  projectCols: Set<string>,
  dynamicVals: Record<string, string[]>,
  ops: Record<string, string> = {},
  vals: Record<string, string> = {}
): string {
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

export function updateQueryTimespan(newQuery: string, tsValue: string, start: string, end: string): string {
  const kqlClause = getTimespanKql(tsValue, start, end);
  const regex = /\|\s*where\s+TimeGenerated\s+(>|between)[^\n]+/i;
  if (regex.test(newQuery)) {
    return newQuery.replace(regex, kqlClause);
  }
  const lines = newQuery.split("\n");
  if (lines.length > 0 && lines[0].trim() && !lines[0].trim().startsWith("|")) {
    lines.splice(1, 0, kqlClause);
    return lines.join("\n");
  }
  return `${kqlClause}\n${newQuery}`;
}
