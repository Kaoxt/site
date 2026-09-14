const STUDIOS = new Map([
  ['A24', 'A24 Film'],
  ['Pixar Animation Studios', 'Pixar Film'],
  ['Pixar', 'Pixar Film'],
  ['Studio Ghibli', 'Studio Ghibli'],
  ['Blumhouse Productions', 'Blumhouse'],
  ['NEON', 'NEON Film'],
  ['Neon', 'NEON Film'],
  ['Searchlight Pictures', 'Searchlight Film'],
  ['BBC Film', 'BBC Film'],
  ['BBC Films', 'BBC Film'],
  ['Bad Robot', 'Bad Robot'],
  ['Bad Robot Productions', 'Bad Robot'],
  ['HBO', 'HBO Original'],
  ['Laika Entertainment', 'LAIKA Film'],
  ['Laika', 'LAIKA Film'],
]);

const DIRECTORS = new Map([
  ['Christopher Nolan', 'Christopher Nolan Film'],
  ['Denis Villeneuve', 'Denis Villeneuve Film'],
  ['Martin Scorsese', 'Martin Scorsese Film'],
  ['Wes Anderson', 'Wes Anderson Film'],
  ['Sofia Coppola', 'Sofia Coppola Film'],
  ['Bong Joon-ho', 'Bong Joon-ho Film'],
  ['Hayao Miyazaki', 'Hayao Miyazaki Film'],
  ['David Fincher', 'David Fincher Film'],
  ['Paul Thomas Anderson', 'P.T. Anderson Film'],
  ['Quentin Tarantino', 'Tarantino Film'],
  ['Alfonso Cuarón', 'Alfonso Cuarón Film'],
  ['Guillermo del Toro', 'Guillermo del Toro Film'],
  ['Ridley Scott', 'Ridley Scott Film'],
  ['Steven Spielberg', 'Spielberg Film'],
  ['Joel Coen', 'Coen Brothers Film'],
  ['Ethan Coen', 'Coen Brothers Film'],
  ['David Lynch', 'David Lynch Film'],
  ['Darren Aronofsky', 'Aronofsky Film'],
  ['Yorgos Lanthimos', 'Lanthimos Film'],
  ['Ari Aster', 'Ari Aster Film'],
  ['Jordan Peele', 'Jordan Peele Film'],
  ['Greta Gerwig', 'Greta Gerwig Film'],
  ['Robert Eggers', 'Robert Eggers Film'],
  ['Céline Sciamma', 'Céline Sciamma Film'],
  ['Park Chan-wook', 'Park Chan-wook Film'],
  ['Wong Kar-wai', 'Wong Kar-wai Film'],
  ['Hirokazu Kore-eda', 'Kore-eda Film'],
  ['Luca Guadagnino', 'Guadagnino Film'],
  ['Sean Baker', 'Sean Baker Film'],
  ['Stanley Kubrick', 'Kubrick Film'],
  ['Spike Lee', 'Spike Lee Film'],
  ['David Cronenberg', 'Cronenberg Film'],
  ['Michael Mann', 'Michael Mann Film'],
  ['Francis Ford Coppola', 'F.F. Coppola Film'],
  ['Jane Campion', 'Jane Campion Film'],
  ['Terrence Malick', 'Terrence Malick Film'],
  ['Mike Flanagan', 'Mike Flanagan Series'],
  ['James Cameron', 'James Cameron Film'],
  ['Peter Jackson', 'Peter Jackson Film'],
]);

const CAST = new Map([
  ['Cate Blanchett', 'Cate Blanchett'],
  ['Meryl Streep', 'Meryl Streep'],
  ['Viola Davis', 'Viola Davis'],
  ['Tilda Swinton', 'Tilda Swinton'],
  ['Joaquin Phoenix', 'Joaquin Phoenix'],
  ['Daniel Day-Lewis', 'Daniel Day-Lewis'],
  ['Tom Hanks', 'Tom Hanks'],
  ['Denzel Washington', 'Denzel Washington'],
  ['Leonardo DiCaprio', 'Leonardo DiCaprio'],
  ['Natalie Portman', 'Natalie Portman'],
  ['Nicole Kidman', 'Nicole Kidman'],
  ['Anthony Hopkins', 'Anthony Hopkins'],
  ['Gary Oldman', 'Gary Oldman'],
  ['Ryan Gosling', 'Ryan Gosling'],
  ['Margot Robbie', 'Margot Robbie'],
  ['Adam Driver', 'Adam Driver'],
  ['Saoirse Ronan', 'Saoirse Ronan'],
  ['Oscar Isaac', 'Oscar Isaac'],
  ['Mahershala Ali', 'Mahershala Ali'],
  ["Lupita Nyong'o", "Lupita Nyong'o"],
  ['Pedro Pascal', 'Pedro Pascal'],
  ['Charlize Theron', 'Charlize Theron'],
  ['Timothée Chalamet', 'Timothée Chalamet'],
  ['Zendaya', 'Zendaya'],
  ['Florence Pugh', 'Florence Pugh'],
  ['Austin Butler', 'Austin Butler'],
  ['Barry Keoghan', 'Barry Keoghan'],
  ['Paul Mescal', 'Paul Mescal'],
  ['Carey Mulligan', 'Carey Mulligan'],
  ['Andrew Garfield', 'Andrew Garfield'],
  ['Ana de Armas', 'Ana de Armas'],
  ['Anya Taylor-Joy', 'Anya Taylor-Joy'],
  ['Frances McDormand', 'Frances McDormand'],
  ['Robert De Niro', 'Robert De Niro'],
  ['Al Pacino', 'Al Pacino'],
]);

export const TREND_DETAIL_TYPES = Object.freeze([
  'studio',
  'director',
  'cast',
  'inCinema',
  'rank',
  'newMovie',
  'comingSoon',
  'newSeries',
  'returningSeries',
  'limitedSeries',
]);

const LEGACY_RELEASE_DETAILS = Object.freeze([
  'inCinema',
  'newMovie',
  'comingSoon',
  'newSeries',
  'returningSeries',
  'limitedSeries',
]);

export function normalizeTrendDetails(value) {
  const raw = value == null || value === ''
    ? TREND_DETAIL_TYPES
    : String(value).split(',').map(item => item.trim()).filter(Boolean);
  const requested = new Set(raw);
  // Existing saved v22 configs used one "release" switch. Expand it into the
  // individual lifecycle switches so nobody silently loses their old behavior.
  if (requested.has('release')) {
    for (const type of LEGACY_RELEASE_DETAILS) requested.add(type);
  }
  return TREND_DETAIL_TYPES.filter(type => requested.has(type));
}

export function needsCredits(trendDetails) {
  const selected = new Set(trendDetails || []);
  return selected.has('director') || selected.has('cast');
}

export function spotlightLabels(details) {
  const companies = Array.isArray(details?.production_companies) ? details.production_companies : [];
  const crew = Array.isArray(details?.credits?.crew) ? details.credits.crew : [];
  const cast = Array.isArray(details?.credits?.cast) ? details.credits.cast : [];

  let studio = '';
  for (const company of companies) {
    const label = STUDIOS.get(String(company?.name || ''));
    if (label) { studio = label; break; }
  }

  let director = '';
  for (const member of crew) {
    if (String(member?.job || '').toLowerCase() !== 'director') continue;
    const label = DIRECTORS.get(String(member?.name || ''));
    if (label) { director = label; break; }
  }

  let castLabel = '';
  for (const member of cast.slice(0, 10)) {
    const label = CAST.get(String(member?.name || ''));
    if (label) { castLabel = label; break; }
  }

  return { studio, director, cast: castLabel };
}

export function chooseTrendDisplay({
  trendDetails,
  rank = '',
  lifecycle = {},
  spotlights = {},
}) {
  const selected = new Set(trendDetails || []);
  // Curated discovery labels win first. In Cinema is deliberately independent
  // and outranks daily rank; the remaining movie/TV lifecycle labels are
  // individually selectable fallbacks.
  if (selected.has('studio') && spotlights.studio) return { label: spotlights.studio, source: 'studio' };
  if (selected.has('director') && spotlights.director) return { label: spotlights.director, source: 'director' };
  if (selected.has('cast') && spotlights.cast) return { label: spotlights.cast, source: 'cast' };
  if (selected.has('inCinema') && lifecycle.inCinema) return { label: lifecycle.inCinema, source: 'inCinema' };
  if (selected.has('rank') && rank) return { label: rank, source: 'rank' };
  if (selected.has('newMovie') && lifecycle.newMovie) return { label: lifecycle.newMovie, source: 'newMovie' };
  if (selected.has('comingSoon') && lifecycle.comingSoon) return { label: lifecycle.comingSoon, source: 'comingSoon' };
  if (selected.has('newSeries') && lifecycle.newSeries) return { label: lifecycle.newSeries, source: 'newSeries' };
  if (selected.has('returningSeries') && lifecycle.returningSeries) return { label: lifecycle.returningSeries, source: 'returningSeries' };
  if (selected.has('limitedSeries') && lifecycle.limitedSeries) return { label: lifecycle.limitedSeries, source: 'limitedSeries' };
  return { label: '', source: 'none' };
}
