/*
 * Copyright (c) 2015 Digital Bazaar, Inc. All rights reserved.
 */

var config = require('bedrock').config;
var path = require('path');

config['messages-client'] = {};
config['messages-client'].enableScheduledJobs = true;
config['messages-client'].servers = {};
/*
config['messages-client'].servers['uniqueKey'] = {
  {
    getEndpoint: <>,
    searchEndpoint: <>.
  }
})
*/

config.scheduler.jobs.push({
  id: 'messages-client.jobs.PollServers',
  type: 'messages-client.jobs.PollServers',
  // repeat forever, run every minute
  schedule: 'R/PT1M',
  // no special priority
  priority: 0,
  concurrency: 1
});
