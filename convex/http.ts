import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { onshapeCallback } from "./onshapeHttp";

const http = httpRouter();
auth.addHttpRoutes(http);
http.route({
  path: "/integrations/onshape/callback",
  method: "GET",
  handler: onshapeCallback,
});

export default http;
