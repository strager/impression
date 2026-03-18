import path from "node:path";
import url from "node:url";

import express from "express";

import { createApp } from "./app.ts";
import { notifyReady } from "./systemd-notify.ts";

const port = Number(process.env.PORT ?? "3011");
const isProduction = process.env.NODE_ENV === "production";

async function main(): Promise<void> {
	const app = await createApp();

	if (isProduction) {
		const frontendDist = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "../frontend/dist");
		app.use(express.static(frontendDist));
		app.use((req, res, next) => {
			if (req.method !== "GET" || req.path.startsWith("/api")) {
				next();
				return;
			}
			res.sendFile(path.join(frontendDist, "index.html"));
		});
	} else {
		const { createServer: createViteServer, mergeConfig } = await import("vite");
		const { default: viteConfig } = await import("../vite.config.ts");
		const vite = await createViteServer(
			mergeConfig(viteConfig, {
				configFile: false,
				server: { middlewareMode: true },
				appType: "spa",
			}),
		);
		app.locals.vite = vite;
		app.use(vite.middlewares);
	}

	app.listen(port, () => {
		const mode = isProduction ? "production" : "dev";
		console.log(`Impression ${mode} server listening at http://localhost:${port.toString()}`);
		void notifyReady();
	});
}

main().catch((error: unknown) => {
	console.error("Failed to start Impression:", error);
	process.exitCode = 1;
});
