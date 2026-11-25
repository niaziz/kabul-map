export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8100";

export type Place = {
  id: string; name: string; name_fa?: string;
  category: string; lat: number; lng: number; description?: string;
  imageUrl?: string; imageSourceUrl?: string; imageCredit?: string;
  modelUrl?: string; modelEmbedUrl?: string; modelCredit?: string;
  source?: string;
};

export async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
