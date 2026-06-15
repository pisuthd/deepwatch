import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource.js';
import { data } from './data/resource.js';
// import { fetchMarkets } from './functions/fetch-markets/resource.js';

defineBackend({
  auth,
  data,
  // fetchMarkets,
});
