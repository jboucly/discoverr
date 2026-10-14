export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pour comparer titres et artistes : sans accents, casse, ponctuation ni mentions "(feat. …)" / "- Remastered". */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*[([].*?(feat|ft\.|with|remaster|version|edit|mono|stereo).*?[)\]]/g, "")
    .replace(/\s+-\s+.*(remaster|version|edit|mono|stereo).*$/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Premier artiste d'une ligne "A, B & C feat. D". */
export function mainArtist(artist: string): string {
  return artist.split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b|\band\b)\s*/i)[0] ?? artist;
}

export const trackKey = (artist: string, title: string) => `${normalize(mainArtist(artist))}::${normalize(title)}`;
export const artistKey = (artist: string) => normalize(mainArtist(artist));

export const now = () => new Date().toISOString();
