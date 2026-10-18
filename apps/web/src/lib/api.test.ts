import { afterEach, expect, it, vi } from "vitest";
import examples from "../../../../contracts.examples.json";
import type { Place } from "@astana/api-client";
import { createApi } from "./api";

afterEach(() => vi.unstubAllGlobals());
const place = () =>
  structuredClone(
    examples.cases.find((c) => c.name === "place_valid")!.instance,
  ) as Place;
it("blocks synthetic data without explicit opt-in, even if the mode header is absent", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(place())));
  await expect(
    createApi(false, vi.fn()).place(
      "synthetic:place:one",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "fixture_disabled" });
});
it("rejects synthetic payloads claimed as live", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json(place(), { headers: { "X-Astana-Data-Mode": "live" } }),
      ),
  );
  await expect(
    createApi(true, vi.fn()).place(
      "synthetic:place:one",
      new AbortController().signal,
    ),
  ).rejects.toMatchObject({ code: "fixture_disabled" });
});
it("rejects malformed response shapes instead of showing fabricated results", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ places: ["wrong shape"] })),
  );
  await expect(
    createApi(true, vi.fn()).places(new AbortController().signal),
  ).rejects.toMatchObject({ code: "invalid_response" });
});
it("preserves safe error code and reference without exposing provider text", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json(
        {
          request_id: "safe-reference",
          error: {
            code: "rate_limited",
            message: "private-provider-detail",
            details: [],
            retryable: true,
          },
        },
        { status: 429 },
      ),
    ),
  );
  await expect(
    createApi(true, vi.fn()).places(new AbortController().signal),
  ).rejects.toMatchObject({
    code: "rate_limited",
    requestId: "safe-reference",
    message: "rate_limited",
  });
});
it("does not retry an aborted or failed operation", async () => {
  const fetch = vi
    .fn()
    .mockRejectedValue(new DOMException("Cancelled", "AbortError"));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort();
  await expect(
    createApi(true, vi.fn()).places(controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(fetch).toHaveBeenCalledTimes(1);
});
