<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
	defineProps<{
		variant: "primary" | "secondary";
		emphasis?: "default" | "muted";
		disabled?: boolean;
	}>(),
	{ emphasis: "default" },
);

const btnClass = computed(() => {
	if (props.emphasis === "muted") {
		return props.variant === "primary" ? "btn-neutral" : "btn-neutral-secondary";
	}
	return `btn-${props.variant}`;
});
</script>

<template>
	<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
	<button :class="btnClass" :disabled="disabled">
		<span><slot /></span>
	</button>
</template>

<style scoped>
span {
	display: block;
	padding: var(--space-2) var(--space-6);
	transition: transform 0.06s ease;
}

button:active span {
	transform: translateY(1px);
}

button:disabled:active span {
	transform: none;
}

@media (prefers-reduced-motion: reduce) {
	span {
		transition: none;
	}
}
</style>
