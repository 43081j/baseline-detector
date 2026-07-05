export const load = async (url) => {
  const response = await fetch(url);
  const data = await response.json();
  return data?.items ?? [];
};

export const merge = (a, b) => ({ ...a, ...b });
