import { Configuration, LogLevel } from "@azure/msal-browser";
import { getEnv } from "./env";

export const msalConfig: Configuration = {
  auth: {
    // Read runtime environment variables (injected by server in k8s/production or from Vite env in dev)
    clientId: getEnv("VITE_AZURE_CLIENT_ID"),
    authority: `https://login.microsoftonline.com/${getEnv("VITE_AZURE_TENANT_ID") || "common"}`,
    redirectUri: "/",
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

// Add here scopes for id token to be used at MS Identity Platform endpoints.
export const loginRequest = {
  scopes: ["https://management.azure.com/user_impersonation"],
};
