import { onBeforeUnmount, ref, type Ref } from "vue";

export function useMatchMedia(query: string): Ref<boolean> {
	const mediaQuery = window.matchMedia(query);
	const matches = ref(mediaQuery.matches);
	function onChange(): void {
		matches.value = mediaQuery.matches;
	}
	mediaQuery.addEventListener("change", onChange);
	onBeforeUnmount(() => {
		mediaQuery.removeEventListener("change", onChange);
	});
	return matches;
}
