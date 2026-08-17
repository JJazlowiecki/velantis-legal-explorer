import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getServerEnvMock = vi.fn();
vi.mock("@/lib/env/server", () => ({ getServerEnv: getServerEnvMock }));

describe("sendMail", () => {
  beforeEach(() => {
    vi.resetModules();
    getServerEnvMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns not_configured and makes ZERO network calls when MAIL_API_KEY/MAIL_FROM are missing — never a fake success", async () => {
    getServerEnvMock.mockReturnValue({ MAIL_API_KEY: undefined, MAIL_FROM: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { sendMail } = await import("./send");
    const result = await sendMail({ to: "user@example.com", subject: "Test", html: "<p>hi</p>", text: "hi" });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns not_configured when only MAIL_API_KEY is set (MAIL_FROM missing)", async () => {
    getServerEnvMock.mockReturnValue({ MAIL_API_KEY: "key", MAIL_FROM: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { sendMail } = await import("./send");
    const result = await sendMail({ to: "user@example.com", subject: "Test", html: "<p>hi</p>", text: "hi" });

    expect(result).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the mail provider with the expected request shape when configured, and reports ok:true on success", async () => {
    getServerEnvMock.mockReturnValue({ MAIL_API_KEY: "test-key", MAIL_FROM: "Velantis <noreply@example.com>" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const { sendMail } = await import("./send");
    const result = await sendMail({ to: "user@example.com", subject: "Reset hasła", html: "<p>hi</p>", text: "hi" });

    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ from: "Velantis <noreply@example.com>", to: "user@example.com", subject: "Reset hasła" });
  });

  it("reports provider_error (never a fake ok:true) when the provider responds with a non-2xx status", async () => {
    getServerEnvMock.mockReturnValue({ MAIL_API_KEY: "test-key", MAIL_FROM: "noreply@example.com" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    vi.stubGlobal("fetch", fetchMock);

    const { sendMail } = await import("./send");
    const result = await sendMail({ to: "user@example.com", subject: "Test", html: "<p>hi</p>", text: "hi" });

    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });

  it("reports provider_error (never throws) when the network request itself fails", async () => {
    getServerEnvMock.mockReturnValue({ MAIL_API_KEY: "test-key", MAIL_FROM: "noreply@example.com" });
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchMock);

    const { sendMail } = await import("./send");
    const result = await sendMail({ to: "user@example.com", subject: "Test", html: "<p>hi</p>", text: "hi" });

    expect(result).toEqual({ ok: false, reason: "provider_error" });
  });
});
