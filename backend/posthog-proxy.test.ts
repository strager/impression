import type { Server } from "node:http";

import express from "express";
import { http, HttpResponse, passthrough } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createAnalyticsHandler } from "./posthog-proxy.ts";

const TEST_ORIGIN = "http://test.local";
process.env.ORIGIN = TEST_ORIGIN;

let lastUpstreamRequest: Request | undefined;

const mswServer = setupServer(
	http.all(/^http:\/\/127\.0\.0\.1/, () => passthrough()),
	http.all("https://us.i.posthog.com/*", ({ request }) => {
		lastUpstreamRequest = request;
		return HttpResponse.json({ status: 1 });
	}),
	http.all("https://us-assets.i.posthog.com/*", ({ request }) => {
		lastUpstreamRequest = request;
		return new HttpResponse("/* js */", {
			headers: {
				"content-type": "application/javascript",
			},
		});
	}),
);

function getUpstreamUrl(): URL {
	expect(lastUpstreamRequest).toBeDefined();
	return new URL(lastUpstreamRequest!.url);
}

describe("posthog proxy integration", () => {
	let server: Server | undefined;
	let baseUrl = "";
	let savedPosthogKey: string | undefined;

	beforeAll(async () => {
		savedPosthogKey = process.env.POSTHOG_KEY;
		process.env.POSTHOG_KEY = "phc_test";

		mswServer.listen({ onUnhandledRequest: "error" });

		const app = express();
		app.use(createAnalyticsHandler());
		app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
			res.status(500).json({ error: "internal" });
		});

		await new Promise<void>((resolve, reject) => {
			const candidate = app.listen(0, "127.0.0.1", () => {
				server = candidate;
				resolve();
			});
			candidate.on("error", reject);
		});

		if (server === undefined) {
			throw new Error("Server failed to start.");
		}

		const address = server.address();
		if (address === null || typeof address === "string") {
			throw new Error("Expected server to listen on a TCP port.");
		}

		baseUrl = `http://127.0.0.1:${address.port.toString()}`;
	});

	beforeEach(() => {
		lastUpstreamRequest = undefined;
	});

	afterEach(() => {
		mswServer.resetHandlers();
	});

	afterAll(async () => {
		if (savedPosthogKey === undefined) {
			delete process.env.POSTHOG_KEY;
		} else {
			process.env.POSTHOG_KEY = savedPosthogKey;
		}

		mswServer.close();

		if (server !== undefined) {
			const runningServer = server;
			await new Promise<void>((resolve, reject) => {
				runningServer.close((error) => {
					if (error !== undefined) {
						reject(error);
						return;
					}
					resolve();
				});
			});
		}
	});

	it("POST /capture with same-origin returns upstream response", async () => {
		const res = await fetch(`${baseUrl}/capture`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body: JSON.stringify({ event: "test" }),
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 1 });

		const upstreamUrl = getUpstreamUrl();
		expect(upstreamUrl.hostname).toBe("us.i.posthog.com");
		expect(upstreamUrl.pathname).toBe("/capture");
		expect(upstreamUrl.searchParams.get("api_key")).toBe("phc_test");
	});

	it("POST /capture with cross-origin returns 403", async () => {
		const res = await fetch(`${baseUrl}/capture`, {
			method: "POST",
			headers: {
				origin: "http://evil.example.com",
				"content-type": "application/json",
			},
			body: JSON.stringify({ event: "test" }),
		});

		expect(res.status).toBe(403);
		expect(lastUpstreamRequest).toBeUndefined();
	});

	it("POST /capture with no origin header returns 403", async () => {
		const res = await fetch(`${baseUrl}/capture`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({ event: "test" }),
		});

		expect(res.status).toBe(403);
		expect(lastUpstreamRequest).toBeUndefined();
	});

	it("GET /capture returns 404", async () => {
		const res = await fetch(`${baseUrl}/capture`);

		expect(res.status).toBe(404);
		expect(lastUpstreamRequest).toBeUndefined();
	});

	it("GET /flags returns upstream response", async () => {
		const res = await fetch(`${baseUrl}/flags`);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: 1 });

		const upstreamUrl = getUpstreamUrl();
		expect(upstreamUrl.hostname).toBe("us.i.posthog.com");
	});

	it("GET /static/array.js returns upstream response from asset host", async () => {
		const res = await fetch(`${baseUrl}/static/array.js`);

		expect(res.status).toBe(200);
		expect(await res.text()).toBe("/* js */");

		const upstreamUrl = getUpstreamUrl();
		expect(upstreamUrl.hostname).toBe("us-assets.i.posthog.com");
		expect(upstreamUrl.searchParams.get("api_key")).toBeNull();
	});

	it("GET /array/proxy/config.js rewrites path for upstream", async () => {
		const res = await fetch(`${baseUrl}/array/proxy/config.js`);

		expect(res.status).toBe(200);

		const upstreamUrl = getUpstreamUrl();
		expect(upstreamUrl.pathname).toBe("/array/phc_test/config.js");
		expect(upstreamUrl.searchParams.get("api_key")).toBeNull();
	});

	it("POST /static/array.js returns 404", async () => {
		const res = await fetch(`${baseUrl}/static/array.js`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
			},
		});

		expect(res.status).toBe(404);
		expect(lastUpstreamRequest).toBeUndefined();
	});

	it("sanitizes upstream response headers", async () => {
		mswServer.use(
			http.all("https://us.i.posthog.com/*", ({ request }) => {
				lastUpstreamRequest = request;
				return new HttpResponse(JSON.stringify({ status: 1 }), {
					headers: {
						"content-type": "application/json",
						"cache-control": "public, max-age=60",
						"set-cookie": "secret=value",
						"x-custom": "should-be-stripped",
					},
				});
			}),
		);

		const res = await fetch(`${baseUrl}/flags`);

		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/json");
		expect(res.headers.get("cache-control")).toBe("public, max-age=60");
		expect(res.headers.get("set-cookie")).toBeNull();
		expect(res.headers.get("x-custom")).toBeNull();
	});

	it("forwards request body to upstream", async () => {
		const body = JSON.stringify({ event: "click", properties: { x: 1 } });

		const res = await fetch(`${baseUrl}/capture`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
		const upstreamBody = await lastUpstreamRequest!.text();
		expect(upstreamBody).toBe(body);
	});

	it("returns 500 when upstream fetch fails", async () => {
		mswServer.use(
			http.all("https://us.i.posthog.com/*", () => {
				return HttpResponse.error();
			}),
		);

		const res = await fetch(`${baseUrl}/capture`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body: JSON.stringify({ event: "test" }),
		});

		expect(res.status).toBe(500);
	});

	it("rewrites proxy token in event array body", async () => {
		const body = JSON.stringify([
			{ event: "test", properties: { token: "proxy", x: 1 } },
			{ event: "click", properties: { token: "proxy" } },
		]);

		const res = await fetch(`${baseUrl}/e/`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
		const upstreamBody = JSON.parse(await lastUpstreamRequest!.text());
		expect(upstreamBody).toEqual([
			{ event: "test", properties: { token: "phc_test", x: 1 } },
			{ event: "click", properties: { token: "phc_test" } },
		]);
	});

	it("rewrites proxy api_key in batch object body", async () => {
		const body = JSON.stringify({ api_key: "proxy", batch: [{ event: "test" }], sent_at: "2026-05-15T00:00:00Z" });

		const res = await fetch(`${baseUrl}/batch/`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
		const upstreamBody = JSON.parse(await lastUpstreamRequest!.text());
		expect(upstreamBody).toEqual({ api_key: "phc_test", batch: [{ event: "test" }], sent_at: "2026-05-15T00:00:00Z" });
	});

	it("rewrites proxy token in flags object body", async () => {
		const body = JSON.stringify({ token: "proxy", distinct_id: "x" });

		const res = await fetch(`${baseUrl}/flags/`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
		const upstreamBody = JSON.parse(await lastUpstreamRequest!.text());
		expect(upstreamBody).toEqual({ token: "phc_test", distinct_id: "x" });
	});

	it("does not rewrite non-proxy token in body", async () => {
		const body = JSON.stringify({ token: "something_else", distinct_id: "x" });

		const res = await fetch(`${baseUrl}/flags/`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body,
		});

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
		const upstreamBody = JSON.parse(await lastUpstreamRequest!.text());
		expect(upstreamBody).toEqual({ token: "something_else", distinct_id: "x" });
	});

	it("returns 400 for POST with wrong content-type", async () => {
		const res = await fetch(`${baseUrl}/e/`, {
			method: "POST",
			headers: {
				origin: TEST_ORIGIN,
				"content-type": "text/plain",
			},
			body: "not json",
		});

		expect(res.status).toBe(400);
		expect(lastUpstreamRequest).toBeUndefined();
	});

	it("GET endpoints are unaffected by content-type check", async () => {
		const res = await fetch(`${baseUrl}/flags`);

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
	});

	it("forwards x-forwarded-host and x-forwarded-proto to upstream", async () => {
		const res = await fetch(`${baseUrl}/capture`, {
			method: "POST",
			headers: {
				"x-forwarded-host": "public.example.com",
				"x-forwarded-proto": "https",
				origin: TEST_ORIGIN,
				"content-type": "application/json",
			},
			body: JSON.stringify({ event: "test" }),
		});

		expect(res.status).toBe(200);
		expect(lastUpstreamRequest).toBeDefined();
		expect(lastUpstreamRequest!.headers.get("x-forwarded-host")).toBe("public.example.com");
		expect(lastUpstreamRequest!.headers.get("x-forwarded-proto")).toBe("https");
	});
});
