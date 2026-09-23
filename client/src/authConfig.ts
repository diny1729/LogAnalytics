import { Configuration, LogLevel } from "@azure/msal-browser";
import { getEnv } from "./env";

export const msalConfig: Configuration = {
  auth: {
    // Read runtime environment variables (injected by server in k8s/production or from Vite env in dev)
    clientId: getEnv("VITE_AZURE_CLIENT_ID"),
    authority: `https://login.microsoftonline.com/${getEnv("VITE_AZURE_TENANT_ID") || "common"}`,
    redirectUri: getEnv("VITE_AZURE_REDIRECT_URI") || "/auth/callback",
    postLogoutRedirectUri: getEnv("VITE_AZURE_LOGIN_URI") || "/auth/login",
  },
  cache: {
    cacheLocation: "sessionStorage", // This configures where your cache will be stored
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            return;
          case LogLevel.Warning:
            console.warn(message);
            return;
        }
      },
    },
  },
};

// Standard OpenID Connect scopes for user sign-in and profile info
export const loginRequest = {
  scopes: ["openid", "profile", "email"],
  redirectUri: getEnv("VITE_AZURE_REDIRECT_URI") || "/auth/callback",
};

// Scopes for Azure Resource Management / Resource Graph (Workspace Discovery)
export const armTokenRequest = {
  scopes: ["https://management.azure.com/user_impersonation"]
};

// Scopes for Microsoft Graph API (User Profile & Group Resolution)
export const graphTokenRequest = {
  scopes: ["https://graph.microsoft.com/User.Read"]
};
