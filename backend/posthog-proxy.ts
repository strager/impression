import express, { type Router } from "express";

import { ANALYTICS_PROXY_TOKEN } from "../shared/analytics-config.ts";
import { firstHeaderValue, isAllowedOrigin, requestHost, requestProtocol, shouldCheckOrigin } from "./origin-check.ts";

const POSTHOG_API_HOST = "us.i.posthog.com";
const POSTHOG_ASSET_HOST = "us-assets.i.posthog.com";

const LOG_POSTHOG_REQUEST_BODIES = false;

const ALLOWED_REQUEST_HEADERS = new Set(["accept", "accept-encoding", "content-type", "user-agent"]);

const ALLOWED_RESPONSE_HEADERS = new Set(["cache-control", "content-type", "date", "etag", "expires", "last-modified", "vary"]);

const ALLOWED_POST_PATHS = new Set(["/batch", "/batch/", "/capture", "/capture/", "/decide", "/decide/", "/e", "/e/", "/flags", "/flags/", "/s", "/s/"]);
const ALLOWED_GET_PATHS = new Set(["/flags", "/flags/"]);

export function resolvePosthogHost(pathname: string): string {
	return isAssetPath(pathname) ? POSTHOG_ASSET_HOST : POSTHOG_API_HOST;
}

export function isAllowedEndpoint(method: string, pathname: string): boolean {
	if (isAssetPath(pathname)) {
		return method === "GET" || method === "HEAD";
	}
	if (method === "POST") {
		return ALLOWED_POST_PATHS.has(pathname);
	}
	if (method === "GET") {
		return ALLOWED_GET_PATHS.has(pathname);
	}
	return false;
}

export function copyRequestHeaders(headers: Record<string, string | string[] | undefined>): Headers {
	const result = new Headers();
	for (const name of ALLOWED_REQUEST_HEADERS) {
		const value = headers[name];
		if (value === undefined) {
			continue;
		}
		if (Array.isArray(value)) {
			for (const item of value) {
				result.append(name, item);
			}
		} else {
			result.set(name, value);
		}
	}
	return result;
}

export function rewriteArrayProxyPath(pathname: string, apiKey: string): string {
	const prefix = `/array/${ANALYTICS_PROXY_TOKEN}/`;
	if (!pathname.startsWith(prefix)) {
		return pathname;
	}
	return `/array/${apiKey}/${pathname.slice(prefix.length)}`;
}

export function isAssetPath(pathname: string): boolean {
	return pathname.startsWith("/static/") || pathname.startsWith("/array/");
}

export function rewriteTokenInBody(data: unknown, apiKey: string): void {
	if (Array.isArray(data)) {
		const elements: unknown[] = data;
		for (const element of elements) {
			if (typeof element === "object" && element !== null && "properties" in element && typeof element.properties === "object" && element.properties !== null && "token" in element.properties && element.properties.token === ANALYTICS_PROXY_TOKEN) {
				element.properties.token = apiKey;
			}
		}
	} else if (typeof data === "object" && data !== null) {
		if ("token" in data && data.token === ANALYTICS_PROXY_TOKEN) {
			data.token = apiKey;
		}
		if ("api_key" in data && data.api_key === ANALYTICS_PROXY_TOKEN) {
			data.api_key = apiKey;
		}
		if ("properties" in data && typeof data.properties === "object" && data.properties !== null && "token" in data.properties && data.properties.token === ANALYTICS_PROXY_TOKEN) {
			data.properties.token = apiKey;
		}
	}
}

export function hasJsonContentType(contentType: string | undefined): boolean {
	if (contentType === undefined) {
		return false;
	}
	return contentType.split(";")[0].trim().toLowerCase() === "application/json";
}

export function createUpstreamUrl(pathWithQuery: string, posthogHost: string, apiKey: string): URL {
	const url = new URL(pathWithQuery, `https://${posthogHost}`);
	if (url.pathname.startsWith(`/array/${ANALYTICS_PROXY_TOKEN}/`)) {
		url.pathname = rewriteArrayProxyPath(url.pathname, apiKey);
	}
	if (!isAssetPath(url.pathname)) {
		url.searchParams.set("api_key", apiKey);
	}
	return url;
}

function maybeLogRequestBody(enabled: boolean, method: string, pathname: string, body: string): void {
	if (enabled) {
		console.log(`[posthog-proxy] ${method} ${pathname}`, body);
	}
}

export function sanitizeResponseHeaders(headers: Headers): Headers {
	const sanitized = new Headers();
	for (const name of ALLOWED_RESPONSE_HEADERS) {
		const value = headers.get(name);
		if (value !== null) {
			sanitized.set(name, value);
		}
	}
	return sanitized;
}

export function createAnalyticsHandler(): Router {
	const router = express.Router();
	const apiKey = process.env.POSTHOG_KEY;
	const configuredOrigin = process.env.ORIGIN;

	if (apiKey === undefined || apiKey === "") {
		let warned = false;
		router.use((_req, res) => {
			if (!warned) {
				warned = true;
				console.warn("POSTHOG_KEY is not set; analytics requests will be ignored.");
			}
			res.status(200).end();
		});
		return router;
	}

	router.use(express.raw({ type: "*/*" }));
	router.use(async (req, res, next) => {
		try {
			const method = req.method.toUpperCase();
			const pathname = req.path;

			if (!isAllowedEndpoint(method, pathname)) {
				res.status(404).end();
				return;
			}

			if (shouldCheckOrigin(method) && !isAllowedOrigin(req, configuredOrigin)) {
				res.status(403).end();
				return;
			}

			if (method === "POST" && !isAssetPath(pathname) && !hasJsonContentType(firstHeaderValue(req.headers["content-type"]))) {
				res.status(400).end();
				return;
			}

			const posthogHost = resolvePosthogHost(pathname);
			const headers = copyRequestHeaders(req.headers);
			headers.set("host", posthogHost);

			const host = requestHost(req);
			if (host !== undefined) {
				headers.set("x-forwarded-host", host);
			}

			headers.set("x-forwarded-proto", requestProtocol(req));

			if (req.socket.remoteAddress !== undefined) {
				headers.set("x-real-ip", req.socket.remoteAddress);
				headers.set("x-forwarded-for", req.socket.remoteAddress);
			}

			let body: string | undefined;
			if (method !== "GET" && method !== "HEAD" && Buffer.isBuffer(req.body)) {
				const parsed: unknown = JSON.parse(req.body.toString("utf-8"));
				rewriteTokenInBody(parsed, apiKey);
				body = JSON.stringify(parsed);
				maybeLogRequestBody(LOG_POSTHOG_REQUEST_BODIES, method, pathname, body);
			}
			const upstreamResponse = await fetch(createUpstreamUrl(req.url, posthogHost, apiKey), {
				method,
				headers,
				body,
			});

			res.status(upstreamResponse.status);
			const responseHeaders = sanitizeResponseHeaders(upstreamResponse.headers);
			for (const [name, value] of responseHeaders.entries()) {
				res.setHeader(name, value);
			}

			const responseBody = Buffer.from(await upstreamResponse.arrayBuffer());
			res.send(responseBody);
		} catch (error) {
			next(error);
		}
	});

	return router;
}
