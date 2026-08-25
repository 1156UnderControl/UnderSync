import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { App, MissingConvexConfiguration } from "./App";
import "./styles.css";

const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();
const root = ReactDOM.createRoot(document.getElementById("root")!);

root.render(
  <React.StrictMode>
    {convexUrl ? (
      <ConvexProvider client={new ConvexReactClient(convexUrl)}>
        <App />
      </ConvexProvider>
    ) : (
      <MissingConvexConfiguration />
    )}
  </React.StrictMode>,
);
