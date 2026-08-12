window.NUVIO_COLLECTION_DATA = [
  {
    id: 'trending-new',
    title: 'Trending & New',
    description: 'The fastest-moving rows for what is new, popular, and worth opening tonight.',
    icon: '✦',
    accent: 'cyan',
    tags: ['featured', 'trending', 'movies', 'tv'],
    folders: [
      { id: 'trending-movies', title: 'Trending Movies', type: 'movie', sourceCount: 2, enabled: true },
      { id: 'new-releases', title: 'New Releases', type: 'movie', sourceCount: 2, enabled: true },
      { id: 'premieres', title: 'Premieres', type: 'mixed', sourceCount: 1, enabled: true },
      { id: 'popular-now', title: 'Popular', type: 'mixed', sourceCount: 2, enabled: true }
    ]
  },
  {
    id: 'top-picks',
    title: 'Top Picks',
    description: 'High-quality discovery rows for ratings, recommendations, and award favorites.',
    icon: '★',
    accent: 'indigo',
    tags: ['featured', 'movies', 'tv'],
    folders: [
      { id: 'top-rated', title: 'Top Rated', type: 'mixed', sourceCount: 2, enabled: true },
      { id: 'recommended', title: 'Recommended For You', type: 'mixed', sourceCount: 1, enabled: true },
      { id: 'award-winners', title: 'Award Winners', type: 'movie', sourceCount: 2, enabled: false }
    ]
  },
  {
    id: 'tv-networks',
    title: 'TV Networks',
    description: 'Network-driven rows for broadcast, cable, prestige TV, documentary, and reality.',
    icon: '▣',
    accent: 'purple',
    tags: ['featured', 'tv', 'networks'],
    folders: [
      { id: 'nbc', title: 'NBC', type: 'series', sourceCount: 1, enabled: true },
      { id: 'cbs', title: 'CBS', type: 'series', sourceCount: 1, enabled: true },
      { id: 'hbo', title: 'HBO', type: 'series', sourceCount: 1, enabled: true },
      { id: 'fx', title: 'FX', type: 'series', sourceCount: 1, enabled: false },
      { id: 'tnt', title: 'TNT', type: 'series', sourceCount: 1, enabled: false },
      { id: 'usa-network', title: 'USA Network', type: 'series', sourceCount: 1, enabled: false },
      { id: 'discovery', title: 'Discovery', type: 'series', sourceCount: 1, enabled: true },
      { id: 'natgeo', title: 'National Geographic', type: 'series', sourceCount: 1, enabled: true },
      { id: 'hgtv', title: 'HGTV', type: 'series', sourceCount: 1, enabled: false },
      { id: 'tlc', title: 'TLC', type: 'series', sourceCount: 1, enabled: false }
    ]
  },
  {
    id: 'anime',
    title: 'Anime',
    description: 'A dedicated anime section with evergreen series, current hits, and studio favorites.',
    icon: '◉',
    accent: 'magenta',
    tags: ['featured', 'tv', 'anime'],
    folders: [
      { id: 'anime-trending', title: 'Anime Trending', type: 'series', sourceCount: 2, enabled: true },
      { id: 'anime-top-rated', title: 'Anime Top Rated', type: 'series', sourceCount: 2, enabled: true },
      { id: 'anime-premieres', title: 'Anime Premieres', type: 'series', sourceCount: 1, enabled: true },
      { id: 'studio-ghibli', title: 'Studio Ghibli', type: 'movie', sourceCount: 1, enabled: true },
      { id: 'gundam', title: 'Gundam', type: 'series', sourceCount: 1, enabled: false },
      { id: 'dragon-ball', title: 'Dragon Ball', type: 'series', sourceCount: 1, enabled: false },
      { id: 'naruto', title: 'Naruto', type: 'series', sourceCount: 1, enabled: false }
    ]
  },
  {
    id: 'genres',
    title: 'Genres',
    description: 'Fast genre shortcuts for the moods you reach for most often.',
    icon: '◇',
    accent: 'blue',
    tags: ['movies', 'tv', 'scifi', 'horror', 'family', 'documentary'],
    folders: [
      { id: 'action', title: 'Action', type: 'mixed', sourceCount: 2, enabled: true },
      { id: 'science-fiction', title: 'Science Fiction', type: 'mixed', sourceCount: 2, enabled: true },
      { id: 'horror', title: 'Horror', type: 'mixed', sourceCount: 2, enabled: true },
      { id: 'drama', title: 'Drama', type: 'mixed', sourceCount: 2, enabled: false },
      { id: 'comedy', title: 'Comedy', type: 'mixed', sourceCount: 2, enabled: false },
      { id: 'documentary', title: 'Documentaries', type: 'mixed', sourceCount: 1, enabled: true },
      { id: 'family', title: 'Kids & Family', type: 'mixed', sourceCount: 1, enabled: false }
    ]
  },
  {
    id: 'decades',
    title: 'Decades',
    description: 'Jump straight into a movie era, from modern favorites back through the classics.',
    icon: '◷',
    accent: 'gold',
    tags: ['movies', 'classics'],
    folders: [
      { id: '2020s', title: '2020s', type: 'movie', sourceCount: 1, enabled: true },
      { id: '2010s', title: '2010s', type: 'movie', sourceCount: 1, enabled: true },
      { id: '2000s', title: '2000s', type: 'movie', sourceCount: 1, enabled: true },
      { id: '1990s', title: '1990s', type: 'movie', sourceCount: 1, enabled: false },
      { id: '1980s', title: '1980s', type: 'movie', sourceCount: 1, enabled: false },
      { id: '1970s', title: '1970s', type: 'movie', sourceCount: 1, enabled: false },
      { id: '1960s', title: '1960s', type: 'movie', sourceCount: 1, enabled: false }
    ]
  },
  {
    id: 'actors',
    title: 'Actor Collections',
    description: 'Personalized filmographies for favorite performers and classic screen icons.',
    icon: '◎',
    accent: 'emerald',
    tags: ['movies', 'classics'],
    folders: [
      { id: 'john-wayne', title: 'John Wayne', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'frank-sinatra', title: 'Frank Sinatra', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'gary-cooper', title: 'Gary Cooper', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'arnold-schwarzenegger', title: 'Arnold Schwarzenegger', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'denzel-washington', title: 'Denzel Washington', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'tom-cruise', title: 'Tom Cruise', type: 'movie', sourceCount: 1, enabled: false }
    ]
  },
  {
    id: 'directors',
    title: 'Director Collections',
    description: 'Browse movies by filmmaker with dedicated rows for major directors.',
    icon: '◈',
    accent: 'violet',
    tags: ['movies', 'classics'],
    folders: [
      { id: 'christopher-nolan', title: 'Christopher Nolan', type: 'movie', sourceCount: 1, enabled: true },
      { id: 'steven-spielberg', title: 'Steven Spielberg', type: 'movie', sourceCount: 1, enabled: true },
      { id: 'denis-villeneuve', title: 'Denis Villeneuve', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'james-cameron', title: 'James Cameron', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'martin-scorsese', title: 'Martin Scorsese', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'david-fincher', title: 'David Fincher', type: 'movie', sourceCount: 1, enabled: false }
    ]
  },
  {
    id: 'seasonal',
    title: 'Seasonal & Holiday',
    description: 'Rotating seasonal rows you can turn on when they are relevant and hide afterward.',
    icon: '✣',
    accent: 'rose',
    tags: ['movies', 'family'],
    folders: [
      { id: 'halloween', title: 'Halloween', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'christmas', title: 'Christmas', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'thanksgiving', title: 'Thanksgiving', type: 'movie', sourceCount: 1, enabled: false },
      { id: 'valentines', title: "Valentine's Day", type: 'movie', sourceCount: 1, enabled: false }
    ]
  }
];
