<template>
  <ul>
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';

interface Item {
  id: number;
  name: string;
}

const items = ref<Item[]>([]);

onMounted(async () => {
  const response = await fetch('/api/items');
  const data = await response.json();
  items.value = data?.items ?? [];
});
</script>
