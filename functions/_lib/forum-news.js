// One-time import of the release article previously published in news.html.
// The import marker survives deletion, so removed news is never recreated.
export const ANNOUNCEMENTS_ID = 4;
export const LEGACY_NEWS_KEY = 'kollection-250';
const legacyTitle = 'The Kollection 2.5.0 is out now';
const legacyBody = "Version 2.5.0 expands The Kollection to 324 catalogs, with custom backdrops and logos throughout the collection. The release covers Discover, streaming platforms, genres, studios, franchises, actors, directors, decades, awards and festivals, holidays, anime, and more.\n\nThe Kollection 2.5.0 is built around a large ready-to-import Nuvio catalog setup.\n\nWhat's included\n\n\u2022 324 catalogs with custom backdrops and logos.\n\u2022 4 Discover folders.\n\u2022 12 Streaming Platforms folders.\n\u2022 14 Genres folders.\n\u2022 13 Studios folders.\n\u2022 23 Franchises folders.\n\u2022 40 Actors folders.\n\u2022 12 Directors folders.\n\u2022 7 Decades folders.\n\u2022 5 Awards & Festivals folders.\n\u2022 5 Holidays folders.\n\u2022 12 Anime folders.\n\u2022 5 Based On folders.\n\nSetup\n\nAIOMetadata is required before adding the pack. Add your MDBList, TMDB, and TVDB API keys, import the catalog configuration from the release resources, save your configuration, and then add the generated addon URL to Nuvio.\n\nBingecat is optional. It can be used with the \"For You\" Discover folder if you want Recommended Movies and Recommended Series catalogs. If you do not want recommendations, that folder can simply be ignored or removed.\n\nThe complete release files and setup resources are available on GitHub.\n\n[Open on GitHub](https://github.com/Kaoxt/Nuvio-Collection/releases/tag/2.5.0)";
export async function importLegacyNews(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS forum_news_imports (source_key TEXT PRIMARY KEY, topic_id INTEGER)').run();
  const existing=await db.prepare('SELECT topic_id FROM forum_news_imports WHERE source_key=?').bind(LEGACY_NEWS_KEY).first();
  if(existing)return existing.topic_id;
  // A separate publisher identity preserves the original article's site attribution.
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO forum_members(id,user_id,author,created_at) VALUES('kollection-news-archive','system:kollection-news-archive','The Kollection','2026-08-08T12:00:00.000Z')"),
    db.prepare(`INSERT INTO forum_topics(member_id,category_id,title,body,created_at,updated_at)
      SELECT 'kollection-news-archive',?,?,?,'2026-08-08T12:00:00.000Z','2026-08-08T12:00:00.000Z'
      WHERE NOT EXISTS(SELECT 1 FROM forum_news_imports WHERE source_key=?)`).bind(ANNOUNCEMENTS_ID,legacyTitle,legacyBody,LEGACY_NEWS_KEY),
    db.prepare(`INSERT OR IGNORE INTO forum_news_imports(source_key,topic_id)
      SELECT ?,id FROM forum_topics WHERE member_id='kollection-news-archive' AND category_id=? AND title=? ORDER BY id DESC LIMIT 1`).bind(LEGACY_NEWS_KEY,ANNOUNCEMENTS_ID,legacyTitle),
  ]);
  return (await db.prepare('SELECT topic_id FROM forum_news_imports WHERE source_key=?').bind(LEGACY_NEWS_KEY).first())?.topic_id;
}
