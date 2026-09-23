import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Clock,
  LogIn,
  LogOut,
  MessageSquare,
  Moon,
  Play,
  Plus,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sun,
  User
} from "lucide-react";
import {
  runQuery,
  fetchUserWorkspaces,
  fetchServerWorkspaces,
  checkBackendHealth,
  clearCacheApi,
  type AzureWorkspace,
  type BackendHealthResponse
} from "./api";
import type {
  PresetOption,
  PresetQuery,
  QueryResponse,
  TabState,
  ThemeMode
} from "./types";
import { PRESETS, CUSTOM_PRESET, starterQuery, presetColors, timespans } from "./constants/presets";
import { THEMES } from "./constants/themes";
import { formatFilterClause } from "./utils/filterUtils";
import {
  findMatchingPreset,
  generateQuery,
  updateQueryConditionOption,
  selectAllPresetOptionsInQuery,
  clearAllPresetOptionsInQuery,
  updateQueryDynamicFilter,
  updateQueryProjectColumns,
  updateQueryTimespan
} from "./utils/kqlUtils";
import {
  getPredefinedWorkspaces,
  combineWorkspaces,
  createInitialTab
} from "./utils/workspaceUtils";
import { Chatbot } from "./Chatbot";
import { SegmentedControl } from "./components/common/SegmentedControl";
import { GlassDateTimePicker } from "./components/common/GlassDateTimePicker";
import { QueryWarningAlert } from "./components/common/QueryWarningAlert";
import { GraphicalSubscriptionSelect } from "./components/selectors/GraphicalSubscriptionSelect";
import { GraphicalWorkspaceSelect } from "./components/selectors/GraphicalWorkspaceSelect";
import { GraphicalPresetSelect } from "./components/selectors/GraphicalPresetSelect";
import { GraphicalThemeSelect } from "./components/selectors/GraphicalThemeSelect";
import { KqlCodeEditor } from "./components/editor/KqlCodeEditor";
import { FilterConditionsDropdown } from "./components/controls/FilterConditionsDropdown";
import { ProjectColumnsDropdown } from "./components/controls/ProjectColumnsDropdown";
import { DynamicFiltersBar } from "./components/controls/DynamicFiltersBar";
import { ResultTable } from "./components/table/ResultTable";
import { useMsal, useIsAuthenticated } from "@azure/msal-react";
import { loginRequest, armTokenRequest, graphTokenRequest } from "./authConfig";
import { getEnv } from "./env";

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      const saved = localStorage.getItem("kql_app_theme") as ThemeMode;
      if (saved && THEMES.some((t) => t.id === saved)) return saved;
    } catch {}
    return "dark";
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.body.setAttribute("data-theme", theme);
    try {
      localStorage.setItem("kql_app_theme", theme);
    } catch {}
  }, [theme]);

  const sortedPresets = useMemo(() => {
    const custom = PRESETS.find((p) => p.id === "custom") || CUSTOM_PRESET;
    const others = PRESETS.filter((p) => p.id !== "custom").sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
    );
    return [custom, ...others];
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

  function handleQueryChange(newQuery: string) {
    setQuery(newQuery);

    if (activePreset?.id !== "custom") {
      setActivePreset(CUSTOM_PRESET);
    }

    const timeMatch = newQuery.match(/\|\s*where\s+TimeGenerated\s+>\s*ago\((\d+[hmd])\)/i);
    if (timeMatch) {
      const val = timeMatch[1].toLowerCase();
      if (val === "1h" && timespan !== "PT1H") setTimespan("PT1H");
      else if (val === "2h" && timespan !== "PT2H") setTimespan("PT2H");
      else if (val === "4h" && timespan !== "PT4H") setTimespan("PT4H");
      else if (val === "6h" && timespan !== "PT6H") setTimespan("PT6H");
      else if (val === "24h" && timespan !== "PT24H") setTimespan("PT24H");
      else if (val === "7d" && timespan !== "P7D") setTimespan("P7D");
    } else if (/\|\s*where\s+TimeGenerated\s+between/i.test(newQuery)) {
      if (timespan !== "CUSTOM") setTimespan("CUSTOM");
    }
  }

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [openDropdown, setOpenDropdown] = useState<"conditions" | "columns" | null>(null);
  const [openDynamicField, setOpenDynamicField] = useState<string | null>(null);
  const dropdownContainerRef = useRef<HTMLDivElement | null>(null);
  const activeDynamicFieldRef = useRef<HTMLDivElement | null>(null);
  const filterConditionsRef = useRef<HTMLDivElement | null>(null);
  const projectColumnsRef = useRef<HTMLDivElement | null>(null);
  const dynamicFilterSeqRef = useRef<number>(0);

  const totalActiveDynamicFilters = useMemo(() => {
    return Object.values(selectedDynamicFilters).reduce((acc, list) => acc + (list ? list.length : 0), 0);
  }, [selectedDynamicFilters]);

  const isRunDisabled = useMemo(() => {
    if (activePreset && activePreset.id !== "custom") {
      return totalActiveDynamicFilters === 0;
    }
    return false;
  }, [activePreset, totalActiveDynamicFilters]);

  const activeDynamicFiltersList = useMemo(() => {
    if (activePreset && activePreset.id !== "custom" && activePreset.dynamicFilters && activePreset.dynamicFilters.length > 0) {
      return activePreset.dynamicFilters;
    }

    const customFilters: { label: string; field: string; clauseTemplate: (val: string | string[]) => string }[] = [];
    const queryLower = query.toLowerCase();

    if (/azurediagnostics/i.test(queryLower)) {
      customFilters.push({ label: "Resource", field: "Resource", clauseTemplate: (v) => formatFilterClause("Resource", v) });
      customFilters.push({ label: "Category", field: "Category", clauseTemplate: (v) => formatFilterClause("Category", v) });
    } else if (/storage(blob|file)logs/i.test(queryLower)) {
      customFilters.push({ label: "Account Name", field: "AccountName", clauseTemplate: (v) => formatFilterClause("AccountName", v) });
      customFilters.push({ label: "Operation Name", field: "OperationName", clauseTemplate: (v) => formatFilterClause("OperationName", v) });
    } else if (/apprequests|apptraces|appexceptions/i.test(queryLower)) {
      customFilters.push({ label: "Name / Request", field: "Name", clauseTemplate: (v) => formatFilterClause("Name", v) });
      customFilters.push({ label: "Result Code", field: "ResultCode", clauseTemplate: (v) => formatFilterClause("ResultCode", v) });
    } else if (/kubeevents/i.test(queryLower)) {
      customFilters.push({ label: "Namespace", field: "Namespace", clauseTemplate: (v) => formatFilterClause("Namespace", v) });
      customFilters.push({ label: "Reason", field: "Reason", clauseTemplate: (v) => formatFilterClause("Reason", v) });
    } else {
      const resultCols = result?.tables?.[0]?.columns?.map((c) => c.name) || [];
      const priorityCols = ["Resource", "Category", "OperationName", "Name", "ResultCode", "AccountName", "CallerIpAddress", "Status", "Level"];
      const matchedCols = priorityCols.filter((col) => resultCols.some((rc) => rc.toLowerCase() === col.toLowerCase()));

      if (matchedCols.length > 0) {
        matchedCols.forEach((col) => {
          customFilters.push({ label: col, field: col, clauseTemplate: (v) => formatFilterClause(col, v) });
        });
      } else if (resultCols.length > 0) {
        resultCols
          .filter((col) => !/timegenerated|details|message|properties|description/i.test(col))
          .slice(0, 3)
          .forEach((col) => {
            customFilters.push({ label: col, field: col, clauseTemplate: (v) => formatFilterClause(col, v) });
          });
      } else {
        customFilters.push({ label: "Resource", field: "Resource", clauseTemplate: (v) => formatFilterClause("Resource", v) });
        customFilters.push({ label: "Category", field: "Category", clauseTemplate: (v) => formatFilterClause("Category", v) });
      }
    }

    return customFilters;
  }, [activePreset, query, result]);

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

  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheNotice, setCacheNotice] = useState<string | null>(null);

  async function handleClearCache() {
    setIsClearingCache(true);
    try {
      let token: string | undefined;
      if (isAuthenticated && accounts.length > 0) {
        const authRes = await instance.acquireTokenSilent({
          ...loginRequest,
          account: accounts[0]
        }).catch(() => null);
        token = authRes?.accessToken;
      }
      const res = await clearCacheApi(token);
      setDynamicFilterValues({});
      setCacheNotice(res.message || "User cache cleared (500s auto-expiry active)");
      setTimeout(() => setCacheNotice(null), 3500);
    } catch {
      setDynamicFilterValues({});
      setCacheNotice("Cache cleared successfully");
      setTimeout(() => setCacheNotice(null), 3500);
    } finally {
      setIsClearingCache(false);
    }
  }

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
        ...armTokenRequest,
        account: accounts[0]
      }).catch(() => null);

      let wsList: AzureWorkspace[] = [];
      if (response?.accessToken) {
        wsList = await fetchUserWorkspaces(response.accessToken).catch((e) => {
          console.warn("Could not query Azure Resource Graph directly:", e?.message);
          return [];
        });
      }

      const serverWs = await fetchServerWorkspaces();
      const predefined = getPredefinedWorkspaces();
      const combined = combineWorkspaces([...wsList, ...serverWs, ...predefined]);
      setWorkspaces(combined);
      if (combined.length > 0 && !workspaceId) {
        setWorkspaceId(combined[0].customerId);
      }
    } catch (err) {
      console.error("Failed to load workspaces:", err);
      const serverWs = await fetchServerWorkspaces();
      const predefined = getPredefinedWorkspaces();
      const fallback = combineWorkspaces([...serverWs, ...predefined]);
      setWorkspaces(fallback);
      if (fallback.length > 0 && !workspaceId) {
        setWorkspaceId(fallback[0].customerId);
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

  useEffect(() => {
    const currentPath = window.location.pathname;
    const loginUri = getEnv("VITE_AZURE_LOGIN_URI") || "/auth/login";
    const callbackUri = getEnv("VITE_AZURE_REDIRECT_URI") || "/auth/callback";

    if (currentPath === loginUri || currentPath === callbackUri) {
      if (isAuthenticated) {
        window.history.replaceState(null, "", "/");
      }
    }
  }, [isAuthenticated]);

  function handleLogin() {
    instance.loginRedirect(loginRequest).catch((e) => {
      console.warn("loginRedirect failed, falling back to loginPopup:", e);
      instance.loginPopup(loginRequest).then(() => loadWorkspaces()).catch((err) => console.error(err));
    });
  }

  function handleLogout() {
    instance.logoutRedirect({
      postLogoutRedirectUri: window.location.origin + (getEnv("VITE_AZURE_LOGIN_URI") || "/auth/login")
    }).catch((e) => {
      console.warn("logoutRedirect failed, falling back to logoutPopup:", e);
      instance.logoutPopup().catch((err) => console.error(err));
    });
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

  const [graphGroups, setGraphGroups] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function fetchUserGroupsFromGraph() {
      if (!isAuthenticated || accounts.length === 0) return;
      try {
        const tokenRes = await instance.acquireTokenSilent({
          ...graphTokenRequest,
          account: accounts[0]
        }).catch(() => null);

        if (!tokenRes?.accessToken) return;

        let res = await fetch("https://graph.microsoft.com/v1.0/me/memberOf?$select=id,displayName", {
          headers: { Authorization: `Bearer ${tokenRes.accessToken}` }
        }).catch(() => null);

        if (!res || !res.ok) {
          res = await fetch("https://graph.microsoft.com/v1.0/me/transitiveMemberOf?$select=id,displayName", {
            headers: { Authorization: `Bearer ${tokenRes.accessToken}` }
          }).catch(() => null);
        }

        if (res && res.ok) {
          const data = await res.json();
          if (isMounted && Array.isArray(data?.value)) {
            const list = data.value
              .map((item: any) => ({
                id: String(item.id || "").toLowerCase(),
                name: String(item.displayName || "").toLowerCase()
              }))
              .filter((g: any) => g.id || g.name);
            setGraphGroups(list);
          }
        }
      } catch (err) {
        console.warn("⚠️ Microsoft Graph group resolution notice:", err);
      }
    }

    fetchUserGroupsFromGraph();
    return () => { isMounted = false; };
  }, [isAuthenticated, accounts, instance]);

  const userGroups: string[] = useMemo(() => {
    if (!isAuthenticated || accounts.length === 0) return [];
    const claims = (accounts[0]?.idTokenClaims || {}) as Record<string, any>;
    const tokenGroups = Array.isArray(claims.groups || claims.roles || claims.wids)
      ? (claims.groups || claims.roles || claims.wids).map((g: any) => String(g).toLowerCase())
      : [];

    const graphIds = graphGroups.map((g) => g.id);
    const graphNames = graphGroups.map((g) => g.name);

    return Array.from(new Set([...tokenGroups, ...graphIds, ...graphNames])).filter(Boolean);
  }, [isAuthenticated, accounts, graphGroups]);

  const isGroupAuthorized = useMemo(() => {
    if (allowedGroupsList.length === 0) return true;
    if (!isAuthenticated || accounts.length === 0) return false;
    return userGroups.some((g) => allowedGroupsList.includes(g));
  }, [allowedGroupsList, isAuthenticated, accounts, userGroups]);

  function handleTimespanChange(newVal: string) {
    setTimespan(newVal);
    setQuery(current => updateQueryTimespan(current, newVal, customStart, customEnd));
  }

  function handleFlipTimeFilter() {
    const regex = /\|\s*where\s+TimeGenerated\s+(>|between)[^\n]+/i;
    if (regex.test(query)) {
      const lines = query.split("\n").filter((l) => !regex.test(l.trim()));
      setQuery(lines.join("\n"));
    } else {
      setQuery((current) => updateQueryTimespan(current, timespan, customStart, customEnd));
    }
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

    const cleanBase = preset.baseQuery
      .split(/\n\|\s*(summarize|order|project|render)\b/i)[0]
      .trim();

    for (let i = 0; i < preset.dynamicFilters.length; i++) {
      if (dynamicFilterSeqRef.current !== currentSeq) return;
      const filter = preset.dynamicFilters[i];
      try {
        let q = `${cleanBase}\n| where TimeGenerated > ago(7d)`;

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
            timespan: "P7D",
            workspaceId: targetWs,
            filters: [],
            token
          });
        } catch {
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
            timespan: "P7D",
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
    if (preset.id === "custom") {
      setQuery((currentQuery) => {
        const matched = findMatchingPreset(currentQuery);
        return matched.id === "custom" && currentQuery.trim() ? currentQuery : starterQuery;
      });
    } else {
      setQuery(generateQuery(preset, new Set(), initialProjects, {}, {}, {}));
      fetchDynamicFilters(preset, workspaceId, {});
    }
  }

  function handleWorkspaceSelect(newWsId: string) {
    if (newWsId === workspaceId) return;

    const matchingWs = workspaces.find((w) => w.customerId === newWsId);
    const wsSub = matchingWs?.subscriptionName || matchingWs?.subscriptionId;

    updateActiveTab({
      workspaceId: newWsId,
      selectedSubscription: wsSub || selectedSubscription,
      result: null,
      error: null,
      loading: false,
      activePreset: CUSTOM_PRESET,
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
    const filterObj = activeDynamicFiltersList.find((f) => f.field === field) || { field, clauseTemplate: (v: string | string[]) => formatFilterClause(field, v) };
    setQuery((currentQuery) =>
      updateQueryDynamicFilter(currentQuery, field, filterObj, current, updated)
    );
    if (activePreset && activePreset.id !== "custom") {
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }

  function selectAllDynamicFilterValues(field: string, values: string[]) {
    const current = selectedDynamicFilters[field] || [];
    const nextFilters = { ...selectedDynamicFilters, [field]: [...values] };
    setSelectedDynamicFilters(nextFilters);
    const filterObj = activeDynamicFiltersList.find((f) => f.field === field) || { field, clauseTemplate: (v: string | string[]) => formatFilterClause(field, v) };
    setQuery((currentQuery) =>
      updateQueryDynamicFilter(currentQuery, field, filterObj, current, [...values])
    );
    if (activePreset && activePreset.id !== "custom") {
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }

  function clearDynamicFilterValues(field: string) {
    const current = selectedDynamicFilters[field] || [];
    const nextFilters = { ...selectedDynamicFilters, [field]: [] };
    setSelectedDynamicFilters(nextFilters);
    const filterObj = activeDynamicFiltersList.find((f) => f.field === field) || { field, clauseTemplate: (v: string | string[]) => formatFilterClause(field, v) };
    setQuery((currentQuery) =>
      updateQueryDynamicFilter(currentQuery, field, filterObj, current, [])
    );
    if (activePreset && activePreset.id !== "custom") {
      fetchDynamicFilters(activePreset, workspaceId, nextFilters);
    }
  }

  useEffect(() => {
    if (result?.tables?.[0]) {
      const table = result.tables[0];
      const newVals: Record<string, string[]> = {};
      activeDynamicFiltersList.forEach((filter) => {
        const colIdx = table.columns.findIndex((c) => c.name.toLowerCase() === filter.field.toLowerCase());
        if (colIdx !== -1) {
          const distinct = Array.from(new Set(table.rows.map((r) => String(r[colIdx] ?? "")).filter(Boolean)));
          distinct.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
          if (distinct.length > 0) {
            newVals[filter.field] = distinct;
          }
        }
      });
      if (Object.keys(newVals).length > 0) {
        setDynamicFilterValues((prev) => ({ ...prev, ...newVals }));
      }
    }
  }, [result, activeDynamicFiltersList]);

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
    if (isRunDisabled) {
      setError("Please select at least 1 Dynamic Filter option to run query.");
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

  if (authRequired && !isAuthenticated) {
    return (
      <main className="login-landing">
        <div style={{ position: "absolute", top: "24px", right: "24px" }}>
          <div className="theme-toggle-pill" role="radiogroup" aria-label="Theme switcher">
            <button
              type="button"
              className={`theme-pill-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
              title="Switch to Milk White Light Mode"
              aria-label="Light Mode"
            >
              <Sun size={14} />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={`theme-pill-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
              title="Switch to Dark Obsidian Mode"
              aria-label="Dark Mode"
            >
              <Moon size={14} />
              <span>Dark</span>
            </button>
          </div>
        </div>
        <div className="login-hero-card">
          <div className="login-brand-icon">
            <ShieldCheck size={36} />
          </div>
          <h2 style={{ fontSize: "28px", fontWeight: "800", color: "var(--color-text-primary)", marginBottom: "12px", letterSpacing: "-0.5px" }}>
            Azure Log Analytics KQL Explorer
          </h2>
          <p style={{ fontSize: "15px", color: "var(--color-text-muted)", marginBottom: "32px", lineHeight: "1.6" }}>
            Please sign in with your Microsoft Azure AD account to discover accessible Log Analytics Workspaces, execute KQL queries, and analyze network and security telemetry.
          </p>

          {!clientIdConfigured && (
            <div style={{
              marginBottom: "24px",
              padding: "12px 16px",
              background: "rgba(178, 58, 72, 0.12)",
              border: "1px solid rgba(178, 58, 72, 0.35)",
              borderRadius: "8px",
              color: "#991b1b",
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

          <div style={{ marginTop: "28px", paddingTop: "20px", borderTop: "1px solid var(--glass-border)", display: "flex", justifyContent: "center", gap: "20px", color: "var(--color-text-muted)", fontSize: "13px" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <ShieldCheck size={16} color="var(--color-accent-action)" /> Enterprise MSAL / Azure AD OAuth 2.0
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

  if (authRequired && isAuthenticated && !isGroupAuthorized) {
    return (
      <main className="login-landing">
        <div style={{ position: "absolute", top: "24px", right: "24px" }}>
          <div className="theme-toggle-pill" role="radiogroup" aria-label="Theme switcher">
            <button
              type="button"
              className={`theme-pill-btn ${theme === "light" ? "active" : ""}`}
              onClick={() => setTheme("light")}
              title="Switch to Milk White Light Mode"
              aria-label="Light Mode"
            >
              <Sun size={14} />
              <span>Light</span>
            </button>
            <button
              type="button"
              className={`theme-pill-btn ${theme === "dark" ? "active" : ""}`}
              onClick={() => setTheme("dark")}
              title="Switch to Dark Obsidian Mode"
              aria-label="Dark Mode"
            >
              <Moon size={14} />
              <span>Dark</span>
            </button>
          </div>
        </div>
        <div className="login-hero-card" style={{ maxWidth: "640px" }}>
          <div className="login-brand-icon" style={{ background: "rgba(178, 58, 72, 0.15)", color: "#b91c1c" }}>
            <ShieldAlert size={36} />
          </div>
          <h2 style={{ fontSize: "24px", fontWeight: "800", color: "var(--color-text-primary)", marginBottom: "8px" }}>
            Access Restricted: Security Group Required
          </h2>
          <p style={{ fontSize: "14px", color: "var(--color-text-muted)", marginBottom: "20px", lineHeight: "1.6" }}>
            Your account (<strong>{accounts[0]?.username || "Unknown"}</strong>) is authenticated with Azure AD, but is not a member of the required Azure AD Security Group to access this Log Analytics tool.
          </p>

          <div style={{
            background: "var(--glass-surface-elevated)",
            border: "1px solid rgba(178, 58, 72, 0.3)",
            borderRadius: "8px",
            padding: "14px",
            marginBottom: "20px",
            textAlign: "left",
            fontSize: "13px"
          }}>
            <div style={{ fontWeight: 700, color: "#b91c1c", marginBottom: "6px" }}>Security Authorization Details:</div>
            <div style={{ color: "var(--color-text-muted)", marginBottom: "8px" }}>
              Authorized AD Groups: <code style={{ color: "#6F7B60", fontWeight: 700 }}>{allowedGroupsConfig}</code>
            </div>
            <div style={{ color: "var(--color-text-muted)" }}>
              Your Group Memberships: <code style={{ color: userGroups.length > 0 ? "#6F7B60" : "#b91c1c" }}>{userGroups.length > 0 ? userGroups.join(", ") : "None emitted (Group claims missing)"}</code>
            </div>
          </div>

          <div style={{ fontSize: "13px", color: "var(--color-text-muted)", marginBottom: "24px", textAlign: "left", background: "var(--glass-surface-elevated)", border: "1px solid var(--glass-border)", padding: "12px", borderRadius: "6px" }}>
            💡 <strong>Troubleshooting:</strong>
            <ul style={{ margin: "6px 0 0 18px", padding: 0, lineHeight: "1.6" }}>
              <li><strong>Important:</strong> Azure AD / Entra ID emits <strong>Group Object IDs (GUIDs)</strong> in tokens, not display names. Configure <code>VITE_ALLOWED_AZURE_AD_GROUPS</code> with the Group Object ID (e.g. <code>{userGroups[0] || "your-group-object-id-guid"}</code>) from Azure Portal &gt; Entra ID &gt; Groups.</li>
              <li>Or leave <code>VITE_ALLOWED_AZURE_AD_GROUPS=""</code> empty in <code>aks/secret.yaml</code> to allow all authenticated Entra ID users in your organization.</li>
              <li>Ensure <code>groupMembershipClaims</code> (SecurityGroup / All) is enabled in your Azure AD App Registration manifest.</li>
            </ul>
          </div>

          <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
            <button className="login-btn-primary" style={{ background: "#b91c1c" }} onClick={handleLogout}>
              <LogOut size={20} />
              <span>Sign Out / Switch Account</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="shell">
      <section className="topbar" aria-label="Application status">
        <div>
          <h1 style={{
            fontSize: "1.65rem",
            fontWeight: 800,
            margin: 0,
            color: "var(--color-text-primary)",
            letterSpacing: "-0.5px"
          }}>
            Azure Log Analytics KQL
          </h1>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          {cacheNotice && (
            <div style={{
              background: "rgba(111, 123, 96, 0.22)",
              border: "1px solid var(--color-accent-action)",
              borderRadius: "6px",
              padding: "4px 10px",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-primary)",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              animation: "fadeIn 0.2s ease"
            }}>
              <span>✓</span>
              <span>{cacheNotice}</span>
            </div>
          )}

          {isAuthenticated && accounts.length > 0 && (
            <div className="user-badge" title={`Signed in as ${accounts[0].username}`}>
              <User size={15} color="var(--color-accent-action)" />
              <span>{accounts[0].name || accounts[0].username}</span>
            </div>
          )}

          <GraphicalThemeSelect currentTheme={theme} onSelectTheme={setTheme} />

          <button
            className="icon-button"
            style={{
              height: "36px",
              padding: "0 12px",
              gap: "6px",
              fontWeight: 600,
              fontSize: "12px",
              color: "var(--color-text-primary)",
              background: "var(--glass-surface)",
              border: "1px solid var(--glass-border)",
              cursor: "pointer"
            }}
            onClick={handleClearCache}
            disabled={isClearingCache}
            title="Auto-clears after 500 seconds (8.3 mins). Click to immediately purge your user-wise query cache."
          >
            <RefreshCw size={13} color="var(--color-accent-action)" className={isClearingCache ? "spin" : ""} />
            <span>{isClearingCache ? "Clearing..." : "Clear Cache (500s)"}</span>
          </button>

          <button 
            className="primary-button" 
            onClick={() => setIsChatOpen(!isChatOpen)}
            title="Open AI Assistant"
            style={{ height: "36px", padding: "0 14px" }}
          >
            <MessageSquare size={16} />
            <span>Ask AI</span>
          </button>
          {isAuthenticated && (
            <button
              className="icon-button"
              style={{
                height: "36px",
                padding: "0 14px",
                gap: "6px",
                fontWeight: 600,
                color: "var(--color-text-primary)",
                background: "var(--glass-surface)",
                border: "1px solid var(--glass-border)"
              }}
              onClick={handleLogout}
              title="Sign out of Azure AD"
            >
              <LogOut size={15} color="var(--color-accent-action)" />
              <span>Sign Out</span>
            </button>
          )}
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
          <div className="panel-header" style={{ position: "relative", zIndex: 20000 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <h2 style={{ color: "#92DE8B" }}>KQL Query</h2>
            </div>
            <div className="toolbar" style={{ display: "flex", gap: "12px", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <SegmentedControl
                    value={timespan}
                    options={timespans}
                    onChange={handleTimespanChange}
                  />
                  <button
                    type="button"
                    className="icon-button"
                    onClick={handleFlipTimeFilter}
                    style={{
                      height: "36px",
                      padding: "0 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      gap: "6px",
                      background: "var(--glass-surface)",
                      border: "1px solid var(--glass-border)",
                      color: "var(--color-text-primary)",
                      borderRadius: "8px",
                      cursor: "pointer",
                      whiteSpace: "nowrap"
                    }}
                    title="Flip / Toggle time filter in query editor (Insert / Remove / Sync TimeGenerated clause)"
                  >
                    <Clock size={14} color="var(--color-accent-action)" />
                    <span>Time in Query</span>
                  </button>
                </div>
                {timespan === "CUSTOM" && (
                  <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "0.85rem" }}>
                    <GlassDateTimePicker
                      value={customStart}
                      onChange={(newVal) => handleCustomTimeChange(newVal, customEnd)}
                      placeholder="Start Time"
                    />
                    <span style={{ color: "var(--color-text-muted)", fontWeight: 700, fontSize: "12px" }}>to</span>
                    <GlassDateTimePicker
                      value={customEnd}
                      onChange={(newVal) => handleCustomTimeChange(customStart, newVal)}
                      placeholder="End Time"
                    />
                  </div>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "var(--glass-surface-elevated)", padding: "4px 10px", borderRadius: "8px", border: "1px solid var(--glass-border)", height: "36px" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-text-primary)", whiteSpace: "nowrap" }}>Max Rows:</span>
                <div style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
                  <select
                    className="max-rows-select transparent-select"
                    value={maxRows}
                    onChange={(e) => {
                      const newRows = Number(e.target.value);
                      setMaxRows(newRows);
                      handleRun(newRows);
                    }}
                    style={{
                      background: "transparent",
                      backgroundColor: "transparent",
                      border: "none",
                      color: "var(--color-text-primary)",
                      fontSize: "12px",
                      fontWeight: 700,
                      outline: "none",
                      cursor: "pointer",
                      paddingRight: "18px",
                      WebkitAppearance: "none",
                      MozAppearance: "none",
                      appearance: "none",
                      boxShadow: "none"
                    }}
                    aria-label="Max rows"
                  >
                    <option value={100} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>100 rows</option>
                    <option value={500} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>500 rows</option>
                    <option value={1000} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>1,000 rows (Default)</option>
                    <option value={2500} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>2,500 rows</option>
                    <option value={5000} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>5,000 rows</option>
                    <option value={10000} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>10,000 rows</option>
                    <option value={50000} style={{ background: "var(--color-surface)", color: "var(--color-text-primary)" }}>50,000 rows</option>
                  </select>
                  <ChevronDown size={13} color="var(--color-accent-action)" style={{ position: "absolute", right: 0, pointerEvents: "none" }} />
                </div>
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

          <div className="workspace-controls-bar" style={{ position: "relative", zIndex: 100 }}>
            <div className="workspace-controls-group">
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="dynamic-filter-label" style={{ color: "var(--color-text-primary)", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                  🏢 Azure Subscription & Workspace
                </span>
                <span className="filter-count" style={{ fontSize: "11px", color: "#6F7B60", background: "rgba(111, 123, 96, 0.1)", padding: "2px 8px", borderRadius: "10px", border: "1px solid rgba(111, 123, 96, 0.25)" }}>
                  {uniqueSubscriptions.length} {uniqueSubscriptions.length === 1 ? "subscription" : "subscriptions"} · {workspaces.length} {workspaces.length === 1 ? "workspace" : "workspaces"}
                </span>
              </div>

              {isCustomInputMode ? (
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <input
                    className="filter-search-field"
                    style={{
                      padding: "4px 10px",
                      height: "34px",
                      minWidth: "260px",
                      background: "var(--glass-surface)",
                      border: "1px solid var(--glass-border)",
                      borderRadius: "6px",
                      color: "var(--color-text-primary)",
                      fontSize: "12px"
                    }}
                    value={workspaceId}
                    onChange={(event) => handleWorkspaceSelect(event.target.value)}
                    placeholder="Enter or paste Workspace ID GUID..."
                  />
                </div>
              ) : (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
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
                  <GraphicalWorkspaceSelect
                    workspaces={workspaces}
                    workspaceId={workspaceId}
                    selectedSubscription={selectedSubscription}
                    onSelect={(id) => handleWorkspaceSelect(id)}
                    onManualClick={() => setIsCustomInputMode(true)}
                  />
                </div>
              )}

              <button
                type="button"
                className="icon-button"
                onClick={() => setIsCustomInputMode(!isCustomInputMode)}
                style={{
                  width: "auto",
                  padding: "5px 10px",
                  height: "34px",
                  fontSize: "11px",
                  border: "1px solid var(--glass-border)",
                  borderRadius: "6px",
                  background: "var(--glass-surface)",
                  color: "#6F7B60",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  cursor: "pointer"
                }}
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
                  style={{
                    width: "34px",
                    height: "34px",
                    padding: 0,
                    fontSize: "11px",
                    borderRadius: "6px",
                    background: "var(--glass-surface)",
                    border: "1px solid var(--glass-border)",
                    color: "#6F7B60",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center"
                  }}
                  title="Refresh workspaces"
                >
                  <RefreshCw size={12} className={fetchingWorkspaces ? "spinning" : ""} />
                </button>
              )}
            </div>

            <div className="workspace-controls-group">
              <span className="dynamic-filter-label" style={{ color: "var(--color-text-primary)", fontSize: "12px", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                ⚡ Log Presets
              </span>
              <GraphicalPresetSelect
                presets={sortedPresets}
                activePreset={activePreset}
                presetColors={presetColors}
                onSelect={(preset) => applyPreset(preset)}
              />
            </div>
          </div>

          {workspaces.length === 0 && !fetchingWorkspaces && (
            <p style={{ color: "var(--color-text-muted)", fontSize: "11px", margin: "-6px 0 12px 4px" }}>
              Configure <code>VITE_WORKSPACES=Subscription/Workspace:GUID</code> in <code>.env</code> or click "Manual" to enter a workspace ID directly.
            </p>
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginBottom: "16px", position: "relative", zIndex: 1 }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--color-text-primary)" }}>Quick Switch:</span>
            {sortedPresets.map((preset) => {
              const isActive = activePreset?.id === preset.id;
              const colors = presetColors[preset.id] || { bg: "#6F7B60", text: "#FEFCFF" };
              return (
                <button
                  key={preset.id}
                  className={`filter-chip ${isActive ? "enabled" : ""}`}
                  style={{
                    backgroundColor: isActive ? colors.bg : "var(--glass-surface)",
                    color: isActive ? colors.text : "var(--color-text-primary)",
                    borderColor: isActive ? colors.bg : "var(--glass-border)",
                    fontWeight: isActive ? "bold" : "normal",
                    whiteSpace: "nowrap",
                    padding: "4px 10px",
                    fontSize: "12px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    transition: "all 0.12s ease",
                    boxShadow: isActive ? `0 2px 8px ${colors.bg}40` : "0 1px 2px rgba(44, 51, 46, 0.04)"
                  }}
                  onClick={() => applyPreset(preset)}
                >
                  {preset.name}
                </button>
              );
            })}
          </div>

          <DynamicFiltersBar
            dynamicFilters={activeDynamicFiltersList}
            dynamicFilterValues={dynamicFilterValues}
            selectedDynamicFilters={selectedDynamicFilters}
            filterSearch={filterSearch}
            openDynamicField={openDynamicField}
            totalActiveDynamicFilters={totalActiveDynamicFilters}
            activeDynamicFieldRef={activeDynamicFieldRef}
            onToggleField={(field) => setOpenDynamicField(openDynamicField === field ? null : field)}
            onSearchChange={(field, val) => setFilterSearch((prev) => ({ ...prev, [field]: val }))}
            onSelectAll={(field, values) => selectAllDynamicFilterValues(field, values)}
            onClearAll={(field) => clearDynamicFilterValues(field)}
            onToggleValue={(field, val) => toggleDynamicFilterValue(field, val)}
          />

          {activePreset && activePreset.id !== "custom" && (activePreset.options.length > 0 || activePreset.projectColumns.length > 0) && (
            <div ref={dropdownContainerRef} style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap", marginBottom: "12px", position: "relative", zIndex: 1000 }}>
              <div ref={filterConditionsRef} style={{ position: "relative" }}>
                <FilterConditionsDropdown
                  activePreset={activePreset}
                  presetOptions={presetOptions}
                  optionOperators={optionOperators}
                  optionValues={optionValues}
                  isOpen={openDropdown === "conditions"}
                  onToggleOpen={() => setOpenDropdown(openDropdown === "conditions" ? null : "conditions")}
                  onToggleOption={togglePresetOption}
                  onSelectAll={selectAllPresetOptions}
                  onClearAll={clearAllPresetOptions}
                  onOperatorChange={handleOptionOperatorChange}
                  onValueChange={handleOptionValueChange}
                />
              </div>

              <div ref={projectColumnsRef} style={{ position: "relative" }}>
                <ProjectColumnsDropdown
                  activePreset={activePreset}
                  presetProjectColumns={presetProjectColumns}
                  isOpen={openDropdown === "columns"}
                  onToggleOpen={() => setOpenDropdown(openDropdown === "columns" ? null : "columns")}
                  onToggleColumn={toggleProjectColumn}
                  onSelectAll={selectAllProjectColumns}
                  onClearAll={clearAllProjectColumns}
                />
              </div>
            </div>
          )}

          <KqlCodeEditor
            query={query}
            onChange={handleQueryChange}
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
