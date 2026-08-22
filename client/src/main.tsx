import React from "react";
import { createRoot } from "react-dom/client";
import { PublicClientApplication } from "@azure/msal-browser";
import { MsalProvider } from "@azure/msal-react";
import { App } from "./App";
import { msalConfig } from "./authConfig";
import "./styles.css";

const msalInstance = new PublicClientApplication(msalConfig);

msalInstance
  .initialize()
  .catch((err) => {
    console.warn("MSAL initialization skipped or failed:", err);
  })
  .finally(() => {
    createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <MsalProvider instance={msalInstance}>
          <App />
        </MsalProvider>
      </React.StrictMode>
    );
  });
