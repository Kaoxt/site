window.KOLLECTION_CONFIG = {
  // Public Nuvio client API. The publishable key is intentionally client-side.
  nuvioApiBase: 'https://api.nuvio.tv',
  nuvioPublishableKey: 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN',

  // The exact Kaoxt "Friends of Kaptain" assets used by the kaoxtv1 test flow.
  // For production ownership, mirror these three files into your own repository
  // and replace the URLs below with your copies.
  kaoxtDatabaseUrl: 'https://raw.githubusercontent.com/ImKaptain/Kaptain-Collection/refs/heads/main/collections/database.kaoxt.js',
  kaoxtAioCatalogsUrl: 'https://raw.githubusercontent.com/ImKaptain/Kaptain-Collection/refs/heads/main/collections/kaoxt-aio-catalogs.json',
  kaoxtAioBaseConfigUrl: 'https://raw.githubusercontent.com/ImKaptain/Kaptain-Collection/refs/heads/main/collections/kaoxt-aio-base-config.json',

  // Local copy of Kaoxt's original full AIOMetadata export is retained in the
  // package as a reference/fallback asset, but the live installer follows the
  // tested friend-pack split used by kaoxtv1 above.
  aiometadataTemplateUrl: './wizard/templates/AIOmetadata.json',
  aiometadataTemplateVersion: '2.16.5',

  aiometadataHosts: [
    { url: 'https://aiometadata.elfhosted.com/', label: 'ElfHosted', cap: 200 },
    { url: 'https://aiometadatafortheweebs.midnightignite.me/', label: 'Midnight', cap: 250 },
  ],

  bingecatUrl: 'https://bingecat.com/',
  collectionTitle: 'The Kollection',
  recommendationFolderTitles: ['For You', 'Recommend For You'],
};
