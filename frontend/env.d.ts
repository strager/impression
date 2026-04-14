/// <reference types="vite/client" />

declare module "*.vue" {
	import type { DefineComponent } from "vue";

	const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
	export default component;
}

// VirtualKeyboard API (Chromium-only). Not yet in lib.dom.d.ts.
// https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API
interface VirtualKeyboard extends EventTarget {
	readonly boundingRect: DOMRectReadOnly;
	overlaysContent: boolean;
}

interface Navigator {
	readonly virtualKeyboard?: VirtualKeyboard;
}
