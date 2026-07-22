/** URL publique GCS pour electron-updater (édition Remote uniquement). */
const GCS_BUCKET = 'pos-entrprise-israel-assets';

const UPDATE_FEEDS = {
  remote: `https://storage.googleapis.com/${GCS_BUCKET}/installers/remote`,
  server: `https://storage.googleapis.com/${GCS_BUCKET}/installers/server`,
};

module.exports = { GCS_BUCKET, UPDATE_FEEDS };
