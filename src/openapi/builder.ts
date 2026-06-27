/**
 * Builds and caches the OpenAPI 3.0 document from the central registry.
 * Import `getOpenApiSpec` wherever you need the generated spec object.
 */

import { OpenApiGeneratorV3 } from "@asteasolutions/zod-to-openapi";
import { registry } from "./registry";

let _cached: ReturnType<OpenApiGeneratorV3["generateDocument"]> | null = null;

export function getOpenApiSpec() {
  if (_cached) return _cached;

  _cached = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "Predictify API",
      version: "0.0.1",
      description: "Backend API for Predictify — a Stellar/Soroban prediction-markets dApp",
    },
    servers: [{ url: "/" }],
  });

  return _cached;
}
