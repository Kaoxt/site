window.KOLLECTION_CONFIG = {
  // Public Nuvio client API. The publishable key is intentionally client-side.
  nuvioApiBase: 'https://api.nuvio.tv',
  nuvioPublishableKey: 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN',

  // Runtime files are served directly from the Kaoxt/site repository.
  kaoxtDatabaseUrl: '/runtime/database.kaoxt.js',
  kaoxtAioCatalogsUrl: '/runtime/kaoxt-aio-catalogs.json',
  kaoxtAioBaseConfigUrl: '/runtime/kaoxt-aio-base-config.json',

  // Local AIOMetadata template retained as a reference/fallback.
  aiometadataTemplateUrl: './set-up-collection/templates/AIOmetadata.json',
  aiometadataTemplateVersion: '2.16.5',

  aiometadataHosts: [
    { url: 'https://aiometadatafortheweebs.midnightignite.me/', label: 'Midnight', cap: 500 },
  ],

  bingecatUrl: 'https://bingecat.com/',
  collectionTitle: 'The Kollection',
  recommendationFolderTitles: ['For You', 'Recommend For You'],
};
