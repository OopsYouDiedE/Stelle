import { describe, expect, it } from "vitest";
import { ResourceAccessPolicy } from "../../src/core/security/resource_access_policy.js";
import type { ResourceRef } from "../../src/core/protocol/data_ref.js";

describe("ResourceAccessPolicy", () => {
  const policy = new ResourceAccessPolicy();

  it("should allow owner to read private resource", () => {
    const ref: any = { ownerPackageId: "pkg.a", accessScope: "private" };
    expect(policy.canReadResource(ref, "pkg.a")).toBe(true);
    expect(policy.canReadResource(ref, "pkg.b")).toBe(false);
  });

  it("should allow anyone to read public resource", () => {
    const ref: any = { ownerPackageId: "pkg.a", accessScope: "public" };
    expect(policy.canReadResource(ref, "pkg.b")).toBe(true);
  });

  it("should require explicit grants for runtime resource reads", () => {
    const ref: any = { ownerPackageId: "window.live", accessScope: "runtime" };
    expect(policy.canReadResource(ref, "capability.cognition.kernel")).toBe(false);
    expect(policy.canReadResource(ref, "core.data_plane")).toBe(false);
    expect(policy.canReadResource(ref, "window.discord")).toBe(false);
  });

  it("should allow explicitly granted package ids to read private runtime resources", () => {
    const ref: any = {
      ownerPackageId: "window.live",
      accessScope: "runtime",
      allowedPackageIds: ["capability.cognition.kernel", "core.data_plane"],
    };
    expect(policy.canReadResource(ref, "capability.cognition.kernel")).toBe(true);
    expect(policy.canReadResource(ref, "core.data_plane")).toBe(true);
    expect(policy.canReadResource(ref, "window.discord")).toBe(false);
  });
});
