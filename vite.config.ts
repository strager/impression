import vue from "@vitejs/plugin-vue";
import { visualizer } from "rollup-plugin-visualizer";
import { defineConfig } from "vite";

export default defineConfig({
	root: "frontend",
	server: {
		allowedHosts: true,
	},
	plugins: [
		vue(),
		visualizer({
			filename: "client-bundle-report.html",
			template: "treemap",
			gzipSize: true,
			brotliSize: true,
			emitFile: true,
		}),
	],
});
