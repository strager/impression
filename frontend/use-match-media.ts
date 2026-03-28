import { onBeforeUnmount, ref, type Ref } from "vue";
import { onMatchMedia } from "./on-match-media.ts";

export function useMatchMedia(query: string): Ref<boolean> {
	const matches = ref(false);
	const cleanup = onMatchMedia(query, (v) => {
		matches.value = v;
	});
	onBeforeUnmount(cleanup);
	return matches;
}
