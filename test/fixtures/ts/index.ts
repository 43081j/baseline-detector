interface Item {
  id: number;
  name: string;
}

export const load = async (url: string): Promise<Item[]> => {
  const response = await fetch(url);
  const data = (await response.json()) as { items?: Item[] };
  return data?.items ?? [];
};

export const findName = (items: Item[], id: number): string | undefined => {
  return items.find((item) => item.id === id)?.name;
};
