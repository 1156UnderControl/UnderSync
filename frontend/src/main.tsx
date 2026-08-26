import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { App, MissingConvexConfiguration } from "./App";
import "./styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();
const root = ReactDOM.createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    {convexUrl ? (
      <ConvexAuthProvider client={new ConvexReactClient(convexUrl)}>
        <App />
      </ConvexAuthProvider>
    ) : (
      <MissingConvexConfiguration />
    )}
  </React.StrictMode>,
);
