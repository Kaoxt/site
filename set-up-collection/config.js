window.KOLLECTION_CONFIG = {
  nuvioApiBase: 'https://api.nuvio.tv',
  nuvioPublishableKey: 'sb_publishable_1Clq8rlTVACkdcZuqr6_AD__xUUC_EN',

  // Runtime files hosted in your own Kaoxt/The-Kollection GitHub repository.
  kaoxtDatabaseUrl: 'https://raw.githubusercontent.com/Kaoxt/The-Kollection/main/runtime/database.kaoxt.js',
  kaoxtAioCatalogsUrl: 'https://raw.githubusercontent.com/Kaoxt/The-Kollection/main/runtime/kaoxt-aio-catalogs.json',
  kaoxtAioBaseConfigUrl: 'https://raw.githubusercontent.com/Kaoxt/The-Kollection/main/runtime/kaoxt-aio-base-config.json',

  aiometadataTemplateUrl: './set-up-collection/templates/AIOmetadata.json',
  aiometadataTemplateVersion: '2.16.5',

  aiometadataHosts: [
    { url: 'https://aiometadatafortheweebs.midnightignite.me/', label: 'Midnight', cap: 500 },
  ],

  bingecatUrl: 'https://bingecat.com/',
  collectionTitle: 'The Kollection',
  recommendationFolderTitles: ['For You', 'Recommend For You'],
};
