declare global {
  interface Window {
    __RUNTIME_CONFIG__?: Record<string, string>;
  }
}

export function getEnv(key: string): string {
  // 1. Check window.__RUNTIME_CONFIG__ injected by Express server at runtime (Docker/k8s/local production)
  if (
    typeof window !== "undefined" &&
    window.__RUNTIME_CONFIG__ &&
    window.__RUNTIME_CONFIG__[key] !== undefined &&
    window.__RUNTIME_CONFIG__[key] !== ""
  ) {
    return window.__RUNTIME_CONFIG__[key];
  }

  // 2. Fall back to static import.meta.env accesses (Vite AST transformer requires static property access)
  switch (key) {
    case "VITE_REQUIRE_AZURE_AD_AUTH":
      return import.meta.env.VITE_REQUIRE_AZURE_AD_AUTH ?? "false";
    case "VITE_AZURE_CLIENT_ID":
      return import.meta.env.VITE_AZURE_CLIENT_ID ?? "";
    case "VITE_AZURE_TENANT_ID":
      return import.meta.env.VITE_AZURE_TENANT_ID ?? "";
    case "VITE_AZURE_REDIRECT_URI":
      return import.meta.env.VITE_AZURE_REDIRECT_URI ?? "/auth/callback";
    case "VITE_AZURE_LOGIN_URI":
      return import.meta.env.VITE_AZURE_LOGIN_URI ?? "/auth/login";
    case "VITE_WORKSPACES":
      return import.meta.env.VITE_WORKSPACES ?? "";
    case "VITE_LOG_ANALYTICS_WORKSPACE_ID":
      return import.meta.env.VITE_LOG_ANALYTICS_WORKSPACE_ID ?? "";
    case "VITE_ALLOWED_AZURE_AD_GROUPS":
      return import.meta.env.VITE_ALLOWED_AZURE_AD_GROUPS ?? "";
    default:
      return "";
  }
}
