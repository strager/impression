<script setup lang="ts">
defineProps<{
	active?: boolean;
	disabled?: boolean;
	variant?: "primary" | "neutral";
}>();

defineEmits<{
	toggle: [];
}>();
</script>

<template>
	<!-- eslint-disable-next-line vue/no-restricted-html-elements -->
	<button class="toggle-btn" :class="[active ? `active-${variant ?? 'primary'}` : '']" :disabled="disabled" :aria-pressed="active" @click="$emit('toggle')">
		<slot />
	</button>
</template>

<style scoped>
.toggle-btn {
	font-size: var(--text-sm);
	padding: var(--space-1) var(--space-3);
	border: 1px solid var(--color-gray-200);
	background: transparent;
	color: var(--color-gray-400);
}

.active-primary {
	background: var(--color-green-600);
	border-color: var(--color-green-600);
	color: var(--color-white);
}

.active-neutral {
	background: var(--color-gray-600);
	border-color: var(--color-gray-600);
	color: var(--color-white);
}
</style>
