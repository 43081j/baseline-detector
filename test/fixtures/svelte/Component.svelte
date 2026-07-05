<script lang="ts">
  interface Item {
    id: number;
    name: string;
  }

  let items: Item[] = [];

  const load = async () => {
    const response = await fetch('/api/items');
    const data = await response.json();
    items = data?.items ?? [];
  };
</script>

<ul>
  {#each items as item (item.id)}
    <li>{item.name}</li>
  {/each}
</ul>
