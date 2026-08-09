import { describe, expect, it } from "vitest";

import { isSidebarItemActive, sidebarBottomItems, sidebarTopItems } from "./sidebar-nav";

describe("sidebar route configuration", () => {
  it("points every sidebar item at a real /explorer sub-route, never a placeholder or /login", () => {
    const allItems = [...sidebarTopItems, ...sidebarBottomItems];

    for (const item of allItems) {
      expect(item.href.startsWith("/explorer")).toBe(true);
      expect(item.href).not.toBe("#");
      expect(item.href).not.toContain("#");
      expect(item.href).not.toBe("/login");
    }
  });

  it("includes exactly the seven required destinations", () => {
    const hrefs = [...sidebarTopItems, ...sidebarBottomItems].map((item) => item.href);
    expect(hrefs).toEqual([
      "/explorer",
      "/explorer/history",
      "/explorer/saved",
      "/explorer/legal-acts",
      "/explorer/account",
      "/explorer/plan",
      "/explorer/settings",
    ]);
  });

  it("Konto now points at the local account concept page, not /login", () => {
    const konto = sidebarBottomItems.find((item) => item.label === "Konto");
    expect(konto?.href).toBe("/explorer/account");
  });
});

describe("isSidebarItemActive", () => {
  it("is active only on an exact pathname match", () => {
    expect(isSidebarItemActive("/explorer", "/explorer")).toBe(true);
    expect(isSidebarItemActive("/explorer/history", "/explorer/history")).toBe(true);
  });

  it("does not mark /explorer active while on a sub-route, or vice versa", () => {
    expect(isSidebarItemActive("/explorer/history", "/explorer")).toBe(false);
    expect(isSidebarItemActive("/explorer", "/explorer/history")).toBe(false);
  });

  it("does not treat sibling routes as active for each other", () => {
    expect(isSidebarItemActive("/explorer/saved", "/explorer/history")).toBe(false);
  });
});
