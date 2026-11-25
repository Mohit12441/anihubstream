const targets = [
  { key: 'spring-2026', search: 'Solo Leveling Season 2 -Arise from the Shadow-' },
  { key: 'solo-leveling', search: 'Solo Leveling' },
  { key: 'dark-fantasy', search: 'Berserk' },
  { key: 'demon-slayer', search: 'Demon Slayer: Kimetsu no Yaiba' },
  { key: 'jujutsu-kaisen', search: 'Jujutsu Kaisen' },
  { key: 'one-piece', search: 'One Piece' },
  { key: 'isekai', search: 'Mushoku Tensei: Isekai Ittara Honki Dasu' },
  { key: 'attack-on-titan', search: 'Attack on Titan' },
  { key: 'chainsaw-man', search: 'Chainsaw Man' },
  { key: 'frieren', search: 'Sousou no Frieren' },
  { key: 'made-in-abyss', search: 'Made in Abyss' }
];

async function main() {
  const query = `
    query ($search: String) {
      Media(search: $search, type: ANIME) {
        id
        idMal
        title {
          romaji
          english
        }
        bannerImage
        coverImage {
          extraLarge
          large
        }
      }
    }
  `;

  const results = {};
  for (const t of targets) {
    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { search: t.search }
        })
      });
      const data = await res.json();
      const media = data?.data?.Media;
      results[t.key] = {
        title: media?.title?.english || media?.title?.romaji,
        banner: media?.bannerImage,
        cover: media?.coverImage?.extraLarge || media?.coverImage?.large
      };
      console.log(`[${t.key}] -> ${results[t.key].title}`);
      console.log(`   Banner: ${results[t.key].banner}`);
      console.log(`   Cover:  ${results[t.key].cover}`);
    } catch (e) {
      console.error(`Error for ${t.key}:`, e.message);
    }
  }
}

main();
