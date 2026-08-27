/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as auth from "../auth.js";
import type * as cots from "../cots.js";
import type * as cotsAdmin from "../cotsAdmin.js";
import type * as dashboard from "../dashboard.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_onshapeConfig from "../lib/onshapeConfig.js";
import type * as lib_onshapeCrypto from "../lib/onshapeCrypto.js";
import type * as onshapeHttp from "../onshapeHttp.js";
import type * as onshapeOAuth from "../onshapeOAuth.js";
import type * as onshapeOAuthData from "../onshapeOAuthData.js";
import type * as onshapeParts from "../onshapeParts.js";
import type * as parts from "../parts.js";
import type * as partsConfig from "../partsConfig.js";
import type * as profiles from "../profiles.js";
import type * as system from "../system.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  auth: typeof auth;
  cots: typeof cots;
  cotsAdmin: typeof cotsAdmin;
  dashboard: typeof dashboard;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  "lib/onshapeConfig": typeof lib_onshapeConfig;
  "lib/onshapeCrypto": typeof lib_onshapeCrypto;
  onshapeHttp: typeof onshapeHttp;
  onshapeOAuth: typeof onshapeOAuth;
  onshapeOAuthData: typeof onshapeOAuthData;
  onshapeParts: typeof onshapeParts;
  parts: typeof parts;
  partsConfig: typeof partsConfig;
  profiles: typeof profiles;
  system: typeof system;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
