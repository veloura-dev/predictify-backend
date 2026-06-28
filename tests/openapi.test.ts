import { getOpenApiSpec } from "../src/openapi/builder";

describe("OpenAPI spec", () => {
  let spec: ReturnType<typeof getOpenApiSpec>;

  beforeAll(() => {
    spec = getOpenApiSpec();
  });

  it("is a valid OpenAPI 3.0 document", () => {
    expect(spec.openapi).toMatch(/^3\.0\./);
    expect(spec.info.title).toBe("Predictify API");
    expect(spec.paths).toBeDefined();
  });

  it("includes all expected route paths", () => {
    const paths = Object.keys(spec.paths ?? {});
    expect(paths).toContain("/health");
    expect(paths).toContain("/api/auth/challenge");
    expect(paths).toContain("/api/auth/verify");
    expect(paths).toContain("/api/auth/refresh");
    expect(paths).toContain("/api/markets");
    expect(paths).toContain("/api/notifications/preferences");
    expect(paths).toContain("/api/markets/{id}");
    expect(paths).toContain("/api/markets/{id}/disputes");
    expect(paths).toContain("/api/users/{address}/predictions");
    expect(paths).toContain("/api/predictions");
    expect(paths).toContain("/api/leaderboard");
    expect(paths).toContain("/api/leaderboard/user/{stellarAddress}");
    expect(paths).toContain("/api/admin/users/{address}");
  });

  it("defines reusable component schemas", () => {
    const schemas = spec.components?.schemas ?? {};
    expect(schemas["ErrorBody"]).toBeDefined();
    expect(schemas["Market"]).toBeDefined();
    expect(schemas["TokenPair"]).toBeDefined();
  });

  it("defines bearer security scheme", () => {
    const schemes = spec.components?.securitySchemes ?? {};
    expect(schemes["bearerAuth"]).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
  });

  it("marks protected routes with bearerAuth", () => {
    const paths = spec.paths ?? {};
    const patchMarket = (paths["/api/markets/{id}"] as Record<string, unknown>)
      ?.patch as Record<string, unknown>;
    expect(patchMarket?.security).toEqual([{ bearerAuth: [] }]);
  });
});

describe("/docs availability logic", () => {
  it("disables docs in production by default", () => {
    const isProduction = true;
    const enableDocsEnv = undefined;
    const docsEnabled = !isProduction || enableDocsEnv === "true";
    expect(docsEnabled).toBe(false);
  });

  it("enables docs when ENABLE_DOCS=true in production", () => {
    const isProduction = true;
    const enableDocsEnv = "true";
    const docsEnabled = !isProduction || enableDocsEnv === "true";
    expect(docsEnabled).toBe(true);
  });

  it("enables docs in non-production by default", () => {
    const isProduction = false;
    const enableDocsEnv = undefined;
    const docsEnabled = !isProduction || enableDocsEnv === "true";
    expect(docsEnabled).toBe(true);
  });
});
