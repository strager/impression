// SSR entry point for server-side PDF rendering. In dev, loaded via
// vite.ssrLoadModule(); in production, imported from the SSR build output
// (dist-ssr/). Exports renderPdfHtml() which returns a complete HTML document
// with inlined CSS and base64-encoded fonts.

import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";

import ReportContent from "./ReportContent.vue";
import type { CardReport } from "../shared/report-types.ts";
import globalCss from "./global.css?inline";

const pagedMediaCss = `
@page {
	size: A4;
	margin: 20mm 18mm 25mm 18mm;
}
h2, h3, h4 {
	break-after: avoid;
}
.report-card {
	break-inside: avoid;
}
.qa-block {
	break-inside: avoid;
}
`;

export async function renderPdfHtml(fontCss: string, componentCss: string, reports: CardReport[]): Promise<string> {
	const app = createSSRApp(ReportContent, { reports });
	const html = await renderToString(app);

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Impression Report</title>
<style>
${globalCss}
</style>
<style>
${fontCss}
</style>
<style>
${componentCss}
</style>
<style>
${pagedMediaCss}
</style>
</head>
<body>
${html}
</body>
</html>`;
}
