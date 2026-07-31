/** URLs publiques GCS pour electron-updater (Remote et Server). */
const GCS_BUCKET = 'eau-cascade-assets';

const UPDATE_FEEDS = {
  remote: `https://storage.googleapis.com/${GCS_BUCKET}/installers/remote`,
  server: `https://storage.googleapis.com/${GCS_BUCKET}/installers/server`,
};

module.exports = { GCS_BUCKET, UPDATE_FEEDS };
