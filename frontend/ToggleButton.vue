<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
	active?: boolean;
	disabled?: boolean;
	variant?: "primary" | "neutral";
}>();

defineEmits<{
	toggle: [];
}>();

const btnClass = computed(() => {
	if (props.active) {
		return props.variant === "neutral" ? "btn-neutral" : "btn-primary";
	}
	return "btn-neutral-secondary";
});
</script>

<template>
	<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
	<button class="toggle-btn" :class="btnClass" :disabled="disabled" :aria-pressed="active" @click="$emit('toggle')">
		<slot />
	</button>
</template>

<style scoped>
.toggle-btn {
	font-size: var(--text-sm);
	padding: var(--space-1) var(--space-3);
}

.toggle-btn.btn-neutral-secondary {
	border-color: var(--color-gray-200);
	color: var(--color-gray-400);
}
</style>
